/**
 * The write half of the Marketing API: what it takes to go from "we have copy
 * and a link" to "an ad is delivering", plus the two after-the-fact reads that
 * cannot live in the same run as the write (review outcome, spend).
 *
 * Every call here fails loud. Meta answers a policy refusal, a rejected
 * targeting spec or a permissions problem as a normal error envelope with HTTP
 * 400, so a swallowed error would read exactly like a launched campaign.
 */
import crypto from "crypto";
import { metaFetch, type MetaApiError } from "./meta-client.js";

export class MetaApiCallError extends Error {
  readonly metaError: MetaApiError;
  readonly operation: string;

  constructor(operation: string, metaError: MetaApiError) {
    super(
      `Meta API ${operation} failed: [${metaError.code}${
        metaError.error_subcode ? `/${metaError.error_subcode}` : ""
      }] ${metaError.message}`,
    );
    this.name = "MetaApiCallError";
    this.metaError = metaError;
    this.operation = operation;
  }
}

async function post<T>(
  operation: string,
  path: string,
  accessToken: string,
  appSecret: string,
  params: Record<string, string>,
): Promise<T> {
  const result = await metaFetch<T>(path, accessToken, {
    method: "POST",
    params,
    appSecret,
  });
  if (!result.success) {
    throw new MetaApiCallError(operation, result.error);
  }
  return result.data;
}

async function get<T>(
  operation: string,
  path: string,
  accessToken: string,
  appSecret: string,
  params: Record<string, string>,
): Promise<T> {
  const result = await metaFetch<T>(path, accessToken, {
    params,
    appSecret,
  });
  if (!result.success) {
    throw new MetaApiCallError(operation, result.error);
  }
  return result.data;
}

// ==================== Optimisation ====================

/**
 * What an ad set can be told to optimise for. The choice is per campaign and it
 * moves deeper down the funnel as volume accrues — a campaign optimising on a
 * rare event never leaves the learning phase.
 */
export const OPTIMIZATION_GOALS = [
  "REACH",
  "IMPRESSIONS",
  "LINK_CLICKS",
  "LANDING_PAGE_VIEWS",
  "OFFSITE_CONVERSIONS",
  "LEAD_GENERATION",
] as const;

export type OptimizationGoal = (typeof OPTIMIZATION_GOALS)[number];

/**
 * A campaign's objective is fixed at creation and Meta will not change it, so
 * it is derived from the FIRST goal and every later goal has to stay inside it.
 * That constraint is Meta's, and callers are told about it rather than worked
 * around.
 */
export const OBJECTIVE_BY_GOAL: Record<OptimizationGoal, string> = {
  REACH: "OUTCOME_AWARENESS",
  IMPRESSIONS: "OUTCOME_AWARENESS",
  LINK_CLICKS: "OUTCOME_TRAFFIC",
  LANDING_PAGE_VIEWS: "OUTCOME_TRAFFIC",
  OFFSITE_CONVERSIONS: "OUTCOME_SALES",
  LEAD_GENERATION: "OUTCOME_LEADS",
};

export function objectiveForGoal(goal: OptimizationGoal): string {
  return OBJECTIVE_BY_GOAL[goal];
}

export function goalsForObjective(objective: string): OptimizationGoal[] {
  return OPTIMIZATION_GOALS.filter(
    (goal) => OBJECTIVE_BY_GOAL[goal] === objective,
  );
}

export interface PromotedObjectInput {
  goal: OptimizationGoal;
  datasetId: string | null;
  customEventType: string | null;
  pageId: string;
}

/**
 * The object the optimisation is measured against. A conversion goal is
 * meaningless without a dataset and an event, so an incomplete pair is an
 * error, not a quietly-dropped field.
 */
