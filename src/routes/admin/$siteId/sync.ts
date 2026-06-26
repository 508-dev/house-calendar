import { createFileRoute } from "@tanstack/react-router";
import { redirectResponse } from "@/lib/server/redirect-response";
import { buildRequestUrl } from "@/lib/server/request-url";
import { redirectToAdmin } from "./-redirect";

export const Route = createFileRoute("/admin/$siteId/sync")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const { getSiteConfig } = await import("@/lib/config/config");
        const { loadAppConfig } = await import("@/lib/server/app-config");
        const { getCurrentAdminSession } = await import("@/lib/server/auth");
        const { refreshCalendarData } = await import(
          "@/lib/server/calendar-data"
        );
        const appConfig = await loadAppConfig();

        if (!getSiteConfig(appConfig, params.siteId)) {
          return new Response("Not found", { status: 404 });
        }

        const session = await getCurrentAdminSession(
          request.headers.get("cookie"),
        );

        if (!session) {
          return redirectResponse(buildRequestUrl(request, "/admin/login"));
        }

        try {
          const result = await refreshCalendarData(params.siteId);
          const message =
            result.source === "sample"
              ? "No all-day ICS events were imported. Sample data is still active in development."
              : result.importedEventCount > 0
                ? `Imported ${result.importedEventCount} all-day events from ICS.`
                : "No all-day ICS events were imported.";

          return redirectToAdmin(request, params.siteId, {
            message,
            sync: "ok",
          });
        } catch (error) {
          console.error("Manual ICS sync failed.", error);

          return redirectToAdmin(request, params.siteId, {
            error: "Manual ICS sync failed. Check the server logs.",
            sync: "error",
          });
        }
      },
    },
  },
});
