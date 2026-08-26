/**
 * The managed advertising path.
 *
 * A caller holding an org, a brand, a daily budget, ad copy and a destination
 * link gets a campaign that Meta accepts and submits for review, with no manual
 * step and no client credential. Our business assets are resolved as platform
 * keys; nothing here reads a per-user Meta connection.
 */
import { Router } from "express";
import { and, eq, sql as rawSql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  metaAdsSpendDaily,
  metaManagedAdSets,
  metaManagedAds,
  metaManagedCampaigns,
  type MetaManagedAd,
  type MetaManagedAdSet,
  type MetaManagedCampaign,
} from "../db/schema.js";
import {
  CreateManagedCampaignSchema,
  UpdateOptimizationSchema,
} from "../schemas.js";
import {
  buildPromotedObject,
  buildTargeting,
  createAd,
  createAdSet,
  createCampaign,
  createLinkCreative,
  goalsForObjective,
  MetaApiCallError,
  objectiveForGoal,
  updateAdSetOptimization,
  uploadConversions,
} from "../lib/meta-ads.js";
import {
  getConversionsApiToken,
  getMetaPlatformCredentials,
} from "../lib/key-service.js";
import { UploadConversionsSchema } from "../schemas.js";

const router = Router();

const DEFAULT_CALL_TO_ACTION = "LEARN_MORE";

/**
 * Meta bills auction delivery on impressions for every goal we expose — it does
 * not bill per conversion, and the conversion goal only changes what it
 * optimises toward, not what it charges for.
 */
const BILLING_EVENT = "IMPRESSIONS";

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function serialiseCampaign(
  campaign: MetaManagedCampaign,
  adSets: MetaManagedAdSet[],
  ads: MetaManagedAd[],
) {
  return {
    id: campaign.id,
    orgId: campaign.orgId,
    brandId: campaign.brandId,
    campaignId: campaign.campaignId,
    metaAdAccountId: campaign.metaAdAccountId,
    metaCampaignId: campaign.metaCampaignId,
    name: campaign.name,
    objective: campaign.objective,
    status: campaign.status,
    dailyBudgetCents: campaign.dailyBudgetCents,
    destinationUrl: campaign.destinationUrl,
    createdAt: campaign.createdAt.toISOString(),
    adSets: adSets.map((adSet) => ({
      id: adSet.id,
      metaAdSetId: adSet.metaAdSetId,
      name: adSet.name,
      dailyBudgetCents: adSet.dailyBudgetCents,
      optimizationGoal: adSet.optimizationGoal,
      customEventType: adSet.customEventType,
      billingEvent: adSet.billingEvent,
      targeting: adSet.targeting,
      status: adSet.status,
    })),
    ads: ads.map((ad) => ({
      id: ad.id,
      metaAdId: ad.metaAdId,
      metaCreativeId: ad.metaCreativeId,
      name: ad.name,
      primaryText: ad.primaryText,
      headline: ad.headline,
      description: ad.description,
      callToAction: ad.callToAction,
      destinationUrl: ad.destinationUrl,
      status: ad.status,
      reviewStatus: ad.reviewStatus,
      reviewFeedback: ad.reviewFeedback,
      reviewCheckedAt: toIso(ad.reviewCheckedAt),
    })),
  };
}

async function loadCampaign(id: string, orgId: string) {
  const campaigns = await db
    .select()
    .from(metaManagedCampaigns)
    .where(
      and(
        eq(metaManagedCampaigns.id, id),
        eq(metaManagedCampaigns.orgId, orgId),
      ),
    )
    .limit(1);

  const campaign = campaigns[0];
  if (!campaign) return null;

  const adSets = await db
    .select()
    .from(metaManagedAdSets)
    .where(eq(metaManagedAdSets.managedCampaignId, campaign.id));
  const ads = await db
    .select()
    .from(metaManagedAds)
    .where(eq(metaManagedAds.managedCampaignId, campaign.id));

  return { campaign, adSets, ads };
}

