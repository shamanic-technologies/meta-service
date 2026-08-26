import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

const inserted: Record<string, unknown>[] = [];
const selected: { campaigns: unknown[]; adSets: unknown[]; ads: unknown[]; spend: unknown[] } = {
  campaigns: [],
  adSets: [],
  ads: [],
  spend: [],
};

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

const metaAdsMock = vi.hoisted(() => ({
  createCampaign: vi.fn(),
  createAdSet: vi.fn(),
  createLinkCreative: vi.fn(),
  createAd: vi.fn(),
  updateAdSetOptimization: vi.fn(),
  uploadConversions: vi.fn(),
  buildPromotedObject: vi.fn(),
  buildTargeting: vi.fn(),
  objectiveForGoal: vi.fn(),
  goalsForObjective: vi.fn(),
  MetaApiCallError: class extends Error {},
  ManagedRequestError: class extends Error {},
}));

const keyServiceMock = vi.hoisted(() => ({
  getMetaPlatformCredentials: vi.fn(),
  getConversionsApiToken: vi.fn(),
  PlatformCredentialError: class extends Error {
    provider = "meta-system-user-token";
  },
}));

vi.mock("../../src/db/index.js", () => ({ db: dbMock, sql: { end: vi.fn() } }));
vi.mock("../../src/lib/meta-ads.js", () => metaAdsMock);
vi.mock("../../src/lib/key-service.js", () => keyServiceMock);
vi.mock("../../src/lib/services.js", () => ({
  createRun: vi.fn().mockResolvedValue({ id: "run" }),
  addRunCosts: vi.fn(),
  completeRun: vi.fn(),
  registerEmailTemplates: vi.fn(),
}));

const { createTestApp, getAuthHeaders } = await import(
  "../helpers/test-app.js"
);

const app = createTestApp();

const CREDENTIALS = {
  accessToken: "tok",
  appSecret: "sec",
  adAccountId: "act_123",
  pageId: "page-1",
  instagramAccountId: "ig-1",
  datasetId: "ds-1",
};

const VALID_BODY = {
  name: "Autumn offer",
  brandId: "brand-1",
  dailyBudgetCents: 5000,
  destinationUrl: "https://example.com/offer",
  adCopy: {
    primaryText: "Book a call this week.",
    headline: "Fill your calendar",
  },
  optimization: { goal: "OFFSITE_CONVERSIONS", customEventType: "LEAD" },
  targeting: { countries: ["US"], ageMin: 25, ageMax: 55 },
};

function primeInsertReturning() {
  dbMock.insert.mockImplementation(() => ({
    values: (values: Record<string, unknown>) => {
      inserted.push(values);
      return {
        returning: () =>
          Promise.resolve([
            {
              id: `row-${inserted.length}`,
              createdAt: new Date("2026-08-26T00:00:00Z"),
              reviewCheckedAt: null,
              reviewFeedback: null,
              ...values,
            },
          ]),
      };
    },
  }));
}

