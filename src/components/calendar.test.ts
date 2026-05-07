import { describe, expect, test } from "bun:test";
import { addDays, format, parseISO } from "date-fns";
import type { DailyAvailability } from "@/lib/house/types";
import {
  buildDayAriaLabel,
  buildWeeks,
  getAnchorPreviewPosition,
  getPointerPreviewPosition,
  getPreviewVerticalClipPath,
  getWholeHouseDetailLabel,
  isAnchorVisibleInHorizontalScroller,
  resolveDayEventText,
} from "./calendar";

function buildDay(date: string): DailyAvailability {
  return {
    date,
    events: [],
    status: "available",
    rooms: [
      { id: "my-room", name: "My room", status: "free" },
      { id: "guest-room", name: "Guest room", status: "free" },
    ],
    presence: [],
  };
}

describe("buildWeeks", () => {
  test("keeps month transitions in the same continuous week row", () => {
    const startDate = parseISO("2026-06-28");
    const days = Array.from({ length: 14 }, (_, index) =>
      buildDay(format(addDays(startDate, index), "yyyy-MM-dd")),
    );

    const weeks = buildWeeks(days);

    expect(weeks).toHaveLength(2);
    expect(
      weeks[0]?.cells.flatMap((cell) => (cell.day ? [cell.day.date] : [])),
    ).toEqual([
      "2026-06-28",
      "2026-06-29",
      "2026-06-30",
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
    ]);
    expect(
      weeks[1]?.cells.flatMap((cell) => (cell.day ? [cell.day.date] : [])),
    ).toEqual([
      "2026-07-05",
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
      "2026-07-09",
      "2026-07-10",
      "2026-07-11",
    ]);
  });

  test("prioritizes true month changes for row markers", () => {
    const startDate = parseISO("2026-06-28");
    const days = Array.from({ length: 10 }, (_, index) =>
      buildDay(format(addDays(startDate, index), "yyyy-MM-dd")),
    );

    const weeks = buildWeeks(days);

    expect(weeks[0]?.monthMarker).toMatchObject({
      label: "July 2026",
      startColumn: 4,
    });
    expect(weeks[1]?.monthMarker).toBeUndefined();
  });

  test("uses the first visible day when the range starts mid-month", () => {
    const startDate = parseISO("2026-06-28");
    const days = Array.from({ length: 3 }, (_, index) =>
      buildDay(format(addDays(startDate, index), "yyyy-MM-dd")),
    );

    const weeks = buildWeeks(days);

    expect(weeks[0]?.monthMarker).toMatchObject({
      label: "June 2026",
      startColumn: 1,
    });
  });
});

describe("resolveDayEventText", () => {
  const event = {
    description: "Please leave the guest room clear",
    endDate: "2026-05-01T06:30:00.000Z",
    id: "evt-cleaner",
    startDate: "2026-05-01T04:00:00.000Z",
    title: "Cleaner",
  };

  test("uses the title by default", () => {
    expect(resolveDayEventText(event, "title")).toBe("Cleaner");
  });

  test("can use the event description as the note text", () => {
    expect(resolveDayEventText(event, "description")).toBe(
      "Please leave the guest room clear",
    );
  });

  test("can combine title and description when configured", () => {
    expect(resolveDayEventText(event, "title_then_description")).toBe(
      "Cleaner: Please leave the guest room clear",
    );
  });

  test("falls back to the title when the description is missing", () => {
    expect(
      resolveDayEventText(
        {
          ...event,
          description: undefined,
        },
        "description",
      ),
    ).toBe("Cleaner");
  });
});

describe("buildDayAriaLabel", () => {
  test("includes the full date, status, and room summary", () => {
    const label = buildDayAriaLabel({
      date: "2026-05-01",
      events: [],
      presence: [],
      rooms: [
        { id: "my-room", name: "My room", status: "free" },
        { id: "guest-room", name: "Guest room", status: "occupied" },
      ],
      status: "partial",
    });

    expect(label).toBe("May 1, 2026. Partially occupied. 1 room occupied");
  });

  test("describes tentative days distinctly from confirmed occupancy", () => {
    const label = buildDayAriaLabel({
      date: "2026-05-01",
      events: [],
      presence: [],
      rooms: [
        { id: "my-room", name: "My room", status: "free" },
        { id: "guest-room", name: "Guest room", status: "tentative" },
      ],
      status: "tentative",
    });

    expect(label).toBe("May 1, 2026. Tentative stay. 1 room tentative");
  });

  test("describes mixed occupied and tentative rooms distinctly", () => {
    const label = buildDayAriaLabel({
      date: "2026-05-01",
      events: [],
      presence: [],
      rooms: [
        { id: "my-room", name: "My room", status: "occupied" },
        { id: "guest-room", name: "Guest room", status: "tentative" },
        { id: "office", name: "Office", status: "free" },
      ],
      status: "partial",
    });

    expect(label).toBe(
      "May 1, 2026. Partially occupied. 1 room occupied, 1 room tentative",
    );
  });

  test("uses room-level wording when the house has a single room", () => {
    const label = buildDayAriaLabel({
      date: "2026-05-01",
      events: [],
      presence: [],
      rooms: [{ id: "studio", name: "Studio", status: "occupied" }],
      status: "unavailable",
    });

    expect(label).toBe("May 1, 2026. Occupied. Room occupied");
  });

  test("includes day event counts when annotations are present", () => {
    const label = buildDayAriaLabel({
      date: "2026-05-01",
      events: [
        {
          endDate: "2026-05-01T06:30:00.000Z",
          id: "evt-cleaner",
          startDate: "2026-05-01T04:00:00.000Z",
          title: "Cleaner 1pm-3:30pm JST",
        },
      ],
      presence: [],
      rooms: [
        { id: "my-room", name: "My room", status: "free" },
        { id: "guest-room", name: "Guest room", status: "free" },
      ],
      status: "available",
    });

    expect(label).toBe("May 1, 2026. Available. All rooms free. 1 day event");
  });
});

