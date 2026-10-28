/**
 * Threads accounts against a REAL Postgres (the one-row-per-account guarantee is
 * the database's unique key, so a mocked db would prove nothing) with the
 * Threads API and key-service mocked at the network edge.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";

const keyServiceMock = vi.hoisted(() => ({
  getPlatformKey: vi.fn(async (provider: string) => {
    if (provider === "threads-app-id") return "threads-app-123";
    if (provider === "threads-app-secret") return "threads-secret-xyz";
    throw new Error(`unexpected key ${provider}`);
  }),
}));

vi.mock("../../src/lib/key-service.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/key-service.js")>();
  return { ...actual, getPlatformKey: keyServiceMock.getPlatformKey };
});

const { db, sql } = await import("../../src/db/index.js");
const { threadsAccounts, threadsOauthPending } = await import("../../src/db/schema.js");
const { encrypt, decrypt } = await import("../../src/lib/crypto.js");
const { runTokenRefresh } = await import("../../src/lib/threads-accounts.js");
const { createTestApp, getAuthHeaders } = await import("../helpers/test-app.js");

const app = createTestApp();
const BRAND = "brand-1";

/** Threads user ids the mocked vendor hands out, keyed by authorization code. */
const CODE_TO_USER: Record<string, { id: string; username: string }> = {
  "code-alice": { id: "1001", username: "alice_ai" },
  "code-bob": { id: "1002", username: "bob_human" },
};

type Handler = (url: URL, init?: RequestInit) => { status?: number; body: unknown };
let threadsHandler: Handler;
const calls: Array<{ url: URL; body: URLSearchParams | null }> = [];

function defaultThreads(): Handler {
  return (url, init) => {
    const body = init?.body ? new URLSearchParams(String(init.body)) : null;
    if (url.pathname === "/oauth/access_token") {
      const user = CODE_TO_USER[body!.get("code")!];
      if (!user) return { status: 400, body: { error: { message: "bad code", code: 100 } } };
      return { body: { access_token: `short-${user.id}`, user_id: Number(user.id) } };
    }
    if (url.pathname === "/access_token") {
      const short = url.searchParams.get("access_token")!;
      return { body: { access_token: short.replace("short", "long"), token_type: "bearer", expires_in: 5184000 } };
    }
    if (url.pathname === "/refresh_access_token") {
      return { body: { access_token: "long-refreshed", token_type: "bearer", expires_in: 5184000 } };
    }
    if (url.pathname === "/v1.0/me") {
      const id = url.searchParams.get("access_token")!.replace("long-", "");
      const user = Object.values(CODE_TO_USER).find((u) => u.id === id)!;
      return {
        body: { id: user.id, username: user.username, name: user.username, threads_profile_picture_url: `https://pics/${user.id}.jpg` },
      };
    }
    if (/^\/v1\.0\/\d+\/threads$/.test(url.pathname)) {
      return { body: { id: body!.get("reply_to_id") ? "container-reply" : "container-root" } };
    }
    if (/^\/v1\.0\/container-/.test(url.pathname)) {
      return { body: { status: "FINISHED", id: url.pathname.split("/").pop() } };
    }
    if (/^\/v1\.0\/\d+\/threads_publish$/.test(url.pathname)) {
      return { body: { id: body!.get("creation_id") === "container-reply" ? "post-reply" : "post-root" } };
    }
    if (/^\/v1\.0\/post-/.test(url.pathname)) {
      const id = url.pathname.split("/").pop();
      return { body: { id, permalink: `https://www.threads.net/@x/post/${id}` } };
    }
    return { status: 404, body: { error: { message: `unmocked ${url.pathname}` } } };
  };
}

const realFetch = globalThis.fetch;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./drizzle" });
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (!url.hostname.endsWith("threads.net")) return realFetch(input, init);
    calls.push({ url, body: init?.body ? new URLSearchParams(String(init.body)) : null });
    const { status = 200, body } = threadsHandler(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await sql.end();
});

beforeEach(async () => {
  await db.delete(threadsAccounts);
  await db.delete(threadsOauthPending);
  threadsHandler = defaultThreads();
  calls.length = 0;
});