function primeSelect() {
  let call = 0;
  dbMock.select.mockImplementation(() => ({
    from: () => {
      // loadCampaign reads campaigns, then ad sets, then ads — and the PATCH
      // route loads twice (before and after the change), so the cycle repeats.
      const which = call++ % 3;
      const rows =
        which === 0
          ? selected.campaigns
          : which === 1
            ? selected.adSets
            : selected.ads;
      return {
        where: () => {
          const result = Promise.resolve(rows);
          return Object.assign(result, {
            limit: () => Promise.resolve(rows),
            orderBy: () => Promise.resolve(selected.spend),
          });
        },
      };
    },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  inserted.length = 0;
  selected.campaigns = [];
  selected.adSets = [];
  selected.ads = [];
  selected.spend = [];
  keyServiceMock.getMetaPlatformCredentials.mockResolvedValue(CREDENTIALS);
  keyServiceMock.getConversionsApiToken.mockResolvedValue("capi-tok");
  metaAdsMock.objectiveForGoal.mockReturnValue("OUTCOME_SALES");
  metaAdsMock.goalsForObjective.mockReturnValue(["OFFSITE_CONVERSIONS"]);
  metaAdsMock.buildPromotedObject.mockReturnValue({
    pixel_id: "ds-1",
    custom_event_type: "LEAD",
  });
  metaAdsMock.buildTargeting.mockReturnValue({
    geo_locations: { countries: ["US"] },
    publisher_platforms: ["facebook", "instagram"],
  });
  metaAdsMock.createCampaign.mockResolvedValue({ id: "23841" });
  metaAdsMock.createAdSet.mockResolvedValue({ id: "23842" });
  metaAdsMock.createLinkCreative.mockResolvedValue({ id: "23843" });
  metaAdsMock.createAd.mockResolvedValue({ id: "23844" });
  primeInsertReturning();
  primeSelect();
});

describe("POST /managed/campaigns", () => {
  it("creates campaign, ad set and a text-only ad in one call, no client credential", async () => {
    const res = await request(app)
      .post("/managed/campaigns")
      .set(getAuthHeaders())
      .send(VALID_BODY);

    expect(res.status).toBe(201);
    expect(metaAdsMock.createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        adAccountId: "act_123",
        objective: "OUTCOME_SALES",
        status: "PAUSED",
      }),
    );
    expect(metaAdsMock.createAdSet).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: "23841",
        dailyBudgetCents: 5000,
        optimizationGoal: "OFFSITE_CONVERSIONS",
        billingEvent: "IMPRESSIONS",
        promotedObject: { pixel_id: "ds-1", custom_event_type: "LEAD" },
      }),
    );
    expect(metaAdsMock.createAd).toHaveBeenCalledWith(
      expect.objectContaining({ adSetId: "23842", creativeId: "23843" }),
    );

    // Text only: the creative carries copy and a link, and nothing image-shaped.
    const creativeArgs = metaAdsMock.createLinkCreative.mock.calls[0][0];
    expect(creativeArgs.destinationUrl).toBe("https://example.com/offer");
    expect(creativeArgs.primaryText).toBe("Book a call this week.");
    expect(Object.keys(creativeArgs)).not.toContain("imageHash");
    expect(Object.keys(creativeArgs)).not.toContain("imageUrl");

    expect(res.body.metaCampaignId).toBe("23841");
    expect(res.body.ads[0].reviewStatus).toBe("PENDING_REVIEW");
    expect(res.body.ads[0].metaAdId).toBe("23844");
  });

  it("persists the identity the background jobs will need long after the request", async () => {
    await request(app)
      .post("/managed/campaigns")
      .set(getAuthHeaders())
      .send(VALID_BODY);

    expect(inserted[0]).toMatchObject({
      orgId: "test-org-id",
      userId: "test-user-id",
      brandId: "brand-1",
    });
  });

  it("does not observe the review outcome in the launch run", async () => {
    const res = await request(app)
      .post("/managed/campaigns")
      .set(getAuthHeaders())
      .send(VALID_BODY);

    // A poll here would read PENDING_REVIEW and report success on an ad Meta
    // may still refuse, so the launch never asks.
    expect(res.body.ads[0].reviewCheckedAt).toBeNull();
  });

  it("surfaces a Meta refusal as a 502 carrying Meta's own message", async () => {
    class MetaApiCallError extends metaAdsMock.MetaApiCallError {
      metaError = { message: "Ad creative is invalid", code: 1487390 };
      operation = "create ad creative";
    }
    metaAdsMock.createLinkCreative.mockRejectedValue(
      new MetaApiCallError("Meta API create ad creative failed"),
    );

    const res = await request(app)
      .post("/managed/campaigns")
      .set(getAuthHeaders())
      .send(VALID_BODY);

    expect(res.status).toBe(502);
    expect(res.body.error).toContain("create ad creative");
  });

  it("names the missing platform key instead of a generic 500", async () => {
    keyServiceMock.getMetaPlatformCredentials.mockRejectedValue(
      new keyServiceMock.PlatformCredentialError(
        "key-service has no platform key for provider 'meta-system-user-token'",
      ),
    );

    const res = await request(app)
      .post("/managed/campaigns")
      .set(getAuthHeaders())
      .send(VALID_BODY);

    expect(res.status).toBe(502);
    expect(res.body.error).toContain("meta-system-user-token");
    expect(res.body.details.provider).toBe("meta-system-user-token");
  });

  it("says which part of the request cannot be satisfied", async () => {
    metaAdsMock.buildPromotedObject.mockImplementation(() => {
      throw new metaAdsMock.ManagedRequestError(
        "OFFSITE_CONVERSIONS needs a customEventType (the event to optimise on)",
      );
    });

    const res = await request(app)
      .post("/managed/campaigns")
      .set(getAuthHeaders())
      .send(VALID_BODY);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("customEventType");
    expect(metaAdsMock.createCampaign).not.toHaveBeenCalled();
  });

  it("rejects an incoherent age range", async () => {
    const res = await request(app)
      .post("/managed/campaigns")
      .set(getAuthHeaders())
      .send({
        ...VALID_BODY,
        targeting: { countries: ["US"], ageMin: 55, ageMax: 25 },
      });

    expect(res.status).toBe(400);
  });

  it("requires identity headers", async () => {
    const res = await request(app)
      .post("/managed/campaigns")
      .set({ "x-api-key": "test-service-key" })
      .send(VALID_BODY);

    expect(res.status).toBe(400);
  });
});

