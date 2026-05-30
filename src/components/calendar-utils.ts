import { addDays, format, getDay, isAfter, parseISO } from "date-fns";
import type { DailyAvailability } from "@/lib/house/types";

export type CalendarTimedNotes = {
  showTime: boolean;
  textSource: "title" | "description" | "title_then_description";
};

type CalendarCell = {
  id: string;
  dateLabel?: string;
  day?: DailyAvailability;
};

type CalendarMonthMarker = {
  label: string;
  monthKey: string;
  startColumn: number;
};

export type CalendarWeek = {
  id: string;
  cells: CalendarCell[];
  monthMarker?: CalendarMonthMarker;
};

export type PreviewPosition = {
  anchorOffsetX?: number;
  placement?: "above" | "below";
  x: number;
  y: number;
};

export type PreviewSize = {
  height: number;
  width: number;
};

export type ViewportSize = {
  height: number;
  width: number;
};

export type VerticalClipRect = {
  bottom: number;
  top: number;
};

export type HorizontalClipRect = {
  left: number;
  right: number;
};

export type AnchorRect = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

const previewViewportPadding = 16;
const previewPointerGap = 18;
const previewAnchorGap = 10;

export function buildWeeks(days: DailyAvailability[]): CalendarWeek[] {
  if (days.length === 0) {
    return [];
  }

  const dayMap = new Map(days.map((day) => [day.date, day]));
  const firstDay = days[0];
  const lastDay = days.at(-1);

  if (!firstDay || !lastDay) {
    return [];
  }

  const firstDate = parseISO(firstDay.date);
  const lastDate = parseISO(lastDay.date);
  const weeks: CalendarWeek[] = [];
  const calendarStart = addDays(firstDate, -getDay(firstDate));
  const calendarEnd = addDays(lastDate, 6 - getDay(lastDate));
  const firstDateKey = format(firstDate, "yyyy-MM-dd");

  let cursor = calendarStart;

  while (!isAfter(cursor, calendarEnd)) {
    const cells: CalendarCell[] = [];
    let monthMarker: CalendarMonthMarker | undefined;
    let monthMarkerPriority = 0;

    for (let offset = 0; offset < 7; offset += 1) {
      const cellDate = addDays(cursor, offset);
      const dateKey = format(cellDate, "yyyy-MM-dd");
      const isVisibleDate = dateKey >= firstDay.date && dateKey <= lastDay.date;

      if (!isVisibleDate) {
        cells.push({
          id: `${dateKey}-blank`,
        });
        continue;
      }

      const isFirstVisibleDay = dateKey === firstDateKey;
      const isFirstDayOfMonth = format(cellDate, "d") === "1";
      const markerPriority = isFirstDayOfMonth ? 2 : isFirstVisibleDay ? 1 : 0;

      if (markerPriority > monthMarkerPriority) {
        monthMarker = {
          label: format(cellDate, "MMMM yyyy"),
          monthKey: format(cellDate, "yyyy-MM"),
          startColumn: offset + 1,
        };
        monthMarkerPriority = markerPriority;
      }

      cells.push({
        id: dateKey,
        dateLabel: format(cellDate, "d"),
        day: dayMap.get(dateKey),
      });
    }

    weeks.push({
      id: format(cursor, "yyyy-MM-dd"),
      cells,
      monthMarker,
    });

    cursor = addDays(cursor, 7);
  }

  return weeks;
}

export function getDayStatusLabel(day: DailyAvailability): string {
  const hasSingleRoom = day.rooms.length === 1;
  const hasOccupiedRoom = day.rooms.some((room) => room.status === "occupied");

  switch (day.status) {
    case "available":
      return "Available";
    case "tentative":
      return hasSingleRoom ? "Tentative" : "Tentative stay";
    case "partial":
      return "Partially occupied";
    case "unavailable":
      if (!hasOccupiedRoom) {
        return "Whole house unavailable";
      }

      return hasSingleRoom ? "Occupied" : "Whole house occupied";
    case "unknown":
      return "Needs interpretation";
  }
}

export function getRoomStatusLabel(
  status: DailyAvailability["rooms"][number]["status"],
): string {
  switch (status) {
    case "free":
      return "Free";
    case "tentative":
      return "Tentative";
    case "occupied":
      return "Occupied";
  }
}

export function formatRoomSummary(day: DailyAvailability): string {
  const hasSingleRoom = day.rooms.length === 1;
  const occupiedCount = day.rooms.filter(
    (room) => room.status === "occupied",
  ).length;
  const tentativeCount = day.rooms.filter(
    (room) => room.status === "tentative",
  ).length;
  const formatRoomCount = (count: number, status: "occupied" | "tentative") =>
    `${count} room${count === 1 ? "" : "s"} ${status}`;

  if (hasSingleRoom) {
    if (occupiedCount > 0) {
      return "Room occupied";
    }

    if (tentativeCount > 0) {
      return "Room tentative";
    }

    return "Room free";
  }

  if (occupiedCount === 0 && tentativeCount === 0) {
    return "All rooms free";
  }

  if (occupiedCount === day.rooms.length) {
    return "Whole house occupied";
  }

  if (occupiedCount === 0 && tentativeCount === day.rooms.length) {
    return "Whole house tentative";
  }

  if (occupiedCount > 0 && tentativeCount > 0) {
    return `${formatRoomCount(occupiedCount, "occupied")}, ${formatRoomCount(
      tentativeCount,
      "tentative",
    )}`;
  }

  if (occupiedCount === 0) {
    return formatRoomCount(tentativeCount, "tentative");
  }

  return formatRoomCount(occupiedCount, "occupied");
}

