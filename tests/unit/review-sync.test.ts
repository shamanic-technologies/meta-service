import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMock = vi.hoisted(() => ({ select: vi.fn(), update: vi.fn() }));
const metaAdsMock = vi.hoisted(() => ({
  getAdReviewState: vi.fn(),
  TERMINAL_REVIEW_STATUSES: new Set([
    "ACTIVE",
    "DISAPPROVED",
    "WITH_ISSUES",
    "CAMPAIGN_PAUSED",
    "ADSET_PAUSED",
    "DELETED",
    "ARCHIVED",
  ]),
  REJECTED_REVIEW_STATUSES: new Set(["DISAPPROVED", "WITH_ISSUES"]),
}));
const keyServiceMock = vi.hoisted(() => ({
  getMetaPlatformCredentials: vi.fn(),
}));

vi.mock("../../src/db/index.js", () => ({ db: dbMock, sql: { end: vi.fn() } }));
vi.mock("../../src/lib/meta-ads.js", () => metaAdsMock);
vi.mock("../../src/lib/key-service.js", () => keyServiceMock);

const { runReviewSync, isRejected, isTerminal, PENDING_REVIEW_STATUSES } =
  await import("../../src/services/review-sync.js");

function primePending(ads: Array<{ id: string; metaAdId: string }>) {
  dbMock.select.mockReturnValue({
    from: () => ({ where: () => Promise.resolve(ads) }),
  });
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  dbMock.update.mockReturnValue({ set });
  return { set, where };
}

beforeEach(() => {
  vi.clearAllMocks();
  keyServiceMock.getMetaPlatformCredentials.mockResolvedValue({
    accessToken: "tok",
    appSecret: "sec",
  });
});

describe("pending set", () => {
  it("keeps asking only about ads Meta has not decided on", () => {
    expect(PENDING_REVIEW_STATUSES).toContain("PENDING_REVIEW");
    expect(PENDING_REVIEW_STATUSES).not.toContain("DISAPPROVED");
    expect(PENDING_REVIEW_STATUSES).not.toContain("ACTIVE");
  });

  it("classifies a verdict", () => {
    expect(isTerminal("ACTIVE")).toBe(true);
    expect(isTerminal("PENDING_REVIEW")).toBe(false);
    expect(isRejected("DISAPPROVED")).toBe(true);
    expect(isRejected("ACTIVE")).toBe(false);
  });
});

describe("review sync", () => {
  it("does nothing, and resolves no credentials, when nothing is pending", async () => {
    primePending([]);
    const summary = await runReviewSync();
    expect(summary.adsChecked).toBe(0);
    expect(keyServiceMock.getMetaPlatformCredentials).not.toHaveBeenCalled();
  });

  it("records a rejection with Meta's own feedback", async () => {
    const { set } = primePending([{ id: "ad-row", metaAdId: "1234" }]);
    metaAdsMock.getAdReviewState.mockResolvedValue({
      adId: "1234",
      effectiveStatus: "DISAPPROVED",
      configuredStatus: "ACTIVE",
      reviewFeedback: { global: { UNREALISTIC_CLAIMS: "..." } },
    });

    const summary = await runReviewSync();

    expect(summary).toMatchObject({
      adsChecked: 1,
      adsSettled: 1,
      adsRejected: 1,
      errors: [],
    });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        reviewStatus: "DISAPPROVED",
        reviewFeedback: { global: { UNREALISTIC_CLAIMS: "..." } },
      }),
    );
  });

  it("records an approval without calling it settled twice", async () => {
    primePending([{ id: "ad-row", metaAdId: "1234" }]);
    metaAdsMock.getAdReviewState.mockResolvedValue({
      adId: "1234",
      effectiveStatus: "ACTIVE",
      configuredStatus: "ACTIVE",
      reviewFeedback: null,
    });

    const summary = await runReviewSync();
    expect(summary).toMatchObject({ adsSettled: 1, adsRejected: 0 });
  });

  it("isolates a failing ad and keeps the error rather than reporting success", async () => {
    primePending([
      { id: "ad-a", metaAdId: "1" },
      { id: "ad-b", metaAdId: "2" },
    ]);
    metaAdsMock.getAdReviewState
      .mockRejectedValueOnce(new Error("Meta API read failed: [190] token"))
      .mockResolvedValueOnce({
        adId: "2",
        effectiveStatus: "ACTIVE",
        configuredStatus: "ACTIVE",
        reviewFeedback: null,
      });

    const summary = await runReviewSync();
    expect(summary.adsChecked).toBe(1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0]).toContain("1: Meta API read failed");
  });
});
