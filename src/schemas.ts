import { z } from "zod";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_VALUES } from "./lib/account-types.js";
import {
  OpenAPIRegistry,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);
export const registry = new OpenAPIRegistry();

// ==================== Security schemes ====================

registry.registerComponent("securitySchemes", "serviceKeyAuth", {
  type: "apiKey",
  in: "header",
  name: "x-api-key",
  description: "Service-to-service key (META_SERVICE_API_KEY)",
});

// ==================== Shared ====================

export const ErrorResponseSchema = z
  .object({
    error: z.string(),
    details: z.unknown().optional(),
  })
  .openapi("ErrorResponse");

const MessageResponseSchema = z
  .object({
    message: z.string(),
  })
  .openapi("MessageResponse");

const PagingSchema = z
  .object({
    cursors: z
      .object({
        before: z.string().optional(),
        after: z.string().optional(),
      })
      .optional(),
    next: z.string().optional(),
  })
  .openapi("Paging");

// ==================== Health ====================

const HealthResponseSchema = z
  .object({
    status: z.string(),
    timestamp: z.string(),
    service: z.string(),
  })
  .openapi("HealthResponse");

registry.registerPath({
  method: "get",
  path: "/health",
  summary: "Health check",
  responses: {
    200: {
      description: "Service is healthy",
      content: { "application/json": { schema: HealthResponseSchema } },
    },
  },
});

// ==================== Auth: Authorize ====================

export const AuthorizeQuerySchema = z
  .object({
    redirectUri: z.string().url(),
    label: z.string().optional(),
  })
  .openapi("AuthorizeQuery");

const AuthorizeResponseSchema = z
  .object({
    authorizationUrl: z.string().url(),
  })
  .openapi("AuthorizeResponse");

