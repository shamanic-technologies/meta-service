/**
 * Meta's review verdict, observed on its own cadence.
 *
 * Meta reviews every submitted ad asynchronously and can refuse it minutes to a
 * day later. A poll chained into the run that submitted the ad sees
 * PENDING_REVIEW every time and reports success on an ad that was in fact
 * refused — so this never runs in the launch path.
 *
 * A refusal is not swallowed: it is stored with Meta's own feedback and logged
 * as an error, and readers see it on the campaign.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index.js";
import { metaManagedAds } from "../db/schema.js";
import {
  getAdReviewState,
  REJECTED_REVIEW_STATUSES,
  TERMINAL_REVIEW_STATUSES,
} from "../lib/meta-ads.js";
import { getMetaPlatformCredentials } from "../lib/key-service.js";

/**
 * Statuses we keep asking about. Anything terminal is left alone — including a
 * rejection, which stays rejected until the ad is resubmitted.
 */
export const PENDING_REVIEW_STATUSES = [
  "PENDING_REVIEW",
  "PENDING",
  "IN_PROCESS",
  "PREAPPROVED",
  "UNKNOWN",
];

export interface ReviewSyncSummary {
  adsChecked: number;
  adsSettled: number;
  adsRejected: number;
  errors: string[];
}

export function isTerminal(effectiveStatus: string): boolean {
  return TERMINAL_REVIEW_STATUSES.has(effectiveStatus);
}

export function isRejected(effectiveStatus: string): boolean {
  return REJECTED_REVIEW_STATUSES.has(effectiveStatus);
}

export async function runReviewSync(): Promise<ReviewSyncSummary> {
  const pending = await db
    .select()
    .from(metaManagedAds)
    .where(inArray(metaManagedAds.reviewStatus, PENDING_REVIEW_STATUSES));

  const summary: ReviewSyncSummary = {
    adsChecked: 0,
    adsSettled: 0,
    adsRejected: 0,
    errors: [],
  };

  if (pending.length === 0) {
    return summary;
  }

  const credentials = await getMetaPlatformCredentials({
    method: "CRON",
    path: "/internal/review-sync",
  });

  for (const ad of pending) {
    try {
      const state = await getAdReviewState(
        ad.metaAdId,
        credentials.accessToken,
        credentials.appSecret,
      );

      await db
        .update(metaManagedAds)
        .set({
          reviewStatus: state.effectiveStatus,
          reviewFeedback: state.reviewFeedback,
          reviewCheckedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(metaManagedAds.id, ad.id));

      summary.adsChecked += 1;
      if (isTerminal(state.effectiveStatus)) summary.adsSettled += 1;
      if (isRejected(state.effectiveStatus)) {
        summary.adsRejected += 1;
        console.error(
          `[meta-service] Meta REFUSED ad ${ad.metaAdId} (${state.effectiveStatus}): ` +
            JSON.stringify(state.reviewFeedback ?? {}),
        );
      }
    } catch (err) {
      const message = `${ad.metaAdId}: ${
        err instanceof Error ? err.message : String(err)
      }`;
      console.error(`[meta-service] review sync failed for ${message}`);
      summary.errors.push(message);
    }
  }

  return summary;
}
