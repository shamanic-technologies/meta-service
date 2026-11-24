/**
 * Provider read of our Units of `threads_post_published` (ENGINE-GET-ASK-1123).
 *
 * A Unit = ONE Threads MAIN post on record, published by us or imported from a
 * connected account. A reply declares no outcome, so it is not a Unit; a
 * publication still `publishing` is not one either. workflow-service finds the
 * route by its OpenAPI tag (`provider:threads_post_published`) and calls it as a
 * script's run. This read is the calling org's own records only: it never calls
 * Threads, spends nothing, writes nothing.
 */
import { and, desc, eq, gte, inArray, isNotNull, lt, sql, type SQL } from "drizzle-orm";
import { db } from "../db/index.js";
import { threadsPublications, type ThreadsPublication } from "../db/schema.js";
import { SUBJECT_SERVICE, THREADS_POST_PUBLISHED } from "./threads-publications.js";

export const UNITS_DEFAULT_LIMIT = 100;
export const UNITS_MAX_LIMIT = 500;
export const UNITS_MAX_LIST = 100;
export const UNIT_ORIGINS = ["published", "imported"] as const;
export type UnitOrigin = (typeof UNIT_ORIGINS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const HAS_ZONE = /(Z|[+-]\d{2}:?\d{2})$/;

/** The query cannot be read as written. 400, names the field. */
export class UnitsQueryError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = "UnitsQueryError";
  }
}

/** The cursor is not one this service issued. 400 `invalid_cursor`. */
export class InvalidCursorError extends Error {
  constructor() {
    super("`cursor` is not a `nextCursor` this route returned. Omit it to read from the first page.");
    this.name = "InvalidCursorError";
  }
}

export interface UnitCursor {
  publishedAt: Date;
  id: string;
}

export function encodeUnitCursor(cursor: UnitCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.publishedAt.toISOString(), i: cursor.id })).toString("base64url");
}

export function decodeUnitCursor(raw: string): UnitCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new InvalidCursorError();
  }
  const { t, i } = (parsed ?? {}) as { t?: unknown; i?: unknown };
  if (typeof t !== "string" || typeof i !== "string" || !UUID.test(i)) throw new InvalidCursorError();
  const publishedAt = new Date(t);
  if (Number.isNaN(publishedAt.getTime())) throw new InvalidCursorError();
  return { publishedAt, id: i.toLowerCase() };
}

export interface UnitsFilters {
  orgId: string;
  since?: Date;
  until?: Date;
  brandId?: string;
  campaignId?: string;
  accountId?: string;
  threadsUserId?: string;
  origin?: UnitOrigin;
  publicationIds?: string[];
  postIds?: string[];
  limit: number;
  cursor?: UnitCursor;
}

/** The query as the route's schema leaves it: strings, or a repeated parameter as an array. */
export interface RawUnitsQuery {
  since?: string;
  until?: string;
  brandId?: string;
  campaignId?: string;
  accountId?: string;
  threadsUserId?: string;
  origin?: UnitOrigin;
  publicationIds?: string | string[];
  postIds?: string | string[];
  limit?: number;
  cursor?: string;
}

function parseDate(field: string, raw: string | undefined): Date | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  // A datetime without a zone is read as UTC; a bare date is that day's 00:00 UTC.
  const date = ISO_DATETIME.test(value)
    ? new Date(value.includes("T") && !HAS_ZONE.test(value) ? `${value}Z` : value)
    : new Date(NaN);
  if (Number.isNaN(date.getTime())) {
    throw new UnitsQueryError(field, `\`${field}\` must be an ISO 8601 datetime (e.g. 2026-11-01T00:00:00Z)`);
  }
  return date;
}

