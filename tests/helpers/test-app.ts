import express from "express";
import cors from "cors";
import healthRoutes from "../../src/routes/health.js";
import webhookRoutes from "../../src/routes/webhooks.js";
import authRoutes from "../../src/routes/auth.js";
import connectionsRoutes from "../../src/routes/connections.js";
import accountsRoutes from "../../src/routes/accounts.js";
import insightsRoutes from "../../src/routes/insights.js";
import managedRoutes from "../../src/routes/managed.js";
import internalRoutes from "../../src/routes/internal.js";
import { ManagedRequestError, MetaApiCallError } from "../../src/lib/meta-ads.js";
import { PlatformCredentialError } from "../../src/lib/key-service.js";
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

  app.use(serviceKeyAuth, internalRoutes);

  // Protected routes (service key + identity required)
  app.use(serviceKeyAuth);
  app.use(requireIdentity);
  app.use(connectionsRoutes);
  app.use(accountsRoutes);
  app.use(insightsRoutes);
  app.use(managedRoutes);

  // 404
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (err instanceof ManagedRequestError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof PlatformCredentialError) {
        res.status(502).json({
          error: err.message,
          details: { provider: err.provider },
        });
        return;
      }
      if (err instanceof MetaApiCallError) {
        res.status(502).json({
          error: err.message,
          details: { operation: err.operation, meta: err.metaError },
        });
        return;
      }
      res.status(500).json({ error: "Internal server error" });
    },
  );

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
