import { describe, expect, test } from "bun:test";
import { setAdminSessionCookie } from "./auth";
import { redirectResponse } from "./redirect-response";

describe("redirectResponse", () => {
  test("creates mutable headers so auth cookies can be appended", () => {
    const expiresAt = new Date("2026-06-06T00:00:00.000Z");
    const response = redirectResponse("https://example.com/admin/tokyo");

    setAdminSessionCookie(response, {
      email: "owner@example.com",
      expiresAt,
      token: "session-token",
      userId: 1,
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://example.com/admin/tokyo",
    );
    expect(response.headers.get("set-cookie")).toContain(
      "house_calendar_admin_session=session-token",
    );
  });
});
