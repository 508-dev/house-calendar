import { z } from "zod";
import { loadSiteConfig } from "./app-config";
import { getCurrentAdminSession } from "./auth";
import { invalidateCalendarData } from "./calendar-data";
import {
  calendarEventInput,
  insertGoogleEvent,
  makeGoogleEvent,
} from "./google-calendar-events";
import { getGoogleAccessToken } from "./google-calendar-oauth";
import {
  getGoogleOAuthSettings,
  getGoogleWriteTarget,
  matchesCalendarApiToken,
} from "./google-calendar-settings";

const maxBodyBytes = 32 * 1024;

async function readEventBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;

  let bytes = 0;
  let body = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(body + decoder.decode());
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) return null;
      body += decoder.decode(value, { stream: true });
    }
  } catch {
    return null;
  } finally {
    void reader.cancel().catch(() => {});
  }
}

function respond(status: number, body: object) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function failure(status: number, code: string, message: string) {
  return respond(status, { error: { code, message } });
}

export async function createCalendarEvent(request: Request, siteId: string) {
  try {
    const authorization = request.headers.get("Authorization");
    const settings = getGoogleOAuthSettings();
    const site = await loadSiteConfig(siteId);
    const target = site ? getGoogleWriteTarget(site) : null;
    if (authorization !== null) {
      if (!matchesCalendarApiToken(authorization, target?.apiToken)) {
        return failure(
          401,
          "unauthorized",
          "A valid API token for this house is required.",
        );
      }
    } else {
      const session = await getCurrentAdminSession(
        request.headers.get("Cookie"),
      );
      if (!session)
        return failure(
          401,
          "unauthorized",
          "Sign in as admin to create events.",
        );
      if (settings && request.headers.get("Origin") !== settings.origin) {
        return failure(
          403,
          "invalid_origin",
          "Open the admin page at its configured address.",
        );
      }
    }
    if (!site) return failure(404, "site_not_found", "House not found.");
    if (!target || !settings) {
      return failure(
        503,
        "calendar_unavailable",
        "Google Calendar writes are unavailable for this house.",
      );
    }

    const idempotencyKey = z
      .uuid()
      .safeParse(request.headers.get("Idempotency-Key"));
    if (!idempotencyKey.success) {
      return failure(
        400,
        "invalid_idempotency_key",
        "Send a UUID in the Idempotency-Key header.",
      );
    }
    const contentType = request.headers
      .get("Content-Type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== "application/json") {
      return failure(
        415,
        "unsupported_content_type",
        "Send an application/json request body.",
      );
    }

    const input = calendarEventInput.safeParse(await readEventBody(request));
    if (!input.success) {
      return failure(
        400,
        "invalid_event",
        "Enter a title and a valid date or time range. The end must be after the start.",
      );
    }

    const accessToken = await getGoogleAccessToken(settings);
    if (!accessToken) {
      return failure(
        409,
        "google_reconnect_required",
        "Connect or reconnect Google Calendar in admin.",
      );
    }

    const result = await insertGoogleEvent({
      accessToken,
      calendarId: target.calendarId,
      event: makeGoogleEvent(site, idempotencyKey.data, input.data),
    });
    if (result.kind === "calendar_access") {
      return failure(
        502,
        "google_calendar_access",
        "Google refused access to the configured calendar. Check calendar ownership and configuration.",
      );
    }
    if (result.kind === "conflict") {
      return failure(
        409,
        "idempotency_conflict",
        "This idempotency key is already associated with another event.",
      );
    }
    invalidateCalendarData(siteId);
    return respond(result.kind === "created" ? 201 : 200, {
      eventId: result.eventId,
      eventUrl: result.eventUrl,
    });
  } catch {
    console.error("Google Calendar event creation failed.", { siteId });
    return failure(
      502,
      "google_unavailable",
      "Calendar creation could not be confirmed. Retry using the same idempotency key.",
    );
  }
}
