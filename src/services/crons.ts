/**
 * The two background schedules.
 *
 * Both exist because the thing they observe is decided on Meta's clock, not
 * ours: a review verdict lands minutes to a day after submission, and a day's
 * spend is published hours after it was spent. Chaining either into the run
 * that launched the campaign would make its latency equal to that run's
 * frequency while both steps still reported success.
 *
 * Neither starts at boot: the first tick is delayed so a deploy binds its port
 * and passes its health check before any Meta traffic begins.
 */
import { runReviewSync } from "./review-sync.js";
import { runSpendIngest } from "./spend-ingest.js";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number, got '${raw}'`);
  }
  return parsed;
}

export function startReviewSync(): NodeJS.Timeout {
  const intervalMinutes = numberFromEnv("META_REVIEW_INTERVAL_MINUTES", 15);
  const firstTickMinutes = numberFromEnv("META_REVIEW_FIRST_TICK_MINUTES", 2);

  console.log(
    `[meta-service] review sync every ${intervalMinutes}min, first tick in ${firstTickMinutes}min`,
  );

  const tick = () => {
    runReviewSync()
      .then((summary) => {
        console.log(
          `[meta-service] review sync: checked=${summary.adsChecked} settled=${summary.adsSettled} rejected=${summary.adsRejected} errors=${summary.errors.length}`,
        );
      })
      .catch((err) => console.error("[meta-service] review sync failed:", err));
  };

  setTimeout(tick, firstTickMinutes * MINUTE);
  return setInterval(tick, intervalMinutes * MINUTE);
}

export function startSpendSync(): NodeJS.Timeout {
  const intervalHours = numberFromEnv("META_ADS_SPEND_INTERVAL_HOURS", 6);
  const lookbackDays = numberFromEnv("META_ADS_SPEND_LOOKBACK_DAYS", 7);
  const firstTickMinutes = numberFromEnv("META_ADS_SPEND_FIRST_TICK_MINUTES", 5);

  console.log(
    `[meta-service] spend sync every ${intervalHours}h over ${lookbackDays}d, first tick in ${firstTickMinutes}min`,
  );

  const tick = () => {
    runSpendIngest({ lookbackDays })
      .then((summary) => {
        console.log(
          `[meta-service] spend sync: campaigns=${summary.campaignsRead} days=${summary.daysObserved} declared=${summary.centsDeclared}c errors=${summary.errors.length}`,
        );
      })
      .catch((err) => console.error("[meta-service] spend sync failed:", err));
  };

  setTimeout(tick, firstTickMinutes * MINUTE);
  return setInterval(tick, intervalHours * HOUR);
}
