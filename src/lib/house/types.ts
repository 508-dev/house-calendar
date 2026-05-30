import { compareAsc, isValid, parseISO } from "date-fns";
import { z } from "zod";
import { isValidTimeZone } from "./date";

export const visibilitySchema = z.enum(["public", "private"]);
export const personVisibilitySchema = z.enum(["visible", "masked"]);
export const shareScopeSchema = z.enum(["view", "request"]);
export const parserRuleTypeSchema = z.enum([
  "stay.whole_house",
  "stay.room",
  "stay.shared_space",
  "presence.in",
  "presence.out",
]);

export const roomSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).default([]),
});

export const personSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  defaultRoomId: z.string().optional(),
  publicVisibility: personVisibilitySchema,
});

const parserRuleMatchSchema = z.string().superRefine((value, ctx) => {
  try {
    new RegExp(value, "i");
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      message:
        error instanceof Error
          ? `Invalid parser rule regex: ${error.message}`
          : "Invalid parser rule regex.",
    });
  }
});

const parserRuleBaseShape = {
  match: parserRuleMatchSchema,
  visibility: visibilitySchema,
} as const;

export const parserRuleSchema = z.discriminatedUnion("type", [
  z.object({
    ...parserRuleBaseShape,
    type: z.literal("stay.whole_house"),
  }),
  z.object({
    ...parserRuleBaseShape,
    type: z.literal("stay.room"),
    roomId: z.string(),
  }),
  z.object({
    ...parserRuleBaseShape,
    type: z.literal("stay.shared_space"),
  }),
  z.object({
    ...parserRuleBaseShape,
    type: z.literal("presence.in"),
    actorId: z.string(),
  }),
  z.object({
    ...parserRuleBaseShape,
    type: z.literal("presence.out"),
    actorId: z.string(),
  }),
]);

export const sharePolicySchema = z.object({
  name: z.string(),
  scope: shareScopeSchema,
  canRequest: z.boolean(),
});

export const inferenceSchema = z.object({
  defaultPresence: z.enum(["unknown", "infer_last_state"]),
  carryForwardDays: z.number().int().nonnegative(),
});

export const houseConfigSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    timezone: z.string().refine(isValidTimeZone, {
      message: "Invalid IANA timezone identifier.",
    }),
    rooms: z.array(roomSchema),
    people: z.array(personSchema),
    visibleHousemateIds: z.array(z.string()).default([]),
    sharePolicies: z.array(sharePolicySchema),
    rules: z.array(parserRuleSchema),
    inference: inferenceSchema,
  })
  .superRefine((config, ctx) => {
    const roomIds = new Set(config.rooms.map((room) => room.id));
    const personIds = new Set(config.people.map((person) => person.id));

    for (const [
      index,
      visibleHousemateId,
    ] of config.visibleHousemateIds.entries()) {
      if (!personIds.has(visibleHousemateId)) {
        ctx.addIssue({
          code: "custom",
          message: `Unknown visibleHousemateId "${visibleHousemateId}".`,
          path: ["visibleHousemateIds", index],
        });
      }
    }

    for (const [index, rule] of config.rules.entries()) {
      if (rule.type === "stay.room" && !roomIds.has(rule.roomId)) {
        ctx.addIssue({
          code: "custom",
          message: `Unknown roomId "${rule.roomId}" for parser rule.`,
          path: ["rules", index, "roomId"],
        });
      }

      if (
        (rule.type === "presence.in" || rule.type === "presence.out") &&
        !personIds.has(rule.actorId)
      ) {
        ctx.addIssue({
          code: "custom",
          message: `Unknown actorId "${rule.actorId}" for parser rule.`,
          path: ["rules", index, "actorId"],
        });
      }
    }

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

const isoDateTimeSchema = z
  .string()
  .refine((value) => isValid(parseISO(value)), "Invalid ISO date or datetime.");

export const rawCalendarEventSchema = z
  .object({
    id: z.string(),
    description: z.string().optional(),
    title: z.string(),
    startDate: isoDateTimeSchema,
    endDate: isoDateTimeSchema,
    allDay: z.boolean().default(true),
    visibility: visibilitySchema.default("public"),
  })
  .superRefine((event, ctx) => {
    if (compareAsc(parseISO(event.endDate), parseISO(event.startDate)) <= 0) {
      ctx.addIssue({
        code: "custom",
        message: "endDate must be after startDate.",
        path: ["endDate"],
      });
    }
  });

export const parsedCalendarEventTypeSchema = z.enum([
  "stay",
  "presence",
  "unknown",
]);

export const presenceStateSchema = z.enum(["in", "out", "unknown"]);
export const parsedScopeSchema = z.enum([
  "house",
  "room",
  "shared_space",
  "location",
  "unknown",
]);

export const parsedCalendarEventSchema = z.object({
  rawTitle: z.string(),
  normalizedTitle: z.string(),
  type: parsedCalendarEventTypeSchema,
  scope: parsedScopeSchema,
  personId: z.string().optional(),
  guestName: z.string().optional(),
  stayStatus: z.enum(["confirmed", "tentative"]).optional(),
  presenceStatus: z.enum(["confirmed", "tentative"]).optional(),
  roomId: z.string().optional(),
  location: z.string().optional(),
  presenceState: presenceStateSchema.optional(),
  occupiesDefaultRoom: z.boolean().optional(),
  visibility: visibilitySchema,
  confidence: z.number().min(0).max(1),
});

export const dayRoomStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["free", "tentative", "occupied"]),
});

export const dayPresenceSchema = z.object({
  personId: z.string(),
  name: z.string(),
  label: z.string().optional(),
  state: presenceStateSchema,
});

export const dayEventSchema = z.object({
  allDay: z.boolean().default(false),
  description: z.string().optional(),
  id: z.string(),
  endDate: isoDateTimeSchema,
  startDate: isoDateTimeSchema,
  title: z.string(),
});

export const dailyAvailabilitySchema = z.object({
  date: z.string(),
  status: z.enum([
    "available",
    "tentative",
    "partial",
    "unavailable",
    "unknown",
  ]),
  events: z.array(dayEventSchema).default([]),
  rooms: z.array(dayRoomStatusSchema),
  presence: z.array(dayPresenceSchema),
});

export type HouseConfig = z.infer<typeof houseConfigSchema>;
export type RawCalendarEvent = z.infer<typeof rawCalendarEventSchema>;
export type ParsedCalendarEvent = z.infer<typeof parsedCalendarEventSchema>;
export type DailyAvailability = z.infer<typeof dailyAvailabilitySchema>;
