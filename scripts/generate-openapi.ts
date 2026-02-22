import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { registry } from "../src/schemas.js";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const generator = new OpenApiGeneratorV3(registry.definitions);
const document = generator.generateDocument({
  openapi: "3.0.0",
  info: {
    title: "Meta Service",
    description:
      "Wraps the Meta (Facebook) Graph API v22.0 for ad account management, performance reporting, and organic posting.",
    version: "1.0.0",
  },
  servers: [
    {
      url: process.env.SERVICE_URL || "http://localhost:3001",
    },
  ],
});

const outPath = join(__dirname, "..", "openapi.json");
writeFileSync(outPath, JSON.stringify(document, null, 2));
console.log("openapi.json generated");
