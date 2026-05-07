"use client";

import { addDays, format, getDay, isAfter, parseISO } from "date-fns";
import type { FocusEvent, MouseEvent } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { currentDateInTimeZone, formatTimeInTimeZone } from "@/lib/house/date";
import type { DailyAvailability } from "@/lib/house/types";

type CalendarProps = {
  days: DailyAvailability[];
  houseName: string;
  requestEnabled: boolean;
  timedNotes: {
    showTime: boolean;
    textSource: "title" | "description" | "title_then_description";
  };
  timezone: string;
};

const statusClasses = {
  available:
    "bg-emerald-50 text-emerald-950 ring-1 ring-emerald-200 hover:bg-emerald-100",
  tentative: "bg-sky-50 text-sky-950 ring-1 ring-sky-200 hover:bg-sky-100",
  partial:
    "bg-amber-50 text-amber-950 ring-1 ring-amber-200 hover:bg-amber-100",
  unavailable:
    "bg-rose-50 text-rose-950 ring-1 ring-rose-200 hover:bg-rose-100",
  unknown:
    "bg-stone-100 text-stone-900 ring-1 ring-stone-200 hover:bg-stone-200",
} as const;

const statusDotClasses = {
  available: "bg-emerald-500",
  tentative: "bg-sky-500",
  partial: "bg-amber-500",
  unavailable: "bg-rose-500",
  unknown: "bg-stone-400",
} as const;

const hoverPreviewMediaQuery =
  "(min-width: 1024px) and (hover: hover) and (pointer: fine)";

type StatusKey = keyof typeof statusDotClasses;

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

type CalendarWeek = {
  id: string;
  cells: CalendarCell[];
  monthMarker?: CalendarMonthMarker;
};

type PreviewPosition = {
  anchorOffsetX?: number;
  placement?: "above" | "below";
  x: number;
  y: number;
};

type PreviewSize = {
  height: number;
  width: number;
};

type ViewportSize = {
  height: number;
  width: number;
};

type VerticalClipRect = {
  bottom: number;
  top: number;
};

type AnchorRect = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

type PreviewRequest =
  | {
      date: string;
      element: HTMLButtonElement;
      type: "anchor";
    }
  | {
      date: string;
      element: HTMLButtonElement;
      pointer: { x: number; y: number };
      type: "pointer";
    };

const previewViewportPadding = 16;
const previewPointerGap = 18;
const previewAnchorGap = 10;

function isPastDate(date: string, today: string): boolean {
  return date < today;
}

function getDefaultSelectedDate(
  days: DailyAvailability[],
  today: string,
): string {
  return (
    days.find((day) => !isPastDate(day.date, today))?.date ??
    days[0]?.date ??
    ""
  );
}

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

function getDayStatusLabel(day: DailyAvailability): string {
  const hasSingleRoom = day.rooms.length === 1;

  switch (day.status) {
    case "available":
      return "Available";
    case "tentative":
      return hasSingleRoom ? "Tentative" : "Tentative stay";
    case "partial":
      return "Partially occupied";
    case "unavailable":
      return hasSingleRoom ? "Occupied" : "Whole house occupied";
    case "unknown":
      return "Needs interpretation";
  }
}

