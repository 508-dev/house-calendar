import type { SiteConfig } from "@/lib/config/config";
import { loadSiteConfig } from "./app-config";
import { getAdminSessionToken, getCurrentAdminSession } from "./auth";
import {
  claimGoogleOAuthState,
  disconnectGoogleCalendar,
  finishGoogleConnection,
  getGoogleConnectionStatus,
  startGoogleConnection,
} from "./google-calendar-oauth";
import {
  getGoogleOAuthSettings,
  getGoogleWriteTarget,
} from "./google-calendar-settings";

function adminRedirect(siteId: string, result: string) {
  return oauthRedirect(
    `/admin/${encodeURIComponent(siteId)}?googleCalendar=${result}`,
  );
}

function oauthRedirect(location: URL | string) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: String(location),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function oauthError(message: string, status: number) {
  return new Response(message, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

async function getBrowserAdminSession(request: Request) {
  const cookie = request.headers.get("Cookie");
  const session = await getCurrentAdminSession(cookie);
  return session ? getAdminSessionToken(cookie) : undefined;
}

export async function updateGoogleConnection(
  request: Request,
  siteId: string,
  action: "connect" | "disconnect",
) {
  try {
    const sessionToken = await getBrowserAdminSession(request);
    if (!sessionToken) return oauthRedirect("/admin/login");
    const settings = getGoogleOAuthSettings();
    if (!settings) return adminRedirect(siteId, "unavailable");
    if (request.headers.get("Origin") !== settings.origin) {
      return oauthError("Open the admin page at its configured address.", 403);
    }
    const site = await loadSiteConfig(siteId);
    if (!site?.googleCalendarWrite) return oauthError("Not found.", 404);
    if (action === "disconnect") {
      const revoked = await disconnectGoogleCalendar(settings);
      return adminRedirect(siteId, revoked ? "disconnected" : "manual_revoke");
    }
    if (!getGoogleWriteTarget(site))
      return adminRedirect(siteId, "unavailable");
    return oauthRedirect(
      await startGoogleConnection(settings, sessionToken, siteId),
    );
  } catch {
    console.error("Google Calendar connection update failed.", {
      siteId,
      action,
    });
    return adminRedirect(siteId, "failed");
  }
}

export async function handleGoogleCalendarCallback(request: Request) {
  let siteId: string | undefined;
  try {
    const settings = getGoogleOAuthSettings();
    if (!settings) return oauthError("Google Calendar is unavailable.", 503);

    const sessionToken = await getBrowserAdminSession(request);
    if (!sessionToken) return oauthRedirect("/admin/login");
    const query = new URL(request.url).searchParams;
    const state = query.get("state");
    if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
      return oauthError(
        "Invalid Google Calendar authorization. Start again from admin.",
        400,
      );
    }
    const attempt = await claimGoogleOAuthState(state, sessionToken);
    if (!attempt) {
      return oauthError(
        "Google Calendar authorization expired or was already used. Start again from admin.",
        400,
      );
    }
    siteId = attempt.siteId;

    const code = query.get("code");
    if (query.has("error") || !code) return adminRedirect(siteId, "cancelled");

    const site = await loadSiteConfig(siteId);
    const target = site ? getGoogleWriteTarget(site) : null;
    if (!target) return adminRedirect(siteId, "unavailable");

    const result = await finishGoogleConnection(
      settings,
      attempt,
      code,
      target.calendarId,
    );
    return adminRedirect(siteId, result);
  } catch {
    console.error("Google Calendar authorization failed.", { siteId });
    return siteId
      ? adminRedirect(siteId, "failed")
      : oauthError(
          "Google Calendar authorization failed. Start again from admin.",
          502,
        );
  }
}

export async function getGoogleCalendarAdminData(site: SiteConfig) {
  if (!site.googleCalendarWrite) return null;
  const settings = getGoogleOAuthSettings();
  const target = getGoogleWriteTarget(site);
  if (!settings) return { status: "unavailable" as const };

  try {
    const status = await getGoogleConnectionStatus(settings);
    if (!target) {
      return {
        status: "unavailable" as const,
        canDisconnect: status !== "disconnected",
      };
    }
    return {
      status,
      sourceLabel: target.sourceLabel,
      showViewerNotes: site.calendarDisplay.timedNotes.enabled,
      includesCheckoutDay:
        site.calendarInterpretation.allDayEndDateMode === "checkout_day",
    };
  } catch {
    console.error("Google Calendar connection state could not be loaded.", {
      siteId: site.site.id,
    });
    return { status: "unavailable" as const };
  }
}
