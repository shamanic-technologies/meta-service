import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));

const servicesMock = vi.hoisted(() => ({
  createRun: vi.fn(),
  addRunCosts: vi.fn(),
  completeRun: vi.fn(),
  registerEmailTemplates: vi.fn(),
}));

const metaAdsMock = vi.hoisted(() => ({
  getCampaignDailySpend: vi.fn(),
}));

vi.mock("../../src/db/index.js", () => ({ db: dbMock, sql: { end: vi.fn() } }));
vi.mock("../../src/lib/services.js", () => servicesMock);
vi.mock("../../src/lib/meta-ads.js", () => metaAdsMock);

const {
  assertUsdSpend,
  ingestCampaignSpend,
  lookbackWindow,
  META_ADS_SPEND_COST_NAME,
} = await import("../../src/services/spend-ingest.js");

type Row = { id: string; declaredCents: number } | undefined;

function primeDb(existing: Row) {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  dbMock.select.mockReturnValue({
    from: () => ({
      where: () => ({ limit: () => Promise.resolve(existing ? [existing] : []) }),
    }),
  });
  dbMock.insert.mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) });
  dbMock.update.mockReturnValue({ set: () => ({ where: updateWhere }) });
  return { updateWhere };
}

const campaign = {
  id: "row-1",
  orgId: "org-1",
  userId: "user-1",
  brandId: "brand-1",
  campaignId: "camp-1",
  featureSlug: "meta-ads",
  metaCampaignId: "23842",
} as never;

const credentials = { accessToken: "tok", appSecret: "sec" };

beforeEach(() => {
  vi.clearAllMocks();
  servicesMock.createRun.mockResolvedValue({ id: "run-1" });
  servicesMock.addRunCosts.mockResolvedValue(undefined);
  servicesMock.completeRun.mockResolvedValue(undefined);
});

describe("lookback window", () => {
  it("ends today and reaches back the requested number of days", () => {
    const window = lookbackWindow(new Date("2026-08-26T10:00:00Z"), 7);
    expect(window).toEqual({ since: "2026-08-19", until: "2026-08-26" });
  });
});

describe("currency", () => {
  it("refuses to price non-USD spend as USD cents", () => {
    expect(() => assertUsdSpend("EUR", "23842")).toThrow(/EUR/);
    expect(() => assertUsdSpend("USD", "23842")).not.toThrow();
  });
});

describe("spend declaration", () => {
  it("declares the whole amount the first time a day is seen", async () => {
    primeDb(undefined);
    metaAdsMock.getCampaignDailySpend.mockResolvedValue([
      { date: "2026-08-25", spendCents: 1234, currency: "USD" },
    ]);

    const result = await ingestCampaignSpend(
      campaign,
      { since: "2026-08-19", until: "2026-08-26" },
      credentials,
    );

    expect(result).toEqual({ daysObserved: 1, centsDeclared: 1234 });
    expect(servicesMock.createRun).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        userId: "user-1",
        brandId: "brand-1",
        campaignId: "camp-1",
        taskName: "meta-ads-spend:2026-08-25",
      }),
      "meta-ads-spend:23842:2026-08-25",
    );
    expect(servicesMock.addRunCosts).toHaveBeenCalledWith(
      "run-1",
      [
        {
          costName: META_ADS_SPEND_COST_NAME,
          quantity: 1234,
          costSource: "platform",
          status: "actual",
        },
      ],
      "23842:2026-08-25:1234",
    );
    expect(servicesMock.completeRun).toHaveBeenCalledWith("run-1", "completed");
  });

  it("declares only the difference when Meta revises a day upward", async () => {
    primeDb({ id: "spend-1", declaredCents: 1000 });
    metaAdsMock.getCampaignDailySpend.mockResolvedValue([
      { date: "2026-08-25", spendCents: 1500, currency: "USD" },
    ]);

    const result = await ingestCampaignSpend(
      campaign,
      { since: "2026-08-19", until: "2026-08-26" },
      credentials,
    );

    expect(result.centsDeclared).toBe(500);
    expect(servicesMock.addRunCosts).toHaveBeenCalledWith(
      "run-1",
      [expect.objectContaining({ quantity: 500 })],
      "23842:2026-08-25:1500",
    );
  });

  it("declares nothing again when the day has not moved", async () => {
    primeDb({ id: "spend-1", declaredCents: 1500 });
    metaAdsMock.getCampaignDailySpend.mockResolvedValue([
      { date: "2026-08-25", spendCents: 1500, currency: "USD" },
    ]);

    const result = await ingestCampaignSpend(
      campaign,
      { since: "2026-08-19", until: "2026-08-26" },
      credentials,
    );

    expect(result.centsDeclared).toBe(0);
    expect(servicesMock.createRun).not.toHaveBeenCalled();
  });

  it("keeps the declared amount when Meta revises a day downward", async () => {
    const { updateWhere } = primeDb({ id: "spend-1", declaredCents: 1500 });
    metaAdsMock.getCampaignDailySpend.mockResolvedValue([
      { date: "2026-08-25", spendCents: 900, currency: "USD" },
    ]);

    const result = await ingestCampaignSpend(
      campaign,
      { since: "2026-08-19", until: "2026-08-26" },
      credentials,
    );

    expect(result.centsDeclared).toBe(0);
    expect(servicesMock.addRunCosts).not.toHaveBeenCalled();
    expect(updateWhere).toHaveBeenCalled();
  });

  it("fails the run and propagates when the cost cannot be declared", async () => {
    primeDb(undefined);
    metaAdsMock.getCampaignDailySpend.mockResolvedValue([
      { date: "2026-08-25", spendCents: 700, currency: "USD" },
    ]);
    servicesMock.addRunCosts.mockRejectedValue(
      new Error("runs-service 422 Unknown cost name"),
    );

    await expect(
      ingestCampaignSpend(
        campaign,
        { since: "2026-08-19", until: "2026-08-26" },
        credentials,
      ),
    ).rejects.toThrow(/Unknown cost name/);

    expect(servicesMock.completeRun).toHaveBeenCalledWith(
      "run-1",
      "failed",
      "runs-service 422 Unknown cost name",
    );
    // Nothing was written as declared, so the next pass retries the same delta.
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it("refuses a non-USD account rather than mis-pricing it", async () => {
    primeDb(undefined);
    metaAdsMock.getCampaignDailySpend.mockResolvedValue([
      { date: "2026-08-25", spendCents: 700, currency: "EUR" },
    ]);

    await expect(
      ingestCampaignSpend(
        campaign,
        { since: "2026-08-19", until: "2026-08-26" },
        credentials,
      ),
    ).rejects.toThrow(/EUR/);
  });
});
