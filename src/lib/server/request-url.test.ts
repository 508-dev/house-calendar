import { describe, expect, test } from "bun:test";
import { buildRequestUrl } from "./request-url";

describe("request URL helpers", () => {
  test("reuses request URL metadata for same-origin redirects", () => {
    const request = new Request(
      "https://house.example.com/admin/login?error=bad#ignored",
      {
        method: "POST",
      },
    );

    expect(buildRequestUrl(request, "/admin/tokyo").toString()).toBe(
      "https://house.example.com/admin/tokyo",
    );
  });

  test("prefers forwarded origin headers when the app sees an internal host", () => {
    const request = new Request("http://localhost:3000/tokyo/viewer-access", {
      headers: {
        host: "localhost:3000",
        "x-forwarded-host": "house.example.com",
        "x-forwarded-proto": "https",
      },
      method: "POST",
    });

    expect(buildRequestUrl(request, "/tokyo").toString()).toBe(
      "https://house.example.com/tokyo",
    );
  });

  test("clears the original query string before callers add redirect params", () => {
    const request = new Request(
      "https://house.example.com/tokyo/viewer-access?from=elsewhere",
      {
        method: "POST",
      },
    );

    const url = buildRequestUrl(request, "/tokyo");
    url.searchParams.set("viewerAccessError", "invalid");

    expect(url.toString()).toBe(
      "https://house.example.com/tokyo?viewerAccessError=invalid",
    );
  });
});
