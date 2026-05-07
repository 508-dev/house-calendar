import { createFileRoute, redirect } from "@tanstack/react-router";
import { getAdminRedirectData } from "@/lib/server/start/page-data";

export const Route = createFileRoute("/admin/")({
  beforeLoad: async () => {
    const { target } = await getAdminRedirectData();
    throw redirect({ href: target });
  },
});
