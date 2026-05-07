import { createFileRoute } from "@tanstack/react-router";
import { redirectResponse } from "@/lib/server/redirect-response";
import { buildRequestUrl } from "@/lib/server/request-url";

function redirectWithError(request: Request, error: string) {
  const url = buildRequestUrl(request, "/admin/setup");
  url.searchParams.set("error", error);
  return redirectResponse(url);
}

export const Route = createFileRoute("/admin/setup/submit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getDefaultSiteId } = await import("@/lib/config/config");
        const { loadAppConfig } = await import("@/lib/server/app-config");
        const { bootstrapAdmin, setAdminSessionCookie } = await import(
          "@/lib/server/auth"
        );
        const formData = await request.formData();
        const result = await bootstrapAdmin({
          bootstrapCode: String(formData.get("bootstrapCode") ?? ""),
          email: String(formData.get("email") ?? ""),
          password: String(formData.get("password") ?? ""),
        });

        if (!result.ok) {
          return redirectWithError(request, result.error);
        }

        const appConfig = await loadAppConfig();
        const response = redirectResponse(
          buildRequestUrl(request, `/admin/${getDefaultSiteId(appConfig)}`),
        );
        setAdminSessionCookie(response, result.session);
        return response;
      },
    },
  },
});