export function buildPromotedObject(
  input: PromotedObjectInput,
): Record<string, string> | null {
  if (input.goal === "OFFSITE_CONVERSIONS") {
    if (!input.datasetId) {
      throw new Error(
        "OFFSITE_CONVERSIONS needs a Meta dataset (pixel); none is configured as a platform key",
      );
    }
    if (!input.customEventType) {
      throw new Error(
        "OFFSITE_CONVERSIONS needs a customEventType (the event to optimise on)",
      );
    }
    return {
      pixel_id: input.datasetId,
      custom_event_type: input.customEventType,
    };
  }

  if (input.goal === "LEAD_GENERATION") {
    return { page_id: input.pageId };
  }

  return null;
}

// ==================== Campaign ====================

export interface CreateCampaignInput {
  adAccountId: string;
  name: string;
  objective: string;
  status: "ACTIVE" | "PAUSED";
  accessToken: string;
  appSecret: string;
}

export async function createCampaign(
  input: CreateCampaignInput,
): Promise<{ id: string }> {
  return post<{ id: string }>(
    "create campaign",
    `/${input.adAccountId}/campaigns`,
    input.accessToken,
    input.appSecret,
    {
      name: input.name,
      objective: input.objective,
      status: input.status,
      special_ad_categories: JSON.stringify([]),
      buying_type: "AUCTION",
    },
  );
}

// ==================== Ad set ====================

export interface TargetingInput {
  countries: string[];
  ageMin?: number;
  ageMax?: number;
  genders?: number[];
  locales?: number[];
}

export function buildTargeting(
  targeting: TargetingInput,
  includeInstagram: boolean,
): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    geo_locations: { countries: targeting.countries },
    publisher_platforms: includeInstagram
      ? ["facebook", "instagram"]
      : ["facebook"],
  };
  if (targeting.ageMin !== undefined) spec.age_min = targeting.ageMin;
  if (targeting.ageMax !== undefined) spec.age_max = targeting.ageMax;
  if (targeting.genders !== undefined && targeting.genders.length > 0) {
    spec.genders = targeting.genders;
  }
  if (targeting.locales !== undefined && targeting.locales.length > 0) {
    spec.locales = targeting.locales;
  }
  return spec;
}

export interface CreateAdSetInput {
  adAccountId: string;
  campaignId: string;
  name: string;
  dailyBudgetCents: number;
  optimizationGoal: OptimizationGoal;
  billingEvent: string;
  promotedObject: Record<string, string> | null;
  targeting: Record<string, unknown>;
  status: "ACTIVE" | "PAUSED";
  accessToken: string;
  appSecret: string;
}

export async function createAdSet(
  input: CreateAdSetInput,
): Promise<{ id: string }> {
  const params: Record<string, string> = {
    name: input.name,
    campaign_id: input.campaignId,
    daily_budget: String(input.dailyBudgetCents),
    optimization_goal: input.optimizationGoal,
    billing_event: input.billingEvent,
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: JSON.stringify(input.targeting),
    status: input.status,
  };
  if (input.promotedObject) {
    params.promoted_object = JSON.stringify(input.promotedObject);
  }

  return post<{ id: string }>(
    "create ad set",
    `/${input.adAccountId}/adsets`,
    input.accessToken,
    input.appSecret,
    params,
  );
}

export interface UpdateAdSetOptimizationInput {
  adSetId: string;
  optimizationGoal: OptimizationGoal;
  promotedObject: Record<string, string> | null;
  accessToken: string;
  appSecret: string;
}

export async function updateAdSetOptimization(
  input: UpdateAdSetOptimizationInput,
): Promise<{ success?: boolean }> {
  const params: Record<string, string> = {
    optimization_goal: input.optimizationGoal,
  };
  if (input.promotedObject) {
    params.promoted_object = JSON.stringify(input.promotedObject);
  }

  return post<{ success?: boolean }>(
    "update ad set optimization",
    `/${input.adSetId}`,
    input.accessToken,
    input.appSecret,
    params,
  );
}

// ==================== Creative + ad ====================