// POST /managed/campaigns — launch
router.post("/managed/campaigns", async (req, res, next) => {
  const parsed = CreateManagedCampaignSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  const input = parsed.data;
  const orgId = res.locals.orgId as string;
  const userId = res.locals.userId as string;
  const runId = res.locals.runId as string;

  if (
    input.targeting.ageMin !== undefined &&
    input.targeting.ageMax !== undefined &&
    input.targeting.ageMin > input.targeting.ageMax
  ) {
    res.status(400).json({ error: "targeting.ageMin is above targeting.ageMax" });
    return;
  }

  try {
    const credentials = await getMetaPlatformCredentials(
      { method: "POST", path: "/managed/campaigns" },
      runId,
    );

    const goal = input.optimization.goal;
    const objective = objectiveForGoal(goal);
    const status = input.status ?? "PAUSED";

    // Throws when a conversion goal has no dataset or no event to optimise on.
    const promotedObject = buildPromotedObject({
      goal,
      datasetId: credentials.datasetId,
      customEventType: input.optimization.customEventType ?? null,
      pageId: credentials.pageId,
    });

    const campaign = await createCampaign({
      adAccountId: credentials.adAccountId,
      name: input.name,
      objective,
      status,
      accessToken: credentials.accessToken,
      appSecret: credentials.appSecret,
    });

    const targeting = buildTargeting(
      input.targeting,
      credentials.instagramAccountId !== null,
    );

    const adSet = await createAdSet({
      adAccountId: credentials.adAccountId,
      campaignId: campaign.id,
      name: `${input.name} — ad set`,
      dailyBudgetCents: input.dailyBudgetCents,
      optimizationGoal: goal,
      billingEvent: BILLING_EVENT,
      promotedObject,
      targeting,
      status,
      accessToken: credentials.accessToken,
      appSecret: credentials.appSecret,
    });

    const callToAction = input.callToAction ?? DEFAULT_CALL_TO_ACTION;

    // Text only: no image is supplied, so Meta uses the destination page's own
    // link preview. Nothing is invented to stand in for one.
    const creative = await createLinkCreative({
      adAccountId: credentials.adAccountId,
      name: `${input.name} — creative`,
      pageId: credentials.pageId,
      instagramAccountId: credentials.instagramAccountId,
      destinationUrl: input.destinationUrl,
      primaryText: input.adCopy.primaryText,
      headline: input.adCopy.headline ?? null,
      description: input.adCopy.description ?? null,
      callToAction,
      accessToken: credentials.accessToken,
      appSecret: credentials.appSecret,
    });

    const adName = input.adName ?? `${input.name} — ad`;
    const ad = await createAd({
      adAccountId: credentials.adAccountId,
      name: adName,
      adSetId: adSet.id,
      creativeId: creative.id,
      status,
      accessToken: credentials.accessToken,
      appSecret: credentials.appSecret,
    });

    const [campaignRow] = await db
      .insert(metaManagedCampaigns)
      .values({
        orgId,
        userId,
        brandId: input.brandId ?? null,
        campaignId: input.campaignId ?? null,
        featureSlug: input.featureSlug ?? null,
        metaAdAccountId: credentials.adAccountId,
        metaCampaignId: campaign.id,
        name: input.name,
        objective,
        status,
        dailyBudgetCents: input.dailyBudgetCents,
        destinationUrl: input.destinationUrl,
      })
      .returning();

    const [adSetRow] = await db
      .insert(metaManagedAdSets)
      .values({
        managedCampaignId: campaignRow.id,
        metaAdSetId: adSet.id,
        name: `${input.name} — ad set`,
        dailyBudgetCents: input.dailyBudgetCents,
        optimizationGoal: goal,
        customEventType: input.optimization.customEventType ?? null,
        datasetId: credentials.datasetId,
        billingEvent: BILLING_EVENT,
        targeting,
        status,
      })
      .returning();

    const [adRow] = await db
      .insert(metaManagedAds)
      .values({
        managedCampaignId: campaignRow.id,
        managedAdSetId: adSetRow.id,
        metaAdId: ad.id,
        metaCreativeId: creative.id,
        name: adName,
        primaryText: input.adCopy.primaryText,
        headline: input.adCopy.headline ?? null,
        description: input.adCopy.description ?? null,
        callToAction,
        destinationUrl: input.destinationUrl,
        status,
        // Meta decides asynchronously. The verdict is observed by the review
        // cron, on its own cadence — never here.
        reviewStatus: "PENDING_REVIEW",
      })
      .returning();

    res.status(201).json(serialiseCampaign(campaignRow, [adSetRow], [adRow]));
  } catch (err) {
    next(err);
  }
});

// GET /managed/campaigns
router.get("/managed/campaigns", async (req, res, next) => {
  try {
    const orgId = res.locals.orgId as string;
    const brandId = req.query.brandId as string | undefined;
    const campaignId = req.query.campaignId as string | undefined;

    const filters = [eq(metaManagedCampaigns.orgId, orgId)];
    if (brandId) filters.push(eq(metaManagedCampaigns.brandId, brandId));
    if (campaignId)
      filters.push(eq(metaManagedCampaigns.campaignId, campaignId));

    const campaigns = await db
      .select()
      .from(metaManagedCampaigns)
      .where(and(...filters));

    const out = [];
    for (const campaign of campaigns) {
      const adSets = await db
        .select()
        .from(metaManagedAdSets)
        .where(eq(metaManagedAdSets.managedCampaignId, campaign.id));
      const ads = await db
        .select()
        .from(metaManagedAds)
        .where(eq(metaManagedAds.managedCampaignId, campaign.id));
      out.push(serialiseCampaign(campaign, adSets, ads));
    }

    res.json({ campaigns: out });
  } catch (err) {
    next(err);
  }
});