function getRoomStatusLabel(
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

function formatRoomSummary(day: DailyAvailability): string {
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

function getDayEventSectionLabel(_day: DailyAvailability): string {
  return "On this day";
}

export function resolveDayEventText(
  event: DailyAvailability["events"][number],
  textSource: CalendarProps["timedNotes"]["textSource"],
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

function formatDayEventTimeLabel(
  event: DailyAvailability["events"][number],
  timezone: string,
): string {
  return `${formatTimeInTimeZone(event.startDate, timezone)} - ${formatTimeInTimeZone(
    event.endDate,
    timezone,
  )}`;
}

function formatDayEventSummary(
  event: DailyAvailability["events"][number],
  timedNotes: CalendarProps["timedNotes"],
  timezone: string,
): string {
  const text = resolveDayEventText(event, timedNotes.textSource);

  if (!timedNotes.showTime) {
    return text;
  }

  return `${formatTimeInTimeZone(event.startDate, timezone)} ${text}`;
}

function findNextWholeHouseFreeDate(
  days: DailyAvailability[],
  fromDate: string,
): string | null {
  return (
    days.find((day) => day.date >= fromDate && day.status === "available")
      ?.date ?? null
  );
}

function findNextRoomFreeDate(
  days: DailyAvailability[],
  roomId: string,
  fromDate: string,
): string | null {
  return (
    days.find((day) => {
      if (day.date < fromDate || day.status === "unknown") {
        return false;
      }

      return day.rooms.find((room) => room.id === roomId)?.status === "free";
    })?.date ?? null
  );
}

function formatNextFreeDateLabel(
  nextFreeDate: string | null,
  activeDate: string,
): string {
  if (!nextFreeDate) {
    return "No confirmed free date in range";
  }

  if (nextFreeDate === activeDate) {
    return "Free on this date";
  }

  return `Next free ${format(parseISO(nextFreeDate), "MMM d")}`;
}

function formatPanelDate(date: string): string {
  return format(parseISO(date), "MMM d");
}

function clampToRange(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }

  return Math.max(min, Math.min(value, max));
}

function getViewportSize(): ViewportSize {
  if (typeof window === "undefined") {
    return { height: 0, width: 0 };
  }

  return {
    height: window.innerHeight,
    width: window.innerWidth,
  };
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

function getFallbackPreviewSize(viewportSize: ViewportSize): PreviewSize {
  return constrainPreviewSize(
    {
      height: 448,
      width: 288,
    },
    viewportSize,
  );
}

function getAnchorRect(element: HTMLElement): AnchorRect {
  const rect = element.getBoundingClientRect();

  return {
    bottom: rect.bottom,
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    width: rect.width,
  };
}

function getPreviewRequestPointer(
  previewRequest: Extract<PreviewRequest, { type: "pointer" }>,
): { x: number; y: number } {
  const anchorRect = getAnchorRect(previewRequest.element);

  return {
    x: anchorRect.left + previewRequest.pointer.x,
    y: anchorRect.top + previewRequest.pointer.y,
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

function parseSelectedDateHash(hash: string): string | null {
  const value = hash.startsWith("#") ? hash.slice(1) : hash;

  if (value.startsWith("date=")) {
    const date = value.slice("date=".length);

    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

export function Calendar({
  days,
  houseName,
  requestEnabled,
  timedNotes,
  timezone,
}: CalendarProps) {
  const today = currentDateInTimeZone(timezone);
  const defaultSelectedDate = getDefaultSelectedDate(days, today);
  const [selectedDate, setSelectedDate] = useState(defaultSelectedDate);
  const [selectedPreviewRequest, setSelectedPreviewRequest] =
    useState<PreviewRequest | null>(null);
  const [hoverPreviewRequest, setHoverPreviewRequest] =
    useState<PreviewRequest | null>(null);
  const [previewPosition, setPreviewPosition] =
    useState<PreviewPosition | null>(null);
  const [previewSize, setPreviewSize] = useState<PreviewSize | null>(null);
  const [canHoverPreview, setCanHoverPreview] = useState(false);
  const [viewportSize, setViewportSize] = useState<ViewportSize>(() =>
    getViewportSize(),
  );
  const [calendarScrollRevision, setCalendarScrollRevision] = useState(0);
  const [calendarViewportClipRect, setCalendarViewportClipRect] =
    useState<VerticalClipRect | null>(null);
  const calendarHorizontalScrollerRef = useRef<HTMLDivElement | null>(null);
  const calendarScrollerRef = useRef<HTMLDivElement | null>(null);
  const previewPanelRef = useRef<HTMLDivElement | null>(null);
  const calendarScrollFrameRef = useRef<number | null>(null);
  const activePreviewRequestRef = useRef<PreviewRequest | null>(null);
  const activePreviewRequest = hoverPreviewRequest ?? selectedPreviewRequest;

  const clearHoverPreview = () => {
    if (canHoverPreview) {
      setHoverPreviewRequest(null);
    }
  };
  const updatePreviewFromFocus = (
    dayDate: string,
    event: FocusEvent<HTMLButtonElement>,
  ) => {
    if (!canHoverPreview || !event.currentTarget.matches(":focus-visible")) {
      return;
    }

    const viewportSize = getViewportSize();
    const anchorElement = event.currentTarget;
    const anchorRect = getAnchorRect(anchorElement);

    setHoverPreviewRequest({
      date: dayDate,
      element: anchorElement,
      type: "anchor",
    });
    setPreviewPosition(
      getAnchorPreviewPosition(
        anchorRect,
        previewSize ?? getFallbackPreviewSize(viewportSize),
        viewportSize,
      ),
    );
  };
  const updatePreviewFromClick = (
    dayDate: string,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    if (canHoverPreview) {
      if (hoverPreviewRequest?.date === dayDate && previewPosition) {
        setSelectedPreviewRequest(hoverPreviewRequest);
        setHoverPreviewRequest(null);
        return;
      }

      const viewportSize = getViewportSize();
      const anchorElement = event.currentTarget;
      const anchorRect = getAnchorRect(anchorElement);
      const pointerPreviewRequest: PreviewRequest = {
        date: dayDate,
        element: anchorElement,
        pointer: {
          x: event.clientX - anchorRect.left,
          y: event.clientY - anchorRect.top,
        },
        type: "pointer",
      };

      setSelectedPreviewRequest(pointerPreviewRequest);
      setHoverPreviewRequest(null);

      setPreviewPosition(
        getPointerPreviewPosition(
          {
            x: event.clientX,
            y: event.clientY,
          },
          previewSize ?? getFallbackPreviewSize(viewportSize),
          viewportSize,
        ),
      );
      return;
    }

    const viewportSize = getViewportSize();
    const anchorElement = event.currentTarget;
    const anchorRect = getAnchorRect(anchorElement);

    setHoverPreviewRequest(null);
    setSelectedPreviewRequest({
      date: dayDate,
      element: anchorElement,
      type: "anchor",
    });
    setPreviewPosition(
      getAnchorPreviewPosition(
        anchorRect,
        previewSize ?? getFallbackPreviewSize(viewportSize),
        viewportSize,
      ),
    );
  };
  const updatePreviewFromMouse = (
    dayDate: string,
    event: MouseEvent<HTMLButtonElement>,
  ) => {
    if (!canHoverPreview) {
      return;
    }

    const viewportSize = getViewportSize();
    const anchorElement = event.currentTarget;
    const anchorRect = getAnchorRect(anchorElement);
    const pointer = {
      x: event.clientX - anchorRect.left,
      y: event.clientY - anchorRect.top,
    };

    setHoverPreviewRequest((currentRequest) =>
      currentRequest?.type === "pointer" &&
      currentRequest.date === dayDate &&
      currentRequest.element === anchorElement
        ? {
            ...currentRequest,
            pointer,
          }
        : {
            date: dayDate,
            element: anchorElement,
            pointer,
            type: "pointer",
          },
    );
    setPreviewPosition(
      getPointerPreviewPosition(
        {
          x: event.clientX,
          y: event.clientY,
        },
        previewSize ?? getFallbackPreviewSize(viewportSize),
        viewportSize,
      ),
    );
  };
  const selectDay = (dayDate: string, event: MouseEvent<HTMLButtonElement>) => {
    setSelectedDate(dayDate);
    updatePreviewFromClick(dayDate, event);
  };

  useEffect(() => {
    const query = window.matchMedia(hoverPreviewMediaQuery);
    const updateHoverPreviewCapability = () =>
      setCanHoverPreview(query.matches);

    updateHoverPreviewCapability();
    query.addEventListener("change", updateHoverPreviewCapability);

    return () =>
      query.removeEventListener("change", updateHoverPreviewCapability);
  }, []);

  useEffect(() => {
    activePreviewRequestRef.current = activePreviewRequest;
  }, [activePreviewRequest]);

  useEffect(() => {
    const handleViewportResize = () => {
      setViewportSize(getViewportSize());
    };

    window.addEventListener("resize", handleViewportResize);

    return () => window.removeEventListener("resize", handleViewportResize);
  }, []);

  useEffect(() => {
    const scheduleCalendarScrollUpdate = () => {
      if (!activePreviewRequestRef.current) {
        return;
      }

      if (calendarScrollFrameRef.current !== null) {
        return;
      }

      calendarScrollFrameRef.current = window.requestAnimationFrame(() => {
        calendarScrollFrameRef.current = null;
        setCalendarScrollRevision((revision) => revision + 1);
      });
    };
    const horizontalScrollElement = calendarHorizontalScrollerRef.current;
    const scrollElement = calendarScrollerRef.current;

    horizontalScrollElement?.addEventListener(
      "scroll",
      scheduleCalendarScrollUpdate,
      {
        passive: true,
      },
    );
    scrollElement?.addEventListener("scroll", scheduleCalendarScrollUpdate, {
      passive: true,
    });
    window.addEventListener("scroll", scheduleCalendarScrollUpdate, {
      passive: true,
    });

    return () => {
      if (calendarScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(calendarScrollFrameRef.current);
        calendarScrollFrameRef.current = null;
      }

      horizontalScrollElement?.removeEventListener(
        "scroll",
        scheduleCalendarScrollUpdate,
      );
      scrollElement?.removeEventListener(
        "scroll",
        scheduleCalendarScrollUpdate,
      );
      window.removeEventListener("scroll", scheduleCalendarScrollUpdate);
    };
  }, []);

  useLayoutEffect(() => {
    void calendarScrollRevision;
    void viewportSize;

    if (!activePreviewRequest) {
      return;
    }

    const rect = calendarScrollerRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    const nextClipRect = {
      bottom: rect.bottom,
      top: rect.top,
    };

    setCalendarViewportClipRect((currentClipRect) =>
      currentClipRect?.bottom === nextClipRect.bottom &&
      currentClipRect.top === nextClipRect.top
        ? currentClipRect
        : nextClipRect,
    );
  }, [activePreviewRequest, calendarScrollRevision, viewportSize]);

  useLayoutEffect(() => {
    void calendarScrollRevision;

    if (!activePreviewRequest) {
      setPreviewSize(null);
      setPreviewPosition(null);
      return;
    }

    const measuredRect = previewPanelRef.current?.getBoundingClientRect();
    const measuredPreviewSize = measuredRect
      ? {
          height: measuredRect.height,
          width: measuredRect.width,
        }
      : null;
    const nextPreviewSize =
      measuredPreviewSize ??
      previewSize ??
      getFallbackPreviewSize(viewportSize);

    if (
      measuredPreviewSize &&
      (!previewSize ||
        measuredPreviewSize.height !== previewSize.height ||
        measuredPreviewSize.width !== previewSize.width)
    ) {
      setPreviewSize(measuredPreviewSize);
    }

    const nextPreviewPosition =
      activePreviewRequest.type === "anchor"
        ? getAnchorPreviewPosition(
            getAnchorRect(activePreviewRequest.element),
            nextPreviewSize,
            viewportSize,
          )
        : getPointerPreviewPosition(
            getPreviewRequestPointer(activePreviewRequest),
            nextPreviewSize,
            viewportSize,
          );

    setPreviewPosition((currentPosition) =>
      currentPosition?.x === nextPreviewPosition.x &&
      currentPosition?.y === nextPreviewPosition.y &&
      currentPosition?.placement === nextPreviewPosition.placement &&
      currentPosition?.anchorOffsetX === nextPreviewPosition.anchorOffsetX
        ? currentPosition
        : nextPreviewPosition,
    );
  }, [activePreviewRequest, calendarScrollRevision, previewSize, viewportSize]);

  useEffect(() => {
    setSelectedDate((currentSelectedDate) =>
      days.some((day) => day.date === currentSelectedDate)
        ? currentSelectedDate
        : defaultSelectedDate,
    );
  }, [days, defaultSelectedDate]);

  useEffect(() => {
    const syncSelectedDateFromHash = () => {
      const hashDate = parseSelectedDateHash(window.location.hash);

      if (hashDate && days.some((day) => day.date === hashDate)) {
        setSelectedDate(hashDate);
        return;
      }

      if (!hashDate) {
        setSelectedDate(defaultSelectedDate);
      }
    };

    syncSelectedDateFromHash();
    window.addEventListener("hashchange", syncSelectedDateFromHash);

    return () =>
      window.removeEventListener("hashchange", syncSelectedDateFromHash);
  }, [days, defaultSelectedDate]);

  useEffect(() => {
    const nextHash = `date=${selectedDate}`;

    if (window.location.hash.slice(1) === nextHash) {
      return;
    }

    window.history.replaceState(null, "", `#${nextHash}`);
  }, [selectedDate]);

  if (days.length === 0) {
    return null;
  }

  const weeks = buildWeeks(days);
  const selectedDay = days.find((day) => day.date === selectedDate) ?? days[0];
  const previewDay = activePreviewRequest
    ? (days.find((day) => day.date === activePreviewRequest.date) ?? null)
    : null;
  const previewClipPath =
    previewPosition && previewSize && calendarViewportClipRect
      ? getPreviewVerticalClipPath(
          previewPosition,
          previewSize,
          calendarViewportClipRect,
        )
      : undefined;
  const hasSingleRoom = days[0]?.rooms.length === 1;
  const legendItems: ReadonlyArray<readonly [StatusKey, string]> = hasSingleRoom
    ? [
        ["available", "Room free"],
        ["tentative", "Room tentative"],
        ["unavailable", "Room occupied"],
        ["unknown", "Needs interpretation"],
      ]
    : [
        ["available", "All rooms free"],
        ["tentative", "At least one room tentative"],
        ["partial", "At least one room occupied"],
        ["unavailable", "Whole house occupied"],
        ["unknown", "Needs interpretation"],
      ];
  const upcomingBusyDays = days
    .filter((day) => !isPastDate(day.date, today) && day.status !== "available")
    .slice(0, 6);

  if (!selectedDay) {
    return null;
  }

  return (
    <section className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 rounded-[1.75rem] border border-[color:var(--app-card-border)] bg-[color:var(--app-card)] shadow-[var(--app-shadow)]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--app-card-border)] px-5 py-4 sm:px-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">
              {houseName}
            </h1>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[color:var(--app-accent)]/25 bg-[color:var(--app-accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--app-accent-strong)]">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                requestEnabled ? "bg-emerald-500" : "bg-stone-400"
              }`}
            />
            {requestEnabled ? "Stay requests enabled" : "View only"}
          </div>
        </div>

        <div className="p-3 sm:p-6">
          <div className="min-w-0 pb-2">
            <div
              ref={calendarHorizontalScrollerRef}
              className="min-w-0 overflow-x-auto pb-2"
            >
              <div className="min-w-[30rem] space-y-3 sm:space-y-4">
                <div className="grid grid-cols-7 gap-1 px-1 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-[var(--app-muted)] sm:gap-2 sm:text-[11px] sm:tracking-[0.24em]">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                    (label) => (
                      <div key={label} className="pb-1 text-center">
                        {label}
                      </div>
                    ),
                  )}
                </div>

                <div
                  ref={calendarScrollerRef}
                  className="h-[70vh] overflow-y-auto pr-1 [mask-image:linear-gradient(to_bottom,transparent_0,black_1.25rem,black_calc(100%_-_1.25rem),transparent_100%)] sm:h-[78vh]"
                >
                  <div className="space-y-2 px-1 pb-1">
                    {weeks.map((week) => (
                      <div key={week.id} className="space-y-2">
                        {week.monthMarker ? (
                          <div className="grid grid-cols-7 gap-1 px-1 sm:gap-2">
                            <div className="col-span-full flex justify-center">
                              <div className="flex w-full items-center rounded-full border border-[color:var(--app-card-border)] bg-white/88 px-2.5 py-1 shadow-[0_1px_0_rgba(31,28,22,0.04)]">
                                <p className="shrink-0 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-[var(--app-muted)]">
                                  {week.monthMarker.label}
                                </p>
                              </div>
                            </div>
                          </div>
                        ) : null}

                        <div className="grid min-w-0 grid-cols-7 gap-1 sm:gap-2">
                          {week.cells.map((cell) => {
                            if (!cell.day) {
                              return (
                                <div
                                  key={cell.id}
                                  className="min-w-0 w-full max-w-full rounded-2xl bg-transparent"
                                >
                                  <div
                                    aria-hidden="true"
                                    className="aspect-[0.78] w-full sm:aspect-[0.95]"
                                  />
                                </div>
                              );
                            }

                            const day = cell.day;
                            const isSelected = selectedDay.date === day.date;
                            const isToday = day.date === today;
                            const isPastDay = isPastDate(day.date, today);
                            const isCarryoverMonthDay = week.monthMarker
                              ? day.date.slice(0, 7) !==
                                week.monthMarker.monthKey
                              : false;
                            const cellClasses = isPastDay
                              ? "cursor-pointer bg-stone-100 text-stone-500 ring-1 ring-stone-200 hover:bg-stone-200"
                              : statusClasses[day.status];
                            const stateClasses = isSelected
                              ? "ring-2 ring-[color:var(--app-foreground)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.65)]"
                              : isToday
                                ? "ring-2 ring-[color:var(--app-accent)]"
                                : "";
                            const roomBarClass = isPastDay
                              ? "bg-stone-300/80"
                              : "bg-white/75";
                            const dotClass = isPastDay
                              ? "bg-stone-300"
                              : statusDotClasses[day.status];

                            return (
                              <div
                                key={cell.id}
                                className="relative min-w-0 w-full max-w-full"
                              >
                                <div
                                  aria-hidden="true"
                                  className="aspect-[0.78] w-full sm:aspect-[0.95]"
                                />
                                <button
                                  aria-current={isToday ? "date" : undefined}
                                  aria-label={buildDayAriaLabel(day)}
                                  aria-pressed={isSelected}
                                  type="button"
                                  onClick={(event) =>
                                    selectDay(day.date, event)
                                  }
                                  onFocus={(event) =>
                                    updatePreviewFromFocus(day.date, event)
                                  }
                                  onMouseEnter={(event) =>
                                    updatePreviewFromMouse(day.date, event)
                                  }
                                  onMouseMove={(event) =>
                                    updatePreviewFromMouse(day.date, event)
                                  }
                                  onMouseLeave={clearHoverPreview}
                                  onBlur={clearHoverPreview}
                                  className={`absolute inset-0 h-full w-full max-w-full overflow-hidden rounded-xl p-1.5 text-left transition sm:rounded-2xl sm:p-2 ${
                                    cellClasses
                                  } ${stateClasses} ${
                                    isCarryoverMonthDay
                                      ? "max-sm:bg-stone-50 max-sm:text-stone-700 max-sm:ring-stone-200 max-sm:hover:bg-stone-100"
                                      : ""
                                  }`}
                                >
                                  <div className="flex h-full min-w-0 flex-col justify-between">
                                    <div className="flex min-w-0 items-start justify-between gap-2">
                                      <span className="block min-w-0 text-xs font-semibold sm:text-sm">
                                        {cell.dateLabel}
                                      </span>
                                      <span
                                        className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full sm:mt-1 sm:h-3 sm:w-3 ${dotClass}`}
                                      />
                                    </div>

                                    <div className="min-w-0 space-y-0.5 sm:space-y-1">
                                      {day.events.length > 0 ? (
                                        <p className="truncate text-[10px] font-medium text-current/85">
                                          {formatDayEventSummary(
                                            day.events[0],
                                            timedNotes,
                                            timezone,
                                          )}
                                          {day.events.length > 1
                                            ? ` +${day.events.length - 1}`
                                            : ""}
                                        </p>
                                      ) : null}
                                      <p className="truncate text-[9px] font-medium capitalize sm:text-[11px]">
                                        {day.status}
                                      </p>
                                      <div className="flex min-w-0 gap-0.5 sm:gap-1">
                                        {day.rooms.map((room) => (
                                          <span
                                            key={room.id}
                                            className={`h-1 flex-1 rounded-full sm:h-1.5 ${
                                              room.status === "occupied"
                                                ? isPastDay
                                                  ? "bg-stone-400"
                                                  : "bg-[color:var(--app-foreground)]/70"
                                                : room.status === "tentative"
                                                  ? isPastDay
                                                    ? "bg-stone-300"
                                                    : "bg-sky-400/80"
                                                  : roomBarClass
                                            }`}
                                          />
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {previewDay && previewPosition ? (
        <div
          ref={previewPanelRef}
          className="pointer-events-none fixed z-50 w-[min(18rem,calc(100vw-2rem))] max-h-64 overflow-y-auto rounded-[1.25rem] border border-[color:var(--app-card-border)] bg-[color:var(--app-card)] p-3 text-[var(--app-foreground)] shadow-[0_20px_60px_rgba(29,22,12,0.18)] backdrop-blur lg:max-h-[min(28rem,calc(100vh-2rem))] lg:p-4"
          style={{
            clipPath: previewClipPath,
            left: previewPosition.x,
            top: previewPosition.y,
          }}
        >
          {previewPosition.placement ? (
            <span
              aria-hidden="true"
              className={`absolute hidden h-3 w-3 rotate-45 border border-[color:var(--app-card-border)] bg-[color:var(--app-card)] lg:block ${
                previewPosition.placement === "below"
                  ? "top-1 border-r-0 border-b-0"
                  : "bottom-1 border-t-0 border-l-0"
              }`}
              style={{
                left: previewPosition.anchorOffsetX,
                transform: "translateX(-50%) rotate(45deg)",
              }}
            />
          ) : null}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold tracking-[-0.04em] lg:text-lg">
                {formatPanelDate(previewDay.date)}
              </h3>
              <p className="text-xs text-[var(--app-muted)]">
                {format(parseISO(previewDay.date), "EEEE")}
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[color:var(--app-card-border)] bg-white/80 px-3 py-1 text-xs font-medium capitalize">
              <span
                className={`h-2 w-2 rounded-full ${
                  statusDotClasses[previewDay.status]
                }`}
              />
              {getDayStatusLabel(previewDay)}
            </div>
          </div>

          <p className="mt-2 text-sm text-[var(--app-muted)] lg:mt-3">
            {formatRoomSummary(previewDay)}
          </p>

          <div className="mt-3 space-y-0 border-t border-[color:var(--app-card-border)] pt-2 lg:mt-4 lg:space-y-2 lg:pt-3">
            {hasSingleRoom ? null : (
              <div className="hidden rounded-xl border border-[color:var(--app-card-border)] bg-white/75 px-3 py-2 text-sm shadow-[0_1px_0_rgba(31,28,22,0.04)] lg:block">
                <div className="flex items-center justify-between gap-3">
                  <span>Whole house</span>
                  <span className="text-right font-[family-name:var(--font-mono)] uppercase text-[var(--app-muted)]">
                    {getWholeHouseDetailLabel(previewDay)}
                  </span>
                </div>
              </div>
            )}

            {previewDay.rooms.map((room, roomIndex) => (
              <div
                key={room.id}
                className={`py-2 text-sm lg:rounded-xl lg:border lg:border-[color:var(--app-card-border)] lg:bg-white/75 lg:px-3 lg:shadow-[0_1px_0_rgba(31,28,22,0.04)] ${
                  roomIndex === 0
                    ? ""
                    : "border-t border-[color:var(--app-card-border)]/70"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span>{room.name}</span>
                  <span className="text-right font-[family-name:var(--font-mono)] uppercase text-[var(--app-muted)]">
                    {getRoomStatusLabel(room.status)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {previewDay.events.length > 0 ? (
            <div className="mt-3 border-t border-[color:var(--app-card-border)] pt-2 lg:mt-4 lg:pt-3">
              <p className="font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.24em] text-[var(--app-muted)]">
                {getDayEventSectionLabel(previewDay)}
              </p>
              <div className="mt-2 space-y-1 text-sm">
                {previewDay.events.slice(0, 3).map((event) => (
                  <div key={event.id}>
                    {timedNotes.showTime ? (
                      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-[var(--app-muted)]">
                        {formatDayEventTimeLabel(event, timezone)}
                      </p>
                    ) : null}
                    <p className={timedNotes.showTime ? "truncate" : ""}>
                      {resolveDayEventText(event, timedNotes.textSource)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <aside className="space-y-4 lg:sticky lg:top-6 lg:h-fit">
        <section className="rounded-[1.75rem] border border-[color:var(--app-card-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)]">
          <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.28em] text-[var(--app-muted)]">
            Selected date
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
            {formatPanelDate(selectedDay.date)}
          </h2>
          <p className="mt-1 text-sm text-[var(--app-muted)]">
            {format(parseISO(selectedDay.date), "EEEE")}
          </p>

          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-[color:var(--app-card-border)] bg-white/80 px-3 py-1.5 text-sm font-medium capitalize">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                statusDotClasses[selectedDay.status]
              }`}
            />
            {getDayStatusLabel(selectedDay)}
          </div>

          <p className="mt-4 text-sm text-[var(--app-muted)]">
            {formatRoomSummary(selectedDay)}
          </p>

          {selectedDay.events.length > 0 ? (
            <div className="mt-5 rounded-xl border border-[color:var(--app-card-border)] bg-white/75 px-3 py-2 text-sm">
              <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-[0.24em] text-[var(--app-muted)]">
                {getDayEventSectionLabel(selectedDay)}
              </p>
              <div className="mt-2 space-y-1.5">
                {selectedDay.events.map((event) => (
                  <div key={event.id}>
                    {timedNotes.showTime ? (
                      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--app-muted)]">
                        {formatDayEventTimeLabel(event, timezone)}
                      </p>
                    ) : null}
                    <p className={timedNotes.showTime ? "mt-0.5" : ""}>
                      {resolveDayEventText(event, timedNotes.textSource)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {hasSingleRoom ? null : (
            <div className="mt-5 rounded-xl border border-[color:var(--app-card-border)] bg-white/75 px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span>Whole house</span>
                <span className="text-right font-[family-name:var(--font-mono)] uppercase text-[var(--app-muted)]">
                  {getWholeHouseDetailLabel(selectedDay)}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--app-muted)]">
                {formatNextFreeDateLabel(
                  findNextWholeHouseFreeDate(days, selectedDay.date),
                  selectedDay.date,
                )}
              </p>
            </div>
          )}

          <div className="mt-5 space-y-2">
            {selectedDay.rooms.map((room) => (
              <div
                key={room.id}
                className="rounded-xl border border-[color:var(--app-card-border)] bg-white/75 px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <span>{room.name}</span>
                  <span className="text-right font-[family-name:var(--font-mono)] uppercase text-[var(--app-muted)]">
                    {getRoomStatusLabel(room.status)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--app-muted)]">
                  {formatNextFreeDateLabel(
                    findNextRoomFreeDate(days, room.id, selectedDay.date),
                    selectedDay.date,
                  )}
                </p>
              </div>
            ))}
          </div>

          {selectedDay.presence.length > 0 ? (
            <div className="mt-5 space-y-2 border-t border-[color:var(--app-card-border)] pt-4">
              {selectedDay.presence.map((presence) => (
                <div
                  key={presence.personId}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{presence.name}</span>
                  <span className="font-[family-name:var(--font-mono)] uppercase text-[var(--app-muted)]">
                    {presence.label ?? presence.state}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="rounded-[1.75rem] border border-[color:var(--app-card-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)]">
          <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.28em] text-[var(--app-muted)]">
            Legend
          </p>
          <div className="mt-4 grid gap-2">
            {legendItems.map(([status, label]) => (
              <div key={status} className="flex items-center gap-3 text-sm">
                <span
                  className={`h-3 w-3 rounded-full ${statusDotClasses[status]}`}
                />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-[color:var(--app-card-border)] bg-[color:var(--app-card)] p-5 shadow-[var(--app-shadow)]">
          <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-[0.28em] text-[var(--app-muted)]">
            Upcoming busy days
          </p>
          <div className="mt-4 space-y-2">
            {upcomingBusyDays.map((day) => (
              <button
                key={day.date}
                type="button"
                onClick={(event) => selectDay(day.date, event)}
                onFocus={(event) => updatePreviewFromFocus(day.date, event)}
                onMouseEnter={(event) =>
                  updatePreviewFromMouse(day.date, event)
                }
                onMouseMove={(event) => updatePreviewFromMouse(day.date, event)}
                onMouseLeave={clearHoverPreview}
                onBlur={clearHoverPreview}
                className="flex w-full items-center justify-between rounded-xl border border-[color:var(--app-card-border)] bg-white/75 px-3 py-2 text-left text-sm"
              >
                <span>{format(parseISO(day.date), "MMM d")}</span>
                <span className="font-[family-name:var(--font-mono)] uppercase text-[var(--app-muted)]">
                  {getDayStatusLabel(day)}
                </span>
              </button>
            ))}
          </div>
        </section>
      </aside>
    </section>
  );
}
