import { afterEach, expect, test } from "bun:test";
import { siteConfigSchema } from "@/lib/config/config";
import { parseIcsCalendar } from "@/lib/house/ics";
import example from "../../../config/config.example.json";
import {
  calendarEventInput,
  insertGoogleEvent,
  makeGoogleEvent,
} from "./google-calendar-events";
import {
  makeGoogleAuthorization,
  openGoogleToken,
  sealGoogleToken,
} from "./google-calendar-oauth";
import {
  GOOGLE_CALENDAR_SCOPE,
  matchesCalendarApiToken,
} from "./google-calendar-settings";

const standard = siteConfigSchema.parse(example.sites[0]);
const checkout = siteConfigSchema.parse(example.sites[1]);
const key = crypto.randomUUID();
const allDay = {
  title: "A guest stays (guest room)",
  startDate: "2026-12-04",
  checkoutDate: "2026-12-06",
};
const timed = {
  title: "Cleaner",
  startDateTime: "2026-12-04T13:00:00+09:00",
  endDateTime: "2026-12-04T15:00:00+09:00",
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("round trips the same occupied nights in both all-day end date modes", () => {
  for (const [site, expectedGoogleEnd] of [
    [standard, "2026-12-06"],
    [checkout, "2026-12-07"],
  ] as const) {
    const event = makeGoogleEvent(site, key, calendarEventInput.parse(allDay));
    expect(event.end).toEqual({ date: expectedGoogleEnd });
    const [imported] = parseIcsCalendar(
      `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:${event.summary}
DTSTART;VALUE=DATE:20261204
DTEND;VALUE=DATE:${expectedGoogleEnd.replaceAll("-", "")}
CLASS:PRIVATE
END:VEVENT
END:VCALENDAR`,
      { allDayEndDateMode: site.calendarInterpretation.allDayEndDateMode },
    );
    expect(imported.startDate).toBe(allDay.startDate);
    expect(imported.endDate).toBe(allDay.checkoutDate);
  }
});

test("timed events are private by default and require explicit viewer-note opt-in", () => {
  const privateEvent = makeGoogleEvent(
    standard,
    key,
    calendarEventInput.parse(timed),
  );
  const viewerNote = makeGoogleEvent(
    standard,
    key,
    calendarEventInput.parse({ ...timed, showAsViewerNote: true }),
  );
  expect(privateEvent.visibility).toBe("private");
  expect(privateEvent.start).toEqual({ dateTime: "2026-12-04T04:00:00.000Z" });
  expect(viewerNote.visibility).toBe("default");
  expect(viewerNote.extendedProperties).not.toEqual(
    privateEvent.extendedProperties,
  );
});

test("rejects invalid date spans, offsetless times, and a caller-supplied target", () => {
  for (const invalid of [
    { ...allDay, checkoutDate: allDay.startDate },
    { ...allDay, startDate: "2026-11-31" },
    { ...allDay, calendarId: "elsewhere" },
    { ...allDay, showAsViewerNote: true },
    { ...timed, startDateTime: "2026-12-04T13:00:00" },
    { ...timed, endDateTime: "2026-12-04T08:00:00+05:00" },
  ]) {
    expect(calendarEventInput.safeParse(invalid).success).toBe(false);
  }
});

test("replays an existing Google event only when its payload matches", async () => {
  const event = makeGoogleEvent(
    standard,
    key,
    calendarEventInput.parse(allDay),
  );
  const otherSiteEvent = makeGoogleEvent(
    checkout,
    key,
    calendarEventInput.parse(allDay),
  );
  expect(otherSiteEvent.id).not.toBe(event.id);

  const requests: Array<{ url: string; method: string }> = [];
  globalThis.fetch = (async (url: URL, init?: RequestInit) => {
    requests.push({ url: url.href, method: init?.method ?? "GET" });
    if (init?.method === "POST") return new Response(null, { status: 409 });
    return Response.json({
      ...event,
      htmlLink: "https://calendar.google.com/calendar/event?eid=example",
    });
  }) as typeof fetch;

  const args = {
    accessToken: "test-access-token",
    calendarId: "pilot@example.test",
  };
  expect(await insertGoogleEvent({ ...args, event })).toEqual({
    kind: "replayed",
    eventId: event.id,
    eventUrl: "https://calendar.google.com/calendar/event?eid=example",
  });
  const changed = makeGoogleEvent(
    standard,
    key,
    calendarEventInput.parse({ ...allDay, title: "Different" }),
  );
  expect(await insertGoogleEvent({ ...args, event: changed })).toEqual({
    kind: "conflict",
  });
  expect(requests.slice(0, 2)).toEqual([
    {
      method: "POST",
      url: "https://www.googleapis.com/calendar/v3/calendars/pilot%40example.test/events",
    },
    {
      method: "GET",
      url: `https://www.googleapis.com/calendar/v3/calendars/pilot%40example.test/events/${event.id}`,
    },
  ]);
});

test("OAuth requests offline access with PKCE and encrypts tokens for the configured client", () => {
  const settings = {
    clientId: "test-client",
    clientSecret: "test-secret",
    redirectUri: "https://house.example.test/admin/google-calendar/callback",
    origin: "https://house.example.test",
    key: Buffer.alloc(32, 7),
  };
  const first = makeGoogleAuthorization(settings, "first-session", "tokyo", 0);
  const second = makeGoogleAuthorization(
    settings,
    "second-session",
    "tokyo",
    0,
  );
  expect(first.url.searchParams.get("scope")).toBe(GOOGLE_CALENDAR_SCOPE);
  expect(first.url.searchParams.get("access_type")).toBe("offline");
  expect(first.url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(first.attempt.stateHash).not.toBe(
    first.url.searchParams.get("state") ?? "",
  );
  expect(first.attempt.stateHash).not.toBe(second.attempt.stateHash);
  expect(first.attempt.sessionHash).not.toBe(second.attempt.sessionHash);
  expect(first.attempt.stateExpiresAt.getTime()).toBe(600_000);

  const encrypted = sealGoogleToken("test-refresh-token", settings);
  expect(encrypted).not.toContain("test-refresh-token");
  expect(openGoogleToken(encrypted, settings)).toBe("test-refresh-token");
  expect(() =>
    openGoogleToken(encrypted, { ...settings, clientId: "another-client" }),
  ).toThrow();
  expect(() =>
    openGoogleToken(encrypted, { ...settings, key: Buffer.alloc(32) }),
  ).toThrow();
});

test("only the configured bearer token can authorize a house API call", () => {
  const tokyo = "t".repeat(32);
  const taiwan = "a".repeat(32);
  expect(matchesCalendarApiToken(`Bearer ${tokyo}`, tokyo)).toBe(true);
  expect(matchesCalendarApiToken(`Bearer ${tokyo}`, taiwan)).toBe(false);
  expect(matchesCalendarApiToken(`Bearer ${tokyo}`, undefined)).toBe(false);
  expect(matchesCalendarApiToken("Bearer short", "short")).toBe(false);
});