export function getWholeHouseDetailLabel(day: DailyAvailability): string {
  if (day.rooms.length === 1) {
    return getDayStatusLabel(day);
  }

  if (day.status === "unknown") {
    return getDayStatusLabel(day);
  }

  if (
    day.status === "unavailable" &&
    day.rooms.every((room) => room.status === "free")
  ) {
    return "Whole house unavailable";
  }

  if (
    day.status === "tentative" &&
    day.rooms.every((room) => room.status === "free")
  ) {
    return "Whole house tentative";
  }

  return formatRoomSummary(day);
}

export function buildDayAriaLabel(day: DailyAvailability): string {
  const labels = [
    format(parseISO(day.date), "MMMM d, yyyy"),
    getDayStatusLabel(day),
    formatRoomSummary(day),
  ];

  if (day.events.length > 0) {
    labels.push(
      day.events.length === 1
        ? "1 day event"
        : `${day.events.length} day events`,
    );
  }

  return labels.join(". ");
}

export function resolveDayEventText(
  event: DailyAvailability["events"][number],
  textSource: CalendarTimedNotes["textSource"],
): string {
  const description = event.description?.trim();

  switch (textSource) {
    case "description":
      return description || event.title;
    case "title_then_description":
      return description ? `${event.title}: ${description}` : event.title;
    default:
      return event.title;
  }
}

function clampToRange(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }

  return Math.max(min, Math.min(value, max));
}

function constrainPreviewSize(
  previewSize: PreviewSize,
  viewportSize: ViewportSize,
): PreviewSize {
  return {
    height: Math.max(
      0,
      Math.min(
        previewSize.height,
        viewportSize.height - previewViewportPadding * 2,
      ),
    ),
    width: Math.max(
      0,
      Math.min(
        previewSize.width,
        viewportSize.width - previewViewportPadding * 2,
      ),
    ),
  };
}

export function clampPreviewPosition(
  position: PreviewPosition,
  previewSize: PreviewSize,
  viewportSize: ViewportSize,
): PreviewPosition {
  const constrainedPreviewSize = constrainPreviewSize(
    previewSize,
    viewportSize,
  );
  const maxX =
    viewportSize.width - constrainedPreviewSize.width - previewViewportPadding;
  const maxY =
    viewportSize.height -
    constrainedPreviewSize.height -
    previewViewportPadding;

  return {
    ...position,
    x: clampToRange(position.x, previewViewportPadding, maxX),
    y: clampToRange(position.y, previewViewportPadding, maxY),
  };
}

export function getPointerPreviewPosition(
  pointer: { x: number; y: number },
  previewSize: PreviewSize,
  viewportSize: ViewportSize,
): PreviewPosition {
  const constrainedPreviewSize = constrainPreviewSize(
    previewSize,
    viewportSize,
  );
  const maxX =
    viewportSize.width - constrainedPreviewSize.width - previewViewportPadding;

  return {
    x: clampToRange(
      pointer.x + previewPointerGap,
      previewViewportPadding,
      maxX,
    ),
    y: pointer.y + previewPointerGap,
  };
}

export function getAnchorPreviewPosition(
  anchorRect: AnchorRect,
  previewSize: PreviewSize,
  viewportSize: ViewportSize,
): PreviewPosition {
  const constrainedPreviewSize = constrainPreviewSize(
    previewSize,
    viewportSize,
  );
  const maxX =
    viewportSize.width - constrainedPreviewSize.width - previewViewportPadding;
  const centeredX =
    anchorRect.left + anchorRect.width / 2 - constrainedPreviewSize.width / 2;
  const belowY = anchorRect.bottom + previewAnchorGap;
  const nextX = clampToRange(centeredX, previewViewportPadding, maxX);

  return {
    anchorOffsetX: clampToRange(
      anchorRect.left + anchorRect.width / 2 - nextX,
      24,
      constrainedPreviewSize.width - 24,
    ),
    placement: "below",
    x: nextX,
    y: belowY,
  };
}

export function getPreviewVerticalClipPath(
  position: PreviewPosition,
  previewSize: PreviewSize,
  clipRect: VerticalClipRect,
): string | undefined {
  const topInset = clampToRange(
    clipRect.top - position.y,
    0,
    previewSize.height,
  );
  const bottomInset = clampToRange(
    position.y + previewSize.height - clipRect.bottom,
    0,
    previewSize.height,
  );

  if (topInset === 0 && bottomInset === 0) {
    return undefined;
  }

  return `inset(${topInset}px 0px ${bottomInset}px 0px)`;
}

export function isAnchorVisibleInHorizontalScroller(
  anchorRect: AnchorRect,
  scrollerRect: HorizontalClipRect,
): boolean {
  return (
    anchorRect.right > scrollerRect.left && anchorRect.left < scrollerRect.right
  );
}
