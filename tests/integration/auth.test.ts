import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, getAuthHeaders } from "../helpers/test-app.js";

describe("Auth Routes", () => {
  const app = createTestApp();

  describe("GET /auth/meta/authorize", () => {
    it("returns authorization URL with correct params", async () => {
      const res = await request(app)
        .get("/auth/meta/authorize")
        .set(getAuthHeaders())
        .query({
          appId: "test-app",
          redirectUri: "https://example.com/callback",
          label: "My Connection",
        });

      expect(res.status).toBe(200);
      expect(res.body.authorizationUrl).toBeDefined();

      const url = new URL(res.body.authorizationUrl);
      expect(url.hostname).toBe("www.facebook.com");
      expect(url.searchParams.get("client_id")).toBe("test-meta-app-id");
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("state")).toBeDefined();

      // Decode state and verify contents
      const state = JSON.parse(
        Buffer.from(
          url.searchParams.get("state")!,
          "base64url",
        ).toString("utf-8"),
      );
      expect(state.appId).toBe("test-app");
      expect(state.redirectUri).toBe("https://example.com/callback");
      expect(state.label).toBe("My Connection");
    });

    it("returns 400 for missing redirectUri", async () => {
      const res = await request(app)
        .get("/auth/meta/authorize")
        .set(getAuthHeaders())
        .query({ appId: "test-app" });

      expect(res.status).toBe(400);
    });

    it("returns 400 for missing appId", async () => {
      const res = await request(app)
        .get("/auth/meta/authorize")
        .set(getAuthHeaders())
        .query({ redirectUri: "https://example.com/callback" });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /auth/meta/callback", () => {
    it("returns 400 for missing code", async () => {
      const res = await request(app)
        .get("/auth/meta/callback")
        .query({ state: "test" });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid state", async () => {
      const res = await request(app)
        .get("/auth/meta/callback")
        .query({ code: "test-code", state: "invalid-base64" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid state parameter");
    });
  });
});
