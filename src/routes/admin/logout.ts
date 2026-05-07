import { createFileRoute } from "@tanstack/react-router";
import { redirectResponse } from "@/lib/server/redirect-response";
import { buildRequestUrl } from "@/lib/server/request-url";

export const Route = createFileRoute("/admin/logout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const {
          clearAdminSessionCookie,
          getAdminSessionToken,
          revokeAdminSession,
        } = await import("@/lib/server/auth");

        await revokeAdminSession(
          getAdminSessionToken(request.headers.get("cookie")),
        );

        const response = redirectResponse(
          buildRequestUrl(request, "/admin/login"),
        );
        clearAdminSessionCookie(response);
        return response;
      },
    },
  },
});
