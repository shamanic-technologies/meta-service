/**
 * THREADS POST IMPORT (OUTCOME-FINEST-1106, owner 2026-11-06: « On branche le compte … Tous les
 * posts arrivent, même ceux que tu as écrits à la main »).
 *
 * A connected Threads account brings EVERY main post it published, hand posts included. Each post
 * not on record lands in `threads_publications` (origin `imported`, performedBy `client_team`) and
 * is ONE Unit of `threads_post_published`, so the post's views, engagement, clicks, visits and
 * signups count under the finest outcome (social-service reads its insights through
 * `/internal/threads/measurable-posts`, like a post we published).
 *
 * Runs (all of the CONNECTING org, identity from the account row: src/lib/threads-runs.ts):
 * - one IMPORT run per account per pass (`threads-post-import`): the timeline read happens on it,
 *   and it is the post's `runId` (the parent social-service hangs its post_viewed runs on);
 * - one spend-free UNIT run per imported post (`threads-post-imported`, child of the import run,
 *   idempotency key `threads-import:<publication id>`) that declares the post's
 *   `threads_post_published`, performer `client_team`, DATED at the post's own Threads time
 *   (runs-service lets a spend-free run of its own service date a past fact; such a run takes no
 *   child, which is why the import run, not the unit run, is the post's `runId`).
 *
 * A post this service published is already on record (same Threads user + post id in the org): it
 * is never imported twice and keeps the outcome its publish declared. A repost of someone else's
 * post (REPOST_FACADE) is not the account's post. Replies are not on the timeline read. The Threads
 * API is free: no cost line.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { threadsAccounts, threadsPublications, type ThreadsAccount, type ThreadsPublication } from "../db/schema.js";
import { decrypt } from "./crypto.js";
import { completeRun, createRun, declareRunOutcomes } from "./services.js";
import { listAccountPosts, REPOST_MEDIA_TYPE, ThreadsApiError } from "./threads-client.js";
import { deadTokenReason, healthOf, markNeedsReconnect } from "./threads-accounts.js";
import { onAccountRun } from "./threads-runs.js";
import { SUBJECT_SERVICE, THREADS_POST_PUBLISHED } from "./threads-publications.js";

export const IMPORT_TASK = "threads-post-import";
export const UNIT_TASK = "threads-post-imported";
const MAX_PAGES = () => {
  const n = Number(process.env.THREADS_IMPORT_MAX_PAGES ?? 20);
  return Number.isFinite(n) && n > 0 ? n : 20;
};

export interface ImportSummary {
  accountsRead: number;
  accountsSkipped: number;
  postsImported: number;
  outcomesDeclared: number;
  errors: Array<{ accountId: string; error: string }>;
}

/** Reads the account's timeline on its own org's run and records every post not on record. */
async function importTimeline(account: ThreadsAccount, runId: string): Promise<{ imported: number; walkedToEnd: boolean }> {
  const token = decrypt(account.accessToken);
  const firstWalk = account.postsImportedAt === null;
  let after: string | null = null;
  let imported = 0;
  for (let page = 0; page < MAX_PAGES(); page++) {
    const read = await listAccountPosts({ token, threadsUserId: account.threadsUserId, after });
    const own = read.posts.filter((p) => p.mediaType !== REPOST_MEDIA_TYPE);
    const ids = own.map((p) => p.id);
    const known = ids.length
      ? new Set(
          (
            await db
              .select({ id: threadsPublications.threadsPostId })
              .from(threadsPublications)
              .where(
                and(
                  eq(threadsPublications.orgId, account.orgId),
                  eq(threadsPublications.threadsUserId, account.threadsUserId),
                  inArray(threadsPublications.threadsPostId, ids),
                ),
              )
          ).map((r) => r.id),
        )
      : new Set<string>();
    const fresh = own.filter((p) => !known.has(p.id));
    if (fresh.length) {
      const rows = await db
        .insert(threadsPublications)
        .values(
          fresh.map((p) => ({
            orgId: account.orgId,
            brandId: account.brandId,
            accountId: account.id,
            threadsUserId: account.threadsUserId,
            accountUsername: account.username,
            accountType: account.accountType,
            userId: account.connectedByUserId,
            runId,
            campaignId: null,
            kind: "post",
            threadRootPostId: p.id,
            text: p.text ?? "",
            publishedText: p.text ?? "",
            status: "published",
            threadsPostId: p.id,
            permalink: p.permalink,
            origin: "imported",
            performedBy: "client_team",
            outcomeKey: THREADS_POST_PUBLISHED,
            mediaType: p.mediaType,
            publishedAt: new Date(p.timestamp),
          })),
        )
        .onConflictDoNothing()
        .returning({ id: threadsPublications.id });
      imported += rows.length;
    }
    if (!read.after) return { imported, walkedToEnd: true };
    // After the first full walk, a page holding nothing new means everything older is on record.
    if (!firstWalk && fresh.length === 0) return { imported, walkedToEnd: true };
    after = read.after;
  }
  console.warn(`[meta-service] threads import: @${account.username} (${account.id}) has more than ${MAX_PAGES()} pages of posts; older ones are not read`);
  return { imported, walkedToEnd: true };
}

