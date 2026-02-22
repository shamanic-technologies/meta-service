import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  metaAdAccounts,
  metaConnections,
} from "../db/schema.js";
import {
  AccountsQuerySchema,
  PatchAccountBodySchema,
} from "../schemas.js";
import { decrypt } from "../lib/crypto.js";
import { metaFetch } from "../lib/meta-client.js";

const router = Router();

function formatAccount(a: typeof metaAdAccounts.$inferSelect) {
  return {
    id: a.id,
    connectionId: a.connectionId,
    adAccountId: a.adAccountId,
    accountName: a.accountName,
    currency: a.currency,
    timezone: a.timezone,
    accountStatus: a.accountStatus,
    isActive: a.isActive,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

// GET /accounts — List ad accounts
router.get("/accounts", async (req, res) => {
  const parsed = AccountsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten(),
    });
    return;
  }

  const { appId, clerkOrgId, activeOnly } = parsed.data;

  // Find connections for this app/org
  const conditions = [eq(metaConnections.appId, appId)];
  if (clerkOrgId) {
    conditions.push(eq(metaConnections.clerkOrgId, clerkOrgId));
  }

  const connections = await db.query.metaConnections.findMany({
    where: and(...conditions),
    columns: { id: true },
  });

  if (connections.length === 0) {
    res.json({ accounts: [] });
    return;
  }

  const connectionIds = connections.map((c) => c.id);

  // Get all ad accounts for these connections
  const allAccounts = await db.query.metaAdAccounts.findMany({
    where: (a, { inArray }) => inArray(a.connectionId, connectionIds),
    orderBy: (a, { asc }) => [asc(a.accountName)],
  });

  const accounts = activeOnly
    ? allAccounts.filter((a) => a.isActive)
    : allAccounts;

  res.json({ accounts: accounts.map(formatAccount) });
});

// PATCH /accounts/:adAccountId — Toggle active
router.patch("/accounts/:adAccountId", async (req, res) => {
  const parsed = PatchAccountBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten(),
    });
    return;
  }

  const { adAccountId } = req.params;
  const appId = req.query.appId as string;

  if (!appId) {
    res.status(400).json({ error: "appId query parameter is required" });
    return;
  }

  // Look up the account and verify ownership
  const account = await db.query.metaAdAccounts.findFirst({
    where: eq(metaAdAccounts.adAccountId, adAccountId),
    with: { connection: { columns: { appId: true } } },
  });

  if (!account || account.connection.appId !== appId) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  const [updated] = await db
    .update(metaAdAccounts)
    .set({ isActive: parsed.data.isActive, updatedAt: new Date() })
    .where(eq(metaAdAccounts.id, account.id))
    .returning();

  res.json(formatAccount(updated));
});

// POST /accounts/:adAccountId/sync — Re-fetch from Meta
router.post("/accounts/:adAccountId/sync", async (req, res) => {
  const { adAccountId } = req.params;
  const appId = req.query.appId as string;

  if (!appId) {
    res.status(400).json({ error: "appId query parameter is required" });
    return;
  }

  const account = await db.query.metaAdAccounts.findFirst({
    where: eq(metaAdAccounts.adAccountId, adAccountId),
    with: { connection: true },
  });

  if (!account || account.connection.appId !== appId) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  // Decrypt the access token
  const accessToken = decrypt(account.connection.accessToken);
  const appSecret = process.env.META_APP_SECRET;

  // Fetch fresh data from Meta
  const result = await metaFetch<{
    name?: string;
    currency?: string;
    timezone_name?: string;
    account_status?: number;
  }>(`/${adAccountId}`, accessToken, {
    params: { fields: "name,currency,timezone_name,account_status" },
    appSecret,
  });

  if (!result.success) {
    res.status(502).json({
      error: "Failed to sync from Meta API",
      details: result.error.message,
    });
    return;
  }

  const [updated] = await db
    .update(metaAdAccounts)
    .set({
      accountName: result.data.name ?? account.accountName,
      currency: result.data.currency ?? account.currency,
      timezone: result.data.timezone_name ?? account.timezone,
      accountStatus: result.data.account_status ?? account.accountStatus,
      updatedAt: new Date(),
    })
    .where(eq(metaAdAccounts.id, account.id))
    .returning();

  res.json(formatAccount(updated));
});

export default router;