function parseList(field: string, raw: string | string[] | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const values = [
    ...new Set(
      (Array.isArray(raw) ? raw : [raw])
        .flatMap((v) => v.split(","))
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
  if (values.length === 0) {
    throw new UnitsQueryError(field, `\`${field}\` is given but names nothing. Omit it, or list at least one id.`);
  }
  if (values.length > UNITS_MAX_LIST) {
    throw new UnitsQueryError(field, `\`${field}\` takes at most ${UNITS_MAX_LIST} ids (got ${values.length})`);
  }
  return values;
}

export function parseUnitsQuery(orgId: string, raw: RawUnitsQuery): UnitsFilters {
  const since = parseDate("since", raw.since);
  const until = parseDate("until", raw.until);
  if (since && until && until <= since) {
    throw new UnitsQueryError("until", "`until` must be later than `since`");
  }
  const listed = parseList("publicationIds", raw.publicationIds);
  const publicationIds = listed && [...new Set(listed.map((id) => id.toLowerCase()))];
  const bad = publicationIds?.find((id) => !UUID.test(id));
  if (bad) throw new UnitsQueryError("publicationIds", `\`publicationIds\` holds "${bad}", which is not a publication id (uuid)`);
  return {
    orgId,
    since,
    until,
    brandId: raw.brandId,
    campaignId: raw.campaignId,
    accountId: raw.accountId,
    threadsUserId: raw.threadsUserId,
    origin: raw.origin,
    publicationIds,
    postIds: parseList("postIds", raw.postIds),
    limit: raw.limit ?? UNITS_DEFAULT_LIMIT,
    cursor: raw.cursor === undefined ? undefined : decodeUnitCursor(raw.cursor),
  };
}

export function serialiseUnit(row: ThreadsPublication) {
  return {
    unitId: row.id,
    outcome: THREADS_POST_PUBLISHED,
    subject: { service: SUBJECT_SERVICE, id: row.id },
    at: row.publishedAt!.toISOString(),
    madeBy: {
      origin: row.origin as UnitOrigin,
      performedBy: row.performedBy as "ours" | "client_team",
      runId: row.runId,
      outcomeRunId: row.outcomeRunId ?? row.runId,
      userId: row.userId,
    },
    declaredOnLedger: row.outcomeDeclaredAt !== null,
    declaredAt: row.outcomeDeclaredAt ? row.outcomeDeclaredAt.toISOString() : null,
    brandId: row.brandId,
    campaignId: row.campaignId,
    accountId: row.accountId,
    accountUsername: row.accountUsername,
    threadsUserId: row.threadsUserId,
    postId: row.threadsPostId!,
    permalink: row.permalink,
    text: row.publishedText ?? row.text,
    mediaType: row.mediaType,
  };
}

export type ThreadsPostPublishedUnit = ReturnType<typeof serialiseUnit>;

/**
 * One page of the org's Units, newest first, keyset on (published_at, id) DESC.
 * Reads `limit + 1` rows: the extra one only says whether a next page exists.
 */
export async function listPostPublishedUnits(
  filters: UnitsFilters,
): Promise<{ units: ThreadsPostPublishedUnit[]; nextCursor: string | null }> {
  const where: SQL[] = [
    eq(threadsPublications.orgId, filters.orgId),
    eq(threadsPublications.kind, "post"),
    eq(threadsPublications.status, "published"),
    eq(threadsPublications.outcomeKey, THREADS_POST_PUBLISHED),
    isNotNull(threadsPublications.publishedAt),
    isNotNull(threadsPublications.threadsPostId),
  ];
  if (filters.since) where.push(gte(threadsPublications.publishedAt, filters.since));
  if (filters.until) where.push(lt(threadsPublications.publishedAt, filters.until));
  if (filters.brandId) where.push(eq(threadsPublications.brandId, filters.brandId));
  if (filters.campaignId) where.push(eq(threadsPublications.campaignId, filters.campaignId));
  if (filters.accountId) where.push(eq(threadsPublications.accountId, filters.accountId));
  if (filters.threadsUserId) where.push(eq(threadsPublications.threadsUserId, filters.threadsUserId));
  if (filters.origin) where.push(eq(threadsPublications.origin, filters.origin));
  if (filters.publicationIds) where.push(inArray(threadsPublications.id, filters.publicationIds));
  if (filters.postIds) where.push(inArray(threadsPublications.threadsPostId, filters.postIds));
  if (filters.cursor) {
    where.push(
      sql`(${threadsPublications.publishedAt}, ${threadsPublications.id}) < (${filters.cursor.publishedAt.toISOString()}::timestamptz, ${filters.cursor.id}::uuid)`,
    );
  }
  const rows = await db
    .select()
    .from(threadsPublications)
    .where(and(...where))
    .orderBy(desc(threadsPublications.publishedAt), desc(threadsPublications.id))
    .limit(filters.limit + 1);
  const page = rows.slice(0, filters.limit);
  const last = page[page.length - 1];
  return {
    units: page.map(serialiseUnit),
    nextCursor: rows.length > filters.limit && last ? encodeUnitCursor({ publishedAt: last.publishedAt!, id: last.id }) : null,
  };
}
