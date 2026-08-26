import * as Sentry from "@sentry/node";
import express from "express";
import cors from "cors";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./db/index.js";
import { runStartupRegistrations } from "./lib/startup.js";
import healthRoutes from "./routes/health.js";
import webhookRoutes from "./routes/webhooks.js";
import authRoutes from "./routes/auth.js";
import connectionsRoutes from "./routes/connections.js";
import accountsRoutes from "./routes/accounts.js";
import insightsRoutes from "./routes/insights.js";
import managedRoutes from "./routes/managed.js";
import internalRoutes from "./routes/internal.js";
import { MetaApiCallError } from "./lib/meta-ads.js";
import { startReviewSync, startSpendSync } from "./services/crons.js";
import { serviceKeyAuth } from "./middleware/auth.js";
import { requireIdentity } from "./middleware/identity.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// OpenAPI spec (public)
const openapiPath = join(__dirname, "..", "openapi.json");
app.get("/openapi.json", (_req, res) => {
  if (existsSync(openapiPath)) {
    res.json(JSON.parse(readFileSync(openapiPath, "utf-8")));
  } else {
    res
      .status(404)
      .json({ error: "OpenAPI spec not generated. Run: pnpm generate:openapi" });
  }
});

// Public routes (no auth)
app.use(healthRoutes);
app.use(webhookRoutes);

// Auth routes: authorize needs service key + identity, callback is hit by Meta redirect
app.use("/auth/meta/authorize", serviceKeyAuth, requireIdentity);
app.use("/auth/meta/connections", serviceKeyAuth, requireIdentity);
app.use(authRoutes);

// Fleet-internal jobs: service key, no org on the wire.
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

// Sentry error handler
Sentry.setupExpressErrorHandler(app);

// Fallback error handler.
//
// A Meta refusal — a policy rejection, an invalid targeting spec, a permissions
// problem — arrives as an error envelope, and it is surfaced with Meta's own
// code and message rather than flattened into a generic 500. Nothing here
// converts a failure into a success.
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof MetaApiCallError) {
      console.error("Meta API error:", err.message, err.metaError);
      res.status(502).json({
        error: err.message,
        details: {
          operation: err.operation,
          meta: err.metaError,
        },
      });
      return;
    }
    console.error("Error:", err);
    res.status(500).json({ error: "Internal server error" });
  },
);

// Only start server if not in test environment
if (process.env.NODE_ENV !== "test") {
  migrate(db, { migrationsFolder: "./drizzle" })
    .then(async () => {
      console.log("Migrations complete");
      await runStartupRegistrations().catch((err) => {
        console.warn("Startup registrations failed (non-fatal):", err);
      });
      app.listen(Number(PORT), "::", () => {
        console.log(`Meta service running on port ${PORT}`);
        // Both jobs run on their OWN cadence and delay their first tick, so a
        // deploy binds its port and passes its health check before any Meta
        // traffic starts. Neither is ever chained into a launch.
        startReviewSync();
        startSpendSync();
      });
    })
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}

export default app;
