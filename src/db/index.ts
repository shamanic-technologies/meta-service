import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const connectionString = process.env.META_SERVICE_DATABASE_URL;

if (!connectionString) {
  throw new Error("META_SERVICE_DATABASE_URL is not set");
}

export const sql = postgres(connectionString, {
  onnotice: () => {}, // Suppress NOTICE messages from migrations
});

export const db = drizzle(sql, { schema });
