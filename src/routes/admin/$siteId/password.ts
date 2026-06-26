import { createFileRoute } from "@tanstack/react-router";
import { redirectResponse } from "@/lib/server/redirect-response";
import { buildRequestUrl } from "@/lib/server/request-url";

function redirectToAdmin(
  request: Request,
  siteId: string,
  params?: Record<string, string>,
) {
  const url = buildRequestUrl(request, `/admin/${siteId}`);

  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }

  return redirectResponse(url);
}

function redirectToLogin(request: Request, params?: Record<string, string>) {
  const url = buildRequestUrl(request, "/admin/login");

  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }

  return redirectResponse(url);
}

export const Route = createFileRoute("/admin/$siteId/password")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const { getSiteConfig } = await import("@/lib/config/config");
        const { loadAppConfig } = await import("@/lib/server/app-config");
        const {
          changeAdminPassword,
          clearAdminSessionCookie,
          getAdminSessionToken,
          setAdminSessionCookie,
        } = await import("@/lib/server/auth");
        const appConfig = await loadAppConfig();

        if (!getSiteConfig(appConfig, params.siteId)) {
          return new Response("Not found", { status: 404 });
        }

        const currentSessionToken = getAdminSessionToken(
          request.headers.get("cookie"),
        );

        if (!currentSessionToken) {
          const response = redirectToLogin(request, {
            error: "Admin session has expired. Sign in again.",
          });
          clearAdminSessionCookie(response);
          return response;
        }

        const formData = await request.formData();
        const newPassword = String(formData.get("newPassword") ?? "");
        const confirmNewPassword = String(
          formData.get("confirmNewPassword") ?? "",
        );

        if (newPassword !== confirmNewPassword) {
          return redirectToAdmin(request, params.siteId, {
            passwordError: "New passwords do not match.",
          });
        }

        const result = await changeAdminPassword({
          adminSecurity: appConfig.adminSecurity,
          currentPassword: String(formData.get("currentPassword") ?? ""),
          currentSessionToken,
          newPassword,
          request,
        });

        if (!result.ok) {
          if (result.requiresLogin) {
            const response = redirectToLogin(request, {
              error: result.error,
            });
            clearAdminSessionCookie(response);
            return response;
          }

          return redirectToAdmin(request, params.siteId, {
            passwordError: result.error,
          });
        }

        const response = redirectToAdmin(request, params.siteId, {
          message: "Admin password changed. Other admin sessions were revoked.",
        });
        setAdminSessionCookie(response, result.session);
        return response;
      },
    },
  },
});
