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
} from "../schemas.js";
import {
  completeConnect,
  deleteAccount,
  findAccount,
  listAccounts,
  publishPost,
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
    const post = await publishPost({ account, ...parsed.data });
    res.status(201).json({
      accountId: account.id,
      postId: post.postId,
      permalink: post.permalink,
      replyToPostId: parsed.data.replyToPostId ?? null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
