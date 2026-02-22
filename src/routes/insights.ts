import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { metaAdAccounts, metaConnections } from "../db/schema.js";
import { InsightsQuerySchema } from "../schemas.js";
import { decrypt } from "../lib/crypto.js";
import { getInsights } from "../lib/meta-client.js";
import { validateBreakdowns } from "../lib/breakdown-validator.js";
import {
  parseUsageHeader,
  recordLimits,
  isNearLimit,
  getLimits,
} from "../lib/rate-limiter.js";
import { createRun, addRunCosts, completeRun } from "../lib/services.js";

const router = Router();

// GET /insights — Performance reporting
router.get("/insights", async (req, res) => {
  const parsed = InsightsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request",
      details: parsed.error.flatten(),
    });
    return;
  }

  const {
    adAccountId,
    appId,
    clerkOrgId,
    level,
    objectId,
    datePreset,
    since,
    until,
    timeIncrement,
    breakdowns: breakdownsStr,
    fields: fieldsStr,
    limit,
    after,
  } = parsed.data;

  // Parse comma-separated breakdowns and fields
  const breakdowns = breakdownsStr
    ? breakdownsStr.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const fields = fieldsStr
    ? fieldsStr.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  // Validate breakdowns
  if (breakdowns.length > 0) {
    const validation = validateBreakdowns(breakdowns);
    if (!validation.valid) {
      res.status(400).json({
        error: "Incompatible breakdown combination",
        details: validation.errors,
      });
      return;
    }
  }

  // Check rate limits before making the call
  const currentLimits = getLimits(adAccountId);
  if (currentLimits && isNearLimit(currentLimits)) {
    res.status(429).json({
      error: "Meta API rate limit approaching. Please try again later.",
    });
    return;
  }

  // Look up ad account to get connection and access token
  const account = await db.query.metaAdAccounts.findFirst({
    where: eq(metaAdAccounts.adAccountId, adAccountId),
    with: { connection: true },
  });

  if (!account) {
    res.status(404).json({ error: "Ad account not found" });
    return;
  }

  // Verify ownership
  if (account.connection.appId !== appId) {
    res.status(404).json({ error: "Ad account not found" });
    return;
  }

  if (clerkOrgId && account.connection.clerkOrgId !== clerkOrgId) {
    res.status(404).json({ error: "Ad account not found" });
    return;
  }

  // Create run for tracking
  let runId: string | null = null;
  try {
    const run = await createRun({
      clerkOrgId: clerkOrgId ?? account.connection.clerkOrgId ?? appId,
      appId,
      serviceName: "meta-service",
      taskName: "get-insights",
    });
    runId = run.id;
  } catch (err) {
    // Non-fatal: continue without run tracking
    console.warn("[meta-service] Failed to create run:", err);
  }

  try {
    const accessToken = decrypt(account.connection.accessToken);
    const appSecret = process.env.META_APP_SECRET;

    // Build time range
    let timeRange: { since: string; until: string } | undefined;
    if (since && until) {
      timeRange = { since, until };
    }

    const result = await getInsights(adAccountId, accessToken, {
      level,
      objectId,
      datePreset,
      timeRange,
      timeIncrement,
      breakdowns,
      fields,
      limit,
      after,
    }, appSecret);

    if (!result.success) {
      if (runId) {
        await completeRun(runId, "failed", result.error.message).catch(
          () => {},
        );
      }
      res.status(502).json({
        error: "Meta API error",
        details: result.error.message,
      });
      return;
    }

    // Record rate limits
    if (result.usageHeader) {
      const usages = parseUsageHeader(result.usageHeader);
      for (const [accountId, limits] of Object.entries(usages)) {
        recordLimits(accountId, limits);
      }
    }

    // Track costs
    if (runId) {
      await addRunCosts(runId, [
        { costName: "meta-insights-query", quantity: 1 },
      ]).catch(() => {});
      await completeRun(runId, "completed").catch(() => {});
    }

    // Transform snake_case keys from Meta to camelCase
    const data = result.data.data.map((row: Record<string, unknown>) => ({
      ...row,
      campaignId: row.campaign_id,
      campaignName: row.campaign_name,
      adsetId: row.adset_id,
      adsetName: row.adset_name,
      adId: row.ad_id,
      adName: row.ad_name,
      dateStart: row.date_start,
      dateStop: row.date_stop,
      publisherPlatform: row.publisher_platform,
      platformPosition: row.platform_position,
      devicePlatform: row.device_platform,
      costPerActionType: row.cost_per_action_type,
    }));

    res.json({
      data,
      paging: result.data.paging,
    });
  } catch (err) {
    if (runId) {
      await completeRun(
        runId,
        "failed",
        err instanceof Error ? err.message : "Unknown error",
      ).catch(() => {});
    }
    throw err;
  }
});

export default router;
