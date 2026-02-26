import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { metaConnections } from "../db/schema.js";
import { ConnectionsQuerySchema } from "../schemas.js";

const router = Router();

// GET /connections — List connections for an app/org
router.get("/connections", async (req, res) => {
  const parsed = ConnectionsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten(),
    });
    return;
  }

  const { appId, orgId } = parsed.data;

  const conditions = [eq(metaConnections.appId, appId)];
  if (orgId) {
    conditions.push(eq(metaConnections.orgId, orgId));
  }

  const connections = await db.query.metaConnections.findMany({
    where: and(...conditions),
    with: {
      adAccounts: true,
      pages: true,
    },
    orderBy: (c, { desc }) => [desc(c.createdAt)],
  });

  const result = connections.map((conn) => ({
    id: conn.id,
    appId: conn.appId,
    orgId: conn.orgId,
    label: conn.label,
    metaUserId: conn.metaUserId,
    metaUserName: conn.metaUserName,
    scopes: conn.scopes ?? [],
    tokenExpiresAt: conn.tokenExpiresAt?.toISOString() ?? null,
    adAccounts: conn.adAccounts.map((a) => ({
      id: a.id,
      adAccountId: a.adAccountId,
      accountName: a.accountName,
      currency: a.currency,
      timezone: a.timezone,
      accountStatus: a.accountStatus,
      isActive: a.isActive,
    })),
    pages: conn.pages.map((p) => ({
      id: p.id,
      pageId: p.pageId,
      pageName: p.pageName,
      hasInstagram: !!p.instagramAccountId,
    })),
    createdAt: conn.createdAt.toISOString(),
  }));

  res.json({ connections: result });
});

export default router;
