import { describe, expect, test } from "bun:test";
import {
  getLoginProtectionDecision,
  hasRecentThresholdCrossing,
  isAdminLoginProtectionFullyDisabled,
} from "./login-protection";

function baseFailures() {
  return {
    emailFailures: 0,
    emailIpFailures: 0,
    emailIpLockedOut: false,
    emailLockedOut: false,
    ipDailyFailures: 0,
    ipDailyLockedOut: false,
    ipFailures: 0,
    ipLockedOut: false,
  };
}

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

describe("getLoginProtectionDecision", () => {
  test("requires a challenge after the configured failure threshold", () => {
    expect(
      getLoginProtectionDecision({
        challengeAfterFailures: 3,
        challengeMode: "after_failures",
        failures: {
          ...baseFailures(),
          emailFailures: 3,
        },
        throttleEnabled: true,
      }),
    ).toEqual({
      challengeRequired: true,
      lockedOut: false,
    });
  });

  test("does not require challenges when challenge mode is off", () => {
    expect(
      getLoginProtectionDecision({
        challengeAfterFailures: 3,
        challengeMode: "off",
        failures: {
          ...baseFailures(),
          emailFailures: 99,
        },
        throttleEnabled: true,
      }).challengeRequired,
    ).toBe(false);
  });

  test("locks out only when throttling is enabled", () => {
    expect(
      getLoginProtectionDecision({
        challengeAfterFailures: 3,
        challengeMode: "off",
        failures: {
          ...baseFailures(),
          emailLockedOut: true,
        },
        throttleEnabled: false,
      }).lockedOut,
    ).toBe(false);

    expect(
      getLoginProtectionDecision({
        challengeAfterFailures: 3,
        challengeMode: "off",
        failures: {
          ...baseFailures(),
          emailLockedOut: true,
        },
        throttleEnabled: true,
      }).lockedOut,
    ).toBe(true);
  });
});

describe("isAdminLoginProtectionFullyDisabled", () => {
  test("short-circuits only when throttle and challenge are both off", () => {
    expect(
      isAdminLoginProtectionFullyDisabled({
        loginChallenge: {
          afterFailures: 3,
          mode: "off",
          provider: "turnstile",
        },
        loginThrottle: {
          enabled: false,
          failureDelayMs: 0,
          lockoutMinutes: 15,
          maxEmailFailures: 8,
          maxEmailIpFailures: 5,
          maxIpDailyFailures: 120,
          maxIpFailures: 30,
          windowMinutes: 15,
        },
      }),
    ).toBe(true);

    expect(
      isAdminLoginProtectionFullyDisabled({
        loginChallenge: {
          afterFailures: 3,
          mode: "always",
          provider: "turnstile",
        },
        loginThrottle: {
          enabled: false,
          failureDelayMs: 0,
          lockoutMinutes: 15,
          maxEmailFailures: 8,
          maxEmailIpFailures: 5,
          maxIpDailyFailures: 120,
          maxIpFailures: 30,
          windowMinutes: 15,
        },
      }),
    ).toBe(false);
  });
});