// GET /managed/campaigns/:id
router.get("/managed/campaigns/:id", async (req, res, next) => {
  try {
    const loaded = await loadCampaign(
      req.params.id,
      res.locals.orgId as string,
    );
    if (!loaded) {
      res.status(404).json({ error: "Managed campaign not found" });
      return;
    }
    res.json(serialiseCampaign(loaded.campaign, loaded.adSets, loaded.ads));
  } catch (err) {
    next(err);
  }
});

// PATCH /managed/campaigns/:id/optimization
router.patch("/managed/campaigns/:id/optimization", async (req, res, next) => {
  const parsed = UpdateOptimizationSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  try {
    const orgId = res.locals.orgId as string;
    const runId = res.locals.runId as string;
    const loaded = await loadCampaign(req.params.id, orgId);
    if (!loaded) {
      res.status(404).json({ error: "Managed campaign not found" });
      return;
    }

    const goal = parsed.data.goal;

    // A campaign's objective is fixed at creation and Meta will not change it.
    // Say so rather than silently failing or quietly creating a second campaign.
    if (objectiveForGoal(goal) !== loaded.campaign.objective) {
      res.status(409).json({
        error:
          `Meta fixes a campaign's objective at creation. This campaign is ${loaded.campaign.objective}, ` +
          `and '${goal}' needs ${objectiveForGoal(goal)}. Goals available without a new campaign: ` +
          goalsForObjective(loaded.campaign.objective).join(", "),
      });
      return;
    }

    const credentials = await getMetaPlatformCredentials(
      { method: "PATCH", path: "/managed/campaigns/:id/optimization" },
      runId,
    );

    const promotedObject = buildPromotedObject({
      goal,
      datasetId: credentials.datasetId,
      customEventType: parsed.data.customEventType ?? null,
      pageId: credentials.pageId,
    });

    for (const adSet of loaded.adSets) {
      await updateAdSetOptimization({
        adSetId: adSet.metaAdSetId,
        optimizationGoal: goal,
        promotedObject,
        accessToken: credentials.accessToken,
        appSecret: credentials.appSecret,
      });

      await db
        .update(metaManagedAdSets)
        .set({
          optimizationGoal: goal,
          customEventType: parsed.data.customEventType ?? null,
          datasetId: credentials.datasetId,
          billingEvent: BILLING_EVENT,
          updatedAt: new Date(),
        })
        .where(eq(metaManagedAdSets.id, adSet.id));
    }

    const reloaded = await loadCampaign(req.params.id, orgId);
    if (!reloaded) {
      res.status(404).json({ error: "Managed campaign not found" });
      return;
    }
    res.json(
      serialiseCampaign(reloaded.campaign, reloaded.adSets, reloaded.ads),
    );
  } catch (err) {
    next(err);
  }
});

// GET /managed/campaigns/:id/spend
router.get("/managed/campaigns/:id/spend", async (req, res, next) => {
  try {
    const orgId = res.locals.orgId as string;
    const loaded = await loadCampaign(req.params.id, orgId);
    if (!loaded) {
      res.status(404).json({ error: "Managed campaign not found" });
      return;
    }

    const days = await db
      .select()
      .from(metaAdsSpendDaily)
      .where(eq(metaAdsSpendDaily.managedCampaignId, loaded.campaign.id))
      .orderBy(rawSql`${metaAdsSpendDaily.spendDate} asc`);

    res.json({
      metaCampaignId: loaded.campaign.metaCampaignId,
      currency: days[0]?.currency ?? "USD",
      days: days.map((day) => ({
        spendDate: day.spendDate,
        observedCents: day.observedCents,
        declaredCents: day.declaredCents,
        lastObservedAt: day.lastObservedAt.toISOString(),
      })),
      totalObservedCents: days.reduce((sum, d) => sum + d.observedCents, 0),
      totalDeclaredCents: days.reduce((sum, d) => sum + d.declaredCents, 0),
    });
  } catch (err) {
    next(err);
  }
});

// POST /managed/conversions
router.post("/managed/conversions", async (req, res, next) => {
  const parsed = UploadConversionsSchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }

  try {
    const runId = res.locals.runId as string;
    const caller = { method: "POST", path: "/managed/conversions" };
    const credentials = await getMetaPlatformCredentials(caller, runId);

    if (!credentials.datasetId) {
      res.status(400).json({
        error:
          "No Meta dataset is configured as a platform key, so there is nowhere to forward a conversion",
      });
      return;
    }

    const conversionsToken = await getConversionsApiToken(caller, runId);

    const result = await uploadConversions({
      datasetId: credentials.datasetId,
      accessToken: conversionsToken,
      appSecret: credentials.appSecret,
      events: parsed.data.events.map((event) => ({
        eventName: event.eventName,
        eventTime: event.eventTime,
        eventId: event.eventId,
        eventSourceUrl: event.eventSourceUrl,
        actionSource: event.actionSource ?? "website",
        userData: event.userData,
        customData: event.customData,
      })),
      testEventCode: parsed.data.testEventCode,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export { MetaApiCallError };
export default router;
