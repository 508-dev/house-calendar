import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import type { AppConfig, SiteConfig } from "@/lib/config/config";

function getCookieHeader(): string | null {
  return getRequestHeader("cookie") ?? null;
}

function buildViewerSiteTabs(appConfig: AppConfig) {
  return appConfig.sites.map((siteConfig: SiteConfig) => ({
    href: `/${siteConfig.site.id}`,
    id: siteConfig.site.id,
    label: siteConfig.site.houseName,
  }));
}

function buildAdminSiteTabs(appConfig: AppConfig) {
  return appConfig.sites.map((siteConfig: SiteConfig) => ({
    href: `/admin/${siteConfig.site.id}`,
    id: siteConfig.site.id,
    label: siteConfig.site.houseName,
  }));
}

export const getHomeRedirectData = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getDefaultSiteId } = await import("@/lib/config/config");
    const { loadAppConfig } = await import("@/lib/server/app-config");
    const appConfig = await loadAppConfig();
    return { siteId: getDefaultSiteId(appConfig) };
  },
);

export const getDefaultMetadata = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getDefaultSiteId, getSiteConfig } = await import(
      "@/lib/config/config"
    );
    const { loadAppConfig } = await import("@/lib/server/app-config");
    const { buildFallbackMetadata, buildSiteMetadata } = await import(
      "@/lib/site-metadata"
    );
    const appConfig = await loadAppConfig();
    const siteConfig = getSiteConfig(appConfig, getDefaultSiteId(appConfig));
    return siteConfig
      ? buildSiteMetadata(siteConfig.site.branding)
      : buildFallbackMetadata();
  },
);

export const getViewerPageData = createServerFn({ method: "GET" })
  .inputValidator(z.object({ siteId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { configToHouseConfig, getSiteConfig } = await import(
      "@/lib/config/config"
    );
    const { loadAppConfig } = await import("@/lib/server/app-config");
    const { loadCalendarData } = await import("@/lib/server/calendar-data");
    const { getViewerAccessState } = await import("@/lib/server/viewer-access");
    const { buildSiteMetadata } = await import("@/lib/site-metadata");
    const appConfig = await loadAppConfig();
    const siteConfig = getSiteConfig(appConfig, data.siteId);

    if (!siteConfig) {
      return { kind: "not-found" as const };
    }

    const viewerAccess = await getViewerAccessState(
      appConfig,
      getCookieHeader(),
    );

    if (!viewerAccess.unlocked) {
      return {
        kind: "locked" as const,
        metadata: buildSiteMetadata(siteConfig.site.branding),
        site: {
          id: siteConfig.site.id,
        },
        viewerAccess,
      };
    }

    const houseConfig = configToHouseConfig(siteConfig);
    const { availability, source, warnings } = await loadCalendarData({
      appConfig,
      houseConfig,
      siteConfig,
    });
    const timedNotes = siteConfig.calendarDisplay.timedNotes;
    const calendarDays = timedNotes.enabled
      ? availability
      : availability.map((day) => ({
          ...day,
          events: [],
        }));

    return {
      availability: calendarDays,
      house: {
        name: houseConfig.name,
        timezone: houseConfig.timezone,
      },
      kind: "ready" as const,
      metadata: buildSiteMetadata(siteConfig.site.branding),
      site: {
        id: siteConfig.site.id,
      },
      siteTabs: buildViewerSiteTabs(appConfig),
      source,
      timedNotes,
      warnings,
    };
  });

export const getAdminRedirectData = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getDefaultSiteId } = await import("@/lib/config/config");
    const { loadAppConfig } = await import("@/lib/server/app-config");
    const { getAdminAuthStateForCookieHeader } = await import(
      "@/lib/server/auth"
    );
    const [authState, appConfig] = await Promise.all([
      getAdminAuthStateForCookieHeader(getCookieHeader()),
      loadAppConfig(),
    ]);

    if (!authState.initialized) {
      return { target: "/admin/setup" };
    }

    if (!authState.session) {
      return { target: "/admin/login" };
    }

    return { target: `/admin/${getDefaultSiteId(appConfig)}` };
  },
);

