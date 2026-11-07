-- DELETE-POST-PUBLISHED-1107 (owner 2026-11-07): the coarse `post_published` is retired fleet-wide.
-- Every Threads publication on record holding it is relabelled to its fine outcome; nothing deleted.
-- Prod before (2026-11-07): 37 published posts + 104 replies = 141 rows `post_published`; after: 0.
UPDATE "threads_publications" SET "outcome_key" = 'threads_post_published' WHERE "outcome_key" = 'post_published';--> statement-breakpoint
ALTER TABLE "threads_publications" ALTER COLUMN "outcome_key" SET DEFAULT 'threads_post_published';
