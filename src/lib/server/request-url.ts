function getFirstHeaderValue(
  request: Request,
  name: string,
): string | undefined {
  const value = request.headers.get(name);

  if (!value) {
    return undefined;
  }

  const firstValue = value.split(",")[0]?.trim();
  return firstValue ? firstValue : undefined;
}

function getForwardedProtocol(
  request: Request,
): "http:" | "https:" | undefined {
  const value = getFirstHeaderValue(request, "x-forwarded-proto");

  if (!value) {
    return undefined;
  }

  const normalized = value.endsWith(":") ? value.slice(0, -1) : value;

  if (normalized === "http" || normalized === "https") {
    return `${normalized}:`;
  }

  return undefined;
}

function getForwardedHost(request: Request): URL | undefined {
  const value =
    getFirstHeaderValue(request, "x-forwarded-host") ??
    getFirstHeaderValue(request, "host");

  if (!value) {
    return undefined;
  }

  try {
    const parsed = new URL(`http://${value}`);

    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return undefined;
    }

    return parsed;
  } catch {
    return undefined;
  }
}

export function buildRequestUrl(request: Request, path: string): URL {
  const url = new URL(request.url);

  const forwardedProtocol = getForwardedProtocol(request);
  const forwardedHost = getForwardedHost(request);

  if (forwardedProtocol) {
    url.protocol = forwardedProtocol;
  }

  if (forwardedHost) {
    url.hostname = forwardedHost.hostname;
    url.port = forwardedHost.port;
  }

  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url;
}
