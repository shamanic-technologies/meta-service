import { describe, it, expect } from "vitest";
import request from "supertest";
import { createTestApp } from "../helpers/test-app.js";

describe("Webhooks", () => {
  const app = createTestApp();

  describe("GET /webhooks/meta (verification)", () => {
    it("returns challenge on valid verification", async () => {
      const res = await request(app).get("/webhooks/meta").query({
        "hub.mode": "subscribe",
        "hub.verify_token": "test-webhook-token",
        "hub.challenge": "test-challenge-123",
      });

      expect(res.status).toBe(200);
      expect(res.text).toBe("test-challenge-123");
    });

    it("returns 403 on invalid verify token", async () => {
      const res = await request(app).get("/webhooks/meta").query({
        "hub.mode": "subscribe",
        "hub.verify_token": "wrong-token",
        "hub.challenge": "test-challenge",
      });

      expect(res.status).toBe(403);
    });

    it("returns 403 on wrong mode", async () => {
      const res = await request(app).get("/webhooks/meta").query({
        "hub.mode": "unsubscribe",
        "hub.verify_token": "test-webhook-token",
        "hub.challenge": "test-challenge",
      });

      expect(res.status).toBe(403);
    });
  });

  describe("POST /webhooks/meta (event receiver)", () => {
    it("returns 200 for valid webhook event", async () => {
      const res = await request(app)
        .post("/webhooks/meta")
        .send({
          object: "page",
          entry: [
            {
              id: "123",
              time: Date.now(),
              changes: [{ field: "feed", value: {} }],
            },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
    });
  });
});
