ALTER TABLE "threads_publications" ADD COLUMN IF NOT EXISTS "published_text" text;--> statement-breakpoint
ALTER TABLE "threads_publications" ADD COLUMN IF NOT EXISTS "link_tracking" text;
