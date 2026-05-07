import { createFileRoute, redirect } from "@tanstack/react-router";
import { getHomeRedirectData } from "@/lib/server/start/page-data";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { siteId } = await getHomeRedirectData();
    throw redirect({ href: `/${siteId}` });
  },
});
