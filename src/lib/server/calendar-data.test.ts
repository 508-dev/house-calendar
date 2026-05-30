import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  appConfigSchema,
  configToHouseConfig,
  getDefaultSiteId,
  getSiteConfig,
} from "@/lib/config/config";
import exampleConfig from "../../../config/config.example.json";

const EMPTY_ICS = `BEGIN:VCALENDAR
VERSION:2.0
END:VCALENDAR
`;

const TIMED_ONLY_ICS = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:cleaner-1
SUMMARY:Cleaner 1pm-3:30pm JST
DTSTART;TZID=Asia/Tokyo:20260429T130000
DTEND;TZID=Asia/Tokyo:20260429T153000
END:VEVENT
BEGIN:VEVENT
UID:test-private-1
CLASS:PRIVATE
SUMMARY:Test Event
DTSTART:20260429T081500Z
DTEND:20260429T111500Z
END:VEVENT
END:VCALENDAR
`;

mock.module("server-only", () => ({}));

const { loadCalendarData } = await import("./calendar-data");

const originalFetch = globalThis.fetch;
const originalNodeEnv = process.env.NODE_ENV;
const appConfig = appConfigSchema.parse(exampleConfig);
const siteId = getDefaultSiteId(appConfig);
const siteConfig = getSiteConfig(appConfig, siteId);

if (!siteConfig) {
  throw new Error("Example config must include the default site.");
}

const houseConfig = configToHouseConfig(siteConfig);
const calendarEnvVar =
  "envVar" in siteConfig.calendars[0] ? siteConfig.calendars[0].envVar : null;
const originalCalendarUrl = calendarEnvVar
  ? process.env[calendarEnvVar]
  : undefined;

function setNodeEnv(value: string | undefined) {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, "NODE_ENV");
    return;
  }

  Object.defineProperty(process.env, "NODE_ENV", {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function setCalendarUrl(value: string | undefined) {
  if (!calendarEnvVar) {
    return;
  }

  if (value === undefined) {
    Reflect.deleteProperty(process.env, calendarEnvVar);
    return;
  }

  Object.defineProperty(process.env, calendarEnvVar, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  setNodeEnv(originalNodeEnv);
  setCalendarUrl(originalCalendarUrl);
});

describe("loadCalendarData", () => {
  test("uses sample data in development when ICS imports no all-day events", async () => {
    setNodeEnv("development");
    setCalendarUrl("https://example.com/calendar.ics");
    globalThis.fetch = mock(
      async () => new Response(EMPTY_ICS, { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await loadCalendarData({
      appConfig,
      forceRefresh: true,
      houseConfig,
      now: new Date("2026-04-19T00:00:00.000Z"),
      siteConfig,
      siteId,
    });

    expect(result.source).toBe("sample");
    expect(result.importedEventCount).toBe(0);
    expect(result.warnings).toContain(
      "No all-day ICS events were imported. Showing sample data in development.",
    );
  });

  test("keeps the real empty state in production when ICS imports no all-day events", async () => {
    setNodeEnv("production");
    setCalendarUrl("https://example.com/calendar.ics");
    globalThis.fetch = mock(
      async () => new Response(EMPTY_ICS, { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await loadCalendarData({
      appConfig,
      forceRefresh: true,
      houseConfig,
      now: new Date("2026-04-19T00:00:00.000Z"),
      siteConfig,
      siteId,
    });

    expect(result.source).toBe("ics");
    expect(result.eventInterpretations).toEqual([]);
    expect(result.importedEventCount).toBe(0);
    expect(result.warnings).toContain("No all-day ICS events were imported.");
    expect(
      result.warnings.some((warning) => warning.includes("sample data")),
    ).toBeFalse();
    expect(result.availability.every((day) => day.status === "available")).toBe(
      true,
    );
  });

  test("shows timed day events in production without counting them as all-day stays", async () => {
    setNodeEnv("production");
    setCalendarUrl("https://example.com/calendar.ics");
    globalThis.fetch = mock(
      async () => new Response(TIMED_ONLY_ICS, { status: 200 }),
    ) as unknown as typeof fetch;

    const result = await loadCalendarData({
      appConfig,
      forceRefresh: true,
      houseConfig,
      now: new Date("2026-04-19T00:00:00.000Z"),
      siteConfig,
      siteId,
    });

    const eventDay = result.availability.find(
      (day) => day.date === "2026-04-29",
    );

    expect(result.source).toBe("ics");
    expect(result.importedEventCount).toBe(0);
    expect(result.eventInterpretations).toHaveLength(2);
    expect(result.eventInterpretations.map((row) => row.raw.id)).toEqual([
      "cleaner-1",
      "test-private-1",
    ]);
    expect(result.warnings).toContain("No all-day ICS events were imported.");
    expect(eventDay?.events).toEqual([
      {
        allDay: false,
        endDate: "2026-04-29T06:30:00.000Z",
        id: "cleaner-1",
        startDate: "2026-04-29T04:00:00.000Z",
        title: "Cleaner 1pm-3:30pm JST",
      },
    ]);
  });
});
