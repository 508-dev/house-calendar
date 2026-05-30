import { describe, expect, test } from "bun:test";
import { exampleHouseConfig } from "./sample-data";
import { houseConfigSchema, rawCalendarEventSchema } from "./types";

describe("houseConfigSchema", () => {
  test("rejects invalid parser regex rules", () => {
    const config = structuredClone(exampleHouseConfig);
    config.rules[0] = {
      ...config.rules[0],
      match: "(",
    };

    expect(() => houseConfigSchema.parse(config)).toThrow(
      /Invalid parser rule regex/,
    );
  });

  test("requires roomId for stay.room rules", () => {
    const config = structuredClone(exampleHouseConfig) as Record<
      string,
      unknown
    >;
    const rules = structuredClone(exampleHouseConfig.rules) as Record<
      string,
      unknown
    >[];
    rules.push({
      type: "stay.room",
      match: "stays \\(studio\\)",
      visibility: "private",
    });
    config.rules = rules;

    expect(() => houseConfigSchema.parse(config)).toThrow();
  });

  test("requires valid actorId for presence rules", () => {
    const config = structuredClone(exampleHouseConfig);
    config.rules.push({
      type: "presence.out",
      match: "^ghost out of japan$",
      actorId: "ghost",
      visibility: "public",
    });

    expect(() => houseConfigSchema.parse(config)).toThrow(/Unknown actorId/);
  });

  test("accepts shared-space stay rules without a room id", () => {
    const config = structuredClone(exampleHouseConfig);
    config.rules.push({
      type: "stay.shared_space",
      match: "crashes? \\((couch|sofa|floor)\\)",
      visibility: "private",
    });

    expect(houseConfigSchema.parse(config).rules.at(-1)).toMatchObject({
      type: "stay.shared_space",
    });
  });

  test("rejects unknown visible housemate ids", () => {
    const config = structuredClone(exampleHouseConfig);
    config.visibleHousemateIds = ["michael", "ghost"];

    expect(() => houseConfigSchema.parse(config)).toThrow(
      /Unknown visibleHousemateId/,
    );
  });

  test("rejects invalid timezone identifiers", () => {
    const config = structuredClone(exampleHouseConfig);
    config.timezone = "America/LA";

    expect(() => houseConfigSchema.parse(config)).toThrow(
      /Invalid IANA timezone identifier/,
    );
  });
});

describe("rawCalendarEventSchema", () => {
  test("rejects malformed date strings", () => {
    expect(() =>
      rawCalendarEventSchema.parse({
        id: "evt-invalid-start",
        title: "Someone stays",
        startDate: "not-a-date",
        endDate: "2026-04-20",
        allDay: true,
      }),
    ).toThrow(/Invalid ISO date or datetime/);
  });

  test("requires endDate to be after startDate", () => {
    expect(() =>
      rawCalendarEventSchema.parse({
        id: "evt-invalid-range",
        title: "Someone stays",
        startDate: "2026-04-20",
        endDate: "2026-04-20",
        allDay: true,
      }),
    ).toThrow(/endDate must be after startDate/);
  });
});
