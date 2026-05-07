type CookieOptions = {
  expires?: Date;
  httpOnly?: boolean;
  name: string;
  path?: string;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
  value: string;
};

export function readCookie(
  cookieHeader: string | null | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  for (const part of cookieHeader.split(/;\s*/)) {
    const separatorIndex = part.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    if (part.slice(0, separatorIndex) === name) {
      return decodeURIComponent(part.slice(separatorIndex + 1));
    }
  }

  return undefined;
}

export function serializeCookie({
  expires,
  httpOnly,
  name,
  path = "/",
  sameSite = "lax",
  secure,
  value,
}: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`];

  if (expires) {
    parts.push(`Expires=${expires.toUTCString()}`);
  }

  if (httpOnly) {
    parts.push("HttpOnly");
  }

  if (secure) {
    parts.push("Secure");
  }

  parts.push(`SameSite=${sameSite[0]?.toUpperCase()}${sameSite.slice(1)}`);

  return parts.join("; ");
}

export function appendSetCookie(response: Response, cookie: string): void {
  response.headers.append("Set-Cookie", cookie);
}
