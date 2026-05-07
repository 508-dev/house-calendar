"use client";

import { format, parseISO } from "date-fns";
import type { FocusEvent, MouseEvent } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  AnchorRect,
  CalendarTimedNotes,
  PreviewPosition,
  PreviewSize,
  ViewportSize,
} from "@/components/calendar-utils";
import {
  buildDayAriaLabel,
  buildWeeks,
  clampPreviewPosition,
  formatRoomSummary,
  getAnchorPreviewPosition,
  getDayStatusLabel,
  getPointerPreviewPosition,
  getRoomStatusLabel,
  getWholeHouseDetailLabel,
  resolveDayEventText,
} from "@/components/calendar-utils";
import { currentDateInTimeZone, formatTimeInTimeZone } from "@/lib/house/date";
import type { DailyAvailability } from "@/lib/house/types";

type CalendarProps = {
  days: DailyAvailability[];
  houseName: string;
  requestEnabled: boolean;
  timedNotes: CalendarTimedNotes;
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

type PreviewRequest =
  | {
      anchorRect: AnchorRect;
      date: string;
      type: "anchor";
    }
  | {
      date: string;
      pointer: { x: number; y: number };
      type: "pointer";
    };

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

function getDayEventSectionLabel(_day: DailyAvailability): string {
  return "On this day";
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

function getViewportSize(): ViewportSize {
  if (typeof window === "undefined") {
    return { height: 0, width: 0 };
  }

  return {
    height: window.innerHeight,
    width: window.innerWidth,
  };
}

function getFallbackPreviewSize(viewportSize: ViewportSize): PreviewSize {
  return {
    height: Math.max(0, Math.min(448, viewportSize.height - 32)),
    width: Math.max(0, Math.min(288, viewportSize.width - 32)),
  };
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
  const [selectedPreviewPosition, setSelectedPreviewPosition] =
    useState<PreviewPosition | null>(null);
  const [hoverPreviewRequest, setHoverPreviewRequest] =
    useState<PreviewRequest | null>(null);
  const [previewPosition, setPreviewPosition] =
    useState<PreviewPosition | null>(null);
  const [previewSize, setPreviewSize] = useState<PreviewSize | null>(null);
  const [canHoverPreview, setCanHoverPreview] = useState(false);
  const [viewportSize, setViewportSize] = useState<ViewportSize>(() =>
    getViewportSize(),
  );
  const previewPanelRef = useRef<HTMLDivElement | null>(null);
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
    const anchorRect = getAnchorRect(event.currentTarget);

    setHoverPreviewRequest({
      anchorRect,
      date: dayDate,
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
        setSelectedPreviewPosition(previewPosition);
        setHoverPreviewRequest(null);
        return;
      }

      const viewportSize = getViewportSize();
      const pointerPreviewRequest: PreviewRequest = {
        date: dayDate,
        pointer: {
          x: event.clientX,
          y: event.clientY,
        },
        type: "pointer",
      };

      setSelectedPreviewRequest(pointerPreviewRequest);
      setSelectedPreviewPosition(null);
      setHoverPreviewRequest(null);

      setPreviewPosition(
        getPointerPreviewPosition(
          pointerPreviewRequest.pointer,
          previewSize ?? getFallbackPreviewSize(viewportSize),
          viewportSize,
        ),
      );
      return;
    }

    const viewportSize = getViewportSize();
    const anchorRect = getAnchorRect(event.currentTarget);

    setHoverPreviewRequest(null);
    setSelectedPreviewPosition(null);
    setSelectedPreviewRequest({
      anchorRect,
      date: dayDate,
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

    setHoverPreviewRequest({
      date: dayDate,
      pointer: {
        x: event.clientX,
        y: event.clientY,
      },
      type: "pointer",
    });
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
    const handleViewportResize = () => {
      setViewportSize(getViewportSize());
    };

    window.addEventListener("resize", handleViewportResize);

    return () => window.removeEventListener("resize", handleViewportResize);
  }, []);

  useLayoutEffect(() => {
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

    if (!hoverPreviewRequest && selectedPreviewPosition) {
      const nextPreviewPosition = clampPreviewPosition(
        selectedPreviewPosition,
        nextPreviewSize,
        viewportSize,
      );

      if (
        nextPreviewPosition.x !== selectedPreviewPosition.x ||
        nextPreviewPosition.y !== selectedPreviewPosition.y
      ) {
        setSelectedPreviewPosition(nextPreviewPosition);
      }

      setPreviewPosition((currentPosition) =>
        currentPosition?.x === nextPreviewPosition.x &&
        currentPosition?.y === nextPreviewPosition.y &&
        currentPosition?.placement === nextPreviewPosition.placement &&
        currentPosition?.anchorOffsetX === nextPreviewPosition.anchorOffsetX
          ? currentPosition
          : nextPreviewPosition,
      );
      return;
    }

    const nextPreviewPosition =
      activePreviewRequest.type === "anchor"
        ? getAnchorPreviewPosition(
            activePreviewRequest.anchorRect,
            nextPreviewSize,
            viewportSize,
          )
        : getPointerPreviewPosition(
            activePreviewRequest.pointer,
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
  }, [
    activePreviewRequest,
    hoverPreviewRequest,
    previewSize,
    selectedPreviewPosition,
    viewportSize,
  ]);

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
      <div className="min-w-0 self-start rounded-[1.75rem] border border-[color:var(--app-card-border)] bg-[color:var(--app-card)] shadow-[var(--app-shadow)]">
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
            <div className="min-w-0 space-y-3 sm:space-y-4">
              <div className="grid grid-cols-7 gap-1 px-1 font-[family-name:var(--font-mono)] text-[10px] uppercase tracking-[0.2em] text-[var(--app-muted)] sm:gap-2 sm:text-[11px] sm:tracking-[0.24em]">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                  (label) => (
                    <div key={label} className="pb-1 text-center">
                      {label}
                    </div>
                  ),
                )}
              </div>

              <div className="h-[70vh] overflow-y-auto pr-1 sm:h-[78vh]">
                <div className="space-y-2 px-1 pb-6">
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

                      <div className="grid grid-cols-7 gap-1 sm:gap-2">
                        {week.cells.map((cell) => {
                          if (!cell.day) {
                            return (
                              <div
                                key={cell.id}
                                className="aspect-[0.95] rounded-2xl bg-transparent"
                              />
                            );
                          }

                          const day = cell.day;
                          const isSelected = selectedDay.date === day.date;
                          const isToday = day.date === today;
                          const isPastDay = isPastDate(day.date, today);
                          const isCarryoverMonthDay = week.monthMarker
                            ? day.date.slice(0, 7) !== week.monthMarker.monthKey
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
                            <button
                              key={cell.id}
                              aria-current={isToday ? "date" : undefined}
                              aria-label={buildDayAriaLabel(day)}
                              aria-pressed={isSelected}
                              type="button"
                              onClick={(event) => selectDay(day.date, event)}
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
                              className={`aspect-[0.78] rounded-xl p-1.5 text-left transition sm:aspect-[0.95] sm:min-h-[5.75rem] sm:rounded-2xl sm:p-2 ${
                                cellClasses
                              } ${stateClasses} ${
                                isCarryoverMonthDay
                                  ? "max-sm:bg-stone-50 max-sm:text-stone-700 max-sm:ring-stone-200 max-sm:hover:bg-stone-100"
                                  : ""
                              }`}
                            >
                              <div className="flex h-full flex-col justify-between">
                                <div className="flex items-start justify-between gap-2">
                                  <span className="block min-w-0 text-xs font-semibold sm:text-sm">
                                    {cell.dateLabel}
                                  </span>
                                  <span
                                    className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full sm:mt-1 sm:h-3 sm:w-3 ${dotClass}`}
                                  />
                                </div>

                                <div className="space-y-0.5 sm:space-y-1">
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
                                  <div className="flex gap-0.5 sm:gap-1">
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

      {previewDay && previewPosition ? (
        <div
          ref={previewPanelRef}
          className="pointer-events-none fixed z-50 w-[min(18rem,calc(100vw-2rem))] max-h-64 overflow-y-auto rounded-[1.25rem] border border-[color:var(--app-card-border)] bg-[color:var(--app-card)] p-3 text-[var(--app-foreground)] shadow-[0_20px_60px_rgba(29,22,12,0.18)] backdrop-blur lg:max-h-[min(28rem,calc(100vh-2rem))] lg:p-4"
          style={{
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
