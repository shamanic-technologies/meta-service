export interface MetaRateLimit {
  callCount: number;
  totalCpuTime: number;
  totalTime: number;
  type: string;
  estimatedTimeToRegainAccess: number;
}

// In-memory rate limit store, keyed by ad account ID
const limitStore = new Map<string, { limits: MetaRateLimit[]; updatedAt: number }>();

/**
 * Parse the x-business-use-case-usage header from Meta API responses.
 * The header value is a JSON string mapping ad account IDs to usage arrays.
 */
export function parseUsageHeader(
  header: string | null,
): Record<string, MetaRateLimit[]> {
  if (!header) return {};

  try {
    const parsed = JSON.parse(header) as Record<
      string,
      Array<{
        call_count: number;
        total_cputime: number;
        total_time: number;
        type: string;
        estimated_time_to_regain_access: number;
      }>
    >;

    const result: Record<string, MetaRateLimit[]> = {};
    for (const [accountId, usages] of Object.entries(parsed)) {
      result[accountId] = usages.map((u) => ({
        callCount: u.call_count,
        totalCpuTime: u.total_cputime,
        totalTime: u.total_time,
        type: u.type,
        estimatedTimeToRegainAccess: u.estimated_time_to_regain_access,
      }));
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Check if any rate limit metric exceeds the threshold (default 80%).
 */
export function isNearLimit(
  limits: MetaRateLimit[],
  threshold = 80,
): boolean {
  return limits.some(
    (l) =>
      l.callCount >= threshold ||
      l.totalCpuTime >= threshold ||
      l.totalTime >= threshold,
  );
}

/**
 * Record rate limits for an ad account.
 */
export function recordLimits(
  accountId: string,
  limits: MetaRateLimit[],
): void {
  limitStore.set(accountId, { limits, updatedAt: Date.now() });
}

/**
 * Get recorded rate limits for an ad account.
 */
export function getLimits(accountId: string): MetaRateLimit[] | null {
  const entry = limitStore.get(accountId);
  if (!entry) return null;
  // Expire after 5 minutes
  if (Date.now() - entry.updatedAt > 5 * 60 * 1000) {
    limitStore.delete(accountId);
    return null;
  }
  return entry.limits;
}
