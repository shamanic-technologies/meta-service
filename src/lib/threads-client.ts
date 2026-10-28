/**
 * Threads API client.
 *
 * Threads has its own OAuth and its own Graph host (graph.threads.net), distinct
 * from the Facebook Graph API the rest of this service talks to, and its own app
 * id/secret (the "Threads app" inside our Meta app). Tokens are user tokens of
 * the Threads account itself: a short-lived one from the code exchange, then a
 * long-lived one (60 days) that can be refreshed once it is at least 24 hours
 * old and not yet expired.
 */

export const THREADS_AUTHORIZE_URL = "https://threads.net/oauth/authorize";
const THREADS_GRAPH = "https://graph.threads.net";
const THREADS_API = `${THREADS_GRAPH}/v1.0`;

export const THREADS_SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_manage_replies",
] as const;

/** Reading a post's views / likes / replies / reposts / quotes / shares. */
export const THREADS_INSIGHTS_SCOPE = "threads_manage_insights";

/**
 * The scopes a new connection asks for. `threads_manage_insights` is asked only
 * once `THREADS_INSIGHTS_SCOPE=on`: Threads refuses the whole login when the app
 * does not hold a scope it is asked for, so turning it on before the permission is
 * added to our Meta app's Threads use case would break every new connection.
 */
export function requestedScopes(env: NodeJS.ProcessEnv = process.env): string[] {
  const flag = (env.THREADS_INSIGHTS_SCOPE ?? "off").trim();
  if (flag !== "on" && flag !== "off") {
    throw new Error(`THREADS_INSIGHTS_SCOPE must be "on" or "off", got ${JSON.stringify(flag)}`);
  }
  return flag === "on" ? [...THREADS_SCOPES, THREADS_INSIGHTS_SCOPE] : [...THREADS_SCOPES];
}

export interface ThreadsAppCredentials {
  appId: string;
  appSecret: string;
}

interface ThreadsErrorEnvelope {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  fbtrace_id?: string;
}

/**
 * Threads refused a call. `tokenInvalid` is the one distinction a caller acts
 * on: a dead token means the account must be reconnected by a human, anything
 * else is Threads refusing this particular call.
 */
export class ThreadsApiError extends Error {
  readonly operation: string;
  readonly httpStatus: number;
  readonly threadsError: ThreadsErrorEnvelope | null;
  readonly tokenInvalid: boolean;

  constructor(
    operation: string,
    httpStatus: number,
    threadsError: ThreadsErrorEnvelope | null,
  ) {
    const detail = threadsError?.message ?? `HTTP ${httpStatus}`;
    super(`Threads refused ${operation}: ${detail}`);
    this.name = "ThreadsApiError";
    this.operation = operation;
    this.httpStatus = httpStatus;
    this.threadsError = threadsError;
    this.tokenInvalid = isTokenInvalid(threadsError);
  }
}

/** 190 = invalid/expired/revoked access token; 102 = session invalid. */
function isTokenInvalid(err: ThreadsErrorEnvelope | null): boolean {
  if (!err) return false;
  return err.code === 190 || err.code === 102;
}

async function threadsFetch<T>(
  operation: string,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ThreadsApiError(operation, response.status, {
        message: `non-JSON response: ${text.slice(0, 200)}`,
      });
    }
  }
  const envelope =
    body && typeof body === "object" && "error" in body
      ? ((body as { error: unknown }).error as ThreadsErrorEnvelope | string)
      : null;
  if (!response.ok || envelope) {
    const err =
      typeof envelope === "string"
        ? { message: envelope }
        : (envelope ?? null);
    throw new ThreadsApiError(operation, response.status, err);
  }
  return body as T;
}

function form(params: Record<string, string>): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  };
}

export function buildAuthorizeUrl(params: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(THREADS_AUTHORIZE_URL);
  url.searchParams.set("client_id", params.appId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", requestedScopes().join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", params.state);
  return url.toString();
}

/**
 * Threads appends `#_` to the redirect, and some browsers hand it over as part
 * of the code. It is not part of the code.
 */
export function cleanAuthorizationCode(code: string): string {
  return code.endsWith("#_") ? code.slice(0, -2) : code;
}

export async function exchangeCode(
  creds: ThreadsAppCredentials,
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; userId: string }> {
  const data = await threadsFetch<{ access_token: string; user_id: string | number }>(
    "the authorization code exchange",
    `${THREADS_GRAPH}/oauth/access_token`,
    form({
      client_id: creds.appId,
      client_secret: creds.appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code: cleanAuthorizationCode(code),
    }),
  );
  return { accessToken: data.access_token, userId: String(data.user_id) };
}

export interface LongLivedToken {
  accessToken: string;
  expiresInSeconds: number;
}

export async function exchangeForLongLivedToken(
  creds: ThreadsAppCredentials,
  shortLivedToken: string,
): Promise<LongLivedToken> {
  const url = new URL(`${THREADS_GRAPH}/access_token`);
  url.searchParams.set("grant_type", "th_exchange_token");
  url.searchParams.set("client_secret", creds.appSecret);
  url.searchParams.set("access_token", shortLivedToken);
  const data = await threadsFetch<{ access_token: string; expires_in: number }>(
    "the long-lived token exchange",
    url.toString(),
  );
  return { accessToken: data.access_token, expiresInSeconds: data.expires_in };
}

export async function refreshLongLivedToken(
  token: string,
): Promise<LongLivedToken> {
  const url = new URL(`${THREADS_GRAPH}/refresh_access_token`);
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", token);
  const data = await threadsFetch<{ access_token: string; expires_in: number }>(
    "the token refresh",
    url.toString(),
  );
  return { accessToken: data.access_token, expiresInSeconds: data.expires_in };
}

