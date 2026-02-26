import { db, sql } from "../../src/db/index.js";
import {
  metaConnections,
  metaAdAccounts,
  metaPages,
} from "../../src/db/schema.js";
import type { NewMetaConnection, NewMetaAdAccount } from "../../src/db/schema.js";
import { encrypt } from "../../src/lib/crypto.js";

export async function cleanTestData() {
  await db.delete(metaPages);
  await db.delete(metaAdAccounts);
  await db.delete(metaConnections);
}

export async function insertTestConnection(
  overrides: Partial<NewMetaConnection> = {},
) {
  const [conn] = await db
    .insert(metaConnections)
    .values({
      appId: overrides.appId ?? "test-app",
      orgId: overrides.orgId ?? "org-test",
      label: overrides.label ?? "Test Connection",
      metaUserId: overrides.metaUserId ?? `meta-user-${Date.now()}`,
      metaUserName: overrides.metaUserName ?? "Test User",
      accessToken:
        overrides.accessToken ?? encrypt("test-access-token"),
      tokenExpiresAt: overrides.tokenExpiresAt ?? null,
      scopes: overrides.scopes ?? ["ads_read", "ads_management"],
    })
    .returning();
  return conn;
}

export async function insertTestAdAccount(
  connectionId: string,
  overrides: Partial<NewMetaAdAccount> = {},
) {
  const [account] = await db
    .insert(metaAdAccounts)
    .values({
      connectionId,
      adAccountId:
        overrides.adAccountId ?? `act_${Date.now()}`,
      accountName: overrides.accountName ?? "Test Ad Account",
      currency: overrides.currency ?? "USD",
      timezone: overrides.timezone ?? "America/New_York",
      accountStatus: overrides.accountStatus ?? 1,
      isActive: overrides.isActive ?? true,
    })
    .returning();
  return account;
}

export async function closeDb() {
  await sql.end();
}
