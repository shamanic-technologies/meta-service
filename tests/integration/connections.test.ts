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
            appId: "test-app",
            orgId: "org-abc",
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

  it("returns connections filtered by orgId", async () => {
    const res = await request(app)
      .get("/connections")
      .set(getAuthHeaders())
      .query({ appId: "test-app", orgId: "org-abc" });

    expect(res.status).toBe(200);
    expect(res.body.connections).toHaveLength(1);
    expect(res.body.connections[0].orgId).toBe("org-abc");
    expect(res.body.connections[0]).not.toHaveProperty("clerkOrgId");
  });

  it("returns 400 for missing appId", async () => {
    const res = await request(app)
      .get("/connections")
      .set(getAuthHeaders());

    expect(res.status).toBe(400);
  });
});
