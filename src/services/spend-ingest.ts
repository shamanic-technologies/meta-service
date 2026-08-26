/**
 * Meta spend → the org's declared cost.
 *
 * Spend accrues on Meta's side continuously and we only ever learn it after the
 * fact, so this is not a step of the launch run and never can be: a read that
 * follows a write in the same run observes nothing, reports success, and leaves
 * the money undeclared until the next tick. It runs on its own cadence.
 *
 * Protocol shape. The fleet's contract is provision → authorize → execute →
 * actualize, and it applies to spend a service is ABOUT to cause. This spend
 * already happened when we read it: there is nothing to hold ahead of a call and
 * an after-the-fact charge cannot be refused, so there is no provision and no
 * affordability gate. Each pass declares the difference between what Meta now
 * reports and what has already been declared, as `actual`.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  metaAdsSpendDaily,
  metaManagedCampaigns,
  type MetaManagedCampaign,
} from "../db/schema.js";
import { getCampaignDailySpend } from "../lib/meta-ads.js";
import { getMetaPlatformCredentials } from "../lib/key-service.js";
import { addRunCosts, completeRun, createRun } from "../lib/services.js";

export const META_ADS_SPEND_COST_NAME = "meta-ads-spend";

export interface SpendIngestSummary {
  campaignsRead: number;
  daysObserved: number;
  centsDeclared: number;
  errors: string[];
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function lookbackWindow(
  now: Date,
  lookbackDays: number,
): { since: string; until: string } {
  const until = new Date(now);
  const since = new Date(now);
  since.setUTCDate(since.getUTCDate() - lookbackDays);
  return { since: isoDay(since), until: isoDay(until) };
}

/**
 * The catalogue prices `meta-ads-spend` in USD cents, one cent per unit. A
 * non-USD ad account would make the declared quantity a number of some other
 * currency's minor units charged as if they were cents, so it is refused rather
 * than silently mis-billed.
 */
export function assertUsdSpend(currency: string, metaCampaignId: string): void {
  if (currency !== "USD") {
    throw new Error(
      `Meta reported spend for campaign ${metaCampaignId} in ${currency}; ` +
        `meta-ads-spend is declared in USD cents and cannot price another currency`,
    );
  }
}

export async function ingestCampaignSpend(
  campaign: MetaManagedCampaign,
  window: { since: string; until: string },
  credentials: { accessToken: string; appSecret: string },
): Promise<{ daysObserved: number; centsDeclared: number }> {
  const rows = await getCampaignDailySpend(
    campaign.metaCampaignId,
    window.since,
    window.until,
    credentials.accessToken,
    credentials.appSecret,
  );

  let centsDeclared = 0;

  for (const row of rows) {
    assertUsdSpend(row.currency, campaign.metaCampaignId);

    const existing = await db
      .select()
      .from(metaAdsSpendDaily)
      .where(
        and(
          eq(metaAdsSpendDaily.metaCampaignId, campaign.metaCampaignId),
          eq(metaAdsSpendDaily.spendDate, row.date),
        ),
      )
      .limit(1);

    const alreadyDeclared = existing[0]?.declaredCents ?? 0;
    const delta = row.spendCents - alreadyDeclared;

    if (delta < 0) {
      // Meta revised the day downward. The declared amount stays: a charge that
      // already happened is not rewritten retroactively.
      console.warn(
        `[meta-service] Meta revised ${campaign.metaCampaignId} ${row.date} down ` +
          `to ${row.spendCents}c from ${alreadyDeclared}c already declared; keeping the declared amount`,
      );
    }

    if (delta > 0) {
      // Declare BEFORE recording it as declared. A declaration that fails throws
      // and leaves declared_cents untouched, so the next pass retries the same
      // delta rather than losing it.
      const run = await createRun(
        {
          orgId: campaign.orgId,
          userId: campaign.userId,
          serviceName: "meta-service",
          taskName: `meta-ads-spend:${row.date}`,
          brandId: campaign.brandId ?? undefined,
          campaignId: campaign.campaignId ?? undefined,
          featureSlug: campaign.featureSlug ?? undefined,
        },
        `meta-ads-spend:${campaign.metaCampaignId}:${row.date}`,
      );

      try {
        await addRunCosts(
          run.id,
          [
            {
              costName: META_ADS_SPEND_COST_NAME,
              quantity: delta,
              costSource: "platform",
              status: "actual",
            },
          ],
          `${campaign.metaCampaignId}:${row.date}:${row.spendCents}`,
        );
      } catch (err) {
        await completeRun(
          run.id,
          "failed",
          err instanceof Error ? err.message : String(err),
        );
        throw err;
      }

      await completeRun(run.id, "completed");
      centsDeclared += delta;
    }

    const declaredCents = Math.max(alreadyDeclared, row.spendCents);
    const now = new Date();

    if (existing[0]) {
      await db
        .update(metaAdsSpendDaily)
        .set({
          observedCents: row.spendCents,
          declaredCents,
          currency: row.currency,
          lastObservedAt: now,
          updatedAt: now,
        })
        .where(eq(metaAdsSpendDaily.id, existing[0].id));
    } else {
      await db.insert(metaAdsSpendDaily).values({
        managedCampaignId: campaign.id,
        orgId: campaign.orgId,
        metaCampaignId: campaign.metaCampaignId,
        spendDate: row.date,
        currency: row.currency,
        observedCents: row.spendCents,
        declaredCents,
        lastObservedAt: now,
      });
    }
  }

  return { daysObserved: rows.length, centsDeclared };
}

/**
 * One pass over every managed campaign. Campaigns are isolated: one that cannot
 * be read or declared records its error and the others still run.
 */
export async function runSpendIngest(options: {
  lookbackDays: number;
  now?: Date;
}): Promise<SpendIngestSummary> {
  const window = lookbackWindow(options.now ?? new Date(), options.lookbackDays);

  const campaigns = await db
    .select()
    .from(metaManagedCampaigns)
    .where(inArray(metaManagedCampaigns.status, ["ACTIVE", "PAUSED"]));

  const summary: SpendIngestSummary = {
    campaignsRead: 0,
    daysObserved: 0,
    centsDeclared: 0,
    errors: [],
  };

  if (campaigns.length === 0) {
    return summary;
  }

  const credentials = await getMetaPlatformCredentials({
    method: "CRON",
    path: "/internal/spend-sync",
  });

  for (const campaign of campaigns) {
    try {
      const result = await ingestCampaignSpend(campaign, window, credentials);
      summary.campaignsRead += 1;
      summary.daysObserved += result.daysObserved;
      summary.centsDeclared += result.centsDeclared;
    } catch (err) {
      const message = `${campaign.metaCampaignId}: ${
        err instanceof Error ? err.message : String(err)
      }`;
      console.error(`[meta-service] spend ingest failed for ${message}`);
      summary.errors.push(message);
    }
  }

  return summary;
}
