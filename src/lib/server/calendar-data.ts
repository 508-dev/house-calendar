import { differenceInCalendarDays, parseISO, startOfMonth } from "date-fns";
import {
  type AppConfig,
  configToHouseConfig,
  getDefaultSiteId,
  getSiteConfig,
  type SiteConfig,
} from "@/lib/config/config";
import { deriveDailyAvailability } from "@/lib/house/availability";
import { currentDateInTimeZone, formatCalendarDate } from "@/lib/house/date";
import { parseIcsCalendar } from "@/lib/house/ics";
import { parseEventTitle } from "@/lib/house/parser";
import { buildSampleScenario } from "@/lib/house/sample-data";
import type { HouseConfig, RawCalendarEvent } from "@/lib/house/types";
import { loadAppConfig, resolveCalendarUrl } from "./app-config";
import { serverEnv } from "./env";

const DEFAULT_ICS_SYNC_TTL_MINUTES = 15;

type CalendarDataSource = "ics" | "sample";
type CalendarDataBase = {
  availability: ReturnType<typeof buildSampleScenario>["sampleDerivedDays"];
  eventInterpretations: ReturnType<
    typeof buildSampleScenario
  >["sampleEventInterpretations"];
  importedEventCount: number;
  source: CalendarDataSource;
  warnings: string[];
};

type CalendarDataCacheEntry = {
  expiresAt: number;
  result: CalendarDataResult;
};

export type CalendarDataResult = {
  availability: CalendarDataBase["availability"];
  cacheTtlMinutes: number;
  eventInterpretations: CalendarDataBase["eventInterpretations"];
  fetchedAt: string;
  importedEventCount: number;
  nextRefreshAt: string;
  source: CalendarDataSource;
  warnings: string[];
};

type LoadCalendarDataOptions = {
  appConfig?: AppConfig;
  forceRefresh?: boolean;
  houseConfig?: HouseConfig;
  now?: Date;
  siteConfig?: SiteConfig;
  siteId?: string;
};

const calendarDataCache = new Map<string, CalendarDataCacheEntry>();
const calendarDataInFlight = new Map<string, Promise<CalendarDataResult>>();

function getCacheTtlMinutes(): number {
  return serverEnv.ICS_SYNC_TTL_MINUTES ?? DEFAULT_ICS_SYNC_TTL_MINUTES;
}

function isDevelopmentEnvironment(): boolean {
  return process.env.NODE_ENV === "development";
}

function withCacheMetadata(
  result: CalendarDataBase,
  fetchedAt: Date,
): CalendarDataResult {
  const cacheTtlMinutes = getCacheTtlMinutes();
  const nextRefreshAt = new Date(
    fetchedAt.getTime() + cacheTtlMinutes * 60 * 1000,
  );

  return {
    ...result,
    cacheTtlMinutes,
    fetchedAt: fetchedAt.toISOString(),
    nextRefreshAt: nextRefreshAt.toISOString(),
  };
}

