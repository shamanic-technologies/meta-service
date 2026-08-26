import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  index,
  unique,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ==================== meta_connections ====================

export const metaConnections = pgTable(
  "meta_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    label: text("label"),
    metaUserId: text("meta_user_id").notNull(),
    metaUserName: text("meta_user_name"),
    accessToken: text("access_token").notNull(), // encrypted at rest
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: text("scopes").array(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_meta_connections_org_id").on(table.orgId),
    index("idx_meta_connections_org_user").on(table.orgId, table.userId),
  ],
);

export const metaConnectionsRelations = relations(
  metaConnections,
  ({ many }) => ({
    adAccounts: many(metaAdAccounts),
    pages: many(metaPages),
  }),
);

// ==================== meta_ad_accounts ====================

export const metaAdAccounts = pgTable(
  "meta_ad_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => metaConnections.id, { onDelete: "cascade" }),
    adAccountId: text("ad_account_id").notNull(), // "act_123456789"
    accountName: text("account_name"),
    currency: text("currency"),
    timezone: text("timezone"),
    accountStatus: integer("account_status"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_meta_ad_accounts_connection_id").on(table.connectionId),
    index("idx_meta_ad_accounts_ad_account_id").on(table.adAccountId),
    unique("uq_connection_ad_account").on(table.connectionId, table.adAccountId),
  ],
);

export const metaAdAccountsRelations = relations(
  metaAdAccounts,
  ({ one }) => ({
    connection: one(metaConnections, {
      fields: [metaAdAccounts.connectionId],
      references: [metaConnections.id],
    }),
  }),
);

// ==================== meta_pages ====================

export const metaPages = pgTable(
  "meta_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => metaConnections.id, { onDelete: "cascade" }),
    pageId: text("page_id").notNull(),
    pageName: text("page_name"),
    pageAccessToken: text("page_access_token").notNull(), // encrypted at rest
    instagramAccountId: text("instagram_account_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_meta_pages_connection_id").on(table.connectionId),
    unique("uq_connection_page").on(table.connectionId, table.pageId),
  ],
);

export const metaPagesRelations = relations(metaPages, ({ one }) => ({
  connection: one(metaConnections, {
    fields: [metaPages.connectionId],
    references: [metaConnections.id],
  }),
}));

// ==================== Inferred types ====================

export type MetaConnection = typeof metaConnections.$inferSelect;
export type NewMetaConnection = typeof metaConnections.$inferInsert;
export type MetaAdAccount = typeof metaAdAccounts.$inferSelect;
export type NewMetaAdAccount = typeof metaAdAccounts.$inferInsert;
export type MetaPage = typeof metaPages.$inferSelect;
export type NewMetaPage = typeof metaPages.$inferInsert;

// ==================== Managed advertising ====================
//
// Everything below is the MANAGED path: campaigns that run from OUR business
// assets on a client's behalf. No client Meta credential is involved, so none
// of these tables reference meta_connections.
//
// The identity columns are not decoration. Spend is declared and the review
// outcome is observed by background jobs, and a job runs long after the request
// headers that carried org/user/brand are gone — so the row itself has to carry
// them, or the cost lands unattributed.

export const metaManagedCampaigns = pgTable(
  "meta_managed_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    brandId: text("brand_id"),
    campaignId: text("campaign_id"),
    featureSlug: text("feature_slug"),
    metaAdAccountId: text("meta_ad_account_id").notNull(),
    metaCampaignId: text("meta_campaign_id").notNull(),
    name: text("name").notNull(),
    objective: text("objective").notNull(),
    status: text("status").notNull(),
    dailyBudgetCents: integer("daily_budget_cents").notNull(),
    destinationUrl: text("destination_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_meta_managed_campaigns_org").on(table.orgId),
    index("idx_meta_managed_campaigns_brand").on(table.brandId),
    unique("uq_meta_managed_campaigns_meta_id").on(table.metaCampaignId),
  ],
);