async function connect(code: string, accountType = "pro_ai", headers = getAuthHeaders()) {
  const start = await request(app)
    .post("/orgs/threads/auth/start")
    .set(headers)
    .send({ brandId: BRAND, accountType, redirectUri: "https://dashboard.distribute.you/threads/callback" });
  expect(start.status).toBe(200);
  const state = new URL(start.body.authorizationUrl).searchParams.get("state")!;
  return request(app).post("/orgs/threads/auth/callback").set(headers).send({ code: `${code}#_`, state });
}

describe("Threads connect", () => {
  it("returns a Threads authorization URL for our app with the publishing scopes", async () => {
    const res = await request(app)
      .post("/orgs/threads/auth/start")
      .set(getAuthHeaders())
      .send({ brandId: BRAND, accountType: "pro_human", redirectUri: "https://dashboard.distribute.you/threads/callback" });

    expect(res.status).toBe(200);
    const url = new URL(res.body.authorizationUrl);
    expect(url.origin + url.pathname).toBe("https://threads.net/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("threads-app-123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://dashboard.distribute.you/threads/callback");
    expect(url.searchParams.get("scope")).toBe("threads_basic,threads_content_publish,threads_manage_replies");
    expect(url.searchParams.get("state")).toBe(res.body.state);
  });

  it("refuses an account type outside the three", async () => {
    const res = await request(app)
      .post("/orgs/threads/auth/start")
      .set(getAuthHeaders())
      .send({ brandId: BRAND, accountType: "assistant", redirectUri: "https://x.test/cb" });
    expect(res.status).toBe(400);
  });

  it("stores the account on callback, token encrypted, long-lived", async () => {
    const res = await connect("code-alice", "pro_ai");

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(true);
    expect(res.body.account).toMatchObject({
      brandId: BRAND,
      threadsUserId: "1001",
      username: "alice_ai",
      profilePictureUrl: "https://pics/1001.jpg",
      accountType: "pro_ai",
      accountTypeLabel: "Pro (AI)",
      health: "connected",
      healthReason: null,
    });

    const exchange = calls.find((c) => c.url.pathname === "/oauth/access_token")!;
    expect(exchange.body!.get("code")).toBe("code-alice"); // `#_` stripped
    expect(exchange.body!.get("redirect_uri")).toBe("https://dashboard.distribute.you/threads/callback");

    const [row] = await db.select().from(threadsAccounts);
    expect(row.accessToken).not.toContain("long-1001");
    expect(decrypt(row.accessToken)).toBe("long-1001");
    expect(row.tokenExpiresAt.getTime() - Date.now()).toBeGreaterThan(59 * 24 * 3600 * 1000);
  });

  it("lists two different accounts on one brand; reconnecting one does not duplicate it", async () => {
    await connect("code-alice", "pro_ai");
    await connect("code-bob", "personal_human");
    const again = await connect("code-alice", "pro_human");

    expect(again.body.created).toBe(false);
    expect(again.body.account.accountType).toBe("pro_human");

    const list = await request(app).get("/orgs/threads/accounts").query({ brandId: BRAND }).set(getAuthHeaders());
    expect(list.status).toBe(200);
    expect(list.body.accounts.map((a: { username: string }) => a.username)).toEqual(["alice_ai", "bob_human"]);
  });

  it("a login state is single use and bound to the org that started it", async () => {
    const start = await request(app)
      .post("/orgs/threads/auth/start")
      .set(getAuthHeaders())
      .send({ brandId: BRAND, accountType: "pro_ai", redirectUri: "https://x.test/cb" });

    const otherOrg = { ...getAuthHeaders(), "x-org-id": "another-org" };
    const stolen = await request(app)
      .post("/orgs/threads/auth/callback")
      .set(otherOrg)
      .send({ code: "code-alice", state: start.body.state });
    expect(stolen.status).toBe(400);

    // The state was not consumed by the other org's attempt.
    const ok = await request(app)
      .post("/orgs/threads/auth/callback")
      .set(getAuthHeaders())
      .send({ code: "code-alice", state: start.body.state });
    expect(ok.status).toBe(200);

    const replay = await request(app)
      .post("/orgs/threads/auth/callback")
      .set(getAuthHeaders())
      .send({ code: "code-alice", state: start.body.state });
    expect(replay.status).toBe(400);
    expect(replay.body.error).toContain("Start the connection again");
  });

  it("names the missing platform key when our Threads app is not configured", async () => {
    const { PlatformCredentialError } = await import("../../src/lib/key-service.js");
    keyServiceMock.getPlatformKey.mockRejectedValueOnce(
      new PlatformCredentialError("threads-app-id", "key-service has no platform key for provider 'threads-app-id'"),
    );
    const res = await request(app)
      .post("/orgs/threads/auth/start")
      .set(getAuthHeaders())
      .send({ brandId: BRAND, accountType: "pro_ai", redirectUri: "https://x.test/cb" });
    expect(res.status).toBe(502);
    expect(res.body.details.provider).toBe("threads-app-id");
  });
});

describe("Threads account management", () => {
  it("changes the type after connect, and disconnects", async () => {
    const { body } = await connect("code-bob", "personal_human");
    const id = body.account.id;

    const patched = await request(app).patch(`/orgs/threads/accounts/${id}`).set(getAuthHeaders()).send({ accountType: "pro_ai" });
    expect(patched.status).toBe(200);
    expect(patched.body.account.accountType).toBe("pro_ai");

    const bad = await request(app).patch(`/orgs/threads/accounts/${id}`).set(getAuthHeaders()).send({ accountType: "founder" });
    expect(bad.status).toBe(400);

    const foreign = await request(app)
      .delete(`/orgs/threads/accounts/${id}`)
      .set({ ...getAuthHeaders(), "x-org-id": "another-org" });
    expect(foreign.status).toBe(404);

    const removed = await request(app).delete(`/orgs/threads/accounts/${id}`).set(getAuthHeaders());
    expect(removed.status).toBe(200);
    const list = await request(app).get("/orgs/threads/accounts").set(getAuthHeaders());
    expect(list.body.accounts).toEqual([]);
  });
});

describe("Threads publishing", () => {
  it("publishes a post, then a reply under it", async () => {
    const { body } = await connect("code-alice");
    const id = body.account.id;

    const post = await request(app).post(`/orgs/threads/accounts/${id}/posts`).set(getAuthHeaders()).send({ text: "Hello Threads" });
    expect(post.status).toBe(201);
    expect(post.body).toEqual({
      accountId: id,
      postId: "post-root",
      permalink: "https://www.threads.net/@x/post/post-root",
      replyToPostId: null,
    });

    const reply = await request(app)
      .post(`/orgs/threads/accounts/${id}/posts`)
      .set(getAuthHeaders())
      .send({ text: "And a reply", replyToPostId: post.body.postId });
    expect(reply.status).toBe(201);
    expect(reply.body.postId).toBe("post-reply");

    const containers = calls.filter((c) => /\/threads$/.test(c.url.pathname));
    expect(containers.map((c) => c.body!.get("text"))).toEqual(["Hello Threads", "And a reply"]);
    expect(containers[1].body!.get("reply_to_id")).toBe("post-root");
    expect(containers[0].body!.get("media_type")).toBe("TEXT");
    expect(containers[0].body!.get("access_token")).toBe("long-1001");
  });

  it("a dead token reads as needs reconnect (409), never a bare 500, and shows on the list", async () => {
    const { body } = await connect("code-alice");
    const id = body.account.id;
    threadsHandler = () => ({
      status: 400,
      body: { error: { message: "Error validating access token: The user has not authorized application.", type: "OAuthException", code: 190 } },
    });

    const res = await request(app).post(`/orgs/threads/accounts/${id}/posts`).set(getAuthHeaders()).send({ text: "Hi" });
    expect(res.status).toBe(409);
    expect(res.body.reason).toBe("needs_reconnect");
    expect(res.body.accountId).toBe(id);
    expect(res.body.error).toContain("Reconnect the account");

    const list = await request(app).get("/orgs/threads/accounts").set(getAuthHeaders());
    expect(list.body.accounts[0].health).toBe("needs_reconnect");
    expect(list.body.accounts[0].healthReason).toContain("Reconnect");

    // A second attempt does not even call Threads.
    calls.length = 0;
    const again = await request(app).post(`/orgs/threads/accounts/${id}/posts`).set(getAuthHeaders()).send({ text: "Hi" });
    expect(again.status).toBe(409);
    expect(calls).toHaveLength(0);

    // Reconnecting heals it in place.
    threadsHandler = defaultThreads();
    const healed = await connect("code-alice");
    expect(healed.body.created).toBe(false);
    expect(healed.body.account.health).toBe("connected");
  });

  it("any other Threads refusal is a 502 carrying Threads' message", async () => {
    const { body } = await connect("code-alice");
    threadsHandler = () => ({ status: 400, body: { error: { message: "Application request limit reached", code: 4 } } });
    const res = await request(app).post(`/orgs/threads/accounts/${body.account.id}/posts`).set(getAuthHeaders()).send({ text: "Hi" });
    expect(res.status).toBe(502);
    expect(res.body.error).toContain("Application request limit reached");
    expect(res.body.details.threads.code).toBe(4);
  });

  it("refuses text over 500 characters", async () => {
    const { body } = await connect("code-alice");
    const res = await request(app).post(`/orgs/threads/accounts/${body.account.id}/posts`).set(getAuthHeaders()).send({ text: "x".repeat(501) });
    expect(res.status).toBe(400);
  });
});

describe("Threads token refresh", () => {
  async function seed(overrides: Partial<typeof threadsAccounts.$inferInsert>) {
    const [row] = await db
      .insert(threadsAccounts)
      .values({
        orgId: "test-org-id",
        brandId: BRAND,
        connectedByUserId: "u",
        threadsUserId: overrides.threadsUserId ?? "2001",
        username: "seed",
        accountType: "pro_ai",
        accessToken: encrypt("long-old"),
        tokenIssuedAt: new Date(Date.now() - 40 * 86400000),
        tokenExpiresAt: new Date(Date.now() + 20 * 86400000),
        scopes: ["threads_basic"],
        ...overrides,
      })
      .returning();
    return row;
  }

  it("refreshes a token nearing expiry, leaves a fresh one alone, marks a refused one needs_reconnect", async () => {
    const due = await seed({ threadsUserId: "2001" });
    const fresh = await seed({ threadsUserId: "2002", tokenIssuedAt: new Date(), tokenExpiresAt: new Date(Date.now() + 60 * 86400000) });
    const expired = await seed({ threadsUserId: "2003", tokenExpiresAt: new Date(Date.now() - 86400000) });

    const summary = await runTokenRefresh();
    expect(summary).toMatchObject({ accountsChecked: 2, refreshed: 1, needsReconnect: 1, errors: [] });

    const [dueRow] = await db.select().from(threadsAccounts).where(eq(threadsAccounts.id, due.id));
    expect(decrypt(dueRow.accessToken)).toBe("long-refreshed");
    expect(dueRow.tokenExpiresAt.getTime() - Date.now()).toBeGreaterThan(59 * 86400000);

    const [freshRow] = await db.select().from(threadsAccounts).where(eq(threadsAccounts.id, fresh.id));
    expect(decrypt(freshRow.accessToken)).toBe("long-old");

    const [expiredRow] = await db.select().from(threadsAccounts).where(eq(threadsAccounts.id, expired.id));
    expect(expiredRow.status).toBe("needs_reconnect");

    threadsHandler = () => ({ status: 400, body: { error: { message: "Session has expired", code: 190 } } });
    await db.update(threadsAccounts).set({ tokenExpiresAt: new Date(Date.now() + 86400000) }).where(eq(threadsAccounts.id, due.id));
    await db.update(threadsAccounts).set({ tokenIssuedAt: new Date(Date.now() - 2 * 86400000) }).where(eq(threadsAccounts.id, due.id));
    const second = await runTokenRefresh();
    expect(second.needsReconnect).toBe(1);
    const [deadRow] = await db.select().from(threadsAccounts).where(eq(threadsAccounts.id, due.id));
    expect(deadRow.status).toBe("needs_reconnect");
    expect(deadRow.statusReason).toContain("Session has expired");
  });
});
