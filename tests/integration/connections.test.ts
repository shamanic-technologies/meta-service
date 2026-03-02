import { describe, it, expect, vi } from "vitest";
import request from "supertest";
import { createTestApp, getAuthHeaders } from "../helpers/test-app.js";

// Mock the DB module
vi.mock("../../src/db/index.js", () => ({
  db: {
    query: {
      metaConnections: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "conn-1",
            orgId: "test-org-id",
            userId: "test-user-id",
            label: "Test",
            metaUserId: "meta-1",
            metaUserName: "Test User",
            scopes: ["ads_read"],
            tokenExpiresAt: null,
            adAccounts: [],
            pages: [],
            createdAt: new Date("2025-01-01"),
          },
        ]),
      },
    },
  },
  sql: { end: vi.fn() },
}));

describe("GET /connections", () => {
  const app = createTestApp();

  it("returns connections for org", async () => {
    const res = await request(app)
      .get("/connections")
      .set(getAuthHeaders());

    expect(res.status).toBe(200);
    expect(res.body.connections).toHaveLength(1);
    expect(res.body.connections[0].orgId).toBe("test-org-id");
    expect(res.body.connections[0].userId).toBe("test-user-id");
    expect(res.body.connections[0]).not.toHaveProperty("appId");
  });

  it("returns 400 without identity headers", async () => {
    const res = await request(app)
      .get("/connections")
      .set("x-api-key", "test-service-key");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Missing required headers");
  });
});
