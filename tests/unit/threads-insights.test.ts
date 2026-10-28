import { describe, it, expect } from "vitest";
import { parseInsights, requestedScopes } from "../../src/lib/threads-client.js";

describe("parseInsights", () => {
  it("reads values[] and total_value, keeps an omitted metric null (never 0)", () => {
    expect(
      parseInsights({
        data: [
          { name: "views", values: [{ value: 12 }] },
          { name: "likes", total_value: { value: 3 } },
          { name: "shares", values: [{ value: "4" }] },
          { name: "unknown_metric", values: [{ value: 9 }] },
          { name: "replies", values: [{ value: -1 }] },
        ],
      }),
    ).toEqual({ views: 12, likes: 3, replies: null, reposts: null, quotes: null, shares: 4 });
  });

  it("a body with no data array reads all null", () => {
    expect(parseInsights({ error: "x" })).toEqual({ views: null, likes: null, replies: null, reposts: null, quotes: null, shares: null });
    expect(parseInsights(null).views).toBeNull();
  });
});

describe("requestedScopes", () => {
  it("off (default) never asks for insights; on asks for it; anything else fails loud", () => {
    expect(requestedScopes({})).not.toContain("threads_manage_insights");
    expect(requestedScopes({ THREADS_INSIGHTS_SCOPE: "on" })).toContain("threads_manage_insights");
    expect(() => requestedScopes({ THREADS_INSIGHTS_SCOPE: "yes" })).toThrow(/THREADS_INSIGHTS_SCOPE/);
  });
});
