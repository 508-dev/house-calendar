import { createFileRoute } from "@tanstack/react-router";
import { redirectResponse } from "@/lib/server/redirect-response";
import { buildRequestUrl } from "@/lib/server/request-url";

export const Route = createFileRoute("/$siteId/viewer-access")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const { getSiteConfig } = await import("@/lib/config/config");
        const { loadAppConfig } = await import("@/lib/server/app-config");
        const {
          isViewerAccessPasswordConfigured,
          isViewerAccessPasswordEnabled,
          setViewerAccessCookie,
          verifyViewerPassword,
        } = await import("@/lib/server/viewer-access");
        const appConfig = await loadAppConfig();
        const siteConfig = getSiteConfig(appConfig, params.siteId);

        if (!siteConfig) {
          return new Response("Not found", { status: 404 });
        }

        const redirectUrl = buildRequestUrl(request, `/${siteConfig.site.id}`);

        if (!isViewerAccessPasswordEnabled(appConfig)) {
          return redirectResponse(redirectUrl);
        }

        if (!isViewerAccessPasswordConfigured()) {
          redirectUrl.searchParams.set("viewerAccessError", "misconfigured");
          return redirectResponse(redirectUrl);
        }

        const formData = await request.formData();
        const password = String(formData.get("password") ?? "");

        if (!verifyViewerPassword(password)) {
          redirectUrl.searchParams.set("viewerAccessError", "invalid");
          return redirectResponse(redirectUrl);
        }

        const response = redirectResponse(redirectUrl);
        setViewerAccessCookie(response);
        return response;
      },
    },
  },
});