export const metaManagedAdSets = pgTable(
  "meta_managed_ad_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    managedCampaignId: uuid("managed_campaign_id")
      .notNull()
      .references(() => metaManagedCampaigns.id, { onDelete: "cascade" }),
    metaAdSetId: text("meta_ad_set_id").notNull(),
    name: text("name").notNull(),
    dailyBudgetCents: integer("daily_budget_cents").notNull(),
    optimizationGoal: text("optimization_goal").notNull(),
    customEventType: text("custom_event_type"),
    datasetId: text("dataset_id"),
    billingEvent: text("billing_event").notNull(),
    targeting: jsonb("targeting").notNull(),
    status: text("status").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_meta_managed_ad_sets_campaign").on(table.managedCampaignId),
    unique("uq_meta_managed_ad_sets_meta_id").on(table.metaAdSetId),
  ],
);

export const metaManagedAds = pgTable(
  "meta_managed_ads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    managedCampaignId: uuid("managed_campaign_id")
      .notNull()
      .references(() => metaManagedCampaigns.id, { onDelete: "cascade" }),
    managedAdSetId: uuid("managed_ad_set_id")
      .notNull()
      .references(() => metaManagedAdSets.id, { onDelete: "cascade" }),
    metaAdId: text("meta_ad_id").notNull(),
    metaCreativeId: text("meta_creative_id").notNull(),
    name: text("name").notNull(),
    primaryText: text("primary_text").notNull(),
    headline: text("headline"),
    description: text("description"),
    callToAction: text("call_to_action").notNull(),
    destinationUrl: text("destination_url").notNull(),
    status: text("status").notNull(),
    // Review is observed on its own cadence, never in the launch run.
    reviewStatus: text("review_status").notNull().default("PENDING_REVIEW"),
    reviewFeedback: jsonb("review_feedback"),
    reviewCheckedAt: timestamp("review_checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_meta_managed_ads_campaign").on(table.managedCampaignId),
    index("idx_meta_managed_ads_review_status").on(table.reviewStatus),
    unique("uq_meta_managed_ads_meta_id").on(table.metaAdId),
  ],
);

/**
 * The spend ledger. `observed_cents` is what Meta last reported for that day;
 * `declared_cents` is how much of it has been declared to runs-service. Meta
 * revises a day for several days, so each pass declares the difference only,
 * and a downward revision leaves the declared amount alone rather than
 * rewriting a charge that already happened.
 */
export const metaAdsSpendDaily = pgTable(
  "meta_ads_spend_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    managedCampaignId: uuid("managed_campaign_id")
      .notNull()
      .references(() => metaManagedCampaigns.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull(),
    metaCampaignId: text("meta_campaign_id").notNull(),
    spendDate: text("spend_date").notNull(),
    currency: text("currency").notNull(),
    observedCents: integer("observed_cents").notNull(),
    declaredCents: integer("declared_cents").notNull().default(0),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_meta_ads_spend_daily_org").on(table.orgId),
    index("idx_meta_ads_spend_daily_campaign").on(table.managedCampaignId),
    unique("uq_meta_ads_spend_daily_campaign_date").on(
      table.metaCampaignId,
      table.spendDate,
    ),
  ],
);

export type MetaManagedCampaign = typeof metaManagedCampaigns.$inferSelect;
export type NewMetaManagedCampaign = typeof metaManagedCampaigns.$inferInsert;
export type MetaManagedAdSet = typeof metaManagedAdSets.$inferSelect;
export type NewMetaManagedAdSet = typeof metaManagedAdSets.$inferInsert;
export type MetaManagedAd = typeof metaManagedAds.$inferSelect;
export type NewMetaManagedAd = typeof metaManagedAds.$inferInsert;
export type MetaAdsSpendDaily = typeof metaAdsSpendDaily.$inferSelect;
export type NewMetaAdsSpendDaily = typeof metaAdsSpendDaily.$inferInsert;
