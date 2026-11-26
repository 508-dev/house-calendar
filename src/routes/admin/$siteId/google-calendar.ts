import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/$siteId/google-calendar")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const action = new URL(request.url).searchParams.get("action");
        if (action !== "connect" && action !== "disconnect") {
          return new Response("Bad request.", { status: 400 });
        }

        const { updateGoogleConnection } = await import(
          "@/lib/server/google-calendar-admin"
        );
        return updateGoogleConnection(request, params.siteId, action);
      },
    },
  },
});
