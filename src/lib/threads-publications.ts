/**
 * Threads publications on record: every post and reply this service published,
 * idempotent on the caller's own key, and the `post_published` outcome a MAIN
 * post declares on the caller's run.
 *
 * - Same idempotency key (per org) = the same publication answered back, Threads
 *   never called again. The key is claimed by a `publishing` row BEFORE the
 *   Threads call, so two concurrent calls with one key publish once.
 * - A main post is ONE `post_published` occurrence (catalogue step, object;
 *   subject = this row), declared on the caller's run (x-run-id). A reply is part
 *   of its thread and declares nothing. The Threads API is free: no cost.
 */
import { and, asc, desc, eq, gte, isNotNull, lte, sql, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  threadsAccounts,
  threadsPublications,
  type ThreadsAccount,
  type ThreadsPublication,
} from "../db/schema.js";
import { declareRunOutcomes, getBrandDomain } from "./services.js";
import { dyPostValue, withOwnLinkParam } from "./own-link.js";
import { THREADS_TEXT_MAX } from "./threads-limits.js";
import { publishPost, readPostInsights } from "./threads-accounts.js";
import type { PostInsights } from "./threads-client.js";

export const POST_PUBLISHED = "post_published";
export const SUBJECT_SERVICE = "meta-service";

export type PublicationKind = "post" | "reply";

/** The caller asked for something the key already names differently, or a publish with that key is still running. 409. */
export class ThreadsPublishConflictError extends Error {
  readonly reason: "idempotency_key_reused" | "publish_in_progress";
  readonly publicationId: string;
  constructor(
    reason: "idempotency_key_reused" | "publish_in_progress",
    publicationId: string,
    message: string,
  ) {
    super(message);
    this.name = "ThreadsPublishConflictError";
    this.reason = reason;
    this.publicationId = publicationId;
  }
}

export interface PublishIdentity {
  orgId: string;
  userId: string;
  runId: string;
  campaignId: string | null;
}

export interface OutcomeState {
  outcomeKey: string;
  declared: boolean;
  error: string | null;
}

export interface PublishResult {
  publication: ThreadsPublication;
  replayed: boolean;
  outcome: OutcomeState | null;
}

