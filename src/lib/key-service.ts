/**
 * Platform credential resolution.
 *
 * The managed advertising path runs from OUR business assets: our Business
 * Manager, our ad account, our page, our dataset. None of that is supplied by a
 * client, so none of it lives on a per-user OAuth connection. Every value below
 * is a PLATFORM key held by key-service and resolved at call time.
 */

const KEY_SERVICE_URL = () =>
  process.env.KEY_SERVICE_URL || "http://localhost:3005";
const KEY_SERVICE_API_KEY = () => process.env.KEY_SERVICE_API_KEY || "";

export interface CallerContext {
  method: string;
  path: string;
}

/**
 * A platform credential could not be resolved. Typed, because "our Meta assets
 * are not configured yet" is a specific and actionable thing a caller must be
 * told — a generic 500 says nothing about which key is missing.
 */
export class PlatformCredentialError extends Error {
  readonly provider: string;

  constructor(provider: string, message: string) {
    super(message);
    this.name = "PlatformCredentialError";
    this.provider = provider;
  }
}

export async function getPlatformKey(
  provider: string,
  caller: CallerContext,
  runId?: string,
): Promise<string> {
  const key = await fetchPlatformKey(provider, caller, runId);
  if (key === null) {
    throw new PlatformCredentialError(
      provider,
      `key-service has no platform key for provider '${provider}'`,
    );
  }
  return key;
}

/** Returns null ONLY on a 404 (the key genuinely does not exist). Any other
 *  failure throws: an unreachable key-service must never read as "absent". */
async function fetchPlatformKey(
  provider: string,
  caller: CallerContext,
  runId?: string,
): Promise<string | null> {
  const response = await fetch(
    `${KEY_SERVICE_URL()}/keys/platform/${provider}/decrypt`,
    {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": KEY_SERVICE_API_KEY(),
        "X-Caller-Service": "meta",
        "X-Caller-Method": caller.method,
        "X-Caller-Path": caller.path,
        ...(runId ? { "x-run-id": runId } : {}),
      },
    },
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new PlatformCredentialError(
      provider,
      `key-service: cannot resolve platform key '${provider}': ${response.status} ${text}`,
    );
  }

  const data = (await response.json()) as { key?: string };
  if (!data.key) {
    throw new PlatformCredentialError(
      provider,
      `key-service returned no key for platform provider '${provider}'`,
    );
  }
  return data.key;
}

/** Everything the managed path needs to talk to Meta as ourselves. */
export interface MetaPlatformCredentials {
  accessToken: string;
  appSecret: string;
  adAccountId: string;
  pageId: string;
  instagramAccountId: string | null;
  datasetId: string | null;
}

/**
 * `instagram-account-id` and `dataset-id` are resolved but tolerated absent:
 * an ad still delivers on Facebook without an Instagram account, and a campaign
 * that does not optimise on a pixel event needs no dataset. They are NOT
 * defaulted — absent means absent, and any path that requires one says so.
 */
export async function getMetaPlatformCredentials(
  caller: CallerContext,
  runId?: string,
): Promise<MetaPlatformCredentials> {
  const [accessToken, appSecret, adAccountId, pageId] = await Promise.all([
    getPlatformKey("meta-system-user-token", caller, runId),
    getPlatformKey("meta-app-secret", caller, runId),
    getPlatformKey("meta-ad-account-id", caller, runId),
    getPlatformKey("meta-page-id", caller, runId),
  ]);

  const instagramAccountId = await getOptionalPlatformKey(
    "meta-instagram-account-id",
    caller,
    runId,
  );
  const datasetId = await getOptionalPlatformKey(
    "meta-dataset-id",
    caller,
    runId,
  );

  return {
    accessToken,
    appSecret,
    adAccountId: normaliseAdAccountId(adAccountId),
    pageId,
    instagramAccountId,
    datasetId,
  };
}

/** The Conversions API token is its own key: it is scoped to the dataset. */
export async function getConversionsApiToken(
  caller: CallerContext,
  runId?: string,
): Promise<string> {
  return getPlatformKey("meta-conversions-api-token", caller, runId);
}

async function getOptionalPlatformKey(
  provider: string,
  caller: CallerContext,
  runId?: string,
): Promise<string | null> {
  const key = await fetchPlatformKey(provider, caller, runId);
  if (key === null) {
    console.warn(
      `[meta-service] no platform key for optional provider '${provider}'`,
    );
  }
  return key;
}

export function normaliseAdAccountId(value: string): string {
  return value.startsWith("act_") ? value : `act_${value}`;
}