describe("getWholeHouseDetailLabel", () => {
  test("preserves unknown status instead of inferring a free summary", () => {
    const label = getWholeHouseDetailLabel({
      date: "2026-05-01",
      events: [],
      presence: [],
      rooms: [
        { id: "my-room", name: "My room", status: "free" },
        { id: "guest-room", name: "Guest room", status: "free" },
      ],
      status: "unknown",
    });

    expect(label).toBe("Needs interpretation");
  });
});

describe("getAnchorPreviewPosition", () => {
  test("keeps the preview below when its top coordinate fits below the anchor", () => {
    const position = getAnchorPreviewPosition(
      {
        bottom: 520,
        height: 60,
        left: 420,
        right: 560,
        top: 460,
        width: 140,
      },
      {
        height: 220,
        width: 288,
      },
      {
        height: 800,
        width: 1120,
      },
    );

    expect(position).toMatchObject({
      anchorOffsetX: 144,
      placement: "below",
      x: 346,
      y: 530,
    });
  });

  test("keeps the preview below a low cell so scroller clipping can hide it", () => {
    const position = getAnchorPreviewPosition(
      {
        bottom: 1030,
        height: 180,
        left: 420,
        right: 560,
        top: 850,
        width: 140,
      },
      {
        height: 220,
        width: 288,
      },
      {
        height: 1100,
        width: 1120,
      },
    );

    expect(position).toMatchObject({
      anchorOffsetX: 144,
      placement: "below",
      x: 346,
      y: 1040,
    });
  });
});

describe("getPointerPreviewPosition", () => {
  test("offsets the preview from the pointer", () => {
    const position = getPointerPreviewPosition(
      {
        x: 120,
        y: 80,
      },
      {
        height: 80,
        width: 100,
      },
      {
        height: 240,
        width: 320,
      },
    );

    expect(position).toMatchObject({
      x: 138,
      y: 98,
    });
  });

  test("does not clamp the preview vertically near the lower edge", () => {
    const position = getPointerPreviewPosition(
      {
        x: 300,
        y: 220,
      },
      {
        height: 80,
        width: 100,
      },
      {
        height: 240,
        width: 320,
      },
    );

    expect(position).toMatchObject({
      x: 204,
      y: 238,
    });
  });
});

describe("getPreviewVerticalClipPath", () => {
  test("does not clip when the preview is inside the scroll viewport", () => {
    expect(
      getPreviewVerticalClipPath(
        { x: 120, y: 100 },
        { height: 160, width: 288 },
        { bottom: 400, top: 80 },
      ),
    ).toBeUndefined();
  });

  test("clips only the vertical overflow outside the scroll viewport", () => {
    expect(
      getPreviewVerticalClipPath(
        { x: 120, y: 60 },
        { height: 180, width: 288 },
        { bottom: 200, top: 100 },
      ),
    ).toBe("inset(40px 0px 40px 0px)");
  });
});

describe("isAnchorVisibleInHorizontalScroller", () => {
  test("allows previews while the anchor is partially inside the horizontal scroller", () => {
    expect(
      isAnchorVisibleInHorizontalScroller(
        {
          bottom: 160,
          height: 80,
          left: 80,
          right: 140,
          top: 80,
          width: 60,
        },
        { left: 100, right: 320 },
      ),
    ).toBe(true);
  });

  test("hides previews when the anchor is fully outside the horizontal scroller", () => {
    expect(
      isAnchorVisibleInHorizontalScroller(
        {
          bottom: 160,
          height: 80,
          left: 20,
          right: 80,
          top: 80,
          width: 60,
        },
        { left: 100, right: 320 },
      ),
    ).toBe(false);
  });
});
