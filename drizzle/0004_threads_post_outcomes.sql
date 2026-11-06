ALTER TABLE "threads_publications" ADD COLUMN IF NOT EXISTS "origin" text DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "threads_publications" ADD COLUMN IF NOT EXISTS "performed_by" text DEFAULT 'ours' NOT NULL;--> statement-breakpoint
ALTER TABLE "threads_publications" ADD COLUMN IF NOT EXISTS "outcome_key" text DEFAULT 'post_published' NOT NULL;--> statement-breakpoint
ALTER TABLE "threads_publications" ADD COLUMN IF NOT EXISTS "outcome_run_id" text;--> statement-breakpoint
ALTER TABLE "threads_publications" ADD COLUMN IF NOT EXISTS "media_type" text;--> statement-breakpoint
ALTER TABLE "threads_accounts" ADD COLUMN IF NOT EXISTS "posts_imported_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_threads_publications_account_post" ON "threads_publications" ("account_id","threads_post_id") WHERE "origin" = 'imported';