registry.registerPath({
  method: "get",
  path: "/auth/meta/authorize",
  summary: "Generate Meta OAuth login URL",
  security: [{ serviceKeyAuth: [] }],
  request: {
    query: AuthorizeQuerySchema,
    headers: z.object({
      "x-org-id": z.string().openapi({ description: "Internal org UUID from client-service" }),
      "x-user-id": z.string().openapi({ description: "Internal user UUID from client-service" }),
      "x-run-id": z.string().openapi({ description: "Caller's run ID (used as parentRunId when creating a child run)" }),
    }),
  },
  responses: {
    200: {
      description: "OAuth authorization URL",
      content: {
        "application/json": { schema: AuthorizeResponseSchema },
      },
    },
    400: {
      description: "Invalid request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

// ==================== Auth: Callback ====================

export const CallbackQuerySchema = z
  .object({
    code: z.string(),
    state: z.string(),
  })
  .openapi("CallbackQuery");

const CallbackResponseSchema = z
  .object({
    connectionId: z.string().uuid(),
    metaUserName: z.string().nullable(),
    adAccountCount: z.number(),
    pageCount: z.number(),
  })
  .openapi("CallbackResponse");

registry.registerPath({
  method: "get",
  path: "/auth/meta/callback",
  summary: "Handle Meta OAuth callback",
  request: {
    query: CallbackQuerySchema,
  },
  responses: {
    302: { description: "Redirect to app with connectionId" },
    400: {
      description: "Invalid callback",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

// ==================== Auth: Disconnect ====================

export const DisconnectParamsSchema = z
  .object({
    connectionId: z.string().uuid(),
  })
  .openapi("DisconnectParams");

registry.registerPath({
  method: "delete",
  path: "/auth/meta/connections/{connectionId}",
  summary: "Disconnect a Meta connection",
  security: [{ serviceKeyAuth: [] }],
  request: {
    params: DisconnectParamsSchema,
    headers: z.object({
      "x-org-id": z.string().openapi({ description: "Internal org UUID from client-service" }),
      "x-user-id": z.string().openapi({ description: "Internal user UUID from client-service" }),
      "x-run-id": z.string().openapi({ description: "Caller's run ID (used as parentRunId when creating a child run)" }),
    }),
  },
  responses: {
    200: {
      description: "Connection removed",
      content: { "application/json": { schema: MessageResponseSchema } },
    },
    404: {
      description: "Connection not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

// ==================== Connections ====================

const AdAccountSummarySchema = z
  .object({
    id: z.string().uuid(),
    adAccountId: z.string(),
    accountName: z.string().nullable(),
    currency: z.string().nullable(),
    timezone: z.string().nullable(),
    accountStatus: z.number().nullable(),
    isActive: z.boolean(),
  })
  .openapi("AdAccountSummary");

const PageSummarySchema = z
  .object({
    id: z.string().uuid(),
    pageId: z.string(),
    pageName: z.string().nullable(),
    hasInstagram: z.boolean(),
  })
  .openapi("PageSummary");

export const ConnectionResponseSchema = z
  .object({
    id: z.string().uuid(),
    orgId: z.string(),
    userId: z.string(),
    label: z.string().nullable(),
    metaUserId: z.string(),
    metaUserName: z.string().nullable(),
    scopes: z.array(z.string()),
    tokenExpiresAt: z.string().datetime().nullable(),
    adAccounts: z.array(AdAccountSummarySchema),
    pages: z.array(PageSummarySchema),
    createdAt: z.string().datetime(),
  })
  .openapi("ConnectionResponse");

registry.registerPath({
  method: "get",
  path: "/connections",
  summary: "List Meta connections for an org",
  security: [{ serviceKeyAuth: [] }],
  request: {
    headers: z.object({
      "x-org-id": z.string().openapi({ description: "Internal org UUID from client-service" }),
      "x-user-id": z.string().openapi({ description: "Internal user UUID from client-service" }),
      "x-run-id": z.string().openapi({ description: "Caller's run ID (used as parentRunId when creating a child run)" }),
    }),
  },
  responses: {
    200: {
      description: "List of connections",
      content: {
        "application/json": {
          schema: z.object({
            connections: z.array(ConnectionResponseSchema),
          }),
        },
      },
    },
    400: {
      description: "Missing identity headers",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

// ==================== Accounts ====================

export const AccountsQuerySchema = z
  .object({
    activeOnly: z.coerce.boolean().default(true),
  })
  .openapi("AccountsQuery");

const AdAccountResponseSchema = z
  .object({
    id: z.string().uuid(),
    connectionId: z.string().uuid(),
    adAccountId: z.string(),
    accountName: z.string().nullable(),
    currency: z.string().nullable(),
    timezone: z.string().nullable(),
    accountStatus: z.number().nullable(),
    isActive: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("AdAccountResponse");

registry.registerPath({
  method: "get",
  path: "/accounts",
  summary: "List ad accounts across connections",
  security: [{ serviceKeyAuth: [] }],
  request: {
    query: AccountsQuerySchema,
    headers: z.object({
      "x-org-id": z.string().openapi({ description: "Internal org UUID from client-service" }),
      "x-user-id": z.string().openapi({ description: "Internal user UUID from client-service" }),
      "x-run-id": z.string().openapi({ description: "Caller's run ID (used as parentRunId when creating a child run)" }),
    }),
  },
  responses: {
    200: {
      description: "List of ad accounts",
      content: {
        "application/json": {
          schema: z.object({ accounts: z.array(AdAccountResponseSchema) }),
        },
      },
    },
  },
});

export const PatchAccountBodySchema = z
  .object({
    isActive: z.boolean(),
  })
  .openapi("PatchAccountBody");

registry.registerPath({
  method: "patch",
  path: "/accounts/{adAccountId}",
  summary: "Toggle ad account active/inactive",
  security: [{ serviceKeyAuth: [] }],
  request: {
    params: z.object({ adAccountId: z.string() }),
    headers: z.object({
      "x-org-id": z.string().openapi({ description: "Internal org UUID from client-service" }),
      "x-user-id": z.string().openapi({ description: "Internal user UUID from client-service" }),
      "x-run-id": z.string().openapi({ description: "Caller's run ID (used as parentRunId when creating a child run)" }),
    }),
    body: {
      content: {
        "application/json": { schema: PatchAccountBodySchema },
      },
    },
  },
  responses: {
    200: {
      description: "Updated ad account",
      content: {
        "application/json": { schema: AdAccountResponseSchema },
      },
    },
    404: {
      description: "Account not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/accounts/{adAccountId}/sync",
  summary: "Re-sync ad account metadata from Meta",
  security: [{ serviceKeyAuth: [] }],
  request: {
    params: z.object({ adAccountId: z.string() }),
    headers: z.object({
      "x-org-id": z.string().openapi({ description: "Internal org UUID from client-service" }),
      "x-user-id": z.string().openapi({ description: "Internal user UUID from client-service" }),
      "x-run-id": z.string().openapi({ description: "Caller's run ID (used as parentRunId when creating a child run)" }),
    }),
  },
  responses: {
    200: {
      description: "Synced ad account",
      content: {
        "application/json": { schema: AdAccountResponseSchema },
      },
    },
    404: {
      description: "Account not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

// ==================== Insights ====================

export const InsightsQuerySchema = z
  .object({
    adAccountId: z.string().min(1),

    level: z
      .enum(["account", "campaign", "adset", "ad"])
      .default("campaign"),
    objectId: z.string().optional(),
    datePreset: z
      .enum([
        "today",
        "yesterday",
        "last_7d",
        "last_14d",
        "last_30d",
        "this_month",
        "last_month",
        "this_quarter",
        "last_3d",
        "maximum",
      ])
      .optional(),
    since: z.string().optional(),
    until: z.string().optional(),
    timeIncrement: z.string().optional(),
    breakdowns: z.string().optional(), // comma-separated
    fields: z.string().optional(), // comma-separated
    limit: z.coerce.number().int().min(1).max(5000).default(500),
    after: z.string().optional(),
  })
  .openapi("InsightsQuery");

const InsightRowSchema = z
  .object({
    campaignId: z.string().optional(),
    campaignName: z.string().optional(),
    adsetId: z.string().optional(),
    adsetName: z.string().optional(),
    adId: z.string().optional(),
    adName: z.string().optional(),
    dateStart: z.string(),
    dateStop: z.string(),
    impressions: z.string(),
    reach: z.string().optional(),
    clicks: z.string().optional(),
    spend: z.string(),
    cpc: z.string().optional(),
    cpm: z.string().optional(),
    ctr: z.string().optional(),
    actions: z
      .array(z.object({ actionType: z.string(), value: z.string() }))
      .optional(),
    costPerActionType: z
      .array(z.object({ actionType: z.string(), value: z.string() }))
      .optional(),
  })
  .passthrough() // allow breakdown columns and extra fields
  .openapi("InsightRow");

const InsightsResponseSchema = z
  .object({
    data: z.array(InsightRowSchema),
    paging: PagingSchema.optional(),
  })
  .openapi("InsightsResponse");

registry.registerPath({
  method: "get",
  path: "/insights",
  summary: "Get ad performance insights",
  security: [{ serviceKeyAuth: [] }],
  request: {
    query: InsightsQuerySchema,
    headers: z.object({
      "x-org-id": z.string().openapi({ description: "Internal org UUID from client-service" }),
      "x-user-id": z.string().openapi({ description: "Internal user UUID from client-service" }),
      "x-run-id": z.string().openapi({ description: "Caller's run ID (used as parentRunId when creating a child run)" }),
    }),
  },
  responses: {
    200: {
      description: "Insights data",
      content: {
        "application/json": { schema: InsightsResponseSchema },
      },
    },
    400: {
      description: "Invalid request or breakdown combination",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

// ==================== Webhooks ====================

registry.registerPath({
  method: "get",
  path: "/webhooks/meta",
  summary: "Meta webhook verification",
  responses: {
    200: { description: "Challenge response" },
    403: { description: "Verification failed" },
  },
});

registry.registerPath({
  method: "post",
  path: "/webhooks/meta",
  summary: "Receive Meta webhook events",
  responses: {
    200: { description: "Event received" },
  },
});

// ==================== Managed advertising ====================
//
// The managed path. Ads run from OUR ad account and OUR page; the client
// supplies an offer, a budget, copy and a link, and never touches Meta.

const IdentityHeadersSchema = z.object({
  "x-org-id": z.string().openapi({ description: "Internal org UUID" }),
  "x-user-id": z.string().openapi({ description: "Internal user UUID" }),
  "x-run-id": z.string().openapi({ description: "Caller's run ID" }),
});

const ThreadsPublishHeadersSchema = IdentityHeadersSchema.extend({
  "x-campaign-id": z.string().optional().openapi({
    description:
      "The Campaign this publication is made for. Optional: omitted = a publication outside any Campaign. Kept on the record as `campaignId`, so the Campaign's publications and Units can be read back by it (`GET /orgs/threads/publications?campaignId=`, `GET /orgs/units/threads-post-published?campaignId=`).",
  }),
  "x-brand-id": z.string().optional().openapi({ description: "Caller's brand (the record keeps the ACCOUNT's brand)" }),
});

export const OptimizationGoalSchema = z
  .enum([
    "REACH",
    "IMPRESSIONS",
    "LINK_CLICKS",
    "LANDING_PAGE_VIEWS",
    "OFFSITE_CONVERSIONS",
    "LEAD_GENERATION",
  ])
  .openapi("OptimizationGoal", {
    description:
      "What the ad set optimises delivery for. Per campaign, and changeable afterwards: the right event moves one step deeper down the funnel as volume accrues.",
  });

export const OptimizationSchema = z
  .object({
    goal: OptimizationGoalSchema,
    customEventType: z.string().optional().openapi({
      description:
        "Required when goal is OFFSITE_CONVERSIONS, e.g. PURCHASE, LEAD, ADD_TO_CART, COMPLETE_REGISTRATION.",
    }),
  })
  .openapi("Optimization");

export const TargetingSchema = z
  .object({
    countries: z.array(z.string().length(2)).min(1),
    ageMin: z.number().int().min(13).max(65).optional(),
    ageMax: z.number().int().min(13).max(65).optional(),
    genders: z.array(z.number().int().min(1).max(2)).optional(),
    locales: z.array(z.number().int()).optional(),
  })
  .openapi("Targeting");

export const AdCopySchema = z
  .object({
    primaryText: z.string().min(1),
    headline: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
  })
  .openapi("AdCopy", {
    description:
      "Text only. No image is supplied and none is generated: Meta renders the destination page's own link preview.",
  });

export const CreateManagedCampaignSchema = z
  .object({
    name: z.string().min(1),
    brandId: z.string().optional(),
    campaignId: z.string().optional(),
    featureSlug: z.string().optional(),
    dailyBudgetCents: z.number().int().min(100),
    destinationUrl: z.string().url(),
    adCopy: AdCopySchema,
    callToAction: z.string().min(1).optional(),
    optimization: OptimizationSchema,
    targeting: TargetingSchema,
    status: z.enum(["ACTIVE", "PAUSED"]).optional(),
    adName: z.string().min(1).optional(),
  })
  .openapi("CreateManagedCampaignRequest");

export const UpdateOptimizationSchema = OptimizationSchema.openapi(
  "UpdateOptimizationRequest",
);

const ManagedAdSchema = z
  .object({
    id: z.string(),
    metaAdId: z.string(),
    metaCreativeId: z.string(),
    name: z.string(),
    primaryText: z.string(),
    headline: z.string().nullable(),
    description: z.string().nullable(),
    callToAction: z.string(),
    destinationUrl: z.string(),
    status: z.string(),
    reviewStatus: z.string(),
    reviewFeedback: z.unknown().nullable(),
    reviewCheckedAt: z.string().nullable(),
  })
  .openapi("ManagedAd");

const ManagedAdSetSchema = z
  .object({
    id: z.string(),
    metaAdSetId: z.string(),
    name: z.string(),
    dailyBudgetCents: z.number(),
    optimizationGoal: z.string(),
    customEventType: z.string().nullable(),
    billingEvent: z.string(),
    targeting: z.unknown(),
    status: z.string(),
  })
  .openapi("ManagedAdSet");

export const ManagedCampaignSchema = z
  .object({
    id: z.string(),
    orgId: z.string(),
    brandId: z.string().nullable(),
    campaignId: z.string().nullable(),
    metaAdAccountId: z.string(),
    metaCampaignId: z.string(),
    name: z.string(),
    objective: z.string(),
    status: z.string(),
    dailyBudgetCents: z.number(),
    destinationUrl: z.string(),
    createdAt: z.string(),
    adSets: z.array(ManagedAdSetSchema),
    ads: z.array(ManagedAdSchema),
  })
  .openapi("ManagedCampaign");

const ManagedCampaignListSchema = z
  .object({ campaigns: z.array(ManagedCampaignSchema) })
  .openapi("ManagedCampaignList");

const SpendLedgerSchema = z
  .object({
    metaCampaignId: z.string(),
    currency: z.string(),
    days: z.array(
      z.object({
        spendDate: z.string(),
        observedCents: z.number(),
        declaredCents: z.number(),
        lastObservedAt: z.string(),
      }),
    ),
    totalObservedCents: z.number(),
    totalDeclaredCents: z.number(),
  })
  .openapi("SpendLedger");

export const ConversionEventSchema = z
  .object({
    eventName: z.string().min(1),
    eventTime: z.number().int(),
    eventId: z.string().optional(),
    eventSourceUrl: z.string().url().optional(),
    actionSource: z
      .enum([
        "website",
        "app",
        "chat",
        "email",
        "other",
        "phone_call",
        "physical_store",
        "system_generated",
      ])
      .optional(),
    userData: z
      .object({
        email: z.string().optional(),
        phone: z.string().optional(),
        externalId: z.string().optional(),
        clientIpAddress: z.string().optional(),
        clientUserAgent: z.string().optional(),
        fbc: z.string().optional(),
        fbp: z.string().optional(),
      })
      .refine(
        (data) => Object.values(data).some((value) => value !== undefined),
        {
          message:
            "userData needs at least one identifier for Meta to match the conversion",
        },
      ),
    customData: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi("ConversionEvent");

export const UploadConversionsSchema = z
  .object({
    events: z.array(ConversionEventSchema).min(1).max(1000),
    testEventCode: z.string().optional(),
  })
  .openapi("UploadConversionsRequest");

const UploadConversionsResponseSchema = z
  .object({
    eventsReceived: z.number(),
    fbtraceId: z.string().nullable(),
  })
  .openapi("UploadConversionsResponse");

const errorResponses = {
  400: {
    description: "Invalid request",
    content: { "application/json": { schema: ErrorResponseSchema } },
  },
  409: {
    description:
      "Meta refuses the change — e.g. an optimisation goal outside the campaign's fixed objective",
    content: { "application/json": { schema: ErrorResponseSchema } },
  },
  502: {
    description: "Meta or a fleet dependency refused or failed the call",
    content: { "application/json": { schema: ErrorResponseSchema } },
  },
};

registry.registerPath({
  method: "post",
  path: "/managed/campaigns",
  summary:
    "Launch a managed Meta campaign: campaign, ad set (targeting, budget, optimisation) and a text-only ad, submitted for review",
  security: [{ serviceKeyAuth: [] }],
  request: {
    headers: IdentityHeadersSchema,
    body: {
      content: {
        "application/json": { schema: CreateManagedCampaignSchema },
      },
    },
  },
  responses: {
    201: {
      description: "Created and submitted for review",
      content: { "application/json": { schema: ManagedCampaignSchema } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/managed/campaigns",
  summary: "List managed campaigns for the calling org",
  security: [{ serviceKeyAuth: [] }],
  request: {
    headers: IdentityHeadersSchema,
    query: z.object({
      brandId: z.string().optional(),
      campaignId: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Managed campaigns",
      content: { "application/json": { schema: ManagedCampaignListSchema } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/managed/campaigns/{id}",
  summary:
    "Read a managed campaign back, including each ad's review outcome and Meta's feedback on a rejection",
  security: [{ serviceKeyAuth: [] }],
  request: {
    headers: IdentityHeadersSchema,
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      description: "Managed campaign",
      content: { "application/json": { schema: ManagedCampaignSchema } },
    },
    404: {
      description: "Not found for this org",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "patch",
  path: "/managed/campaigns/{id}/optimization",
  summary:
    "Change what the campaign's ad set optimises on, e.g. one step deeper down the funnel",
  security: [{ serviceKeyAuth: [] }],
  request: {
    headers: IdentityHeadersSchema,
    params: z.object({ id: z.string().uuid() }),
    body: {
      content: { "application/json": { schema: UpdateOptimizationSchema } },
    },
  },
  responses: {
    200: {
      description: "Optimisation updated",
      content: { "application/json": { schema: ManagedCampaignSchema } },
    },
    404: {
      description: "Not found for this org",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "get",
  path: "/managed/campaigns/{id}/spend",
  summary:
    "Per-day Meta spend for a managed campaign, and how much of it has been declared as the org's cost",
  security: [{ serviceKeyAuth: [] }],
  request: {
    headers: IdentityHeadersSchema,
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      description: "Spend ledger",
      content: { "application/json": { schema: SpendLedgerSchema } },
    },
    404: {
      description: "Not found for this org",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/managed/conversions",
  summary:
    "Forward conversions measured on the brand's own site to Meta server-side (Conversions API)",
  security: [{ serviceKeyAuth: [] }],
  request: {
    headers: IdentityHeadersSchema,
    body: {
      content: { "application/json": { schema: UploadConversionsSchema } },
    },
  },
  responses: {
    200: {
      description: "Meta accepted the events",
      content: {
        "application/json": { schema: UploadConversionsResponseSchema },
      },
    },
    ...errorResponses,
  },
});

registry.registerPath({
  method: "post",
  path: "/internal/review-sync",
  summary:
    "Run the ad-review poll now. The same work the review cron does on its own cadence; it is never chained into a launch.",
  security: [{ serviceKeyAuth: [] }],
  responses: {
    200: { description: "Review sync summary" },
    502: {
      description: "Sync failed",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/internal/spend-sync",
  summary:
    "Run the spend ingestion now. The same work the spend cron does on its own cadence; it is never chained into a launch.",
  security: [{ serviceKeyAuth: [] }],
  responses: {
    200: { description: "Spend ingest summary" },
    502: {
      description: "Ingest failed",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

// ==================== Threads accounts ====================
//
// Any user connects any number of Threads accounts to a brand through Threads'
// own login. The dashboard page that receives Threads' redirect hands the
// `code` and `state` back to POST /orgs/threads/auth/callback.

const accountTypeDescription = `Who runs the account: ${Object.entries(ACCOUNT_TYPES)
  .map(([value, label]) => `\`${value}\` = ${label}`)
  .join(", ")}`;

export const AccountTypeSchema = z
  .enum(ACCOUNT_TYPE_VALUES)
  .openapi("AccountType", { description: accountTypeDescription });

export const ThreadsConnectStartSchema = z
  .object({
    brandId: z.string().min(1).openapi({ description: "Brand the account is connected to" }),
    accountType: AccountTypeSchema,
    redirectUri: z.string().url().openapi({
      description:
        "Page Threads sends the user back to with `code` and `state`. Must be registered, byte for byte, as a redirect callback URL of our Threads app.",
    }),
  })
  .openapi("ThreadsConnectStart");

const ThreadsConnectStartResponseSchema = z
  .object({
    authorizationUrl: z.string().url().openapi({ description: "Send the user here to log into Threads" }),
    state: z.string(),
    expiresAt: z.string().openapi({ description: "The login must finish before this time (15 minutes)" }),
  })
  .openapi("ThreadsConnectStartResponse");

export const ThreadsConnectCallbackSchema = z
  .object({
    code: z.string().min(1).openapi({ description: "`code` from Threads' redirect" }),
    state: z.string().min(1).openapi({ description: "`state` from Threads' redirect" }),
  })
  .openapi("ThreadsConnectCallback");

const ThreadsAccountSchema = z
  .object({
    id: z.string().uuid(),
    brandId: z.string(),
    threadsUserId: z.string(),
    username: z.string(),
    name: z.string().nullable(),
    profilePictureUrl: z.string().nullable(),
    profileUrl: z.string(),
    accountType: AccountTypeSchema,
    accountTypeLabel: z.string().openapi({ description: "Human label of accountType, e.g. Pro (AI)" }),
    health: z.enum(["connected", "needs_reconnect"]).openapi({
      description: "`needs_reconnect` = Threads no longer accepts this login; a human must connect it again",
    }),
    healthReason: z.string().nullable().openapi({ description: "Plain-language reason when health is needs_reconnect" }),
    tokenExpiresAt: z.string(),
    connectedByUserId: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("ThreadsAccount");

const ThreadsConnectCallbackResponseSchema = z
  .object({
    account: ThreadsAccountSchema,
    created: z.boolean().openapi({
      description: "false when this Threads account was already connected to the brand: it was refreshed, not duplicated",
    }),
  })
  .openapi("ThreadsConnectCallbackResponse");

export const ThreadsAccountUpdateSchema = z
  .object({ accountType: AccountTypeSchema })
  .openapi("ThreadsAccountUpdate");

export const ThreadsPublishSchema = z
  .object({
    text: z.string().min(1).max(500).openapi({
      description:
        "The words to publish, 1 to 500 characters (Threads' limit). Text only: no image, no video. Published as written, except that every link to the brand's own site gets a `dy_post` tracking parameter (the answer's record keeps both: `text` as asked, `publishedText` as Threads received it).",
    }),
    replyToPostId: z.string().min(1).optional().openapi({
      description:
        "Omitted = a MAIN post (one Unit of `threads_post_published`). Given = a reply published under this Threads post id (the `postId` a previous call returned, to chain a thread): part of that thread, no outcome of its own.",
    }),
    idempotencyKey: z.string().min(1).max(512).optional().openapi({
      description:
        "Caller's own key for THIS publication, unique per org, at most 512 characters (e.g. `<run id>:<step>`). Optional, and strongly advised: without it a retry publishes the post a second time. The same key again answers the publication it already made (200, `replayed: true`) and never calls Threads twice. The same key with another account, text or parent post is a 409 `idempotency_key_reused`; while the first call is still running it is a 409 `publish_in_progress`. A publish Threads refused frees the key.",
    }),
    outcomeKey: z.enum(["threads_post_published"]).optional().openapi({
      description:
        "The outcome a MAIN post declares on the caller's run (x-run-id). Only one value exists, `threads_post_published`, and it is also what an omitted `outcomeKey` means: leave it out. Any other value is a 400. Ignored for a reply (a reply declares no outcome).",
    }),
  })
  .openapi("ThreadsPublish");

const PublicationKindSchema = z.enum(["post", "reply"]).openapi({
  description: "`post` = a main post (one `threads_post_published` outcome); `reply` = a reply under a post (part of its thread, no outcome)",
});

const ThreadsPublishResponseSchema = z
  .object({
    accountId: z.string().uuid(),
    postId: z.string().openapi({ description: "Threads media id of the published post" }),
    permalink: z.string().nullable(),
    replyToPostId: z.string().nullable(),
    publicationId: z.string().uuid().openapi({ description: "This service's record of the publication (the outcome's subject)" }),
    kind: PublicationKindSchema,
    threadRootPostId: z.string().openapi({ description: "Threads id of the main post of this thread (itself for a post)" }),
    publishedAt: z.string(),
    replayed: z.boolean().openapi({ description: "true when the idempotency key had already published this: nothing was published again" }),
    outcome: z
      .object({
        outcomeKey: z.enum(["threads_post_published"]),
        declared: z.boolean().openapi({ description: "false = runs-service refused or was unreachable; retried by the next call with the same idempotency key" }),
        error: z.string().nullable(),
      })
      .nullable()
      .openapi({ description: "The outcome (`threads_post_published`) declared on the caller's run (x-run-id), main posts only; null for a reply" }),
  })
  .openapi("ThreadsPublishResponse");

export const ThreadsPublicationsQuerySchema = z
  .object({
    campaignId: z.string().min(1).optional().openapi({ description: "Publications made under this campaign (x-campaign-id at publish time)" }),
    brandId: z.string().min(1).optional().openapi({ description: "Publications on this brand's accounts" }),
    since: z.coerce.date().optional().openapi({ description: "ISO date-time, inclusive. Default: 30 days ago" }),
    until: z.coerce.date().optional().openapi({ description: "ISO date-time, inclusive. Default: now" }),
    limit: z.coerce.number().int().min(1).max(1000).default(200),
  })
  .refine((q) => q.campaignId || q.brandId, {
    message: "campaignId or brandId is required",
    path: ["campaignId"],
  });

export const MeasurablePostsQuerySchema = z.object({
  since: z.coerce.date().optional().openapi({ description: "ISO date-time, inclusive. Default: 90 days ago" }),
  afterPublishedAt: z.coerce.date().optional().openapi({ description: "Keyset cursor: the last row's publishedAt (with afterId)" }),
  afterId: z.string().uuid().optional().openapi({ description: "Keyset cursor: the last row's id (with afterPublishedAt)" }),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
}).refine((q) => (q.afterPublishedAt === undefined) === (q.afterId === undefined), {
  message: "afterPublishedAt and afterId go together",
  path: ["afterId"],
});

const ThreadsPublicationSchema = z
  .object({
    id: z.string().uuid(),
    accountId: z.string().uuid(),
    accountUsername: z.string(),
    accountType: AccountTypeSchema,
    brandId: z.string(),
    campaignId: z.string().nullable(),
    runId: z.string(),
    userId: z.string(),
    kind: PublicationKindSchema,
    replyToPostId: z.string().nullable(),
    threadRootPostId: z.string().nullable(),
    postId: z.string(),
    permalink: z.string().nullable(),
    text: z.string().openapi({ description: "The writer's words, as asked" }),
    publishedText: z.string().openapi({ description: "What Threads received: text with the post's dy_post on every link to the brand's own site" }),
    linkTracking: z.string().nullable().openapi({ description: "tracked:<links> | no_own_link | brand_unreadable | too_long | root_unknown (null before 2026-10-29, and on an imported post)" }),
    origin: z.enum(["published", "imported"]).openapi({ description: "published = this service published it; imported = read off the connected account (published outside us, hand posts included)" }),
    performedBy: z.enum(["ours", "client_team"]).openapi({ description: "Who performed it: ours, or the client's own team (an imported post)" }),
    outcomeKey: z.string().openapi({ description: "The outcome this main post declares: threads_post_published (every main post, published or imported)" }),
    mediaType: z.string().nullable().openapi({ description: "Threads media_type of an imported post (TEXT_POST, IMAGE, VIDEO, CAROUSEL_ALBUM, AUDIO); null on a post we published (text)" }),
    publishedAt: z.string(),
  })
  .openapi("ThreadsPublication");

const threadsErrors = {
  400: {
    description: "The request cannot be satisfied as written (names the field or the reason)",
    content: { "application/json": { schema: ErrorResponseSchema } },
  },
  502: {
    description:
      "Threads refused the call (carries Threads' code and message), or our Threads app credentials are not configured (names the key)",
    content: { "application/json": { schema: ErrorResponseSchema } },
  },
};

const notFound = {
  404: {
    description: "No such Threads account in this org",
    content: { "application/json": { schema: ErrorResponseSchema } },
  },
};

registry.registerPath({
  method: "post",
  path: "/orgs/threads/auth/start",
  summary: "Start connecting a Threads account to a brand: returns the Threads login URL",
  security: [{ serviceKeyAuth: [] }],
  request: {
    headers: IdentityHeadersSchema,
    body: { content: { "application/json": { schema: ThreadsConnectStartSchema } } },
  },
  responses: {
    200: {
      description: "Threads login URL",
      content: { "application/json": { schema: ThreadsConnectStartResponseSchema } },
    },
    ...threadsErrors,
  },
});

registry.registerPath({
  method: "post",
  path: "/orgs/threads/auth/callback",
  summary:
    "Finish a Threads login: stores the account (or refreshes it when already connected to the brand)",
  security: [{ serviceKeyAuth: [] }],
  request: {
    headers: IdentityHeadersSchema,
    body: { content: { "application/json": { schema: ThreadsConnectCallbackSchema } } },
  },
  responses: {
    200: {
      description: "Connected account",
      content: { "application/json": { schema: ThreadsConnectCallbackResponseSchema } },
    },
    ...threadsErrors,
  },
});

registry.registerPath({
  method: "get",
  path: "/orgs/threads/accounts",
  summary: "List the connected Threads accounts of the org, or of one brand",
  security: [{ serviceKeyAuth: [] }],
  request: {
    headers: IdentityHeadersSchema,
    query: z.object({ brandId: z.string().optional() }),
  },
  responses: {
    200: {
      description: "Connected Threads accounts, oldest first",
      content: {
        "application/json": {
          schema: z.object({ accounts: z.array(ThreadsAccountSchema) }).openapi("ThreadsAccountList"),
        },
      },
    },
  },
});

registry.registerPath({
  method: "patch",
  path: "/orgs/threads/accounts/{id}",
  summary: "Change a connected Threads account's type",
  security: [{ serviceKeyAuth: [] }],
  request: {
    headers: IdentityHeadersSchema,
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: ThreadsAccountUpdateSchema } } },
  },
  responses: {
    200: {
      description: "Updated account",
      content: { "application/json": { schema: z.object({ account: ThreadsAccountSchema }) } },
    },
    ...notFound,
    400: threadsErrors[400],
  },
});

registry.registerPath({
  method: "delete",
  path: "/orgs/threads/accounts/{id}",
  summary: "Disconnect a Threads account",
  security: [{ serviceKeyAuth: [] }],
  request: {
    headers: IdentityHeadersSchema,
    params: z.object({ id: z.string().uuid() }),
  },
  responses: {
    200: {
      description: "Disconnected",
      content: { "application/json": { schema: MessageResponseSchema } },
    },
    ...notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/orgs/threads/accounts/{id}/posts",
  summary: "Publish a text post, or a reply under a post, on a connected Threads account (kept on record, idempotent on the caller's key)",
  description:
    "Every publication is kept (account, brand, org, user, run, campaign, kind, parent post, text, permalink, time). A main post declares ONE `threads_post_published` outcome on the caller's run (x-run-id), subject = the publication; a reply declares none. The Threads API is free: no cost.",
  security: [{ serviceKeyAuth: [] }],
  request: {
    headers: ThreadsPublishHeadersSchema,
    params: z.object({ id: z.string().uuid() }),
    body: { content: { "application/json": { schema: ThreadsPublishSchema } } },
  },
  responses: {
    201: {
      description: "Published",
      content: { "application/json": { schema: ThreadsPublishResponseSchema } },
    },
    200: {
      description: "Already published with this idempotency key: the same publication, nothing published again",
      content: { "application/json": { schema: ThreadsPublishResponseSchema } },
    },
    ...notFound,
    409: {
      description:
        "`reason: needs_reconnect` (+ `accountId`): Threads no longer accepts the account's login. `reason: idempotency_key_reused` / `publish_in_progress` (+ `publicationId`): the key names another publication, or its publish is still in flight.",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    ...threadsErrors,
  },
});

registry.registerPath({
  method: "get",
  path: "/orgs/threads/publications",
  summary: "List the Threads publications of one campaign and/or one brand over a time window, newest first",
  security: [{ serviceKeyAuth: [] }],
  request: {
    headers: IdentityHeadersSchema,
    query: z.object({
      campaignId: z.string().optional().openapi({ description: "At least one of campaignId, brandId" }),
      brandId: z.string().optional(),
      since: z.string().optional().openapi({ description: "ISO date-time, inclusive. Default: 30 days ago" }),
      until: z.string().optional().openapi({ description: "ISO date-time, inclusive. Default: now" }),
      limit: z.string().optional().openapi({ description: "1 to 1000, default 200" }),
    }),
  },
  responses: {
    200: {
      description: "Publications (posts and replies) of the org matching the filters, newest first",
      content: {
        "application/json": {
          schema: z.object({ publications: z.array(ThreadsPublicationSchema) }).openapi("ThreadsPublicationList"),
        },
      },
    },
    400: threadsErrors[400],
  },
});

// ─── Provider read of our Units (ENGINE-GET-ASK-1123) ───────────────────────
// workflow-service finds this operation by its TAG (`provider:<outcome key>`) in
// the served openapi.json and calls it for a script. Never rename the tag or the
// operationId. Dates, lists and the cursor are normalised by `parseUnitsQuery`
// (src/lib/threads-units.ts).

const unitsList = (what: string) => z.union([z.string(), z.array(z.string())]).optional().openapi({ description: what });

export const ThreadsPostPublishedUnitsQuerySchema = z
  .object({
    since: z.string().optional().openapi({
      description:
        "ISO 8601 datetime, INCLUSIVE lower bound on the Unit's `at` (when the post went live on Threads). A datetime without a zone is read as UTC. Omitted = since inception: old Units are included.",
    }),
    until: z.string().optional().openapi({
      description: "ISO 8601 datetime, EXCLUSIVE upper bound on the Unit's `at`. Omitted = up to now.",
    }),
    brandId: z.string().min(1).optional().openapi({
      description: "Only posts on this brand's Threads accounts. Omitted = every brand of the calling org.",
    }),
    campaignId: z.string().min(1).optional().openapi({
      description:
        "Only posts published for this Campaign (the `x-campaign-id` sent at publish). Omitted = every Campaign, and posts made outside any Campaign (imported posts carry none).",
    }),
    accountId: z.string().uuid().optional().openapi({
      description:
        "Only posts of this connected Threads account (OUR account id, a uuid, as listed by `GET /orgs/threads/accounts`). An account reconnected after a rename gets a new id: use `threadsUserId` to follow the same Threads user across reconnects.",
    }),
    threadsUserId: z.string().min(1).optional().openapi({
      description: "Only posts of this Threads user (Threads' own numeric user id), whichever of our account rows published or imported them.",
    }),
    origin: z.enum(["published", "imported"]).optional().openapi({
      description:
        "`published` = we published the post through this service. `imported` = the post was read off the connected account (e.g. posted by hand by the client's team). Omitted = both.",
    }),
    publicationIds: unitsList(
      "Only these Units, by `unitId` (our publication id, a uuid): comma-separated, or the parameter repeated; max 100. Use it to check Units you already know.",
    ),
    postIds: unitsList(
      "Only the Units of these Threads posts, by Threads post id (`postId`): comma-separated, or the parameter repeated; max 100.",
    ),
    limit: z.coerce.number().int().min(1).max(500).optional().openapi({ description: "Page size, 1-500. Omitted = 100." }),
    cursor: z.string().min(1).optional().openapi({
      description: "The previous page's `nextCursor`, verbatim (opaque). Omitted = first page. Keep every other parameter the same from page to page.",
    }),
  })
  .openapi("ThreadsPostPublishedUnitsQuery");

const ThreadsPostPublishedUnitSchema = z
  .object({
    unitId: z.string().uuid().openapi({ description: "Stable id of this Unit at this Provider (our publication id)" }),
    outcome: z.literal("threads_post_published"),
    subject: z
      .object({
        service: z.literal("meta-service"),
        id: z.string().uuid().openapi({ description: "The publication id (same as `unitId`)" }),
      })
      .openapi({ description: "The subject this Unit carries on runs-service's ledger, exactly as declared" }),
    at: z.string().openapi({ description: "When the post went live on Threads (ISO 8601 UTC)" }),
    madeBy: z
      .object({
        origin: z.enum(["published", "imported"]).openapi({
          description: "`published` = we published it; `imported` = read off the connected account (published outside this service)",
        }),
        performedBy: z.enum(["ours", "client_team"]).openapi({
          description: "`ours` = our system wrote and published it; `client_team` = someone on the client's team posted it by hand",
        }),
        runId: z.string().openapi({ description: "The run that published the post (or the import run that found it)" }),
        outcomeRunId: z.string().openapi({
          description: "The run the outcome is declared on: `runId` for a post we published, its own dated unit run for an imported post",
        }),
        userId: z.string().openapi({ description: "The user the publishing (or connecting) call was made for" }),
      })
      .openapi({ description: "Who made this Unit, and on which run" }),
    declaredOnLedger: z.boolean().openapi({
      description: "True when runs-service's ledger holds this Unit. False = the post is live but its declaration has not landed yet (it is retried)",
    }),
    declaredAt: z.string().nullable().openapi({ description: "When the declaration landed (ISO 8601 UTC). Null while `declaredOnLedger` is false" }),
    brandId: z.string().openapi({ description: "The brand of the Threads account that carries the post" }),
    campaignId: z.string().nullable().openapi({ description: "The Campaign the post was published for. Null outside any Campaign (every imported post)" }),
    accountId: z.string().uuid().openapi({ description: "Our Threads account row that published or imported it" }),
    accountUsername: z.string().openapi({ description: "That account's Threads username when the post was recorded" }),
    threadsUserId: z.string().openapi({ description: "Threads' own id of the user who owns the post" }),
    postId: z.string().openapi({ description: "Threads id of the post" }),
    permalink: z.string().nullable().openapi({ description: "Public link to the post on Threads. Null when Threads returned none" }),
    text: z.string().openapi({ description: "The post's words as Threads holds them" }),
    mediaType: z.string().nullable().openapi({
      description: "Threads media type of an imported post (TEXT_POST, IMAGE, VIDEO, CAROUSEL_ALBUM, AUDIO). Null on a post we published (always text)",
    }),
  })
  .openapi("ThreadsPostPublishedUnit");

const ThreadsPostPublishedUnitsResponseSchema = z
  .object({
    success: z.literal(true),
    outcome: z.literal("threads_post_published"),
    count: z.number().int().openapi({ description: "Units on THIS page" }),
    units: z.array(ThreadsPostPublishedUnitSchema).openapi({ description: "Newest first. Empty when none exists." }),
    nextCursor: z.string().nullable().openapi({ description: "Pass as `cursor` for the next page. Null = last page." }),
  })
  .openapi("ThreadsPostPublishedUnitsResponse");

const UnitsErrorSchema = z
  .object({
    error: z.string().openapi({ description: "`Invalid request` (see `details`), or the code `invalid_cursor` (see `message`)" }),
    details: z.unknown().optional().openapi({ description: "Per-field reasons for an invalid query" }),
    message: z.string().optional(),
  })
  .openapi("UnitsError");

registry.registerPath({
  method: "get",
  path: "/orgs/units/threads-post-published",
  operationId: "listThreadsPostPublishedUnits",
  tags: ["provider:threads_post_published"],
  summary: "Units of `threads_post_published` that already exist for the calling org",
  description:
    "This service is the Provider of the outcome `threads_post_published`. A Unit = ONE Threads MAIN post that is live: published by us (`madeBy.origin` `published`) or imported from a connected account, hand posts by the client's team included (`imported`). A reply under a post is part of its thread and is not a Unit; a publish still in flight is not one yet.\n\n" +
    "**Example.** What has this brand posted on Threads this week? `GET /orgs/units/threads-post-published?brandId=<brand>&since=2026-11-17T00:00:00Z`: `units[0].at` is the latest post, an empty `units` means none. Only what we published for one Campaign: `?campaignId=<campaign>&origin=published`.\n\n" +
    "**Who.** Every filter is optional and they combine (AND): `brandId`, `campaignId`, `accountId`, `threadsUserId`, `origin`, or exact Units by `publicationIds` / `postIds`. No filter = every Unit of the org.\n\n" +
    "**When.** `since` is yours to choose; omitted = since inception, so old Units are included. `until` is optional.\n\n" +
    "**Scope.** The CALLING org only (`x-org-id`). Never another org's data.\n\n" +
    "**Answer.** Newest first, paged by `cursor` (read until `nextCursor` is null). No Unit = 200 with an empty `units`, never a 404.\n\n" +
    "**Cost.** None: it reads this service's own records, never calls Threads, publishes nothing, changes nothing.",
  security: [{ serviceKeyAuth: [] }],
  request: {
    headers: IdentityHeadersSchema,
    query: ThreadsPostPublishedUnitsQuerySchema,
  },
  responses: {
    200: {
      description: "One page of `threads_post_published` Units, newest first (possibly empty)",
      content: { "application/json": { schema: ThreadsPostPublishedUnitsResponseSchema } },
    },
    400: {
      description:
        "Invalid query (`error: Invalid request`, `details` names the field), or a cursor this route did not issue (`error: invalid_cursor`)",
      content: { "application/json": { schema: UnitsErrorSchema } },
    },
    401: { description: "Unauthorized" },
  },
});

registry.registerPath({
  method: "get",
  path: "/internal/threads/measurable-posts",
  summary:
    "Fleet-wide Threads MAIN posts whose outcome landed on runs-service, oldest first (keyset paged). `accountId`/`accountUsername` name the account the post is read through TODAY: the one that published it, or a later connection of the same Threads user (a rename + reconnect makes a new account row). Posts we published AND posts imported from a connected account (threads_post_published, performedBy client_team). What social-service measures (views, engagement) and declares outcomes on (FACTORY-P2-CONTENT-OUTCOMES). A reader consuming the post's outcome consumes `outcomeKey`.",
  security: [{ serviceKeyAuth: [] }],
  request: {
    query: z.object({
      since: z.string().optional().openapi({ description: "ISO date-time, inclusive. Default: 90 days ago" }),
      afterPublishedAt: z.string().optional().openapi({ description: "Keyset cursor (with afterId): the last row's publishedAt" }),
      afterId: z.string().optional().openapi({ description: "Keyset cursor (with afterPublishedAt): the last row's id" }),
      limit: z.string().optional().openapi({ description: "1 to 1000, default 500" }),
    }),
  },
  responses: {
    200: {
      description: "Main posts with the org that owns them and when their outcome was declared",
      content: {
        "application/json": {
          schema: z
            .object({
              posts: z.array(
                ThreadsPublicationSchema.extend({
                  orgId: z.string(),
                  ownReplies: z.number().int().openapi({ description: "Replies under this post that are OUR publications on record (same Threads user, any depth of the thread). Threads' `replies` insight counts them: replies by others = metrics.replies - ownReplies. 0 is a real 0." }),
                  outcomeDeclaredAt: z.string().openapi({ description: "When the post's outcome (`outcomeKey`) landed on runs-service" }),
                  outcomeRunId: z.string().openapi({ description: "The run that outcome is declared on: runId for a post we published, the post's own unit run (child of runId) for an imported one" }),
                }),
              ),
            })
            .openapi("ThreadsMeasurablePostList"),
        },
      },
    },
    400: threadsErrors[400],
  },
});

registry.registerPath({
  method: "get",
  path: "/internal/threads/publications/{id}/insights",
  summary:
    "Live lifetime insights of one Threads MAIN post (views, likes, replies, reposts, quotes, shares), read on the account that published it (or a later connection of the same Threads user). `ownReplies` = replies under it that we published, which Threads counts in `metrics.replies`. Free, stores nothing: social-service keeps the series and declares post_viewed / post_engaged (FACTORY-P2-CONTENT-OUTCOMES).",
  security: [{ serviceKeyAuth: [] }],
  request: { params: z.object({ id: z.string().uuid().openapi({ description: "Publication id (GET /internal/threads/measurable-posts)" }) }) },
  responses: {
    200: {
      description: "The post's insights; a metric Threads did not return is null, never 0",
      content: {
        "application/json": {
          schema: z
            .object({
              publicationId: z.string().uuid(),
              postId: z.string(),
              permalink: z.string().nullable(),
              accountId: z.string().uuid().openapi({ description: "The connected account the read ran on: the one that published it, or a later connection of the same Threads user" }),
              accountUsername: z.string().openapi({ description: "That account's current Threads username" }),
              observedAt: z.string(),
              ownReplies: z.number().int().openapi({ description: "Replies under this post that are OUR publications on record (same Threads user, any depth of the thread). Threads' `replies` insight counts them: replies by others = metrics.replies - ownReplies. 0 is a real 0." }),
              metrics: z.object({
                views: z.number().nullable(),
                likes: z.number().nullable(),
                replies: z.number().nullable(),
                reposts: z.number().nullable(),
                quotes: z.number().nullable(),
                shares: z.number().nullable(),
              }),
              raw: z.unknown().openapi({ description: "Threads' answer verbatim (bronze for the caller)" }),
            })
            .openapi("ThreadsPostInsights"),
        },
      },
    },
    400: { description: "Invalid publication id", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "No such publication", content: { "application/json": { schema: ErrorResponseSchema } } },
    409: {
      description:
        "Not readable now, `reason`: `needs_reconnect` (Threads no longer accepts the login), `insights_scope_missing` (connected without threads_manage_insights), `insights_permission_missing` (our Meta app lacks the permission: Threads code 10), `not_measurable` (a reply, unpublished, or the account is gone)",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    502: { description: "Threads refused the read (its code and message)", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/internal/threads/import",
  summary:
    "Run the Threads post import now (the same work its cron does): every connected account's own posts not on record land as publications (origin imported, performedBy client_team), each declaring threads_post_published dated at its Threads time, on runs of the CONNECTING org.",
  security: [{ serviceKeyAuth: [] }],
  responses: {
    200: { description: "Import summary: accounts read, posts imported, outcomes declared, errors" },
  },
});

registry.registerPath({
  method: "post",
  path: "/internal/threads/token-refresh",
  summary:
    "Run the Threads token refresh now. The same work its cron does twice a day: refreshes tokens nearing expiry, marks dead ones needs_reconnect.",
  security: [{ serviceKeyAuth: [] }],
  responses: {
    200: { description: "Token refresh summary" },
  },
});
