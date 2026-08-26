import { z } from "zod";
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