/**
 * Declares one imported post's `threads_post_published` on its own unit run (child of the import
 * run, dated at the post's time, performer client_team). The unit run id is kept BEFORE the
 * declaration so a retry names the same run (runs-service answers already_recorded).
 */
export async function declareImported(row: ThreadsPublication): Promise<void> {
  const unit = await createRun(
    { ...accountRunIdentityOf(row), taskName: UNIT_TASK, parentRunId: row.runId },
    `threads-import:${row.id}`,
  );
  if (row.outcomeRunId !== unit.id) {
    await db.update(threadsPublications).set({ outcomeRunId: unit.id, updatedAt: new Date() }).where(eq(threadsPublications.id, row.id));
  }
  await declareRunOutcomes(
    unit.id,
    row.orgId,
    [
      {
        outcomeKey: row.outcomeKey,
        subjectService: SUBJECT_SERVICE,
        subjectId: row.id,
        performer: { kind: "client_team", name: "threads" },
      },
    ],
    undefined,
    { occurredAt: row.publishedAt!.toISOString() },
  );
  await completeRun(unit.id, "completed").catch((err) =>
    console.error(`[meta-service] unit run ${unit.id} not closed:`, err instanceof Error ? err.message : err),
  );
  await db.update(threadsPublications).set({ outcomeDeclaredAt: new Date(), updatedAt: new Date() }).where(eq(threadsPublications.id, row.id));
}

/** The unit run's identity: the publication's own org / brand / connecting user (snapshotted from the account). */
function accountRunIdentityOf(row: ThreadsPublication) {
  return { orgId: row.orgId, userId: row.userId, brandId: row.brandId, serviceName: "meta-service" };
}

/** Every imported post of this account whose outcome has not landed yet (new ones, and retries). */
async function declarePending(accountId: string, summary: ImportSummary): Promise<void> {
  const pending = await db
    .select()
    .from(threadsPublications)
    .where(
      and(
        eq(threadsPublications.accountId, accountId),
        eq(threadsPublications.origin, "imported"),
        isNull(threadsPublications.outcomeDeclaredAt),
      ),
    );
  for (const row of pending) {
    try {
      await declareImported(row);
      summary.outcomesDeclared++;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.error(`[meta-service] OUTCOME NOT DECLARED: ${row.outcomeKey} ${SUBJECT_SERVICE}/${row.id} (imported, org ${row.orgId}): ${error.slice(0, 300)}`);
      summary.errors.push({ accountId, error: `declare ${row.id}: ${error.slice(0, 300)}` });
    }
  }
}

/** One account: read its timeline on a run of its org, record the new posts, declare what is pending. */
export async function importAccount(account: ThreadsAccount, summary: ImportSummary, now = new Date()): Promise<void> {
  if (healthOf(account, now).health === "needs_reconnect") {
    summary.accountsSkipped++;
    return;
  }
  try {
    const { imported, walkedToEnd } = await onAccountRun(account, IMPORT_TASK, (runId) => importTimeline(account, runId));
    summary.accountsRead++;
    summary.postsImported += imported;
    if (walkedToEnd) {
      await db.update(threadsAccounts).set({ postsImportedAt: now }).where(eq(threadsAccounts.id, account.id));
    }
  } catch (err) {
    if (err instanceof ThreadsApiError && err.tokenInvalid) {
      await markNeedsReconnect(account.id, deadTokenReason(err));
      summary.accountsSkipped++;
    } else {
      summary.errors.push({ accountId: account.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  await declarePending(account.id, summary);
}

/** Every connected account, one after the other (the cron's pass and `POST /internal/threads/import`). */
export async function runThreadsImport(now = new Date()): Promise<ImportSummary> {
  const summary: ImportSummary = { accountsRead: 0, accountsSkipped: 0, postsImported: 0, outcomesDeclared: 0, errors: [] };
  const accounts = await db.select().from(threadsAccounts).where(eq(threadsAccounts.status, "connected"));
  for (const account of accounts) await importAccount(account, summary, now);
  return summary;
}
