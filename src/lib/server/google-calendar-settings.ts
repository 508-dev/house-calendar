import { createHash, timingSafeEqual } from "node:crypto";
import type { SiteConfig } from "@/lib/config/config";
import { resolveCalendarUrl } from "./app-config";

export const GOOGLE_CALENDAR_CALLBACK_PATH = "/admin/google-calendar/callback";
export const GOOGLE_CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.owned";

export function getGoogleOAuthSettings() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim();
  const key = process.env.GOOGLE_CALENDAR_TOKEN_KEY?.trim();
  const redirectUri = process.env.GOOGLE_CALENDAR_OAUTH_REDIRECT_URI?.trim();
  if (
    !clientId ||
    !clientSecret ||
    !key ||
    !/^[0-9a-f]{64}$/i.test(key) ||
    !redirectUri
  ) {
    return null;
  }

  const redirectUrl = URL.canParse(redirectUri) ? new URL(redirectUri) : null;
  const localDevelopment =
    process.env.NODE_ENV !== "production" &&
    redirectUrl?.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(redirectUrl.hostname);
  if (
    !redirectUrl ||
    (redirectUrl.protocol !== "https:" && !localDevelopment) ||
    redirectUrl.pathname !== GOOGLE_CALENDAR_CALLBACK_PATH ||
    redirectUri !== `${redirectUrl.origin}${GOOGLE_CALENDAR_CALLBACK_PATH}`
  ) {
    return null;
  }

  return {
    clientId,
    clientSecret,
    key: Buffer.from(key, "hex"),
    origin: redirectUrl.origin,
    redirectUri,
  };
}

export type GoogleOAuthSettings = NonNullable<
  ReturnType<typeof getGoogleOAuthSettings>
>;

export function getGoogleWriteTarget(site: SiteConfig) {
  const write = site.googleCalendarWrite;
  if (!write) return null;

  const source = site.calendars.find(
    (calendar) => calendar.id === write.icsSourceId,
  );
  const calendarId = process.env[write.calendarIdEnvVar]?.trim();
  if (
    !source ||
    !resolveCalendarUrl(source) ||
    !calendarId ||
    calendarId === "primary"
  ) {
    return null;
  }

  return {
    calendarId,
    sourceLabel: source.label,
    apiToken: write.apiTokenEnvVar
      ? process.env[write.apiTokenEnvVar]?.trim()
      : undefined,
  };
}

export function matchesCalendarApiToken(
  authorization: string,
  token: string | undefined,
): boolean {
  if (!token || !/^[A-Za-z0-9_-]{32,}$/.test(token)) return false;
  const bearer = /^Bearer ([A-Za-z0-9_-]+)$/i.exec(authorization)?.[1];
  if (!bearer) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(bearer), digest(token));
}

export function googleEventsUrl(calendarId: string): URL {
  return new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
  );
}

export function googleFetch(url: URL | string, init?: RequestInit) {
  return fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
}
