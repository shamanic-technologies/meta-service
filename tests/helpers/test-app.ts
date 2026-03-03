import express from "express";
import cors from "cors";
import healthRoutes from "../../src/routes/health.js";
import webhookRoutes from "../../src/routes/webhooks.js";
import authRoutes from "../../src/routes/auth.js";
import connectionsRoutes from "../../src/routes/connections.js";
import accountsRoutes from "../../src/routes/accounts.js";
import insightsRoutes from "../../src/routes/insights.js";
import { serviceKeyAuth } from "../../src/middleware/auth.js";
import { requireIdentity } from "../../src/middleware/identity.js";

export function createTestApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Public routes
  app.use(healthRoutes);
  app.use(webhookRoutes);

  // Auth routes: authorize + disconnect need service key + identity
  app.use("/auth/meta/authorize", serviceKeyAuth, requireIdentity);
  app.use("/auth/meta/connections", serviceKeyAuth, requireIdentity);
  app.use(authRoutes);

  // Protected routes (service key + identity required)
  app.use(serviceKeyAuth);
  app.use(requireIdentity);
  app.use(connectionsRoutes);
  app.use(accountsRoutes);
  app.use(insightsRoutes);

  // 404
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}

export function getAuthHeaders(): Record<string, string> {
  return {
    "x-api-key": "test-service-key",
    "x-org-id": "test-org-id",
    "x-user-id": "test-user-id",
    "x-run-id": "test-run-id",
    "Content-Type": "application/json",
  };
}
