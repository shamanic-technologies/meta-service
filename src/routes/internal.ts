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
import { listMeasurablePosts, PublicationNotMeasurableError, publicationInsights, serialisePublication } from "../lib/threads-publications.js";
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

/**
 * The live insights of one main post, on the account that published it
 * (FACTORY-P2-CONTENT-OUTCOMES, the Threads adapter of social-service's post
 * metrics). Free; nothing stored here. 409 reasons: needs_reconnect,
 * insights_scope_missing, insights_permission_missing, not_measurable.
 */
router.get("/internal/threads/publications/:id/insights", async (req, res, next) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) {
    res.status(400).json({ error: "Invalid publication id" });
    return;
  }
  try {
    const read = await publicationInsights(req.params.id);
    if (!read) {
      res.status(404).json({ error: "Publication not found" });
      return;
    }
    res.json({
      publicationId: read.publication.id,
      postId: read.publication.threadsPostId,
      permalink: read.publication.permalink,
      observedAt: read.observedAt,
      metrics: read.insights,
      raw: read.raw,
    });
  } catch (err) {
    if (err instanceof PublicationNotMeasurableError) {
      res.status(409).json({ error: err.message, reason: "not_measurable" });
      return;
    }
    next(err);
  }
});

export default router;
