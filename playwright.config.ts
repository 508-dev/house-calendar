import { defineConfig, devices } from "@playwright/test";
import { resolveWorktreePorts } from "./scripts/worktree-ports";

const configuredBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/+$/, "");
const portBundle = configuredBaseUrl
  ? null
  : await resolveWorktreePorts({ worktreeRoot: process.cwd() });

const resolvedPort = portBundle?.app.port;
const reuseExistingServer = ["1", "true"].includes(
  process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER?.toLowerCase() ?? "",
);
let baseURL = configuredBaseUrl;

if (!baseURL) {
  if (!resolvedPort) {
    throw new Error("Unable to resolve a Playwright app port.");
  }

  baseURL = `http://127.0.0.1:${resolvedPort}`;
}

if (!configuredBaseUrl && resolvedPort) {
  process.env.HOUSE_CALENDAR_CONFIG_PATH = "config/config.example.json";
  process.env.PLAYWRIGHT_BASE_URL = baseURL;
  process.env.WORKTREE_DEV_PORT = String(resolvedPort);
}

export default defineConfig({
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  testDir: "./tests/integration",
  testMatch: "**/*.playwright.ts",
  timeout: 30_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: configuredBaseUrl
    ? undefined
    : {
        command: "bun dev",
        reuseExistingServer,
        timeout: 120_000,
        url: `${baseURL}/api/health`,
      },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { height: 900, width: 1280 },
      },
    },
  ],
});
