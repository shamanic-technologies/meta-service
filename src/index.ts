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
import { serviceKeyAuth } from "./middleware/auth.js";

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

// Auth routes: authorize needs service key, callback is hit by Meta redirect
app.use("/auth/meta", serviceKeyAuth);
app.use(authRoutes);

// Protected routes (service key required)
app.use(serviceKeyAuth);
app.use(connectionsRoutes);
app.use(accountsRoutes);
app.use(insightsRoutes);

// 404
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Sentry error handler
Sentry.setupExpressErrorHandler(app);

// Fallback error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
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
      });
    })
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}

export default app;