async function fetchCalendarDataWithConfig({
  siteConfig,
  houseConfig,
  now,
}: {
  siteConfig: SiteConfig;
  houseConfig: HouseConfig;
  now: Date;
}): Promise<CalendarDataBase> {
  const warnings: string[] = [];
  const today = parseISO(currentDateInTimeZone(houseConfig.timezone, now));
  const calendarStart = startOfMonth(today);
  const nights = differenceInCalendarDays(today, calendarStart) + 365;
  const calendarResults = await Promise.all(
    siteConfig.calendars.map(async (calendar) => {
      const url = resolveCalendarUrl(calendar);

      if (!url) {
        return {
          events: [] as RawCalendarEvent[],
          warnings: [`Calendar "${calendar.label}" is missing an ICS URL.`],
        };
      }

      try {
        const response = await fetch(url, { cache: "no-store" });

        if (!response.ok) {
          return {
            events: [] as RawCalendarEvent[],
            warnings: [
              `Calendar "${calendar.label}" returned ${response.status}.`,
            ],
          };
        }

        try {
          return {
            events: parseIcsCalendar(await response.text(), {
              allDayEndDateMode:
                siteConfig.calendarInterpretation.allDayEndDateMode,
              defaultTimedEventTimeZone: siteConfig.site.timezone,
            }),
            warnings: [] as string[],
          };
        } catch {
          return {
            events: [] as RawCalendarEvent[],
            warnings: [
              `Calendar "${calendar.label}" returned invalid ICS data.`,
            ],
          };
        }
      } catch {
        return {
          events: [] as RawCalendarEvent[],
          warnings: [`Calendar "${calendar.label}" could not be fetched.`],
        };
      }
    }),
  );

  const rawEvents = calendarResults.flatMap((result) => result.events);
  const eventInterpretations = rawEvents.map((raw) => ({
    raw,
    parsed: parseEventTitle(raw.title, houseConfig),
  }));
  const importedAllDayEventCount = rawEvents.filter(
    (event) => event.allDay,
  ).length;
  warnings.push(...calendarResults.flatMap((result) => result.warnings));

  if (importedAllDayEventCount === 0) {
    warnings.push(
      isDevelopmentEnvironment()
        ? "No all-day ICS events were imported. Showing sample data in development."
        : "No all-day ICS events were imported.",
    );

    if (isDevelopmentEnvironment()) {
      const sampleScenario = buildSampleScenario(now);

      return {
        availability: sampleScenario.sampleDerivedDays,
        eventInterpretations: sampleScenario.sampleEventInterpretations,
        importedEventCount: 0,
        source: "sample",
        warnings,
      };
    }

    return {
      availability: deriveDailyAvailability(
        houseConfig,
        rawEvents,
        formatCalendarDate(calendarStart),
        nights,
      ),
      eventInterpretations,
      importedEventCount: importedAllDayEventCount,
      source: "ics",
      warnings,
    };
  }

  return {
    availability: deriveDailyAvailability(
      houseConfig,
      rawEvents,
      formatCalendarDate(calendarStart),
      nights,
    ),
    eventInterpretations,
    importedEventCount: importedAllDayEventCount,
    source: "ics",
    warnings,
  };
}

export async function loadCalendarData({
  appConfig,
  forceRefresh = false,
  houseConfig,
  now = new Date(),
  siteConfig,
  siteId,
}: LoadCalendarDataOptions = {}): Promise<CalendarDataResult> {
  const nowMs = now.getTime();
  const resolvedAppConfig = appConfig ?? (await loadAppConfig());
  const resolvedSiteId =
    siteId ?? siteConfig?.site.id ?? getDefaultSiteId(resolvedAppConfig);
  const resolvedSiteConfig =
    siteConfig ?? getSiteConfig(resolvedAppConfig, resolvedSiteId);

  if (!resolvedSiteConfig) {
    throw new Error(`Unknown site "${resolvedSiteId}".`);
  }
  const resolvedHouseConfig =
    houseConfig ?? configToHouseConfig(resolvedSiteConfig);
  const cachedEntry = calendarDataCache.get(resolvedSiteId);

  if (!forceRefresh && cachedEntry && cachedEntry.expiresAt > nowMs) {
    return cachedEntry.result;
  }

  const inFlightPromise = calendarDataInFlight.get(resolvedSiteId);

  if (inFlightPromise && !forceRefresh) {
    return inFlightPromise;
  }

  const inFlightState: {
    promise: Promise<CalendarDataResult> | null;
  } = {
    promise: null,
  };

  inFlightState.promise = (async () => {
    const result = withCacheMetadata(
      await fetchCalendarDataWithConfig({
        siteConfig: resolvedSiteConfig,
        houseConfig: resolvedHouseConfig,
        now,
      }),
      now,
    );

    if (calendarDataInFlight.get(resolvedSiteId) === inFlightState.promise) {
      calendarDataCache.set(resolvedSiteId, {
        expiresAt: Date.parse(result.nextRefreshAt),
        result,
      });
    }

    return result;
  })();
  const inFlight = inFlightState.promise;
  calendarDataInFlight.set(resolvedSiteId, inFlight);

  try {
    return await inFlight;
  } finally {
    if (calendarDataInFlight.get(resolvedSiteId) === inFlight) {
      calendarDataInFlight.delete(resolvedSiteId);
    }
  }
}

export async function refreshCalendarData(
  siteId?: string,
): Promise<CalendarDataResult> {
  return loadCalendarData({ forceRefresh: true, siteId });
}
