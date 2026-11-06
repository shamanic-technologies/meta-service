CREATE TABLE "threads_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"threads_user_id" text NOT NULL,
	"account_username" text NOT NULL,
	"account_type" text NOT NULL,
	"user_id" text NOT NULL,
	"run_id" text NOT NULL,
	"campaign_id" text,
	"kind" text NOT NULL,
	"reply_to_post_id" text,
	"thread_root_post_id" text,
	"text" text NOT NULL,
	"status" text DEFAULT 'publishing' NOT NULL,
	"threads_post_id" text,
	"permalink" text,
	"idempotency_key" text,
	"outcome_declared_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_threads_publications_org_key" UNIQUE("org_id","idempotency_key")
);
--> statement-breakpoint
CREATE INDEX "idx_threads_publications_campaign" ON "threads_publications" USING btree ("org_id","campaign_id","published_at");--> statement-breakpoint
CREATE INDEX "idx_threads_publications_brand" ON "threads_publications" USING btree ("org_id","brand_id","published_at");--> statement-breakpoint
CREATE INDEX "idx_threads_publications_post" ON "threads_publications" USING btree ("org_id","threads_post_id");