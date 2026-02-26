import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  metaConnections,
  metaAdAccounts,
  metaPages,
} from "../db/schema.js";
import {
  AuthorizeQuerySchema,
  CallbackQuerySchema,
} from "../schemas.js";
import { encrypt } from "../lib/crypto.js";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  getMe,
  getAdAccounts,
  getPages,
} from "../lib/meta-client.js";

const router = Router();

const META_OAUTH_BASE = "https://www.facebook.com/v22.0/dialog/oauth";

const DEFAULT_SCOPES = [
  "ads_read",
  "ads_management",
  "pages_read_engagement",
  "pages_manage_posts",
  "instagram_basic",
  "instagram_content_publish",
  "business_management",
].join(",");

// GET /auth/meta/authorize — Generate the OAuth URL
router.get("/auth/meta/authorize", (req, res) => {
  const parsed = AuthorizeQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten(),
    });
    return;
  }

  const { appId, orgId, redirectUri, label } = parsed.data;
  const metaAppId = process.env.META_APP_ID;

  if (!metaAppId) {
    res.status(500).json({ error: "META_APP_ID not configured" });
    return;
  }

  // Encode state as base64 JSON
  const state = Buffer.from(
    JSON.stringify({ appId, orgId, redirectUri, label }),
  ).toString("base64url");

  // Build the callback URL — Meta redirects here
  const callbackUrl = `${req.protocol}://${req.get("host")}/auth/meta/callback`;

  const url = new URL(META_OAUTH_BASE);
  url.searchParams.set("client_id", metaAppId);
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("scope", DEFAULT_SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");

  res.json({ authorizationUrl: url.toString() });
});

// GET /auth/meta/callback — Handle the OAuth callback
router.get("/auth/meta/callback", async (req, res) => {
  const parsed = CallbackQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid callback",
      details: parsed.error.flatten(),
    });
    return;
  }

  const { code, state: stateB64 } = parsed.data;

  // Decode state
  let stateData: {
    appId: string;
    orgId?: string;
    redirectUri: string;
    label?: string;
  };
  try {
    stateData = JSON.parse(
      Buffer.from(stateB64, "base64url").toString("utf-8"),
    );
  } catch {
    res.status(400).json({ error: "Invalid state parameter" });
    return;
  }

  const metaAppId = process.env.META_APP_ID!;
  const metaAppSecret = process.env.META_APP_SECRET!;
  const callbackUrl = `${req.protocol}://${req.get("host")}/auth/meta/callback`;

  try {
    // 1. Exchange code for short-lived token
    const tokenResult = await exchangeCodeForToken(
      code,
      callbackUrl,
      metaAppId,
      metaAppSecret,
    );
    if (!tokenResult.success) {
      res.status(400).json({
        error: "Failed to exchange code for token",
        details: tokenResult.error.message,
      });
      return;
    }

    // 2. Exchange for long-lived token
    const longLivedResult = await exchangeForLongLivedToken(
      tokenResult.data.access_token,
      metaAppId,
      metaAppSecret,
    );
    if (!longLivedResult.success) {
      res.status(400).json({
        error: "Failed to get long-lived token",
        details: longLivedResult.error.message,
      });
      return;
    }

    const accessToken = longLivedResult.data.access_token;
    const expiresIn = longLivedResult.data.expires_in;
    const tokenExpiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000)
      : null;

    // 3. Get user info
    const meResult = await getMe(accessToken, metaAppSecret);
    if (!meResult.success) {
      res.status(400).json({
        error: "Failed to get Meta user info",
        details: meResult.error.message,
      });
      return;
    }

    // 4. Get ad accounts
    const adAccountsResult = await getAdAccounts(accessToken, metaAppSecret);
    const adAccountsData = adAccountsResult.success
      ? adAccountsResult.data.data
      : [];

    // 5. Get pages
    const pagesResult = await getPages(accessToken, metaAppSecret);
    const pagesData = pagesResult.success ? pagesResult.data.data : [];

    // 6. Upsert connection
    const encryptedToken = encrypt(accessToken);
    const grantedScopes = DEFAULT_SCOPES.split(",");

    const [connection] = await db
      .insert(metaConnections)
      .values({
        appId: stateData.appId,
        orgId: stateData.orgId ?? null,
        label: stateData.label ?? null,
        metaUserId: meResult.data.id,
        metaUserName: meResult.data.name,
        accessToken: encryptedToken,
        tokenExpiresAt,
        scopes: grantedScopes,
      })
      .onConflictDoUpdate({
        target: [metaConnections.id],
        set: {
          accessToken: encryptedToken,
          tokenExpiresAt,
          metaUserName: meResult.data.name,
          scopes: grantedScopes,
          updatedAt: new Date(),
        },
      })
      .returning();

    // 7. Upsert ad accounts
    for (const acct of adAccountsData) {
      await db
        .insert(metaAdAccounts)
        .values({
          connectionId: connection.id,
          adAccountId: acct.id, // "act_XXXXX" format
          accountName: acct.name ?? null,
          currency: acct.currency ?? null,
          timezone: acct.timezone_name ?? null,
          accountStatus: acct.account_status ?? null,
        })
        .onConflictDoUpdate({
          target: [metaAdAccounts.connectionId, metaAdAccounts.adAccountId],
          set: {
            accountName: acct.name ?? null,
            currency: acct.currency ?? null,
            timezone: acct.timezone_name ?? null,
            accountStatus: acct.account_status ?? null,
            updatedAt: new Date(),
          },
        });
    }

    // 8. Upsert pages
    for (const page of pagesData) {
      const encryptedPageToken = encrypt(page.access_token);
      await db
        .insert(metaPages)
        .values({
          connectionId: connection.id,
          pageId: page.id,
          pageName: page.name ?? null,
          pageAccessToken: encryptedPageToken,
          instagramAccountId:
            page.instagram_business_account?.id ?? null,
        })
        .onConflictDoUpdate({
          target: [metaPages.connectionId, metaPages.pageId],
          set: {
            pageName: page.name ?? null,
            pageAccessToken: encryptedPageToken,
            instagramAccountId:
              page.instagram_business_account?.id ?? null,
            updatedAt: new Date(),
          },
        });
    }

    // 9. Redirect back to the app
    const redirectUrl = new URL(stateData.redirectUri);
    redirectUrl.searchParams.set("connectionId", connection.id);
    redirectUrl.searchParams.set("status", "success");

    res.redirect(302, redirectUrl.toString());
  } catch (err) {
    console.error("[meta-service] OAuth callback error:", err);
    res.status(500).json({ error: "Internal server error during OAuth" });
  }
});

// DELETE /auth/meta/connections/:connectionId
router.delete(
  "/auth/meta/connections/:connectionId",
  async (req, res) => {
    const { connectionId } = req.params;
    const appId = req.query.appId as string;

    if (!appId) {
      res.status(400).json({ error: "appId query parameter is required" });
      return;
    }

    const connection = await db.query.metaConnections.findFirst({
      where: and(
        eq(metaConnections.id, connectionId),
        eq(metaConnections.appId, appId),
      ),
    });

    if (!connection) {
      res.status(404).json({ error: "Connection not found" });
      return;
    }

    // Cascade delete handles ad accounts and pages
    await db
      .delete(metaConnections)
      .where(eq(metaConnections.id, connectionId));

    res.json({ message: "Connection removed" });
  },
);

export default router;
