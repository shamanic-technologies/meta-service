import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ==================== meta_connections ====================

export const metaConnections = pgTable(
  "meta_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: text("app_id").notNull(),
    orgId: text("org_id"),
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
    index("idx_meta_connections_app_id").on(table.appId),
    index("idx_meta_connections_org_id").on(table.orgId),
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
