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
    const res = await request(app).get("/connections");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Invalid service key");
  });

  it("returns 401 for protected routes with wrong api key", async () => {
    const res = await request(app)
      .get("/connections")
      .set("x-api-key", "wrong-key");
    expect(res.status).toBe(401);
  });

  it("returns 400 for protected routes without identity headers", async () => {
    const res = await request(app)
      .get("/connections")
      .set("x-api-key", "test-service-key");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Missing required headers");
  });

  it("returns 400 without x-org-id header", async () => {
    const res = await request(app)
      .get("/connections")
      .set("x-api-key", "test-service-key")
      .set("x-user-id", "test-user-id");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Missing required headers");
  });

  it("returns 400 without x-user-id header", async () => {
    const res = await request(app)
      .get("/connections")
      .set("x-api-key", "test-service-key")
      .set("x-org-id", "test-org-id");
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Missing required headers");
  });

  it("allows access with correct api key and identity headers", async () => {
    const res = await request(app)
      .get("/connections")
      .set(getAuthHeaders());
    // Should get past auth and identity (200, not 401 or 400)
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(400);
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
