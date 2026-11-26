import { createHash } from "node:crypto";
import { z } from "zod";
import type { SiteConfig } from "@/lib/config/config";
import { googleEventsUrl, googleFetch } from "./google-calendar-settings";

const eventFields = {
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4_000).optional(),
};

export const calendarEventInput = z
  .union([
    z.strictObject({
      ...eventFields,
      startDate: z.iso.date(),
      checkoutDate: z.iso.date(),
    }),
    z.strictObject({
      ...eventFields,
      startDateTime: z.iso.datetime({ offset: true }),
      endDateTime: z.iso.datetime({ offset: true }),
      showAsViewerNote: z.boolean().default(false),
    }),
  ])
  .refine((event) => {
    if ("startDate" in event) return event.checkoutDate > event.startDate;
    return Date.parse(event.endDateTime) > Date.parse(event.startDateTime);
  });

type CalendarEventInput = z.output<typeof calendarEventInput>;
type EndDateMode = SiteConfig["calendarInterpretation"]["allDayEndDateMode"];

function nextDate(date: string): string {
  const day = new Date(date);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().split("T")[0];
}

function eventPayload(event: CalendarEventInput, endDateMode: EndDateMode) {
  const text = {
    summary: event.title,
    description: event.description || undefined,
  };
  if ("startDate" in event) {
    return {
      ...text,
      visibility: "private",
      start: { date: event.startDate },
      end: {
        date:
          endDateMode === "checkout_day"
            ? nextDate(event.checkoutDate)
            : event.checkoutDate,
      },
    };
  }
  return {
    ...text,
    visibility: event.showAsViewerNote ? "default" : "private",
    start: { dateTime: new Date(event.startDateTime).toISOString() },
    end: { dateTime: new Date(event.endDateTime).toISOString() },
  };
}

export function makeGoogleEvent(
  site: SiteConfig,
  idempotencyKey: string,
  input: CalendarEventInput,
) {
  const event = eventPayload(
    input,
    site.calendarInterpretation.allDayEndDateMode,
  );
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  return {
    ...event,
    id: hash(JSON.stringify([site.site.id, idempotencyKey.toLowerCase()])),
    extendedProperties: {
      private: { houseCalendarPayload: hash(JSON.stringify(event)) },
    },
  };
}

const googleEventResponse = z.object({
  id: z.string(),
  htmlLink: z.string().optional(),
  status: z.string().optional(),
  extendedProperties: z
    .object({
      private: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});

function eventLink(link: string | undefined): string | null {
  if (!link || !URL.canParse(link)) return null;
  const url = new URL(link);
  if (url.username || url.password) return null;
  if (url.origin === "https://calendar.google.com") return url.href;
  if (
    url.origin === "https://www.google.com" &&
    url.pathname === "/calendar/event"
  )
    return url.href;
  return null;
}

export async function insertGoogleEvent({
  accessToken,
  calendarId,
  event,
}: {
  accessToken: string;
  calendarId: string;
  event: ReturnType<typeof makeGoogleEvent>;
}) {
  const url = googleEventsUrl(calendarId);
  const headers = { Authorization: `Bearer ${accessToken}` };
  const insertion = await googleFetch(url, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  if (insertion.status === 403 || insertion.status === 404) {
    return { kind: "calendar_access" } as const;
  }

  const replay = insertion.status === 409;
  if (replay) url.pathname += `/${event.id}`;
  const response = replay ? await googleFetch(url, { headers }) : insertion;
  if (replay && (response.status === 404 || response.status === 410)) {
    return { kind: "conflict" } as const;
  }
  if (!response.ok) throw new Error("Google event request failed.");

  const existing = googleEventResponse.parse(await response.json());
  if (existing.id !== event.id) throw new Error("Unexpected Google event ID.");
  if (
    replay &&
    (existing.status === "cancelled" ||
      existing.extendedProperties?.private?.houseCalendarPayload !==
        event.extendedProperties.private.houseCalendarPayload)
  ) {
    return { kind: "conflict" } as const;
  }
  return {
    kind: replay ? "replayed" : "created",
    eventId: existing.id,
    eventUrl: eventLink(existing.htmlLink),
  } as const;
}
