import { z } from "zod";
import {
  houseConfigSchema,
  inferenceSchema,
  parserRuleSchema,
  roomSchema,
  sharePolicySchema,
} from "@/lib/house/types";

const siteIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      "Site id must be a lowercase URL slug containing only letters, numbers, and hyphens.",
  })
  .refine((value) => value !== "admin", {
    message: 'Site id "admin" is reserved.',
  });

const instancePersonSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  defaultRoomId: z.string().optional(),
  visibility: z.enum(["visible", "masked"]),
});

const instanceSiteSchema = z.object({
  id: siteIdSchema,
  houseName: z.string(),
  ownerName: z.string().optional(),
  timezone: z.string(),
  branding: z.object({
    title: z.string(),
    description: z.string().optional(),
    faviconPath: z
      .string()
      .regex(/^\/(?!\/).+/, {
        message:
          "faviconPath must be an app-relative path like /branding/default/favicon.png.",
      })
      .optional(),
    themeColor: z.string().optional(),
    logoUrl: z.string().optional(),
  }),
});

const viewerAccessSchema = z.object({
  mode: z.enum(["public", "password"]).default("public"),
});

const adminSecuritySchema = z
  .object({
    loginThrottle: z
      .object({
        enabled: z.boolean().default(true),
        failureDelayMs: z.number().int().min(0).default(500),
        lockoutMinutes: z.number().int().positive().default(15),
        maxEmailFailures: z.number().int().positive().default(8),
        maxEmailIpFailures: z.number().int().positive().default(5),
        maxIpDailyFailures: z.number().int().positive().default(120),
        maxIpFailures: z.number().int().positive().default(30),
        windowMinutes: z.number().int().positive().default(15),
      })
      .default({
        enabled: true,
        failureDelayMs: 500,
        lockoutMinutes: 15,
        maxEmailFailures: 8,
        maxEmailIpFailures: 5,
        maxIpDailyFailures: 120,
        maxIpFailures: 30,
        windowMinutes: 15,
      }),
    loginChallenge: z
      .object({
        afterFailures: z.number().int().positive().default(3),
        mode: z.enum(["off", "always", "after_failures"]).default("off"),
        provider: z.enum(["turnstile"]).default("turnstile"),
      })
      .default({
        afterFailures: 3,
        mode: "off",
        provider: "turnstile",
      }),
  })
  .default({
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
    loginChallenge: {
      afterFailures: 3,
      mode: "off",
      provider: "turnstile",
    },
  });

const calendarInterpretationSchema = z
  .object({
    allDayEndDateMode: z
      .enum(["calendar_days", "checkout_day"])
      .default("calendar_days"),
  })
  .default({
    allDayEndDateMode: "calendar_days",
  });

const timedNotesDisplaySchema = z
  .object({
    enabled: z.boolean().default(true),
    showTime: z.boolean().default(true),
    textSource: z
      .enum(["title", "description", "title_then_description"])
      .default("title"),
  })
  .default({
    enabled: true,
    showTime: true,
    textSource: "title",
  });

const calendarDisplaySchema = z
  .object({
    timedNotes: timedNotesDisplaySchema,
  })
  .default({
    timedNotes: {
      enabled: true,
      showTime: true,
      textSource: "title",
    },
  });

const instanceCalendarSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: z.enum(["ics"]),
});

const instanceCalendarEnvSchema = instanceCalendarSchema
  .extend({
    envVar: z.string(),
  })
  .strict();

const instanceCalendarUrlSchema = instanceCalendarSchema
  .extend({
    url: z.url(),
  })
  .strict();

export const appCalendarSchema = z.union([
  instanceCalendarEnvSchema,
  instanceCalendarUrlSchema,
]);

export const siteConfigSchema = z
  .object({
    site: instanceSiteSchema,
    calendarInterpretation: calendarInterpretationSchema,
    calendarDisplay: calendarDisplaySchema,
    calendars: z.array(appCalendarSchema).min(1),
    rooms: z.array(roomSchema),
    people: z.array(instancePersonSchema),
    visibleHousemateIds: z.array(z.string()).default([]),
    sharePolicies: z.array(sharePolicySchema),
    inference: inferenceSchema,
    rules: z.array(parserRuleSchema),
  })
  .superRefine((config, ctx) => {
    const roomIds = new Set(config.rooms.map((room) => room.id));

    for (const [index, person] of config.people.entries()) {
      if (person.defaultRoomId && !roomIds.has(person.defaultRoomId)) {
        ctx.addIssue({
          code: "custom",
          message: `Unknown defaultRoomId "${person.defaultRoomId}" for person.`,
          path: ["people", index, "defaultRoomId"],
        });
      }
    }
  });

export const appConfigSchema = z
  .object({
    adminSecurity: adminSecuritySchema,
    defaultSiteId: z.string().min(1).optional(),
    viewerAccess: viewerAccessSchema.default({ mode: "public" }),
    sites: z.array(siteConfigSchema).min(1),
  })
  .superRefine((config, ctx) => {
    const siteIds = new Set<string>();

    for (const [index, siteConfig] of config.sites.entries()) {
      const siteId = siteConfig.site.id;

      if (siteIds.has(siteId)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate site id "${siteId}".`,
          path: ["sites", index, "site", "id"],
        });
      }

      siteIds.add(siteId);
    }

    if (config.defaultSiteId && !siteIds.has(config.defaultSiteId)) {
      ctx.addIssue({
        code: "custom",
        message: `Unknown defaultSiteId "${config.defaultSiteId}".`,
        path: ["defaultSiteId"],
      });
    }
  });

export type AppConfig = z.infer<typeof appConfigSchema>;
export type AppCalendar = z.infer<typeof appCalendarSchema>;
export type AdminSecurityConfig = z.infer<typeof adminSecuritySchema>;
export type SiteConfig = z.infer<typeof siteConfigSchema>;

export function getDefaultSiteId(configInput: AppConfig): string {
  const config = appConfigSchema.parse(configInput);
  return config.defaultSiteId ?? config.sites[0]?.site.id ?? "";
}

export function getSiteConfig(
  configInput: AppConfig,
  siteId: string,
): SiteConfig | undefined {
  const config = appConfigSchema.parse(configInput);
  return config.sites.find((siteConfig) => siteConfig.site.id === siteId);
}

export function configToHouseConfig(configInput: SiteConfig) {
  const config = siteConfigSchema.parse(configInput);

  return houseConfigSchema.parse({
    id: config.site.id,
    name: config.site.houseName,
    timezone: config.site.timezone,
    rooms: config.rooms,
    people: config.people.map((person) => ({
      id: person.id,
      name: person.name,
      aliases: person.aliases,
      defaultRoomId: person.defaultRoomId,
      publicVisibility: person.visibility,
    })),
    visibleHousemateIds: config.visibleHousemateIds,
    sharePolicies: config.sharePolicies,
    inference: config.inference,
    rules: config.rules,
  });
}
