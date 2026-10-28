/**
 * Connected Threads accounts: connect, list, retype, disconnect, publish, and
 * keep the token alive.
 *
 * Any number of accounts per brand, of any type. One Threads account connected
 * twice on the same brand is ONE row: the reconnect refreshes its token and
 * profile in place.
 */
import crypto from "crypto";
import { and, asc, eq, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  threadsAccounts,
  threadsOauthPending,
  type ThreadsAccount,
} from "../db/schema.js";
import { ACCOUNT_TYPES, type AccountType } from "./account-types.js";
import { decrypt, encrypt } from "./crypto.js";
import { getPlatformKey, type CallerContext } from "./key-service.js";
import {
  buildAuthorizeUrl,
  exchangeCode,
  exchangeForLongLivedToken,
  getPostInsights,
  getProfile,
  publishText,
  THREADS_INSIGHTS_SCOPE,
  type PostInsights,
  refreshLongLivedToken,
  requestedScopes,
  ThreadsApiError,
  type PublishedPost,
  type ThreadsAppCredentials,
} from "./threads-client.js";

export type AccountHealth = "connected" | "needs_reconnect";

const PENDING_TTL_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A Threads login that cannot be completed as asked: 400, names why. */
export class ThreadsRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThreadsRequestError";
  }
}

/** The account's token is dead; a human must reconnect it. 409. */
export class ThreadsReconnectRequiredError extends Error {
  readonly accountId: string;
  constructor(accountId: string, reason: string) {
    super(reason);
    this.name = "ThreadsReconnectRequiredError";
    this.accountId = accountId;
  }
}

export async function getThreadsAppCredentials(
  caller: CallerContext,
  runId?: string,
): Promise<ThreadsAppCredentials> {
  const [appId, appSecret] = await Promise.all([
    getPlatformKey("threads-app-id", caller, runId),
    getPlatformKey("threads-app-secret", caller, runId),
  ]);
  return { appId, appSecret };
}

// ==================== Read model ====================

export function healthOf(
  account: ThreadsAccount,
  now = new Date(),
): { health: AccountHealth; healthReason: string | null } {
  if (account.status === "needs_reconnect") {
    return {
      health: "needs_reconnect",
      healthReason:
        account.statusReason ??
        "Threads no longer accepts this login. Reconnect the account.",
    };
  }
  if (account.tokenExpiresAt.getTime() <= now.getTime()) {
    return {
      health: "needs_reconnect",
      healthReason: `The Threads login expired on ${account.tokenExpiresAt.toISOString().slice(0, 10)}. Reconnect the account.`,
    };
  }
  return { health: "connected", healthReason: null };
}

