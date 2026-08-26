import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getMetaPlatformCredentials,
  getPlatformKey,
  normaliseAdAccountId,
} from "../../src/lib/key-service.js";

const originalFetch = globalThis.fetch;

function keyResponses(map: Record<string, string | number>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const provider = url.split("/keys/platform/")[1]?.split("/")[0] ?? "";
    const value = map[provider];
    if (value === undefined) {
      return new Response("not found", { status: 404 });
    }
    if (typeof value === "number") {
      return new Response("boom", { status: value });
    }
    return new Response(JSON.stringify({ key: value }), { status: 200 });
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ad account id", () => {
  it("accepts both forms and always sends Meta the act_ form", () => {
    expect(normaliseAdAccountId("123")).toBe("act_123");
    expect(normaliseAdAccountId("act_123")).toBe("act_123");
  });
});

describe("platform key resolution", () => {
  it("resolves a key", async () => {
    globalThis.fetch = keyResponses({ "meta-page-id": "page-1" }) as never;
    await expect(
      getPlatformKey("meta-page-id", { method: "GET", path: "/x" }),
    ).resolves.toBe("page-1");
  });

  it("throws when the key does not exist", async () => {
    globalThis.fetch = keyResponses({}) as never;
    await expect(
      getPlatformKey("meta-page-id", { method: "GET", path: "/x" }),
    ).rejects.toThrow(/no platform key/);
  });

  it("throws rather than reading an unreachable key-service as absent", async () => {
    globalThis.fetch = keyResponses({ "meta-page-id": 503 }) as never;
    await expect(
      getPlatformKey("meta-page-id", { method: "GET", path: "/x" }),
    ).rejects.toThrow(/503/);
  });
});

describe("managed credentials", () => {
  const required = {
    "meta-system-user-token": "tok",
    "meta-app-secret": "sec",
    "meta-ad-account-id": "123",
    "meta-page-id": "page-1",
  };

  it("resolves our own business assets, no client credential involved", async () => {
    globalThis.fetch = keyResponses({
      ...required,
      "meta-instagram-account-id": "ig-1",
      "meta-dataset-id": "ds-1",
    }) as never;

    await expect(
      getMetaPlatformCredentials({ method: "POST", path: "/managed/campaigns" }),
    ).resolves.toEqual({
      accessToken: "tok",
      appSecret: "sec",
      adAccountId: "act_123",
      pageId: "page-1",
      instagramAccountId: "ig-1",
      datasetId: "ds-1",
    });
  });

  it("reports a genuinely absent Instagram account and dataset as absent", async () => {
    globalThis.fetch = keyResponses(required) as never;
    const credentials = await getMetaPlatformCredentials({
      method: "POST",
      path: "/managed/campaigns",
    });
    expect(credentials.instagramAccountId).toBeNull();
    expect(credentials.datasetId).toBeNull();
  });

  it("fails loudly when a required asset is missing", async () => {
    globalThis.fetch = keyResponses({
      "meta-system-user-token": "tok",
      "meta-app-secret": "sec",
      "meta-page-id": "page-1",
    }) as never;

    await expect(
      getMetaPlatformCredentials({ method: "POST", path: "/managed/campaigns" }),
    ).rejects.toThrow(/meta-ad-account-id/);
  });
});
