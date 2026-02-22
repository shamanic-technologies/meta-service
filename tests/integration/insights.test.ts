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

// Mock services to prevent actual HTTP calls
vi.mock("../../src/lib/services.js", () => ({
  createRun: vi.fn().mockResolvedValue({ id: "test-run-id" }),
  addRunCosts: vi.fn().mockResolvedValue(undefined),
  completeRun: vi.fn().mockResolvedValue(undefined),
  registerCost: vi.fn().mockResolvedValue(undefined),
  registerAppKey: vi.fn().mockResolvedValue(undefined),
  getDecryptedAppKey: vi.fn().mockResolvedValue("test-key"),
  registerEmailTemplates: vi.fn().mockResolvedValue(undefined),
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

describe("GET /insights", () => {
  const app = createTestApp();

  it("returns 400 for missing adAccountId", async () => {
    const res = await request(app)
      .get("/insights")
      .set(getAuthHeaders())
      .query({ appId: "test-app" });

    expect(res.status).toBe(400);
  });

  it("returns 400 for missing appId", async () => {
    const res = await request(app)
      .get("/insights")
      .set(getAuthHeaders())
      .query({ adAccountId: "act_123" });

    expect(res.status).toBe(400);
  });

  it("returns 400 for incompatible breakdowns", async () => {
    const res = await request(app)
      .get("/insights")
      .set(getAuthHeaders())
      .query({
        adAccountId: "act_123",
        appId: "test-app",
        breakdowns: "image_asset,age",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Incompatible breakdown");
  });

  it("returns 400 for too many breakdowns", async () => {
    const res = await request(app)
      .get("/insights")
      .set(getAuthHeaders())
      .query({
        adAccountId: "act_123",
        appId: "test-app",
        breakdowns: "age,gender,country,publisher_platform",
      });

    expect(res.status).toBe(400);
    expect(res.body.details).toContain("Maximum 3 breakdowns allowed");
  });

  it("returns 404 for unknown ad account", async () => {
    const res = await request(app)
      .get("/insights")
      .set(getAuthHeaders())
      .query({
        adAccountId: "act_nonexistent",
        appId: "test-app",
      });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Ad account not found");
  });
});