describe("PATCH /managed/campaigns/:id/optimization", () => {
  const campaignRow = {
    id: "11111111-1111-1111-1111-111111111111",
    orgId: "test-org-id",
    userId: "test-user-id",
    brandId: null,
    campaignId: null,
    metaAdAccountId: "act_123",
    metaCampaignId: "23841",
    name: "Autumn offer",
    objective: "OUTCOME_SALES",
    status: "PAUSED",
    dailyBudgetCents: 5000,
    destinationUrl: "https://example.com/offer",
    createdAt: new Date("2026-08-26T00:00:00Z"),
  };

  it("moves the optimisation one step deeper down the funnel", async () => {
    selected.campaigns = [campaignRow];
    selected.adSets = [
      {
        id: "adset-row",
        metaAdSetId: "23842",
        name: "set",
        dailyBudgetCents: 5000,
        optimizationGoal: "OFFSITE_CONVERSIONS",
        customEventType: "LEAD",
        billingEvent: "IMPRESSIONS",
        targeting: {},
        status: "PAUSED",
      },
    ];
    selected.ads = [];
    dbMock.update.mockReturnValue({
      set: () => ({ where: vi.fn().mockResolvedValue(undefined) }),
    });
    metaAdsMock.updateAdSetOptimization.mockResolvedValue({ success: true });
    metaAdsMock.buildPromotedObject.mockReturnValue({
      pixel_id: "ds-1",
      custom_event_type: "PURCHASE",
    });

    const res = await request(app)
      .patch(`/managed/campaigns/${campaignRow.id}/optimization`)
      .set(getAuthHeaders())
      .send({ goal: "OFFSITE_CONVERSIONS", customEventType: "PURCHASE" });

    expect(res.status).toBe(200);
    expect(metaAdsMock.updateAdSetOptimization).toHaveBeenCalledWith(
      expect.objectContaining({
        adSetId: "23842",
        optimizationGoal: "OFFSITE_CONVERSIONS",
        promotedObject: { pixel_id: "ds-1", custom_event_type: "PURCHASE" },
      }),
    );
  });

  it("says plainly when the new goal would need a different campaign objective", async () => {
    selected.campaigns = [campaignRow];
    selected.adSets = [];
    selected.ads = [];
    metaAdsMock.objectiveForGoal.mockReturnValue("OUTCOME_TRAFFIC");

    const res = await request(app)
      .patch(`/managed/campaigns/${campaignRow.id}/optimization`)
      .set(getAuthHeaders())
      .send({ goal: "LINK_CLICKS" });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("OUTCOME_SALES");
    expect(metaAdsMock.updateAdSetOptimization).not.toHaveBeenCalled();
  });

  it("404s for a campaign that is not this org's", async () => {
    selected.campaigns = [];
    const res = await request(app)
      .patch(`/managed/campaigns/${campaignRow.id}/optimization`)
      .set(getAuthHeaders())
      .send({ goal: "OFFSITE_CONVERSIONS", customEventType: "PURCHASE" });

    expect(res.status).toBe(404);
  });
});

describe("POST /managed/conversions", () => {
  it("forwards a site conversion to Meta server-side", async () => {
    metaAdsMock.uploadConversions.mockResolvedValue({
      eventsReceived: 1,
      fbtraceId: "A1",
    });

    const res = await request(app)
      .post("/managed/conversions")
      .set(getAuthHeaders())
      .send({
        events: [
          {
            eventName: "Purchase",
            eventTime: 1756166400,
            actionSource: "website",
            userData: { email: "buyer@example.com" },
            customData: { value: 199, currency: "USD" },
          },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ eventsReceived: 1, fbtraceId: "A1" });
    expect(metaAdsMock.uploadConversions).toHaveBeenCalledWith(
      expect.objectContaining({ datasetId: "ds-1", accessToken: "capi-tok" }),
    );
  });

  it("refuses an event with no identifier Meta could match on", async () => {
    const res = await request(app)
      .post("/managed/conversions")
      .set(getAuthHeaders())
      .send({
        events: [
          {
            eventName: "Purchase",
            eventTime: 1756166400,
            userData: {},
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(metaAdsMock.uploadConversions).not.toHaveBeenCalled();
  });

  it("says so when no dataset is configured rather than dropping the conversion", async () => {
    keyServiceMock.getMetaPlatformCredentials.mockResolvedValue({
      ...CREDENTIALS,
      datasetId: null,
    });

    const res = await request(app)
      .post("/managed/conversions")
      .set(getAuthHeaders())
      .send({
        events: [
          {
            eventName: "Purchase",
            eventTime: 1756166400,
            userData: { email: "buyer@example.com" },
          },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("dataset");
  });
});