export const getAdminLoginPageData = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getDefaultSiteId } = await import("@/lib/config/config");
    const { loadAppConfig } = await import("@/lib/server/app-config");
    const { getAdminAuthStateForCookieHeader } = await import(
      "@/lib/server/auth"
    );
    const [authState, appConfig] = await Promise.all([
      getAdminAuthStateForCookieHeader(getCookieHeader()),
      loadAppConfig(),
    ]);

    if (!authState.initialized) {
      return { kind: "redirect" as const, target: "/admin/setup" };
    }

    if (authState.session) {
      return {
        kind: "redirect" as const,
        target: `/admin/${getDefaultSiteId(appConfig)}`,
      };
    }

    const { getAdminLoginChallengeUiConfig } = await import(
      "@/lib/server/auth/login-protection"
    );

    return {
      challenge: getAdminLoginChallengeUiConfig(appConfig.adminSecurity),
      kind: "ready" as const,
    };
  },
);

export const getAdminSetupPageData = createServerFn({ method: "GET" }).handler(
  async () => {
    const { getDefaultSiteId } = await import("@/lib/config/config");
    const { loadAppConfig } = await import("@/lib/server/app-config");
    const { getAdminAuthStateForCookieHeader } = await import(
      "@/lib/server/auth"
    );
    const [authState, appConfig] = await Promise.all([
      getAdminAuthStateForCookieHeader(getCookieHeader()),
      loadAppConfig(),
    ]);

    if (authState.initialized) {
      return {
        kind: "redirect" as const,
        target: authState.session
          ? `/admin/${getDefaultSiteId(appConfig)}`
          : "/admin/login",
      };
    }

    return {
      authState: {
        bootstrapCodeReady: authState.bootstrapCodeReady,
        databaseConfigured: authState.databaseConfigured,
      },
      kind: "ready" as const,
    };
  },
);

export const getAdminSitePageData = createServerFn({ method: "GET" })
  .inputValidator(z.object({ siteId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { configToHouseConfig, getSiteConfig } = await import(
      "@/lib/config/config"
    );
    const { currentDateInTimeZone } = await import("@/lib/house/date");
    const { loadAppConfig } = await import("@/lib/server/app-config");
    const { getAdminAuthStateForCookieHeader } = await import(
      "@/lib/server/auth"
    );
    const { loadCalendarData } = await import("@/lib/server/calendar-data");
    const [authState, appConfig] = await Promise.all([
      getAdminAuthStateForCookieHeader(getCookieHeader()),
      loadAppConfig(),
    ]);
    const siteConfig = getSiteConfig(appConfig, data.siteId);

    if (!siteConfig) {
      return { kind: "not-found" as const };
    }

    if (!authState.initialized) {
      return { kind: "redirect" as const, target: "/admin/setup" };
    }

    if (!authState.session) {
      return { kind: "redirect" as const, target: "/admin/login" };
    }

    const houseConfig = configToHouseConfig(siteConfig);
    const calendarData = await loadCalendarData({
      appConfig,
      houseConfig,
      siteConfig,
    });
    const today = currentDateInTimeZone(houseConfig.timezone);
    const interpretationRows = calendarData.eventInterpretations
      .filter((row) => row.raw.endDate >= today)
      .sort((left, right) => {
        const startComparison = left.raw.startDate.localeCompare(
          right.raw.startDate,
        );

        if (startComparison !== 0) {
          return startComparison;
        }

        const endComparison = left.raw.endDate.localeCompare(right.raw.endDate);

        if (endComparison !== 0) {
          return endComparison;
        }

        return left.raw.title.localeCompare(right.raw.title);
      });

    return {
      authEmail: authState.session.email,
      calendarData: {
        cacheTtlMinutes: calendarData.cacheTtlMinutes,
        fetchedAt: calendarData.fetchedAt,
        importedEventCount: calendarData.importedEventCount,
        nextRefreshAt: calendarData.nextRefreshAt,
        source: calendarData.source,
        warnings: calendarData.warnings,
      },
      houseConfig,
      interpretationRows,
      kind: "ready" as const,
      metadata: {
        title: `${siteConfig.site.branding.title} admin`,
      },
      site: {
        houseName: siteConfig.site.houseName,
        id: siteConfig.site.id,
      },
      siteTabs: buildAdminSiteTabs(appConfig),
      unknownInterpretationCount: interpretationRows.filter(
        (row) => row.raw.allDay && row.parsed.type === "unknown",
      ).length,
    };
  });

export async function getAdminSessionForRequest(request: Request) {
  const { getCurrentAdminSession } = await import("@/lib/server/auth");
  return getCurrentAdminSession(request.headers.get("cookie"));
}
