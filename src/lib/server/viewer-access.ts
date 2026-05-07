import { createHmac, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "@/lib/config/config";
import { serverEnv } from "./env";
import { appendSetCookie, readCookie, serializeCookie } from "./http-cookies";

const VIEWER_ACCESS_COOKIE = "house_calendar_viewer_access";
const VIEWER_ACCESS_DURATION_DAYS = 30;
const VIEWER_ACCESS_MARKER = "viewer-access-unlocked";

export type ViewerAccessState = {
  configured: boolean;
  mode: AppConfig["viewerAccess"]["mode"];
  unlocked: boolean;
};

function secureStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isViewerAccessPasswordEnabled(config: AppConfig): boolean {
  return config.viewerAccess.mode === "password";
}

export function verifyViewerPassword(password: string): boolean {
  if (!serverEnv.VIEWER_PASSWORD) {
    return false;
  }

  return secureStringEqual(password, serverEnv.VIEWER_PASSWORD);
}

function buildViewerAccessToken(password: string): string {
  return createHmac("sha256", password)
    .update(VIEWER_ACCESS_MARKER)
    .digest("base64url");
}

export async function getViewerAccessState(
  config: AppConfig,
  cookieHeader?: string | null,
): Promise<ViewerAccessState> {
  if (!isViewerAccessPasswordEnabled(config)) {
    return {
      configured: true,
      mode: config.viewerAccess.mode,
      unlocked: true,
    };
  }

  if (!serverEnv.VIEWER_PASSWORD) {
    return {
      configured: false,
      mode: config.viewerAccess.mode,
      unlocked: false,
    };
  }

  const token = readCookie(cookieHeader, VIEWER_ACCESS_COOKIE);

  return {
    configured: true,
    mode: config.viewerAccess.mode,
    unlocked:
      token !== undefined &&
      secureStringEqual(
        token,
        buildViewerAccessToken(serverEnv.VIEWER_PASSWORD),
      ),
  };
}

export function setViewerAccessCookie(response: Response): void {
  if (!serverEnv.VIEWER_PASSWORD) {
    throw new Error("VIEWER_PASSWORD is not configured.");
  }

  appendSetCookie(
    response,
    serializeCookie({
      expires: new Date(
        Date.now() + VIEWER_ACCESS_DURATION_DAYS * 24 * 60 * 60 * 1000,
      ),
      httpOnly: true,
      name: VIEWER_ACCESS_COOKIE,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      value: buildViewerAccessToken(serverEnv.VIEWER_PASSWORD),
    }),
  );
}
