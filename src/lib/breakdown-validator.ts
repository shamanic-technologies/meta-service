export const VALID_BREAKDOWNS = [
  "age",
  "gender",
  "country",
  "region",
  "publisher_platform",
  "platform_position",
  "device_platform",
  "image_asset",
  "video_asset",
  "title_asset",
  "body_asset",
  "product_id",
] as const;

export type Breakdown = (typeof VALID_BREAKDOWNS)[number];

// Creative asset breakdowns cannot be combined with demographic or geographic breakdowns
const CREATIVE_BREAKDOWNS: ReadonlySet<string> = new Set([
  "image_asset",
  "video_asset",
  "title_asset",
  "body_asset",
]);

const DEMOGRAPHIC_BREAKDOWNS: ReadonlySet<string> = new Set([
  "age",
  "gender",
]);

const GEO_BREAKDOWNS: ReadonlySet<string> = new Set(["country", "region"]);

export interface BreakdownValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateBreakdowns(
  breakdowns: string[],
): BreakdownValidationResult {
  const errors: string[] = [];

  // Max 3 breakdowns
  if (breakdowns.length > 3) {
    errors.push("Maximum 3 breakdowns allowed");
  }

  // Check each breakdown is valid
  const validSet = new Set<string>(VALID_BREAKDOWNS);
  for (const b of breakdowns) {
    if (!validSet.has(b)) {
      errors.push(`Unknown breakdown: "${b}"`);
    }
  }

  // Check creative + demographic incompatibility
  const hasCreative = breakdowns.some((b) => CREATIVE_BREAKDOWNS.has(b));
  const hasDemographic = breakdowns.some((b) => DEMOGRAPHIC_BREAKDOWNS.has(b));
  const hasGeo = breakdowns.some((b) => GEO_BREAKDOWNS.has(b));

  if (hasCreative && hasDemographic) {
    errors.push(
      "Creative asset breakdowns (image_asset, video_asset, title_asset, body_asset) cannot be combined with demographic breakdowns (age, gender)",
    );
  }

  if (hasCreative && hasGeo) {
    errors.push(
      "Creative asset breakdowns cannot be combined with geographic breakdowns (country, region)",
    );
  }

  return { valid: errors.length === 0, errors };
}
