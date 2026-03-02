import {
  registerCost,
  registerEmailTemplates,
} from "./services.js";

export async function runStartupRegistrations(): Promise<void> {
  console.log("[meta-service] Running startup registrations...");

  await Promise.allSettled([
    registerCostNames(),
    registerTemplates(),
  ]);

  console.log("[meta-service] Startup registrations complete");
}

async function registerCostNames(): Promise<void> {
  await Promise.allSettled([
    registerCost("meta-api-call", "0.001"),
    registerCost("meta-insights-query", "0.01"),
    registerCost("meta-bulk-update", "0.005"),
  ]);
}

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
