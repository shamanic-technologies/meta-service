import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { metaConnections } from "../db/schema.js";

const router = Router();

// GET /connections — List connections for an org
router.get("/connections", async (_req, res) => {
  const orgId = res.locals.orgId as string;

  const connections = await db.query.metaConnections.findMany({
    where: eq(metaConnections.orgId, orgId),
    with: {
      adAccounts: true,
      pages: true,
    },
    orderBy: (c, { desc }) => [desc(c.createdAt)],
  });

  const result = connections.map((conn) => ({
    id: conn.id,
    orgId: conn.orgId,
    userId: conn.userId,
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
