CREATE TABLE "threads_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"connected_by_user_id" text NOT NULL,
	"threads_user_id" text NOT NULL,
	"username" text NOT NULL,
	"name" text,
	"profile_picture_url" text,
	"account_type" text NOT NULL,
	"access_token" text NOT NULL,
	"token_issued_at" timestamp with time zone NOT NULL,
	"token_expires_at" timestamp with time zone NOT NULL,
	"scopes" text[] NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"status_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_threads_accounts_brand_user" UNIQUE("org_id","brand_id","threads_user_id")
);
--> statement-breakpoint
CREATE TABLE "threads_oauth_pending" (
	"state" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"account_type" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_threads_accounts_org_brand" ON "threads_accounts" USING btree ("org_id","brand_id");
--> statement-breakpoint
CREATE INDEX "idx_threads_accounts_token_expires" ON "threads_accounts" USING btree ("token_expires_at");
--> statement-breakpoint
CREATE INDEX "idx_threads_oauth_pending_expires" ON "threads_oauth_pending" USING btree ("expires_at");
