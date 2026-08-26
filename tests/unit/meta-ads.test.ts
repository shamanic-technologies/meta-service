import { describe, it, expect } from "vitest";
import crypto from "crypto";
import {
  buildConversionUserData,
  buildPromotedObject,
  buildTargeting,
  goalsForObjective,
  objectiveForGoal,
  REJECTED_REVIEW_STATUSES,
  TERMINAL_REVIEW_STATUSES,
} from "../../src/lib/meta-ads.js";

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

describe("objective mapping", () => {
  it("derives the campaign objective from the optimisation goal", () => {
    expect(objectiveForGoal("OFFSITE_CONVERSIONS")).toBe("OUTCOME_SALES");
    expect(objectiveForGoal("LEAD_GENERATION")).toBe("OUTCOME_LEADS");
    expect(objectiveForGoal("LINK_CLICKS")).toBe("OUTCOME_TRAFFIC");
    expect(objectiveForGoal("LANDING_PAGE_VIEWS")).toBe("OUTCOME_TRAFFIC");
    expect(objectiveForGoal("REACH")).toBe("OUTCOME_AWARENESS");
  });

  it("lists the goals reachable without creating a new campaign", () => {
    expect(goalsForObjective("OUTCOME_TRAFFIC")).toEqual([
      "LINK_CLICKS",
      "LANDING_PAGE_VIEWS",
    ]);
    expect(goalsForObjective("OUTCOME_SALES")).toEqual(["OFFSITE_CONVERSIONS"]);
  });
});

describe("promoted object", () => {
  it("points a conversion goal at the dataset and the event", () => {
    expect(
      buildPromotedObject({
        goal: "OFFSITE_CONVERSIONS",
        datasetId: "ds-1",
        customEventType: "PURCHASE",
        pageId: "page-1",
      }),
    ).toEqual({ pixel_id: "ds-1", custom_event_type: "PURCHASE" });
  });

  it("refuses a conversion goal with no dataset instead of dropping it", () => {
    expect(() =>
      buildPromotedObject({
        goal: "OFFSITE_CONVERSIONS",
        datasetId: null,
        customEventType: "PURCHASE",
        pageId: "page-1",
      }),
    ).toThrow(/dataset/i);
  });

  it("refuses a conversion goal with no event to optimise on", () => {
    expect(() =>
      buildPromotedObject({
        goal: "OFFSITE_CONVERSIONS",
        datasetId: "ds-1",
        customEventType: null,
        pageId: "page-1",
      }),
    ).toThrow(/customEventType/);
  });

  it("points lead generation at the page and leaves traffic goals bare", () => {
    expect(
      buildPromotedObject({
        goal: "LEAD_GENERATION",
        datasetId: null,
        customEventType: null,
        pageId: "page-1",
      }),
    ).toEqual({ page_id: "page-1" });
    expect(
      buildPromotedObject({
        goal: "LINK_CLICKS",
        datasetId: null,
        customEventType: null,
        pageId: "page-1",
      }),
    ).toBeNull();
  });
});

describe("targeting", () => {
  it("runs on Facebook and Instagram when an Instagram account exists", () => {
    const spec = buildTargeting({ countries: ["US"] }, true);
    expect(spec.publisher_platforms).toEqual(["facebook", "instagram"]);
    expect(spec.geo_locations).toEqual({ countries: ["US"] });
  });

  it("runs on Facebook alone when no Instagram account is configured", () => {
    const spec = buildTargeting({ countries: ["FR"] }, false);
    expect(spec.publisher_platforms).toEqual(["facebook"]);
  });

  it("only sends the optional dimensions that were supplied", () => {
    const spec = buildTargeting(
      { countries: ["US"], ageMin: 25, genders: [] },
      false,
    );
    expect(spec.age_min).toBe(25);
    expect(spec).not.toHaveProperty("age_max");
    expect(spec).not.toHaveProperty("genders");
  });
});

describe("review statuses", () => {
  it("treats a rejection as terminal and as a rejection", () => {
    expect(TERMINAL_REVIEW_STATUSES.has("DISAPPROVED")).toBe(true);
    expect(REJECTED_REVIEW_STATUSES.has("DISAPPROVED")).toBe(true);
  });

  it("does not treat a pending review as settled", () => {
    expect(TERMINAL_REVIEW_STATUSES.has("PENDING_REVIEW")).toBe(false);
  });
});

describe("conversion user data", () => {
  it("hashes the identifying fields and leaves the network ones raw", () => {
    const built = buildConversionUserData({
      email: "  Person@Example.COM ",
      phone: "+1 (555) 010-1234",
      clientIpAddress: "203.0.113.5",
      clientUserAgent: "Mozilla/5.0",
      fbc: "fb.1.123.abc",
    });

    // Normalised (trimmed, lower-cased) before hashing, as Meta requires.
    expect(built.em).toEqual([sha256("person@example.com")]);
    // Punctuation stripped from the phone before hashing.
    expect(built.ph).toEqual([sha256("15550101234")]);
    expect(built.client_ip_address).toBe("203.0.113.5");
    expect(built.client_user_agent).toBe("Mozilla/5.0");
    expect(built.fbc).toBe("fb.1.123.abc");
  });

  it("does not invent fields that were not supplied", () => {
    expect(buildConversionUserData({ email: "a@b.co" })).toEqual({
      em: [expect.stringMatching(/^[0-9a-f]{64}$/)],
    });
  });
});
