import { describe, it, expect, beforeEach } from "vitest";
import {
  parseUsageHeader,
  isNearLimit,
  recordLimits,
  getLimits,
} from "../../src/lib/rate-limiter.js";

describe("rate-limiter", () => {
  describe("parseUsageHeader", () => {
    it("returns empty object for null header", () => {
      expect(parseUsageHeader(null)).toEqual({});
    });

    it("returns empty object for invalid JSON", () => {
      expect(parseUsageHeader("not-json")).toEqual({});
    });

    it("parses valid usage header", () => {
      const header = JSON.stringify({
        "act_123": [
          {
            call_count: 50,
            total_cputime: 30,
            total_time: 40,
            type: "ads_insights",
            estimated_time_to_regain_access: 0,
          },
        ],
      });

      const result = parseUsageHeader(header);
      expect(result).toHaveProperty("act_123");
      expect(result["act_123"]).toHaveLength(1);
      expect(result["act_123"][0].callCount).toBe(50);
      expect(result["act_123"][0].totalCpuTime).toBe(30);
      expect(result["act_123"][0].totalTime).toBe(40);
      expect(result["act_123"][0].type).toBe("ads_insights");
    });
  });

  describe("isNearLimit", () => {
    it("returns false when all metrics are below threshold", () => {
      expect(
        isNearLimit([
          {
            callCount: 50,
            totalCpuTime: 40,
            totalTime: 30,
            type: "ads_insights",
            estimatedTimeToRegainAccess: 0,
          },
        ]),
      ).toBe(false);
    });

    it("returns true when callCount exceeds threshold", () => {
      expect(
        isNearLimit([
          {
            callCount: 85,
            totalCpuTime: 10,
            totalTime: 10,
            type: "ads_insights",
            estimatedTimeToRegainAccess: 0,
          },
        ]),
      ).toBe(true);
    });

    it("returns true when totalCpuTime exceeds threshold", () => {
      expect(
        isNearLimit([
          {
            callCount: 10,
            totalCpuTime: 90,
            totalTime: 10,
            type: "ads_insights",
            estimatedTimeToRegainAccess: 0,
          },
        ]),
      ).toBe(true);
    });

    it("uses custom threshold", () => {
      expect(
        isNearLimit(
          [
            {
              callCount: 60,
              totalCpuTime: 10,
              totalTime: 10,
              type: "ads_insights",
              estimatedTimeToRegainAccess: 0,
            },
          ],
          50,
        ),
      ).toBe(true);
    });
  });

  describe("recordLimits / getLimits", () => {
    beforeEach(() => {
      // Clear by recording for a unique key
    });

    it("stores and retrieves limits", () => {
      const limits = [
        {
          callCount: 50,
          totalCpuTime: 30,
          totalTime: 40,
          type: "ads_insights",
          estimatedTimeToRegainAccess: 0,
        },
      ];

      recordLimits("act_test_1", limits);
      const retrieved = getLimits("act_test_1");
      expect(retrieved).toEqual(limits);
    });

    it("returns null for unknown account", () => {
      expect(getLimits("act_unknown")).toBeNull();
    });
  });
});
