import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createTestApp, getAuthHeaders } from "../helpers/test-app.js";

// Mock the DB module to avoid actual database connections
vi.mock("../../src/db/index.js", () => ({
  db: {
    query: {
      metaConnections: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      metaAdAccounts: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      metaPages: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    },
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
    delete: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
  sql: { end: vi.fn() },
}));

describe("Auth Middleware", () => {
  const app = createTestApp();

  it("returns 401 for protected routes without api key", async () => {
    const res = await request(app).get("/connections").query({ appId: "test" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid service key");
  });

  it("returns 401 for protected routes with wrong api key", async () => {
    const res = await request(app)
      .get("/connections")
      .set("x-api-key", "wrong-key")
      .query({ appId: "test" });
    expect(res.status).toBe(401);
  });

  it("allows access with correct api key", async () => {
    const res = await request(app)
      .get("/connections")
      .set(getAuthHeaders())
      .query({ appId: "test" });
    // Should get past auth (200, not 401)
    expect(res.status).not.toBe(401);
  });

  it("allows health check without auth", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });

  it("allows webhook verification without auth", async () => {
    const res = await request(app)
      .get("/webhooks/meta")
      .query({
        "hub.mode": "subscribe",
        "hub.verify_token": "test-webhook-token",
        "hub.challenge": "test-challenge",
      });
    expect(res.status).toBe(200);
    expect(res.text).toBe("test-challenge");
  });
});
