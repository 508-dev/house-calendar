import { createFileRoute } from "@tanstack/react-router";
import { redirectResponse } from "@/lib/server/redirect-response";
import { buildRequestUrl } from "@/lib/server/request-url";

function redirectWithParams(request: Request, params: Record<string, string>) {
  const url = buildRequestUrl(request, "/admin/login");

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return redirectResponse(url);
}

export const Route = createFileRoute("/admin/login/submit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getDefaultSiteId } = await import("@/lib/config/config");
        const { loadAppConfig } = await import("@/lib/server/app-config");
        const { loginAdmin, setAdminSessionCookie } = await import(
          "@/lib/server/auth"
        );
        const appConfig = await loadAppConfig();
        const formData = await request.formData();
        const result = await loginAdmin({
          adminSecurity: appConfig.adminSecurity,
          challengeToken: String(formData.get("cf-turnstile-response") ?? ""),
          email: String(formData.get("email") ?? ""),
          password: String(formData.get("password") ?? ""),
          request,
        });

        if (!result.ok) {
          return redirectWithParams(request, {
            ...(result.challengeRequired ? { challenge: "1" } : {}),
            error: result.error,
          });
        }

        const response = redirectResponse(
          buildRequestUrl(request, `/admin/${getDefaultSiteId(appConfig)}`),
        );
        setAdminSessionCookie(response, result.session);
        return response;
      },
    },
  },
});
