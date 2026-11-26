import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/sites/$siteId/events")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        const { createCalendarEvent } = await import(
          "@/lib/server/google-calendar-api"
        );
        return createCalendarEvent(request, params.siteId);
      },
    },
  },
});
