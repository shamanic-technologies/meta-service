/**
 * Provider read of `threads_post_published` Units (ENGINE-GET-ASK-1123): the query
 * normalisation, the cursor, the Unit shape, and the OpenAPI contract
 * workflow-service discovers the route by (tag + operationId).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { registry, ThreadsPostPublishedUnitsQuerySchema, ThreadsPublishSchema } from "../../src/schemas.js";
import {
  InvalidCursorError,
  UnitsQueryError,
  decodeUnitCursor,
  encodeUnitCursor,
  parseUnitsQuery,
  serialiseUnit,
} from "../../src/lib/threads-units.js";
import type { ThreadsPublication } from "../../src/db/schema.js";

const PATH = "/orgs/units/threads-post-published";
const ID = "0b0e7f0e-6f43-4f0e-9a51-0d1c2b3a4f5e";

function row(over: Partial<ThreadsPublication> = {}): ThreadsPublication {
  return {
    id: ID,
    orgId: "org-1",
    brandId: "brand-1",
    accountId: "5f0c2d0a-0000-4000-8000-000000000001",
    threadsUserId: "1001",
    accountUsername: "alice_ai",
    accountType: "pro_ai",
    userId: "user-1",
    runId: "run-1",
    campaignId: "camp-1",
    kind: "post",
    replyToPostId: null,
    threadRootPostId: "post-1",
    text: "as asked https://distribute.you",
    status: "published",
    threadsPostId: "post-1",
    permalink: "https://www.threads.net/@alice_ai/post/abc",
    idempotencyKey: null,
    publishedText: "as sent https://distribute.you?dy_post=x",
    linkTracking: "tracked:1",
    origin: "published",
    performedBy: "ours",
    outcomeKey: "threads_post_published",
    outcomeRunId: null,
    mediaType: null,
    outcomeDeclaredAt: new Date("2026-11-20T10:00:05.000Z"),
    publishedAt: new Date("2026-11-20T10:00:00.000Z"),
    createdAt: new Date("2026-11-20T09:59:59.000Z"),
    updatedAt: new Date("2026-11-20T10:00:05.000Z"),
    ...over,
  };
}

describe("threads_post_published Units: OpenAPI contract", () => {
  const generated = new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: "3.0.0",
    info: { title: "t", version: "1" },
  });
  const committed = JSON.parse(readFileSync(join(__dirname, "..", "..", "openapi.json"), "utf-8"));

  it.each([
    ["the registry", generated],
    ["the committed openapi.json", committed],
  ])("%s carries the operation under its provider tag and operationId", (_name, doc) => {
    const op = doc.paths[PATH]?.get;
    expect(op).toBeDefined();
    expect(op.operationId).toBe("listThreadsPostPublishedUnits");
    expect(op.tags).toEqual(["provider:threads_post_published"]);
  });

  it("is the ONLY operation tagged as a Provider read, and no other operation shares its id", () => {
    const ops = Object.entries(committed.paths as Record<string, Record<string, any>>).flatMap(([path, methods]) =>
      Object.entries(methods).map(([method, op]) => ({ path, method, op })),
    );
    const tagged = ops.filter(({ op }) => (op.tags ?? []).some((t: string) => t.startsWith("provider:")));
    expect(tagged.map(({ path, method }) => `${method} ${path}`)).toEqual([`get ${PATH}`]);
    expect(ops.filter(({ op }) => op.operationId === "listThreadsPostPublishedUnits")).toHaveLength(1);
  });

  it("the committed openapi.json is the generated one for this path (never hand-edited, never stale)", () => {
    expect(committed.paths[PATH]).toEqual(JSON.parse(JSON.stringify(generated.paths[PATH])));
  });

  it("documents every filter in plain words, all optional, and the identity headers", () => {
    const params = committed.paths[PATH].get.parameters as Array<{ name: string; in: string; required?: boolean; description?: string; schema: any }>;
    const query = params.filter((p) => p.in === "query");
    expect(query.map((p) => p.name).sort()).toEqual(
      ["accountId", "brandId", "campaignId", "cursor", "limit", "origin", "postIds", "publicationIds", "since", "threadsUserId", "until"].sort(),
    );
    for (const p of query) {
      expect(p.required ?? false, p.name).toBe(false);
      expect((p.description ?? p.schema.description ?? "").length, p.name).toBeGreaterThan(20);
    }
    expect(params.filter((p) => p.in === "header" && p.required).map((p) => p.name).sort()).toEqual(["x-org-id", "x-run-id", "x-user-id"]);
    const limit = query.find((p) => p.name === "limit")!;
    expect([limit.schema.minimum, limit.schema.maximum]).toEqual([1, 500]);
  });

  it("the publish door describes every input a caller may state", () => {
    const publish = committed.paths["/orgs/threads/accounts/{id}/posts"].post;
    const body = committed.components.schemas.ThreadsPublish.properties;
    for (const field of ["text", "replyToPostId", "idempotencyKey", "outcomeKey"]) {
      expect((body[field].description ?? "").length, field).toBeGreaterThan(40);
    }
    const campaign = publish.parameters.find((p: any) => p.name === "x-campaign-id");
    expect((campaign.description ?? campaign.schema.description ?? "").length).toBeGreaterThan(40);
    expect(campaign.required ?? false).toBe(false);
  });

  it("the publish door's behaviour is unchanged by its doc", () => {
    expect(ThreadsPublishSchema.safeParse({ text: "hello" }).success).toBe(true);
    expect(ThreadsPublishSchema.safeParse({ text: "" }).success).toBe(false);
    expect(ThreadsPublishSchema.safeParse({ text: "x".repeat(501) }).success).toBe(false);
    expect(ThreadsPublishSchema.safeParse({ text: "a", outcomeKey: "threads_post_published" }).success).toBe(true);
    expect(ThreadsPublishSchema.safeParse({ text: "a", outcomeKey: "post_published" }).success).toBe(false);
    expect(ThreadsPublishSchema.safeParse({ text: "a", idempotencyKey: "k".repeat(513) }).success).toBe(false);
  });
});

describe("threads_post_published Units: query", () => {
  it("no filter = the whole org since inception, 100 per page", () => {
    expect(parseUnitsQuery("org-1", {})).toEqual({
      orgId: "org-1",
      since: undefined,
      until: undefined,
      brandId: undefined,
      campaignId: undefined,
      accountId: undefined,
      threadsUserId: undefined,
      origin: undefined,
      publicationIds: undefined,
      postIds: undefined,
      limit: 100,
      cursor: undefined,
    });
  });

  it("the schema bounds limit, origin and accountId", () => {
    const parse = (q: Record<string, unknown>) => ThreadsPostPublishedUnitsQuerySchema.safeParse(q);
    expect(parse({ limit: "500" }).data?.limit).toBe(500);
    expect(parse({ limit: "501" }).success).toBe(false);
    expect(parse({ limit: "0" }).success).toBe(false);
    expect(parse({ limit: "abc" }).success).toBe(false);
    expect(parse({ origin: "imported" }).success).toBe(true);
    expect(parse({ origin: "hand" }).success).toBe(false);
    expect(parse({ accountId: "nope" }).success).toBe(false);
    expect(parse({ accountId: ID }).success).toBe(true);
  });

  it("reads dates as ISO 8601, a zoneless datetime as UTC", () => {
    const f = parseUnitsQuery("o", { since: "2026-11-01T00:00:00", until: "2026-11-02T02:00:00+02:00" });
    expect(f.since!.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(f.until!.toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(parseUnitsQuery("o", { since: "2026-11-01" }).since!.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it.each(["yesterday", "5", "2026-13-45T00:00:00Z", ""])("refuses the date %j, naming the field", (since) => {
    try {
      parseUnitsQuery("o", { since });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(UnitsQueryError);
      expect((err as UnitsQueryError).field).toBe("since");
    }
  });

  it("refuses until at or before since", () => {
    expect(() => parseUnitsQuery("o", { since: "2026-11-02T00:00:00Z", until: "2026-11-02T00:00:00Z" })).toThrow(UnitsQueryError);
  });

  it("reads lists comma-separated or repeated, trimmed and de-duplicated", () => {
    const other = "1b0e7f0e-6f43-4f0e-9a51-0d1c2b3a4f5e";
    const f = parseUnitsQuery("o", { publicationIds: `${ID.toUpperCase()}, ${other},${ID}`, postIds: ["p1,p2", " p3 ", "p1"] });
    expect(f.publicationIds).toEqual([ID, other]);
    expect(f.postIds).toEqual(["p1", "p2", "p3"]);
  });

  it("refuses a list over 100, an empty one, and a publication id that is not a uuid", () => {
    const many = Array.from({ length: 101 }, (_, i) => `p${i}`).join(",");
    expect(() => parseUnitsQuery("o", { postIds: many })).toThrow(/at most 100/);
    expect(parseUnitsQuery("o", { postIds: many.split(",").slice(0, 100) }).postIds).toHaveLength(100);
    expect(() => parseUnitsQuery("o", { postIds: " , " })).toThrow(UnitsQueryError);
    expect(() => parseUnitsQuery("o", { publicationIds: "not-a-uuid" })).toThrow(/not a publication id/);
  });
});

describe("threads_post_published Units: cursor", () => {
  it("round-trips, opaque and URL-safe", () => {
    const cursor = { publishedAt: new Date("2026-11-20T10:00:00.123Z"), id: ID };
    const encoded = encodeUnitCursor(cursor);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeUnitCursor(encoded)).toEqual(cursor);
    expect(parseUnitsQuery("o", { cursor: encoded }).cursor).toEqual(cursor);
  });

  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  it.each([
    ["garbage", "garbage"],
    ["not JSON", Buffer.from("{oops").toString("base64url")],
    ["null", b64(null)],
    ["no id", b64({ t: "2026-11-20T10:00:00.000Z" })],
    ["id not a uuid", b64({ t: "2026-11-20T10:00:00.000Z", i: "1; drop table" })],
    ["bad date", b64({ t: "soon", i: ID })],
  ])("refuses a cursor it did not issue: %s", (_name, raw) => {
    expect(() => decodeUnitCursor(raw)).toThrow(InvalidCursorError);
  });
});

describe("threads_post_published Units: shape", () => {
  it("a post we published", () => {
    expect(serialiseUnit(row())).toEqual({
      unitId: ID,
      outcome: "threads_post_published",
      subject: { service: "meta-service", id: ID },
      at: "2026-11-20T10:00:00.000Z",
      madeBy: { origin: "published", performedBy: "ours", runId: "run-1", outcomeRunId: "run-1", userId: "user-1" },
      declaredOnLedger: true,
      declaredAt: "2026-11-20T10:00:05.000Z",
      brandId: "brand-1",
      campaignId: "camp-1",
      accountId: "5f0c2d0a-0000-4000-8000-000000000001",
      accountUsername: "alice_ai",
      threadsUserId: "1001",
      postId: "post-1",
      permalink: "https://www.threads.net/@alice_ai/post/abc",
      text: "as sent https://distribute.you?dy_post=x",
      mediaType: null,
    });
  });

  it("an imported hand post, not on the ledger yet", () => {
    const unit = serialiseUnit(
      row({ origin: "imported", performedBy: "client_team", outcomeRunId: "unit-run", outcomeDeclaredAt: null, publishedText: null, campaignId: null, mediaType: "IMAGE" }),
    );
    expect(unit.madeBy).toEqual({ origin: "imported", performedBy: "client_team", runId: "run-1", outcomeRunId: "unit-run", userId: "user-1" });
    expect(unit.declaredOnLedger).toBe(false);
    expect(unit.declaredAt).toBeNull();
    expect(unit.text).toBe("as asked https://distribute.you");
    expect(unit.campaignId).toBeNull();
    expect(unit.mediaType).toBe("IMAGE");
  });
});