export interface ThreadsProfile {
  id: string;
  username: string;
  name: string | null;
  profilePictureUrl: string | null;
}

export async function getProfile(token: string): Promise<ThreadsProfile> {
  const url = new URL(`${THREADS_API}/me`);
  url.searchParams.set(
    "fields",
    "id,username,name,threads_profile_picture_url",
  );
  url.searchParams.set("access_token", token);
  const data = await threadsFetch<{
    id: string;
    username: string;
    name?: string;
    threads_profile_picture_url?: string;
  }>("the profile read", url.toString());
  return {
    id: String(data.id),
    username: data.username,
    name: data.name ?? null,
    profilePictureUrl: data.threads_profile_picture_url ?? null,
  };
}

export interface PublishedPost {
  postId: string;
  permalink: string | null;
}

const CONTAINER_POLL_ATTEMPTS = 10;
const CONTAINER_POLL_DELAY_MS = 1000;

/**
 * Publish a text post (or a reply, with `replyToPostId`) in Threads' two steps:
 * create a media container, wait until Threads has processed it, publish it.
 * A text container is usually ready at once; the bounded wait covers the case
 * where it is not, and a container Threads marks ERROR is a refusal, not a retry.
 */
export async function publishText(params: {
  token: string;
  threadsUserId: string;
  text: string;
  replyToPostId?: string;
  pollDelayMs?: number;
}): Promise<PublishedPost> {
  const { token, threadsUserId, text, replyToPostId } = params;
  const delay = params.pollDelayMs ?? CONTAINER_POLL_DELAY_MS;

  const containerParams: Record<string, string> = {
    media_type: "TEXT",
    text,
    access_token: token,
  };
  if (replyToPostId) containerParams.reply_to_id = replyToPostId;

  const container = await threadsFetch<{ id: string }>(
    "the post creation",
    `${THREADS_API}/${threadsUserId}/threads`,
    form(containerParams),
  );

  for (let attempt = 0; attempt < CONTAINER_POLL_ATTEMPTS; attempt++) {
    const url = new URL(`${THREADS_API}/${container.id}`);
    url.searchParams.set("fields", "status,error_message");
    url.searchParams.set("access_token", token);
    const state = await threadsFetch<{ status?: string; error_message?: string }>(
      "the post status read",
      url.toString(),
    );
    if (state.status === "FINISHED" || state.status === "PUBLISHED") break;
    if (state.status === "ERROR" || state.status === "EXPIRED") {
      throw new ThreadsApiError("the post creation", 200, {
        message: `container ${state.status}: ${state.error_message ?? "no reason given"}`,
      });
    }
    if (attempt === CONTAINER_POLL_ATTEMPTS - 1) {
      throw new ThreadsApiError("the post creation", 200, {
        message: `container still ${state.status ?? "unknown"} after ${CONTAINER_POLL_ATTEMPTS} checks`,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  const published = await threadsFetch<{ id: string }>(
    "the post publication",
    `${THREADS_API}/${threadsUserId}/threads_publish`,
    form({ creation_id: container.id, access_token: token }),
  );

  // The post is live from here on. A failed link read must not turn it into a
  // failure, or a caller retrying "the failed publish" posts it twice.
  const linkUrl = new URL(`${THREADS_API}/${published.id}`);
  linkUrl.searchParams.set("fields", "id,permalink");
  linkUrl.searchParams.set("access_token", token);
  let permalink: string | null = null;
  try {
    const link = await threadsFetch<{ id: string; permalink?: string }>(
      "the post link read",
      linkUrl.toString(),
    );
    permalink = link.permalink ?? null;
  } catch (err) {
    console.warn(
      `[meta-service] Threads post ${published.id} published, link read failed:`,
      err instanceof Error ? err.message : err,
    );
  }

  return { postId: String(published.id), permalink };
}

export interface PostInsights {
  views: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  quotes: number | null;
  shares: number | null;
}

export const INSIGHT_METRICS = ["views", "likes", "replies", "reposts", "quotes", "shares"] as const;

/**
 * PURE: Threads' media insights body -> one number per metric. Threads answers
 * `{data: [{name, values: [{value}]}]}` (lifetime metrics) and, for some metrics,
 * `total_value: {value}`; a metric it does not return reads null, never 0.
 */
export function parseInsights(body: unknown): PostInsights {
  const out: PostInsights = { views: null, likes: null, replies: null, reposts: null, quotes: null, shares: null };
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : null;
  if (!Array.isArray(data)) return out;
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const name = (row as { name?: unknown }).name;
    if (typeof name !== "string" || !(INSIGHT_METRICS as readonly string[]).includes(name)) continue;
    const values = (row as { values?: unknown }).values;
    const total = (row as { total_value?: { value?: unknown } }).total_value?.value;
    const raw = Array.isArray(values) && values.length > 0 ? (values[values.length - 1] as { value?: unknown })?.value : total;
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= 0) out[name as keyof PostInsights] = n;
  }
  return out;
}

/** One post's lifetime insights, read live. Free (the Threads API bills nothing). */
export async function getPostInsights(token: string, postId: string): Promise<{ insights: PostInsights; raw: unknown }> {
  const url = new URL(`${THREADS_API}/${postId}/insights`);
  url.searchParams.set("metric", INSIGHT_METRICS.join(","));
  url.searchParams.set("access_token", token);
  const raw = await threadsFetch<unknown>("the post insights read", url.toString());
  return { insights: parseInsights(raw), raw };
}
