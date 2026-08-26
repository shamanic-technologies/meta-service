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

export default router;
