import crypto from "crypto";

const GRAPH_API_BASE = "https://graph.facebook.com/v22.0";

export interface MetaApiError {
  message: string;
  type: string;
  code: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

export type MetaApiResponse<T> =
  | { success: true; data: T; usageHeader: string | null }
  | { success: false; error: MetaApiError };

function computeAppSecretProof(
  accessToken: string,
  appSecret: string,
): string {
  return crypto
    .createHmac("sha256", appSecret)
    .update(accessToken)
    .digest("hex");
}

export async function metaFetch<T>(
  path: string,
  accessToken: string,
  options: {
    method?: string;
    params?: Record<string, string>;
    body?: Record<string, unknown>;
    appSecret?: string;
  } = {},
): Promise<MetaApiResponse<T>> {
  const { method = "GET", params = {}, body, appSecret } = options;

  const url = new URL(`${GRAPH_API_BASE}${path}`);
  url.searchParams.set("access_token", accessToken);

  if (appSecret) {
    url.searchParams.set(
      "appsecret_proof",
      computeAppSecretProof(accessToken, appSecret),
    );
  }

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const fetchOptions: RequestInit = { method };
  if (body) {
    fetchOptions.headers = { "Content-Type": "application/json" };
    fetchOptions.body = JSON.stringify(body);
  }

  const response = await fetch(url.toString(), fetchOptions);
  const usageHeader = response.headers.get("x-business-use-case-usage");

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      error?: MetaApiError;
    };
    return {
      success: false,
      error: errorBody.error ?? {
        message: `HTTP ${response.status}`,
        type: "OAuthException",
        code: response.status,
      },
    };
  }

  const data = (await response.json()) as T;
  return { success: true, data, usageHeader };
}

// ==================== Convenience helpers ====================

interface MetaUser {
  id: string;
  name: string;
}

interface MetaAdAccountData {
  account_id: string;
  id: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
}

interface MetaPageData {
  id: string;
  name?: string;
  access_token: string;
  instagram_business_account?: { id: string };
}

interface MetaPaging {
  cursors?: { before?: string; after?: string };
  next?: string;
}

export async function getMe(
  accessToken: string,
  appSecret?: string,
): Promise<MetaApiResponse<MetaUser>> {
  return metaFetch<MetaUser>("/me", accessToken, {
    params: { fields: "id,name" },
    appSecret,
  });
}

export async function getAdAccounts(
  accessToken: string,
  appSecret?: string,
): Promise<
  MetaApiResponse<{ data: MetaAdAccountData[]; paging?: MetaPaging }>
> {
  return metaFetch("/me/adaccounts", accessToken, {
    params: {
      fields: "account_id,name,currency,timezone_name,account_status",
      limit: "100",
    },
    appSecret,
  });
}

export async function getPages(
  accessToken: string,
  appSecret?: string,
): Promise<MetaApiResponse<{ data: MetaPageData[]; paging?: MetaPaging }>> {
  return metaFetch("/me/accounts", accessToken, {
    params: {
      fields: "id,name,access_token,instagram_business_account",
      limit: "100",
    },
    appSecret,
  });
}

export async function exchangeForLongLivedToken(
  shortToken: string,
  appId: string,
  appSecret: string,
): Promise<MetaApiResponse<{ access_token: string; expires_in?: number }>> {
  const url = new URL(`${GRAPH_API_BASE}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", shortToken);

  const response = await fetch(url.toString());
  const usageHeader = response.headers.get("x-business-use-case-usage");

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      error?: MetaApiError;
    };
    return {
      success: false,
      error: errorBody.error ?? {
        message: `HTTP ${response.status}`,
        type: "OAuthException",
        code: response.status,
      },
    };
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in?: number;
  };
  return { success: true, data, usageHeader };
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  appId: string,
  appSecret: string,
): Promise<MetaApiResponse<{ access_token: string; token_type: string }>> {
  const url = new URL(`${GRAPH_API_BASE}/oauth/access_token`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("code", code);

  const response = await fetch(url.toString());
  const usageHeader = response.headers.get("x-business-use-case-usage");

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => ({}))) as {
      error?: MetaApiError;
    };
    return {
      success: false,
      error: errorBody.error ?? {
        message: `HTTP ${response.status}`,
        type: "OAuthException",
        code: response.status,
      },
    };
  }

  const data = (await response.json()) as {
    access_token: string;
    token_type: string;
  };
  return { success: true, data, usageHeader };
}

export interface InsightParams {
  level?: string;
  objectId?: string;
  datePreset?: string;
  timeRange?: { since: string; until: string };
  timeIncrement?: string;
  breakdowns?: string[];
  fields?: string[];
  limit?: number;
  after?: string;
}

const DEFAULT_INSIGHT_FIELDS = [
  "impressions",
  "reach",
  "clicks",
  "spend",
  "cpc",
  "cpm",
  "ctr",
  "actions",
  "cost_per_action_type",
  "conversions",
  "cost_per_conversion",
];

export async function getInsights(
  adAccountId: string,
  accessToken: string,
  params: InsightParams,
  appSecret?: string,
): Promise<MetaApiResponse<{ data: Record<string, unknown>[]; paging?: MetaPaging }>> {
  const queryParams: Record<string, string> = {};

  const fields = params.fields ?? DEFAULT_INSIGHT_FIELDS;
  queryParams.fields = fields.join(",");

  if (params.level) {
    queryParams.level = params.level;
  }

  if (params.datePreset) {
    queryParams.date_preset = params.datePreset;
  } else if (params.timeRange) {
    queryParams.time_range = JSON.stringify(params.timeRange);
  }

  if (params.timeIncrement) {
    queryParams.time_increment = params.timeIncrement;
  }

  if (params.breakdowns && params.breakdowns.length > 0) {
    queryParams.breakdowns = params.breakdowns.join(",");
  }

  if (params.limit) {
    queryParams.limit = String(params.limit);
  }

  if (params.after) {
    queryParams.after = params.after;
  }

  // If objectId is provided, query that specific object, otherwise query the ad account
  const path = params.objectId
    ? `/${params.objectId}/insights`
    : `/${adAccountId}/insights`;

  return metaFetch(path, accessToken, {
    params: queryParams,
    appSecret,
  });
}
