import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/google-calendar/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { handleGoogleCalendarCallback } = await import(
          "@/lib/server/google-calendar-admin"
        );
        return handleGoogleCalendarCallback(request);
      },
    },
  },
});
