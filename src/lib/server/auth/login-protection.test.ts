import { describe, expect, test } from "bun:test";
import { hasRecentThresholdCrossing } from "./login-protection";

describe("hasRecentThresholdCrossing", () => {
  test("honors lockout duration after a threshold is crossed", () => {
    const minute = 60 * 1000;
    const nowMs = 100 * minute;

    expect(
      hasRecentThresholdCrossing({
        limit: 3,
        lockoutMs: 60 * minute,
        nowMs,
        timestampsMs: [40, 41, 42].map((value) => value * minute),
        windowMs: 15 * minute,
      }),
    ).toBe(true);
  });

  test("does not lock out when the threshold crossing is older than lockout", () => {
    const minute = 60 * 1000;
    const nowMs = 100 * minute;

    expect(
      hasRecentThresholdCrossing({
        limit: 3,
        lockoutMs: 30 * minute,
        nowMs,
        timestampsMs: [40, 41, 42].map((value) => value * minute),
        windowMs: 15 * minute,
      }),
    ).toBe(false);
  });

  test("does not lock out when failures never cross the limit inside the window", () => {
    const minute = 60 * 1000;
    const nowMs = 100 * minute;

    expect(
      hasRecentThresholdCrossing({
        limit: 3,
        lockoutMs: 60 * minute,
        nowMs,
        timestampsMs: [40, 60, 80].map((value) => value * minute),
        windowMs: 15 * minute,
      }),
    ).toBe(false);
  });
});
