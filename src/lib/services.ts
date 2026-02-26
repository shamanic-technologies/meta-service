// ==================== runs-service ====================

const RUNS_SERVICE_URL = () =>
  process.env.RUNS_SERVICE_URL || "http://localhost:3006";
const RUNS_SERVICE_API_KEY = () => process.env.RUNS_SERVICE_API_KEY || "";

async function runsRequest<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${RUNS_SERVICE_URL()}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": RUNS_SERVICE_API_KEY(),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `runs-service ${options.method || "GET"} ${path} failed: ${response.status} ${text}`,
    );
  }
  return response.json() as Promise<T>;
}

export async function createRun(params: {
  orgId: string;
  appId: string;
  serviceName: string;
  taskName: string;
  userId?: string;
  brandId?: string;
  campaignId?: string;
}): Promise<{ id: string }> {
  return runsRequest("/v1/runs", { method: "POST", body: params });
}

export async function addRunCosts(
  runId: string,
  items: Array<{
    costName: string;
    quantity: number;
    status?: "actual" | "provisioned";
  }>,
): Promise<void> {
  await runsRequest(`/v1/runs/${runId}/costs`, {
    method: "POST",
    body: { items },
  });
}

export async function completeRun(
  runId: string,
  status: "completed" | "failed",
  error?: string,
): Promise<void> {
  await runsRequest(`/v1/runs/${runId}`, {
    method: "PATCH",
    body: { status, error },
  });
}

// ==================== costs-service ====================

const COSTS_SERVICE_URL = () =>
  process.env.COSTS_SERVICE_URL || "http://localhost:3011";
const COSTS_SERVICE_API_KEY = () => process.env.COSTS_SERVICE_API_KEY || "";

export async function registerCost(
  name: string,
  costPerUnitInUsdCents: string,
): Promise<void> {
  const response = await fetch(`${COSTS_SERVICE_URL()}/v1/costs/${name}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": COSTS_SERVICE_API_KEY(),
    },
    body: JSON.stringify({ costPerUnitInUsdCents }),
  });
  // 409 = already exists with same effectiveFrom, which is fine
  if (!response.ok && response.status !== 409) {
    const text = await response.text().catch(() => "");
    console.warn(`[meta-service] Failed to register cost ${name}: ${response.status} ${text}`);
  }
}

// ==================== key-service ====================

const KEY_SERVICE_URL = () =>
  process.env.KEY_SERVICE_URL || "http://localhost:3001";
const KEY_SERVICE_API_KEY = () => process.env.KEY_SERVICE_API_KEY || "";

export async function registerAppKey(
  appId: string,
  provider: string,
  apiKey: string,
): Promise<void> {
  const response = await fetch(`${KEY_SERVICE_URL()}/internal/app-keys`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": KEY_SERVICE_API_KEY(),
    },
    body: JSON.stringify({ appId, provider, apiKey }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.warn(
      `[meta-service] Failed to register app key ${provider}: ${response.status} ${text}`,
    );
  }
}

export async function getDecryptedAppKey(provider: string): Promise<string> {
  const response = await fetch(
    `${KEY_SERVICE_URL()}/internal/app-keys/${provider}/decrypt?appId=meta-service`,
    {
      headers: { "x-api-key": KEY_SERVICE_API_KEY() },
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to get app key ${provider}: ${response.status}`,
    );
  }
  const data = (await response.json()) as { provider: string; key: string };
  return data.key;
}

// ==================== transactional-email-service ====================

const EMAIL_SERVICE_URL = () =>
  process.env.TRANSACTIONAL_EMAIL_SERVICE_URL || "http://localhost:3012";
const EMAIL_SERVICE_API_KEY = () =>
  process.env.TRANSACTIONAL_EMAIL_SERVICE_API_KEY || "";

export async function registerEmailTemplates(
  appId: string,
  templates: Array<{
    name: string;
    subject: string;
    htmlBody: string;
    textBody?: string;
  }>,
): Promise<void> {
  const response = await fetch(`${EMAIL_SERVICE_URL()}/templates`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": EMAIL_SERVICE_API_KEY(),
    },
    body: JSON.stringify({ appId, templates }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.warn(
      `[meta-service] Failed to register email templates: ${response.status} ${text}`,
    );
  }
}

export async function sendEmail(params: {
  appId: string;
  eventType: string;
  recipientEmail?: string;
  orgId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  // Map orgId/userId to clerkOrgId/clerkUserId for email service compat
  const { orgId, userId, ...rest } = params;
  const body = { ...rest, clerkOrgId: orgId, clerkUserId: userId };
  const response = await fetch(`${EMAIL_SERVICE_URL()}/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": EMAIL_SERVICE_API_KEY(),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.warn(
      `[meta-service] Failed to send email ${params.eventType}: ${response.status} ${text}`,
    );
  }
}
