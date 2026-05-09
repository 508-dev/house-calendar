import { describe, expect, test } from "bun:test";
import { appConfigSchema, getDefaultSiteId, getSiteConfig } from "./config";

const baseSiteConfig = {
  calendars: [
    {
      envVar: "ICS_URL_1",
      id: "primary",
      label: "Primary calendar",
      provider: "ics",
    },
  ],
  inference: {
    carryForwardDays: 0,
    defaultPresence: "unknown",
  },
  people: [
    {
      aliases: [],
      defaultRoomId: "guest-room",
      id: "michael",
      name: "Michael",
      visibility: "visible",
    },
  ],
  rooms: [
    {
      aliases: ["guest room"],
      id: "guest-room",
      name: "Guest room",
    },
  ],
  rules: [],
  sharePolicies: [
    {
      canRequest: false,
      name: "view-only",
      scope: "view",
    },
  ],
  site: {
    branding: {
      title: "Tokyo House",
    },
    houseName: "Tokyo House",
    id: "tokyo",
    timezone: "Asia/Tokyo",
  },
  visibleHousemateIds: ["michael"],
};

const baseConfig = {
  sites: [baseSiteConfig],
};

describe("appConfigSchema", () => {
  test("defaults viewer access to public", () => {
    const parsed = appConfigSchema.parse(baseConfig);

    expect(parsed.viewerAccess.mode).toBe("public");
  });

  test("defaults admin login protection policy", () => {
    const parsed = appConfigSchema.parse(baseConfig);

    expect(parsed.adminSecurity).toEqual({
      loginChallenge: {
        afterFailures: 3,
        mode: "off",
        provider: "turnstile",
      },
      loginThrottle: {
        enabled: true,
        failureDelayMs: 500,
        lockoutMinutes: 15,
        maxEmailFailures: 8,
        maxEmailIpFailures: 5,
        maxIpDailyFailures: 120,
        maxIpFailures: 30,
        windowMinutes: 15,
      },
    });
  });

  test("accepts custom admin login protection policy", () => {
    const parsed = appConfigSchema.parse({
      ...baseConfig,
      adminSecurity: {
        loginChallenge: {
          afterFailures: 2,
          mode: "after_failures",
        },
        loginThrottle: {
          maxEmailFailures: 4,
          windowMinutes: 10,
        },
      },
    });

    expect(parsed.adminSecurity.loginChallenge).toEqual({
      afterFailures: 2,
      mode: "after_failures",
      provider: "turnstile",
    });
    expect(parsed.adminSecurity.loginThrottle).toMatchObject({
      enabled: true,
      maxEmailFailures: 4,
      windowMinutes: 10,
    });
  });

  test("accepts app-relative favicon paths in branding", () => {
    const parsed = appConfigSchema.parse({
      ...baseConfig,
      sites: [
        {
          ...baseSiteConfig,
          site: {
            ...baseSiteConfig.site,
            branding: {
              ...baseSiteConfig.site.branding,
              faviconPath: "/branding/default/favicon.png",
            },
          },
        },
      ],
    });

    expect(parsed.sites[0]?.site.branding.faviconPath).toBe(
      "/branding/default/favicon.png",
    );
  });

  test("rejects external favicon paths in branding", () => {
    expect(() =>
      appConfigSchema.parse({
        ...baseConfig,
        sites: [
          {
            ...baseSiteConfig,
            site: {
              ...baseSiteConfig.site,
              branding: {
                ...baseSiteConfig.site.branding,
                faviconPath: "https://example.com/favicon.png",
              },
            },
          },
        ],
      }),
    ).toThrow(/faviconPath must be an app-relative path/);
  });

  test("accepts password-protected viewer access", () => {
    const parsed = appConfigSchema.parse({
      ...baseConfig,
      viewerAccess: {
        mode: "password",
      },
    });

    expect(parsed.viewerAccess.mode).toBe("password");
  });

  test("defaults all-day end date mode to calendar_days", () => {
    const parsed = appConfigSchema.parse(baseConfig);

    expect(parsed.sites[0]?.calendarInterpretation.allDayEndDateMode).toBe(
      "calendar_days",
    );
  });

  test("accepts checkout_day all-day end date mode", () => {
    const parsed = appConfigSchema.parse({
      ...baseConfig,
      sites: [
        {
          ...baseSiteConfig,
          calendarInterpretation: {
            allDayEndDateMode: "checkout_day",
          },
        },
      ],
    });

    expect(parsed.sites[0]?.calendarInterpretation.allDayEndDateMode).toBe(
      "checkout_day",
    );
  });

  test("defaults timed note display settings", () => {
    const parsed = appConfigSchema.parse(baseConfig);

    expect(parsed.sites[0]?.calendarDisplay.timedNotes).toEqual({
      enabled: true,
      showTime: true,
      textSource: "title",
    });
  });

  test("accepts custom timed note display settings", () => {
    const parsed = appConfigSchema.parse({
      ...baseConfig,
      sites: [
        {
          ...baseSiteConfig,
          calendarDisplay: {
            timedNotes: {
              enabled: true,
              showTime: false,
              textSource: "title_then_description",
            },
          },
        },
      ],
    });

    expect(parsed.sites[0]?.calendarDisplay.timedNotes).toEqual({
      enabled: true,
      showTime: false,
      textSource: "title_then_description",
    });
  });

  test("accepts multiple sites and resolves the default site", () => {
    const parsed = appConfigSchema.parse({
      ...baseConfig,
      defaultSiteId: "taiwan",
      sites: [
        baseSiteConfig,
        {
          ...baseSiteConfig,
          site: {
            ...baseSiteConfig.site,
            houseName: "Taiwan House",
            id: "taiwan",
            timezone: "Asia/Taipei",
          },
        },
      ],
    });

    expect(getDefaultSiteId(parsed)).toBe("taiwan");
    expect(getSiteConfig(parsed, "taiwan")?.site.houseName).toBe(
      "Taiwan House",
    );
  });

  test("rejects duplicate site ids", () => {
    expect(() =>
      appConfigSchema.parse({
        ...baseConfig,
        sites: [
          baseSiteConfig,
          {
            ...baseSiteConfig,
          },
        ],
      }),
    ).toThrow(/Duplicate site id/);
  });

  test("rejects site ids that are not route-safe slugs", () => {
    expect(() =>
      appConfigSchema.parse({
        ...baseConfig,
        sites: [
          {
            ...baseSiteConfig,
            site: {
              ...baseSiteConfig.site,
              id: "tokyo/main",
            },
          },
        ],
      }),
    ).toThrow(/lowercase URL slug/);
  });

  test('rejects reserved site ids such as "admin"', () => {
    expect(() =>
      appConfigSchema.parse({
        ...baseConfig,
        sites: [
          {
            ...baseSiteConfig,
            site: {
              ...baseSiteConfig.site,
              id: "admin",
            },
          },
        ],
      }),
    ).toThrow(/reserved/);
  });

  test("rejects unknown defaultSiteId", () => {
    expect(() =>
      appConfigSchema.parse({
        ...baseConfig,
        defaultSiteId: "missing-site",
      }),
    ).toThrow(/Unknown defaultSiteId/);
  });

  test("rejects blank defaultSiteId", () => {
    expect(() =>
      appConfigSchema.parse({
        ...baseConfig,
        defaultSiteId: "",
      }),
    ).toThrow();
  });

  test("rejects calendar entries with both envVar and url", () => {
    expect(() =>
      appConfigSchema.parse({
        ...baseConfig,
        sites: [
          {
            ...baseSiteConfig,
            calendars: [
              {
                envVar: "ICS_URL_1",
                id: "primary",
                label: "Primary calendar",
                provider: "ics",
                url: "https://example.com/calendar.ics",
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });

  test("rejects unknown default room ids for people", () => {
    expect(() =>
      appConfigSchema.parse({
        ...baseConfig,
        sites: [
          {
            ...baseSiteConfig,
            people: [
              {
                aliases: [],
                defaultRoomId: "missing-room",
                id: "michael",
                name: "Michael",
                visibility: "visible",
              },
            ],
          },
        ],
      }),
    ).toThrow(/defaultRoomId/);
  });
});