export interface CreateLinkCreativeInput {
  adAccountId: string;
  name: string;
  pageId: string;
  instagramAccountId: string | null;
  destinationUrl: string;
  primaryText: string;
  headline: string | null;
  description: string | null;
  callToAction: string;
  accessToken: string;
  appSecret: string;
}

/**
 * A TEXT-ONLY ad. `link_data` carries no `image_hash` and no `picture`, so Meta
 * renders the destination page's own link preview. Nothing here invents,
 * generates or substitutes a visual — if the destination has no preview, that
 * is a fact about the destination and Meta will say so.
 */
export async function createLinkCreative(
  input: CreateLinkCreativeInput,
): Promise<{ id: string }> {
  const linkData: Record<string, unknown> = {
    link: input.destinationUrl,
    message: input.primaryText,
    call_to_action: {
      type: input.callToAction,
      value: { link: input.destinationUrl },
    },
  };
  if (input.headline) linkData.name = input.headline;
  if (input.description) linkData.description = input.description;

  const objectStorySpec: Record<string, unknown> = {
    page_id: input.pageId,
    link_data: linkData,
  };
  if (input.instagramAccountId) {
    objectStorySpec.instagram_user_id = input.instagramAccountId;
  }

  return post<{ id: string }>(
    "create ad creative",
    `/${input.adAccountId}/adcreatives`,
    input.accessToken,
    input.appSecret,
    {
      name: input.name,
      object_story_spec: JSON.stringify(objectStorySpec),
      degrees_of_freedom_spec: JSON.stringify({
        creative_features_spec: {
          standard_enhancements: { enroll_status: "OPT_OUT" },
        },
      }),
    },
  );
}

export interface CreateAdInput {
  adAccountId: string;
  name: string;
  adSetId: string;
  creativeId: string;
  status: "ACTIVE" | "PAUSED";
  accessToken: string;
  appSecret: string;
}

export async function createAd(
  input: CreateAdInput,
): Promise<{ id: string }> {
  return post<{ id: string }>(
    "create ad",
    `/${input.adAccountId}/ads`,
    input.accessToken,
    input.appSecret,
    {
      name: input.name,
      adset_id: input.adSetId,
      creative: JSON.stringify({ creative_id: input.creativeId }),
      status: input.status,
    },
  );
}

// ==================== Review outcome ====================

export interface AdReviewState {
  adId: string;
  effectiveStatus: string;
  configuredStatus: string | null;
  reviewFeedback: Record<string, unknown> | null;
}

/**
 * Meta reviews asynchronously and can refuse minutes to a day later. This read
 * NEVER runs in the same run that submitted the ad: seconds after a submission
 * it observes `PENDING_REVIEW` and would report success on an ad that is about
 * to be refused.
 */
export async function getAdReviewState(
  adId: string,
  accessToken: string,
  appSecret: string,
): Promise<AdReviewState> {
  const data = await get<{
    id: string;
    effective_status?: string;
    configured_status?: string;
    ad_review_feedback?: Record<string, unknown>;
  }>("read ad review state", `/${adId}`, accessToken, appSecret, {
    fields: "id,effective_status,configured_status,ad_review_feedback",
  });

  return {
    adId: data.id,
    effectiveStatus: data.effective_status ?? "UNKNOWN",
    configuredStatus: data.configured_status ?? null,
    reviewFeedback: data.ad_review_feedback ?? null,
  };
}

/** Effective statuses that mean Meta has finished deciding. */
export const TERMINAL_REVIEW_STATUSES = new Set([
  "ACTIVE",
  "DISAPPROVED",
  "WITH_ISSUES",
  "CAMPAIGN_PAUSED",
  "ADSET_PAUSED",
  "DELETED",
  "ARCHIVED",
]);

export const REJECTED_REVIEW_STATUSES = new Set([
  "DISAPPROVED",
  "WITH_ISSUES",
]);

// ==================== Spend ====================

export interface DailySpend {
  date: string;
  spendCents: number;
  currency: string;
}

/**
 * Per-day campaign spend. Segmenting on Meta's own day (`time_increment=1`) is
 * what lets a figure be dated by when it was spent rather than by when we
 * happened to poll.
 */
