-- Baseline. The service had no migration at all: its tables were applied with
-- `drizzle-kit push`, so a fresh clone had nothing to migrate from and the
-- migrations folder did not survive into the image. Everything is written
-- IF NOT EXISTS so this is a no-op against the database that already has the
-- connection tables, and a full create against an empty one.

CREATE TABLE IF NOT EXISTS "meta_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"label" text,
	"meta_user_id" text NOT NULL,
	"meta_user_name" text,
	"access_token" text NOT NULL,
	"token_expires_at" timestamp with time zone,
	"scopes" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meta_ad_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"ad_account_id" text NOT NULL,
	"account_name" text,
	"currency" text,
	"timezone" text,
	"account_status" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_connection_ad_account" UNIQUE("connection_id","ad_account_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meta_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"page_id" text NOT NULL,
	"page_name" text,
	"page_access_token" text NOT NULL,
	"instagram_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_connection_page" UNIQUE("connection_id","page_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meta_managed_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"brand_id" text,
	"campaign_id" text,
	"feature_slug" text,
	"meta_ad_account_id" text NOT NULL,
	"meta_campaign_id" text NOT NULL,
	"name" text NOT NULL,
	"objective" text NOT NULL,
	"status" text NOT NULL,
	"daily_budget_cents" integer NOT NULL,
	"destination_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_meta_managed_campaigns_meta_id" UNIQUE("meta_campaign_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meta_managed_ad_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"managed_campaign_id" uuid NOT NULL,
	"meta_ad_set_id" text NOT NULL,
	"name" text NOT NULL,
	"daily_budget_cents" integer NOT NULL,
	"optimization_goal" text NOT NULL,
	"custom_event_type" text,
	"dataset_id" text,
	"billing_event" text NOT NULL,
	"targeting" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_meta_managed_ad_sets_meta_id" UNIQUE("meta_ad_set_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meta_managed_ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"managed_campaign_id" uuid NOT NULL,
	"managed_ad_set_id" uuid NOT NULL,
	"meta_ad_id" text NOT NULL,
	"meta_creative_id" text NOT NULL,
	"name" text NOT NULL,
	"primary_text" text NOT NULL,
	"headline" text,
	"description" text,
	"call_to_action" text NOT NULL,
	"destination_url" text NOT NULL,
	"status" text NOT NULL,
	"review_status" text DEFAULT 'PENDING_REVIEW' NOT NULL,
	"review_feedback" jsonb,
	"review_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_meta_managed_ads_meta_id" UNIQUE("meta_ad_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "meta_ads_spend_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"managed_campaign_id" uuid NOT NULL,
	"org_id" text NOT NULL,
	"meta_campaign_id" text NOT NULL,
	"spend_date" text NOT NULL,
	"currency" text NOT NULL,
	"observed_cents" integer NOT NULL,
	"declared_cents" integer DEFAULT 0 NOT NULL,
	"last_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_meta_ads_spend_daily_campaign_date" UNIQUE("meta_campaign_id","spend_date")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meta_ad_accounts" ADD CONSTRAINT "meta_ad_accounts_connection_id_meta_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meta_pages" ADD CONSTRAINT "meta_pages_connection_id_meta_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meta_managed_ad_sets" ADD CONSTRAINT "meta_managed_ad_sets_managed_campaign_id_meta_managed_campaigns_id_fk" FOREIGN KEY ("managed_campaign_id") REFERENCES "public"."meta_managed_campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meta_managed_ads" ADD CONSTRAINT "meta_managed_ads_managed_campaign_id_meta_managed_campaigns_id_fk" FOREIGN KEY ("managed_campaign_id") REFERENCES "public"."meta_managed_campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meta_managed_ads" ADD CONSTRAINT "meta_managed_ads_managed_ad_set_id_meta_managed_ad_sets_id_fk" FOREIGN KEY ("managed_ad_set_id") REFERENCES "public"."meta_managed_ad_sets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "meta_ads_spend_daily" ADD CONSTRAINT "meta_ads_spend_daily_managed_campaign_id_meta_managed_campaigns_id_fk" FOREIGN KEY ("managed_campaign_id") REFERENCES "public"."meta_managed_campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_meta_connections_org_id" ON "meta_connections" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_meta_connections_org_user" ON "meta_connections" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_meta_ad_accounts_connection_id" ON "meta_ad_accounts" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_meta_ad_accounts_ad_account_id" ON "meta_ad_accounts" USING btree ("ad_account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_meta_pages_connection_id" ON "meta_pages" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_meta_managed_campaigns_org" ON "meta_managed_campaigns" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_meta_managed_campaigns_brand" ON "meta_managed_campaigns" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_meta_managed_ad_sets_campaign" ON "meta_managed_ad_sets" USING btree ("managed_campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_meta_managed_ads_campaign" ON "meta_managed_ads" USING btree ("managed_campaign_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_meta_managed_ads_review_status" ON "meta_managed_ads" USING btree ("review_status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_meta_ads_spend_daily_org" ON "meta_ads_spend_daily" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_meta_ads_spend_daily_campaign" ON "meta_ads_spend_daily" USING btree ("managed_campaign_id");
