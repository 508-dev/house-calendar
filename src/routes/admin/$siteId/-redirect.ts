import { redirectResponse } from "@/lib/server/redirect-response";
import { buildRequestUrl } from "@/lib/server/request-url";

export function redirectToAdmin(
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

export function redirectToLogin(
  request: Request,
  params?: Record<string, string>,
) {
  const url = buildRequestUrl(request, "/admin/login");

  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }

  return redirectResponse(url);
}
