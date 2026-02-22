import { describe, it, expect } from "vitest";
import { validateBreakdowns } from "../../src/lib/breakdown-validator.js";

describe("breakdown-validator", () => {
  it("accepts empty breakdowns", () => {
    const result = validateBreakdowns([]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("accepts single valid breakdown", () => {
    expect(validateBreakdowns(["age"]).valid).toBe(true);
    expect(validateBreakdowns(["country"]).valid).toBe(true);
    expect(validateBreakdowns(["publisher_platform"]).valid).toBe(true);
  });

  it("accepts compatible combinations", () => {
    expect(validateBreakdowns(["age", "gender"]).valid).toBe(true);
    expect(validateBreakdowns(["age", "country"]).valid).toBe(true);
    expect(validateBreakdowns(["publisher_platform", "platform_position"]).valid).toBe(true);
    expect(
      validateBreakdowns(["age", "gender", "country"]).valid,
    ).toBe(true);
  });

  it("rejects more than 3 breakdowns", () => {
    const result = validateBreakdowns([
      "age",
      "gender",
      "country",
      "publisher_platform",
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Maximum 3 breakdowns allowed");
  });

  it("rejects unknown breakdowns", () => {
    const result = validateBreakdowns(["age", "not_a_breakdown"]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Unknown breakdown");
  });

  it("rejects creative + demographic combinations", () => {
    const result = validateBreakdowns(["image_asset", "age"]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("cannot be combined");
  });

  it("rejects creative + geographic combinations", () => {
    const result = validateBreakdowns(["video_asset", "country"]);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("cannot be combined");
  });

  it("allows creative breakdowns alone", () => {
    expect(validateBreakdowns(["image_asset"]).valid).toBe(true);
    expect(
      validateBreakdowns(["image_asset", "video_asset"]).valid,
    ).toBe(true);
  });
});