export async function getCampaignDailySpend(
  metaCampaignId: string,
  since: string,
  until: string,
  accessToken: string,
  appSecret: string,
): Promise<DailySpend[]> {
  const data = await get<{
    data: Array<{
      date_start?: string;
      spend?: string;
      account_currency?: string;
    }>;
  }>(
    "read campaign daily spend",
    `/${metaCampaignId}/insights`,
    accessToken,
    appSecret,
    {
      fields: "spend,account_currency",
      level: "campaign",
      time_increment: "1",
      time_range: JSON.stringify({ since, until }),
      limit: "500",
    },
  );

  return (data.data ?? []).map((row) => {
    if (!row.date_start) {
      throw new Error(
        `Meta returned a spend row with no date_start for campaign ${metaCampaignId}`,
      );
    }
    if (row.spend === undefined) {
      throw new Error(
        `Meta returned a spend row with no spend for campaign ${metaCampaignId} on ${row.date_start}`,
      );
    }
    const currency = row.account_currency ?? "UNKNOWN";
    return {
      date: row.date_start,
      spendCents: Math.round(Number(row.spend) * 100),
      currency,
    };
  });
}

// ==================== Conversions API ====================

export interface ConversionUserData {
  email?: string;
  phone?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  fbc?: string;
  fbp?: string;
  externalId?: string;
}

export interface ConversionEventInput {
  eventName: string;
  eventTime: number;
  eventId?: string;
  eventSourceUrl?: string;
  actionSource: string;
  userData: ConversionUserData;
  customData?: Record<string, unknown>;
}

function sha256(value: string): string {
  return crypto
    .createHash("sha256")
    .update(value.trim().toLowerCase())
    .digest("hex");
}

/** Meta requires the identifying fields hashed; the network-level ones raw. */
export function buildConversionUserData(
  userData: ConversionUserData,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (userData.email) out.em = [sha256(userData.email)];
  if (userData.phone) out.ph = [sha256(userData.phone.replace(/[^0-9]/g, ""))];
  if (userData.externalId) out.external_id = [sha256(userData.externalId)];
  if (userData.clientIpAddress) out.client_ip_address = userData.clientIpAddress;
  if (userData.clientUserAgent) out.client_user_agent = userData.clientUserAgent;
  if (userData.fbc) out.fbc = userData.fbc;
  if (userData.fbp) out.fbp = userData.fbp;
  return out;
}

export interface ConversionUploadResult {
  eventsReceived: number;
  fbtraceId: string | null;
}

export async function uploadConversions(input: {
  datasetId: string;
  accessToken: string;
  appSecret: string;
  events: ConversionEventInput[];
  testEventCode?: string;
}): Promise<ConversionUploadResult> {
  const payload = input.events.map((event) => {
    const entry: Record<string, unknown> = {
      event_name: event.eventName,
      event_time: event.eventTime,
      action_source: event.actionSource,
      user_data: buildConversionUserData(event.userData),
    };
    if (event.eventId) entry.event_id = event.eventId;
    if (event.eventSourceUrl) entry.event_source_url = event.eventSourceUrl;
    if (event.customData) entry.custom_data = event.customData;
    return entry;
  });

  const params: Record<string, string> = { data: JSON.stringify(payload) };
  if (input.testEventCode) params.test_event_code = input.testEventCode;

  const data = await post<{
    events_received?: number;
    fbtrace_id?: string;
  }>(
    "upload conversions",
    `/${input.datasetId}/events`,
    input.accessToken,
    input.appSecret,
    params,
  );

  const eventsReceived = data.events_received ?? 0;
  if (eventsReceived === 0) {
    throw new Error(
      `Meta accepted none of the ${input.events.length} conversion event(s) sent to dataset ${input.datasetId}`,
    );
  }

  return {
    eventsReceived,
    fbtraceId: data.fbtrace_id ?? null,
  };
}
