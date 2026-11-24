/**
 * Threads accounts a user connects to their brand, any number, each with an
 * account type. The login is Threads' own OAuth on our Meta app; the page that
 * receives Threads' redirect is the caller's (the dashboard), which hands
 * `code` + `state` back to the callback route below.
 */
import { Router } from "express";
import {
  ThreadsAccountUpdateSchema,
  ThreadsConnectCallbackSchema,
  ThreadsConnectStartSchema,
  ThreadsPublishSchema,
  ThreadsPublicationsQuerySchema,
  ThreadsPostPublishedUnitsQuerySchema,
} from "../schemas.js";
import {
  InvalidCursorError,
  UnitsQueryError,
  listPostPublishedUnits,
  parseUnitsQuery,
  type UnitsFilters,
} from "../lib/threads-units.js";
import { THREADS_POST_PUBLISHED } from "../lib/threads-publications.js";
import {
  DEFAULT_WINDOW_DAYS,
  listPublications,
  publishAndRecord,
  serialisePublication,
} from "../lib/threads-publications.js";
import {
  completeConnect,
  deleteAccount,
  findAccount,
  listAccounts,
  serialiseAccount,
  setAccountType,
  startConnect,
} from "../lib/threads-accounts.js";

const router = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound(res: import("express").Response) {
  res.status(404).json({ error: "Threads account not found" });
}

function invalid(res: import("express").Response, details: unknown) {
  res.status(400).json({ error: "Invalid request", details });
}

router.post("/orgs/threads/auth/start", async (req, res, next) => {
  const parsed = ThreadsConnectStartSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error.flatten());
  try {
    res.json(
      await startConnect({
        ...parsed.data,
        orgId: res.locals.orgId,
        userId: res.locals.userId,
        runId: res.locals.runId,
        caller: { method: "POST", path: "/orgs/threads/auth/start" },
      }),
    );
  } catch (err) {
    next(err);
  }
});

router.post("/orgs/threads/auth/callback", async (req, res, next) => {
  const parsed = ThreadsConnectCallbackSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error.flatten());
  try {
    const { account, created } = await completeConnect({
      ...parsed.data,
      orgId: res.locals.orgId,
      userId: res.locals.userId,
      runId: res.locals.runId,
      caller: { method: "POST", path: "/orgs/threads/auth/callback" },
    });
    res.json({ account: serialiseAccount(account), created });
  } catch (err) {
    next(err);
  }
});

router.get("/orgs/threads/accounts", async (req, res, next) => {
  const brandId =
    typeof req.query.brandId === "string" && req.query.brandId
      ? req.query.brandId
      : undefined;
  try {
    const rows = await listAccounts(res.locals.orgId, brandId);
    const now = new Date();
    res.json({ accounts: rows.map((row) => serialiseAccount(row, now)) });
  } catch (err) {
    next(err);
  }
});

router.patch("/orgs/threads/accounts/:id", async (req, res, next) => {
  if (!UUID.test(req.params.id)) return notFound(res);
  const parsed = ThreadsAccountUpdateSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error.flatten());
  try {
    const account = await setAccountType(
      req.params.id,
      res.locals.orgId,
      parsed.data.accountType,
    );
    if (!account) {
      notFound(res);
      return;
    }
    res.json({ account: serialiseAccount(account) });
  } catch (err) {
    next(err);
  }
});

router.delete("/orgs/threads/accounts/:id", async (req, res, next) => {
  if (!UUID.test(req.params.id)) return notFound(res);
  try {
    const removed = await deleteAccount(req.params.id, res.locals.orgId);
    if (!removed) {
      notFound(res);
      return;
    }
    res.json({ message: "Threads account disconnected" });
  } catch (err) {
    next(err);
  }
});

router.post("/orgs/threads/accounts/:id/posts", async (req, res, next) => {
  if (!UUID.test(req.params.id)) return notFound(res);
  const parsed = ThreadsPublishSchema.safeParse(req.body);
  if (!parsed.success) return invalid(res, parsed.error.flatten());
  try {
    const account = await findAccount(req.params.id, res.locals.orgId);
    if (!account) {
      notFound(res);
      return;
    }
    const header = req.headers["x-campaign-id"];
    const campaignId = typeof header === "string" && header ? header : null;
    const { publication, replayed, outcome } = await publishAndRecord({
      account,
      identity: {
        orgId: res.locals.orgId,
        userId: res.locals.userId,
        runId: res.locals.runId,
        campaignId,
      },
      ...parsed.data,
    });
    res.status(replayed ? 200 : 201).json({
      accountId: account.id,
      postId: publication.threadsPostId,
      permalink: publication.permalink,
      replyToPostId: publication.replyToPostId,
      publicationId: publication.id,
      kind: publication.kind,
      threadRootPostId: publication.threadRootPostId,
      publishedAt: publication.publishedAt!.toISOString(),
      replayed,
      outcome,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/orgs/threads/publications", async (req, res, next) => {
  const parsed = ThreadsPublicationsQuerySchema.safeParse(req.query);
  if (!parsed.success) return invalid(res, parsed.error.flatten());
  const { campaignId, brandId, since, until, limit } = parsed.data;
  try {
    const rows = await listPublications({
      orgId: res.locals.orgId,
      campaignId,
      brandId,
      since: since ?? new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000),
      until,
      limit,
    });
    res.json({ publications: rows.map(serialisePublication) });
  } catch (err) {
    next(err);
  }
});

/**
 * Provider read of our Units of `threads_post_published` (ENGINE-GET-ASK-1123): found by its
 * OpenAPI tag, called as a script's run. The calling org's own records only; no Threads call.
 */
router.get("/orgs/units/threads-post-published", async (req, res, next) => {
  const parsed = ThreadsPostPublishedUnitsQuerySchema.safeParse(req.query);
  if (!parsed.success) return invalid(res, parsed.error.flatten());
  let filters: UnitsFilters;
  try {
    filters = parseUnitsQuery(res.locals.orgId, parsed.data);
  } catch (err) {
    if (err instanceof InvalidCursorError) {
      res.status(400).json({ error: "invalid_cursor", message: err.message });
      return;
    }
    if (err instanceof UnitsQueryError) {
      return invalid(res, { formErrors: [], fieldErrors: { [err.field]: [err.message] } });
    }
    return next(err);
  }
  try {
    const page = await listPostPublishedUnits(filters);
    res.json({
      success: true,
      outcome: THREADS_POST_PUBLISHED,
      count: page.units.length,
      units: page.units,
      nextCursor: page.nextCursor,
    });
  } catch (err) {
    // Fail loud: an empty page on a read failure would read as "nothing was ever posted".
    next(err);
  }
});

export default router;