export function serialiseAccount(account: ThreadsAccount, now = new Date()) {
  const type = account.accountType as AccountType;
  return {
    id: account.id,
    brandId: account.brandId,
    threadsUserId: account.threadsUserId,
    username: account.username,
    name: account.name,
    profilePictureUrl: account.profilePictureUrl,
    profileUrl: `https://www.threads.net/@${account.username}`,
    accountType: type,
    accountTypeLabel: ACCOUNT_TYPES[type],
    ...healthOf(account, now),
    tokenExpiresAt: account.tokenExpiresAt.toISOString(),
    connectedByUserId: account.connectedByUserId,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

// ==================== Connect ====================

export async function startConnect(params: {
  orgId: string;
  userId: string;
  runId: string;
  brandId: string;
  accountType: AccountType;
  redirectUri: string;
  caller: CallerContext;
}): Promise<{ authorizationUrl: string; state: string; expiresAt: string }> {
  const creds = await getThreadsAppCredentials(params.caller, params.runId);
  const state = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + PENDING_TTL_MS);

  await db.insert(threadsOauthPending).values({
    state,
    orgId: params.orgId,
    userId: params.userId,
    brandId: params.brandId,
    accountType: params.accountType,
    redirectUri: params.redirectUri,
    expiresAt,
  });

  return {
    authorizationUrl: buildAuthorizeUrl({
      appId: creds.appId,
      redirectUri: params.redirectUri,
      state,
    }),
    state,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function completeConnect(params: {
  orgId: string;
  userId: string;
  runId: string;
  code: string;
  state: string;
  caller: CallerContext;
}): Promise<{ account: ThreadsAccount; created: boolean }> {
  // Single use: the state is consumed whatever happens next.
  const [pending] = await db
    .delete(threadsOauthPending)
    .where(
      and(
        eq(threadsOauthPending.state, params.state),
        eq(threadsOauthPending.orgId, params.orgId),
      ),
    )
    .returning();

  if (!pending) {
    throw new ThreadsRequestError(
      "This Threads login is unknown or was already used. Start the connection again.",
    );
  }
  if (pending.expiresAt.getTime() <= Date.now()) {
    throw new ThreadsRequestError(
      "This Threads login took longer than 15 minutes and expired. Start the connection again.",
    );
  }

  const creds = await getThreadsAppCredentials(params.caller, params.runId);
  const shortLived = await exchangeCode(creds, params.code, pending.redirectUri);
  const longLived = await exchangeForLongLivedToken(creds, shortLived.accessToken);
  const profile = await getProfile(longLived.accessToken);

  const now = new Date();
  const tokenExpiresAt = new Date(now.getTime() + longLived.expiresInSeconds * 1000);
  const encryptedToken = encrypt(longLived.accessToken);

  const existing = await db
    .select({ id: threadsAccounts.id })
    .from(threadsAccounts)
    .where(
      and(
        eq(threadsAccounts.orgId, pending.orgId),
        eq(threadsAccounts.brandId, pending.brandId),
        eq(threadsAccounts.threadsUserId, profile.id),
      ),
    )
    .limit(1);

  const [account] = await db
    .insert(threadsAccounts)
    .values({
      orgId: pending.orgId,
      brandId: pending.brandId,
      connectedByUserId: params.userId,
      threadsUserId: profile.id,
      username: profile.username,
      name: profile.name,
      profilePictureUrl: profile.profilePictureUrl,
      accountType: pending.accountType,
      accessToken: encryptedToken,
      tokenIssuedAt: now,
      tokenExpiresAt,
      scopes: requestedScopes(),
      status: "connected",
      statusReason: null,
    })
    .onConflictDoUpdate({
      target: [
        threadsAccounts.orgId,
        threadsAccounts.brandId,
        threadsAccounts.threadsUserId,
      ],
      set: {
        connectedByUserId: params.userId,
        username: profile.username,
        name: profile.name,
        profilePictureUrl: profile.profilePictureUrl,
        accountType: pending.accountType,
        accessToken: encryptedToken,
        tokenIssuedAt: now,
        tokenExpiresAt,
        scopes: requestedScopes(),
        status: "connected",
        statusReason: null,
        updatedAt: now,
      },
    })
    .returning();

  return { account, created: existing.length === 0 };
}

// ==================== Manage ====================

export async function listAccounts(orgId: string, brandId?: string) {
  const filters = [eq(threadsAccounts.orgId, orgId)];
  if (brandId) filters.push(eq(threadsAccounts.brandId, brandId));
  return db
    .select()
    .from(threadsAccounts)
    .where(and(...filters))
    .orderBy(asc(threadsAccounts.createdAt));
}

export async function findAccount(
  id: string,
  orgId: string,
): Promise<ThreadsAccount | null> {
  const rows = await db
    .select()
    .from(threadsAccounts)
    .where(and(eq(threadsAccounts.id, id), eq(threadsAccounts.orgId, orgId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function setAccountType(
  id: string,
  orgId: string,
  accountType: AccountType,
): Promise<ThreadsAccount | null> {
  const [row] = await db
    .update(threadsAccounts)
    .set({ accountType, updatedAt: new Date() })
    .where(and(eq(threadsAccounts.id, id), eq(threadsAccounts.orgId, orgId)))
    .returning();
  return row ?? null;
}

export async function deleteAccount(id: string, orgId: string): Promise<boolean> {
  const rows = await db
    .delete(threadsAccounts)
    .where(and(eq(threadsAccounts.id, id), eq(threadsAccounts.orgId, orgId)))
    .returning({ id: threadsAccounts.id });
  return rows.length > 0;
}

async function markNeedsReconnect(id: string, reason: string): Promise<void> {
  await db
    .update(threadsAccounts)
    .set({ status: "needs_reconnect", statusReason: reason, updatedAt: new Date() })
    .where(eq(threadsAccounts.id, id));
}

function deadTokenReason(err: ThreadsApiError): string {
  return `Threads no longer accepts this login (${err.threadsError?.message ?? "token refused"}). Reconnect the account.`;
}

// ==================== Publish ====================

export async function publishPost(params: {
  account: ThreadsAccount;
  text: string;
  replyToPostId?: string;
}): Promise<PublishedPost> {
  const { account } = params;
  const { health, healthReason } = healthOf(account);
  if (health === "needs_reconnect") {
    throw new ThreadsReconnectRequiredError(account.id, healthReason!);
  }
  try {
    return await publishText({
      token: decrypt(account.accessToken),
      threadsUserId: account.threadsUserId,
      text: params.text,
      replyToPostId: params.replyToPostId,
    });
  } catch (err) {
    if (err instanceof ThreadsApiError && err.tokenInvalid) {
      const reason = deadTokenReason(err);
      await markNeedsReconnect(account.id, reason);
      throw new ThreadsReconnectRequiredError(account.id, reason);
    }
    throw err;
  }
}

// ==================== Insights ====================

/**
 * Why a post's insights cannot be read, in words a caller acts on:
 * - `insights_scope_missing`: the account was connected without
 *   `threads_manage_insights` (THREADS_INSIGHTS_SCOPE was off): reconnect it once the
 *   scope is asked for. No Threads call is made.
 * - `insights_permission_missing`: Threads answered code 10 "Application does not have
 *   permission for this action": our Meta app's Threads use case lacks the permission.
 */
export class ThreadsInsightsUnavailableError extends Error {
  constructor(
    readonly accountId: string,
    readonly reason: "insights_scope_missing" | "insights_permission_missing",
    message: string,
  ) {
    super(message);
    this.name = "ThreadsInsightsUnavailableError";
  }
}

/** One post's lifetime insights on the account that published it, read live (free). */
export async function readPostInsights(params: {
  account: ThreadsAccount;
  postId: string;
}): Promise<{ insights: PostInsights; raw: unknown }> {
  const { account } = params;
  const { health, healthReason } = healthOf(account);
  if (health === "needs_reconnect") {
    throw new ThreadsReconnectRequiredError(account.id, healthReason!);
  }
  if (!account.scopes.includes(THREADS_INSIGHTS_SCOPE)) {
    throw new ThreadsInsightsUnavailableError(
      account.id,
      "insights_scope_missing",
      `Threads account @${account.username} was connected without ${THREADS_INSIGHTS_SCOPE}: reconnect it to read its posts' views and engagement.`,
    );
  }
  try {
    return await getPostInsights(decrypt(account.accessToken), params.postId);
  } catch (err) {
    if (err instanceof ThreadsApiError && err.tokenInvalid) {
      const reason = deadTokenReason(err);
      await markNeedsReconnect(account.id, reason);
      throw new ThreadsReconnectRequiredError(account.id, reason);
    }
    if (err instanceof ThreadsApiError && err.threadsError?.code === 10) {
      throw new ThreadsInsightsUnavailableError(
        account.id,
        "insights_permission_missing",
        `Threads refused the insights read: our Meta app lacks ${THREADS_INSIGHTS_SCOPE} (${err.threadsError?.message ?? "code 10"}).`,
      );
    }
    throw err;
  }
}

// ==================== Token refresh ====================

/** Refresh a token once it is inside this window of its expiry. */
const REFRESH_WINDOW_DAYS = 30;

export interface TokenRefreshSummary {
  accountsChecked: number;
  refreshed: number;
  needsReconnect: number;
  errors: Array<{ accountId: string; error: string }>;
}

/**
 * Keeps long-lived tokens alive. Threads refreshes a token only while it is
 * valid and at least 24 hours old, so a token is picked up well before expiry
 * (inside REFRESH_WINDOW_DAYS) and the pass tolerates missing a few ticks. A
 * token Threads refuses marks the account "needs reconnect" so the dashboard
 * says so instead of the connection dying silently.
 */
export async function runTokenRefresh(now = new Date()): Promise<TokenRefreshSummary> {
  const horizon = new Date(now.getTime() + REFRESH_WINDOW_DAYS * DAY_MS);
  const minIssuedAt = new Date(now.getTime() - DAY_MS);

  // Logins started and never finished.
  await db.delete(threadsOauthPending).where(lt(threadsOauthPending.expiresAt, now));

  const due = await db
    .select()
    .from(threadsAccounts)
    .where(
      and(
        eq(threadsAccounts.status, "connected"),
        lt(threadsAccounts.tokenExpiresAt, horizon),
        lt(threadsAccounts.tokenIssuedAt, minIssuedAt),
      ),
    );

  const summary: TokenRefreshSummary = {
    accountsChecked: due.length,
    refreshed: 0,
    needsReconnect: 0,
    errors: [],
  };

  for (const account of due) {
    if (account.tokenExpiresAt.getTime() <= now.getTime()) {
      await markNeedsReconnect(
        account.id,
        `The Threads login expired on ${account.tokenExpiresAt.toISOString().slice(0, 10)}. Reconnect the account.`,
      );
      summary.needsReconnect++;
      continue;
    }
    try {
      const fresh = await refreshLongLivedToken(decrypt(account.accessToken));
      await db
        .update(threadsAccounts)
        .set({
          accessToken: encrypt(fresh.accessToken),
          tokenIssuedAt: now,
          tokenExpiresAt: new Date(now.getTime() + fresh.expiresInSeconds * 1000),
          updatedAt: now,
        })
        .where(eq(threadsAccounts.id, account.id));
      summary.refreshed++;
    } catch (err) {
      if (err instanceof ThreadsApiError && err.tokenInvalid) {
        await markNeedsReconnect(account.id, deadTokenReason(err));
        summary.needsReconnect++;
        continue;
      }
      summary.errors.push({
        accountId: account.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}
