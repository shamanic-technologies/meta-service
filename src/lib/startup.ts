import { registerEmailTemplates } from "./services.js";

export async function runStartupRegistrations(): Promise<void> {
  console.log("[meta-service] Running startup registrations...");

  await Promise.allSettled([registerTemplates()]);

  console.log("[meta-service] Startup registrations complete");
}

/**
 * Cost names are NOT registered from here. They live in costs-service's own
 * seed and are created by a PR there; `PUT /v1/providers-costs/{name}` only adds
 * a price version to a name that already exists. The three names this service
 * used to push (`meta-api-call`, `meta-insights-query`, `meta-bulk-update`) were
 * in no catalogue, so every boot warned and nothing was ever registered.
 *
 * The one cost this service declares, `meta-ads-spend`, is already in that
 * catalogue: costs-service generates one pass-through line per advertising
 * channel, priced at exactly 1 cent per unit, so a declared quantity is a
 * number of cents of Meta spend and the org is charged that number.
 */
async function registerTemplates(): Promise<void> {
  await registerEmailTemplates("meta-service", [
    {
      name: "meta_token_expiring",
      subject: "Action required: Your Meta connection needs renewal",
      htmlBody:
        "<p>Hi, your Meta connection '{{connectionLabel}}' expires on {{expiresAt}}. Please reconnect.</p>",
      textBody:
        "Hi, your Meta connection '{{connectionLabel}}' expires on {{expiresAt}}. Please reconnect.",
    },
    {
      name: "meta_connection_failed",
      subject: "Meta connection error",
      htmlBody:
        "<p>Your Meta connection '{{connectionLabel}}' encountered an error: {{errorMessage}}. Please reconnect.</p>",
      textBody:
        "Your Meta connection '{{connectionLabel}}' encountered an error: {{errorMessage}}. Please reconnect.",
    },
  ]);
}
