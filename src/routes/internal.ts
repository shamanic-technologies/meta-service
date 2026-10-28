/**
 * Manual triggers for the two background jobs.
 *
 * They exist because a job whose result is only observed on its own cadence is
 * otherwise unreachable when you need to look now — and because "the artifact
 * was never created" and "the artifact exists and has not been ingested yet"
 * look identical from the outside. Neither is ever called from a launch.
 *
 * Service-key only: this is fleet-internal work with no org on the wire.
 */
import { Router } from "express";
import { runReviewSync } from "../services/review-sync.js";
import { runSpendIngest } from "../services/spend-ingest.js";
import { runTokenRefresh } from "../lib/threads-accounts.js";
import { listMeasurablePosts, serialisePublication } from "../lib/threads-publications.js";
import { MeasurablePostsQuerySchema } from "../schemas.js";

const router = Router();

router.post("/internal/review-sync", async (_req, res, next) => {
  try {
    res.json(await runReviewSync());
  } catch (err) {
    next(err);
  }
});

router.post("/internal/spend-sync", async (req, res, next) => {
  try {
    const raw = req.body?.lookbackDays;
    const lookbackDays = raw === undefined ? 7 : Number(raw);
    if (!Number.isFinite(lookbackDays) || lookbackDays <= 0) {
      res.status(400).json({ error: "lookbackDays must be a positive number" });
      return;
    }
    res.json(await runSpendIngest({ lookbackDays }));
  } catch (err) {
    next(err);
  }
});

router.post("/internal/threads/token-refresh", async (_req, res, next) => {
  try {
    res.json(await runTokenRefresh());
  } catch (err) {
    next(err);
  }
});

/**
 * Every main post on record whose post_published landed (FACTORY-P2-CONTENT-OUTCOMES),
 * fleet-wide, for social-service's post metrics. Service key only: no org on the wire,
 * each row names its own org.
 */
router.get("/internal/threads/measurable-posts", async (req, res, next) => {
  const parsed = MeasurablePostsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    return;
  }
  const { since, afterPublishedAt, afterId, limit } = parsed.data;
  try {
    const rows = await listMeasurablePosts({
      since: since ?? new Date(Date.now() - 90 * 86_400_000),
      after: afterPublishedAt && afterId ? { publishedAt: afterPublishedAt, id: afterId } : undefined,
      limit,
    });
    res.json({
      posts: rows.map((r) => ({
        ...serialisePublication(r),
        orgId: r.orgId,
        outcomeDeclaredAt: r.outcomeDeclaredAt!.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
