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
    appId: z.string().min(1),
    orgId: z.string().optional(),
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

export const ConnectionsQuerySchema = z
  .object({
    appId: z.string().min(1),
    orgId: z.string().optional(),
  })
  .openapi("ConnectionsQuery");

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
    appId: z.string(),
    orgId: z.string().nullable(),
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
  summary: "List Meta connections for an app/org",
  security: [{ serviceKeyAuth: [] }],
  request: {
    query: ConnectionsQuerySchema,
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
      description: "Missing appId",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

// ==================== Accounts ====================

export const AccountsQuerySchema = z
  .object({
    appId: z.string().min(1),
    orgId: z.string().optional(),
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
    appId: z.string().min(1),
    orgId: z.string().optional(),
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