async function findByKey(orgId: string, key: string) {
  const rows = await db
    .select()
    .from(threadsPublications)
    .where(
      and(
        eq(threadsPublications.orgId, orgId),
        eq(threadsPublications.idempotencyKey, key),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Declares the main post's outcome once. A miss does not unpublish anything: it
 * is logged loud, answered as `declared: false`, and retried by the next call
 * carrying the same idempotency key.
 */
async function ensureOutcome(row: ThreadsPublication): Promise<OutcomeState | null> {
  if (row.kind !== "post") return null;
  if (row.outcomeDeclaredAt) {
    return { outcomeKey: POST_PUBLISHED, declared: true, error: null };
  }
  try {
    await declareRunOutcomes(row.runId, row.orgId, [
      { outcomeKey: POST_PUBLISHED, subjectService: SUBJECT_SERVICE, subjectId: row.id },
    ]);
    await db
      .update(threadsPublications)
      .set({ outcomeDeclaredAt: new Date(), updatedAt: new Date() })
      .where(eq(threadsPublications.id, row.id));
    return { outcomeKey: POST_PUBLISHED, declared: true, error: null };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(
      `[meta-service] OUTCOME NOT DECLARED: ${POST_PUBLISHED} ${SUBJECT_SERVICE}/${row.id} on run ${row.runId} (org ${row.orgId}): ${error.slice(0, 300)}`,
    );
    return { outcomeKey: POST_PUBLISHED, declared: false, error };
  }
}

function sameRequest(
  row: ThreadsPublication,
  accountId: string,
  text: string,
  replyToPostId: string | null,
): boolean {
  return (
    row.accountId === accountId &&
    row.text === text &&
    (row.replyToPostId ?? null) === replyToPostId
  );
}

async function answerExisting(
  row: ThreadsPublication,
  accountId: string,
  text: string,
  replyToPostId: string | null,
): Promise<PublishResult> {
  if (!sameRequest(row, accountId, text, replyToPostId)) {
    throw new ThreadsPublishConflictError(
      "idempotency_key_reused",
      row.id,
      "This idempotency key already names another publication (different account, text or parent post). Use a new key.",
    );
  }
  if (row.status !== "published") {
    throw new ThreadsPublishConflictError(
      "publish_in_progress",
      row.id,
      "A publish with this idempotency key is still in flight. Read the publications before trying again.",
    );
  }
  return { publication: row, replayed: true, outcome: await ensureOutcome(row) };
}

/**
 * Every link to the brand's own site carries the post's `dy_post` (src/lib/own-link.ts), so a visit
 * and the signup after it credit the run that published it. A reply's links name the thread's MAIN
 * post. Never blocks a publication: an unreadable brand or a text the parameter would push past
 * Threads' limit publishes as written, the reason kept on the row and logged.
 */
async function trackOwnLinks(p: { orgId: string; brandId: string; claimId: string; rootPostId: string | null; text: string }): Promise<{ text: string; status: string }> {
  let subjectId = p.claimId;
  if (p.rootPostId) {
    const [root] = await db
      .select({ id: threadsPublications.id })
      .from(threadsPublications)
      .where(and(eq(threadsPublications.orgId, p.orgId), eq(threadsPublications.threadsPostId, p.rootPostId), eq(threadsPublications.kind, "post")))
      .limit(1);
    if (!root) {
      console.warn(`[meta-service] LINK NOT TRACKED: reply under ${p.rootPostId}, whose main post is not on record`);
      return { text: p.text, status: "root_unknown" };
    }
    subjectId = root.id;
  }
  let domain: string | null;
  try {
    domain = await getBrandDomain(p.brandId);
  } catch (err) {
    console.error(`[meta-service] LINK NOT TRACKED: brand ${p.brandId} domain unreadable:`, err instanceof Error ? err.message : err);
    return { text: p.text, status: "brand_unreadable" };
  }
  const out = withOwnLinkParam(p.text, domain, dyPostValue(SUBJECT_SERVICE, subjectId));
  if (out.count === 0) return { text: p.text, status: "no_own_link" };
  if (out.text.length > THREADS_TEXT_MAX) {
    console.warn(`[meta-service] LINK NOT TRACKED: publication ${p.claimId} would be ${out.text.length} chars with dy_post (limit ${THREADS_TEXT_MAX})`);
    return { text: p.text, status: "too_long" };
  }
  return { text: out.text, status: `tracked:${out.count}` };
}

export async function publishAndRecord(params: {
  account: ThreadsAccount;
  identity: PublishIdentity;
  text: string;
  replyToPostId?: string;
  idempotencyKey?: string;
}): Promise<PublishResult> {
  const { account, identity, text } = params;
  const replyToPostId = params.replyToPostId ?? null;
  const key = params.idempotencyKey ?? null;

  if (key) {
    const existing = await findByKey(identity.orgId, key);
    if (existing) return answerExisting(existing, account.id, text, replyToPostId);
  }

  // The claim: inserted before Threads is called. A concurrent call with the same
  // key loses the insert and is answered from the winner's row.
  const [claim] = await db
    .insert(threadsPublications)
    .values({
      orgId: identity.orgId,
      brandId: account.brandId,
      accountId: account.id,
      threadsUserId: account.threadsUserId,
      accountUsername: account.username,
      accountType: account.accountType,
      userId: identity.userId,
      runId: identity.runId,
      campaignId: identity.campaignId,
      kind: replyToPostId ? "reply" : "post",
      replyToPostId,
      text,
      status: "publishing",
      idempotencyKey: key,
    })
    .onConflictDoNothing()
    .returning();

  if (!claim) {
    const winner = await findByKey(identity.orgId, key!);
    if (!winner) throw new Error("idempotency claim lost but no row holds the key");
    return answerExisting(winner, account.id, text, replyToPostId);
  }

  // The thread's root publication: a reply's links credit the MAIN post (the one post_published).
  let parentRoot: string | null = null;
  if (replyToPostId) {
    const [parent] = await db
      .select({ root: threadsPublications.threadRootPostId })
      .from(threadsPublications)
      .where(
        and(
          eq(threadsPublications.orgId, identity.orgId),
          eq(threadsPublications.threadsPostId, replyToPostId),
          eq(threadsPublications.status, "published"),
        ),
      )
      .limit(1);
    parentRoot = parent?.root ?? replyToPostId;
  }
  const tracked = await trackOwnLinks({ orgId: identity.orgId, brandId: account.brandId, claimId: claim.id, rootPostId: parentRoot, text });

  let post;
  try {
    post = await publishPost({ account, text: tracked.text, replyToPostId: replyToPostId ?? undefined });
  } catch (err) {
    // Nothing published: free the key so the caller can try again.
    await db.delete(threadsPublications).where(eq(threadsPublications.id, claim.id));
    throw err;
  }

  const threadRootPostId = parentRoot ?? post.postId;

  const now = new Date();
  const [published] = await db
    .update(threadsPublications)
    .set({
      status: "published",
      threadsPostId: post.postId,
      permalink: post.permalink,
      threadRootPostId,
      publishedText: tracked.text,
      linkTracking: tracked.status,
      publishedAt: now,
      updatedAt: now,
    })
    .where(eq(threadsPublications.id, claim.id))
    .returning();

  return { publication: published, replayed: false, outcome: await ensureOutcome(published) };
}

export const DEFAULT_WINDOW_DAYS = 30;

export async function listPublications(params: {
  orgId: string;
  campaignId?: string;
  brandId?: string;
  since: Date;
  until?: Date;
  limit: number;
}): Promise<ThreadsPublication[]> {
  const filters: SQL[] = [
    eq(threadsPublications.orgId, params.orgId),
    eq(threadsPublications.status, "published"),
    gte(threadsPublications.publishedAt, params.since),
  ];
  if (params.until) filters.push(lte(threadsPublications.publishedAt, params.until));
  if (params.campaignId) filters.push(eq(threadsPublications.campaignId, params.campaignId));
  if (params.brandId) filters.push(eq(threadsPublications.brandId, params.brandId));
  return db
    .select()
    .from(threadsPublications)
    .where(and(...filters))
    .orderBy(desc(threadsPublications.publishedAt), desc(threadsPublications.createdAt))
    .limit(params.limit);
}

/**
 * FLEET-WIDE main posts on record whose `post_published` landed on runs-service
 * (FACTORY-P2-CONTENT-OUTCOMES): what social-service measures (views, engagement)
 * and declares outcomes on, each consuming that `post_published`. Oldest first,
 * keyset on (published_at, id) so a reader pages without gaps.
 */
export async function listMeasurablePosts(params: {
  since: Date;
  after?: { publishedAt: Date; id: string };
  limit: number;
}): Promise<ThreadsPublication[]> {
  const filters: SQL[] = [
    eq(threadsPublications.status, "published"),
    eq(threadsPublications.kind, "post"),
    isNotNull(threadsPublications.outcomeDeclaredAt),
    gte(threadsPublications.publishedAt, params.since),
  ];
  if (params.after) {
    filters.push(
      sql`(${threadsPublications.publishedAt}, ${threadsPublications.id}) > (${params.after.publishedAt.toISOString()}::timestamptz, ${params.after.id}::uuid)`,
    );
  }
  return db
    .select()
    .from(threadsPublications)
    .where(and(...filters))
    .orderBy(asc(threadsPublications.publishedAt), asc(threadsPublications.id))
    .limit(params.limit);
}

export class PublicationNotMeasurableError extends Error {
  constructor(readonly publicationId: string, message: string) {
    super(message);
    this.name = "PublicationNotMeasurableError";
  }
}

/**
 * The live insights of one MAIN post (FACTORY-P2-CONTENT-OUTCOMES), read on the
 * account that published it. Null = no such publication. Stores nothing:
 * social-service keeps the series (bronze call + silver snapshot) and declares the
 * outcomes.
 */
export async function publicationInsights(id: string): Promise<{
  publication: ThreadsPublication;
  observedAt: string;
  insights: PostInsights;
  raw: unknown;
} | null> {
  const [publication] = await db.select().from(threadsPublications).where(eq(threadsPublications.id, id)).limit(1);
  if (!publication) return null;
  if (publication.kind !== "post" || publication.status !== "published" || !publication.threadsPostId) {
    throw new PublicationNotMeasurableError(id, "Only a published MAIN post has insights of its own");
  }
  const [account] = await db.select().from(threadsAccounts).where(eq(threadsAccounts.id, publication.accountId)).limit(1);
  if (!account) {
    throw new PublicationNotMeasurableError(id, `The Threads account that published it (@${publication.accountUsername}) is no longer connected`);
  }
  const observedAt = new Date().toISOString();
  const { insights, raw } = await readPostInsights({ account, postId: publication.threadsPostId });
  return { publication, observedAt, insights, raw };
}

export function serialisePublication(row: ThreadsPublication) {
  return {
    id: row.id,
    accountId: row.accountId,
    accountUsername: row.accountUsername,
    accountType: row.accountType,
    brandId: row.brandId,
    campaignId: row.campaignId,
    runId: row.runId,
    userId: row.userId,
    kind: row.kind as PublicationKind,
    replyToPostId: row.replyToPostId,
    threadRootPostId: row.threadRootPostId,
    postId: row.threadsPostId!,
    permalink: row.permalink,
    text: row.text,
    publishedText: row.publishedText ?? row.text,
    linkTracking: row.linkTracking,
    publishedAt: row.publishedAt!.toISOString(),
  };
}
