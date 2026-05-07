import { describe, expect, test } from "bun:test";
import type {
  HouseConfig,
  ParsedCalendarEvent,
  RawCalendarEvent,
} from "@/lib/house/types";

const { buildParsedFieldRows, describeInterpretation, formatEventRange } =
  await import("@/routes/admin/$siteId");

const houseConfig: HouseConfig = {
  id: "tokyo",
  inference: {
    carryForwardDays: 0,
    defaultPresence: "unknown",
  },
  name: "Tokyo House",
  people: [
    {
      aliases: [],
      id: "michael",
      name: "Michael",
      publicVisibility: "visible",
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
  sharePolicies: [],
  timezone: "Asia/Tokyo",
  visibleHousemateIds: ["michael"],
};

function buildTimedRawEvent(
  visibility: RawCalendarEvent["visibility"] = "public",
): RawCalendarEvent {
  return {
    allDay: false,
    endDate: "2026-04-29T06:30:00.000Z",
    id: "timed-1",
    startDate: "2026-04-29T04:00:00.000Z",
    title: "Cleaner",
    visibility,
  };
}

const parsedStayEvent: ParsedCalendarEvent = {
  confidence: 1,
  normalizedTitle: "someone stays (guest room)",
  rawTitle: "Someone stays (guest room)",
  roomId: "guest-room",
  scope: "room",
  stayStatus: "confirmed",
  type: "stay",
  visibility: "private",
};

const parsedTentativePresenceEvent: ParsedCalendarEvent = {
  confidence: 0.98,
  location: "taipei",
  normalizedTitle: "michael maybe in taipei",
  personId: "michael",
  presenceState: "in",
  presenceStatus: "tentative",
  rawTitle: "Michael maybe in Taipei",
  scope: "location",
  type: "presence",
  visibility: "public",
};

describe("admin timed event diagnostics", () => {
  test("formats timed event ranges in the house timezone", () => {
    expect(formatEventRange(buildTimedRawEvent(), houseConfig.timezone)).toBe(
      "Apr 29, 2026, 1:00 PM - 3:30 PM (Asia/Tokyo)",
    );
  });

  test("describes timed events as viewer notes even when the parser matches a stay rule", () => {
    expect(
      describeInterpretation(
        parsedStayEvent,
        houseConfig,
        buildTimedRawEvent(),
      ),
    ).toBe(
      "Timed day event shown on its start date without affecting availability.",
    );
  });

  test("shows viewer-note rows instead of stay fields for timed events", () => {
    expect(
      buildParsedFieldRows(parsedStayEvent, houseConfig, buildTimedRawEvent()),
    ).toEqual([
      {
        label: "Viewer calendar",
        value: "Shown on the viewer calendar",
      },
      {
        label: "Visibility",
        value: "public",
      },
    ]);
  });

  test("marks private timed events as hidden from viewers", () => {
    expect(
      buildParsedFieldRows(
        parsedStayEvent,
        houseConfig,
        buildTimedRawEvent("private"),
      ),
    ).toEqual([
      {
        label: "Viewer calendar",
        value: "Hidden from the viewer calendar (private/confidential)",
      },
      {
        label: "Visibility",
        value: "private",
      },
    ]);
  });

  test("describes tentative presence interpretations explicitly", () => {
    expect(
      describeInterpretation(parsedTentativePresenceEvent, houseConfig, {
        allDay: true,
        endDate: "2026-04-30",
        id: "presence-1",
        startDate: "2026-04-29",
        title: "Michael maybe in Taipei",
        visibility: "public",
      }),
    ).toBe("Michael: Tentative in (taipei)");
  });

  test("shows presence status rows for tentative presence", () => {
    expect(
      buildParsedFieldRows(parsedTentativePresenceEvent, houseConfig, {
        allDay: true,
        endDate: "2026-04-30",
        id: "presence-1",
        startDate: "2026-04-29",
        title: "Michael maybe in Taipei",
        visibility: "public",
      }),
    ).toEqual([
      {
        label: "Known housemate",
        value: "Michael",
      },
      {
        label: "Presence state",
        value: "in",
      },
      {
        label: "Presence status",
        value: "Tentative",
      },
      {
        label: "Occupies default room",
        value: "Yes",
      },
      {
        label: "Location",
        value: "taipei",
      },
    ]);
  });
});
