import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const { serverEnv } = await import("@/lib/server/env");

        return Response.json({
          database: {
            configured: Boolean(serverEnv.DATABASE_URL),
            kind: "postgres",
            port: serverEnv.POSTGRES_PORT ?? null,
          },
          ok: true,
          service: "house-calendar",
        });
      },
    },
  },
});
