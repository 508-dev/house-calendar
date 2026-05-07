import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { type Subprocess, spawn } from "bun";
import { getDefaultSiteId } from "@/lib/config/config";
import { loadAppConfig } from "@/lib/server/app-config";
import { resolveWorktreePorts } from "./worktree-ports";

type CheckResult = {
  detail?: string;
  name: string;
};

type RegressionArgs = {
  adminEmail?: string;
  adminPassword?: string;
  siteId?: string;
  url?: string;
};

const privateMarkerPatterns = [
  /calendar\.google/i,
  /basic\.ics/i,
  /ICS_URL/,
  /"aliases"/,
  /"envVar"/,
  /"people"/,
  /"publicVisibility"/,
  /"rules"/,
  /"sharePolicies"/,
  /"calendars"/,
  /private-/i,
];

const serverBundlePatterns = [
  /node:crypto/,
  /postgres\/src/,
  /drizzle-orm\/postgres/i,
  /process\.env\.DATABASE_URL/,
  /serverEnv/,
];

const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".txt",
]);

function parseOptionalPort(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65_535) {
    return undefined;
  }

  return parsed;
}

function parseArgs(argv: string[]): RegressionArgs {
  const args: RegressionArgs = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--url") {
      args.url = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--url=")) {
      args.url = arg.slice("--url=".length);
      continue;
    }

    if (arg === "--site") {
      args.siteId = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--site=")) {
      args.siteId = arg.slice("--site=".length);
      continue;
    }

    if (arg === "--admin-email") {
      args.adminEmail = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--admin-email=")) {
      args.adminEmail = arg.slice("--admin-email=".length);
      continue;
    }

    if (arg === "--admin-password") {
      args.adminPassword = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--admin-password=")) {
      args.adminPassword = arg.slice("--admin-password=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  args.adminEmail ??= process.env.REGRESSION_ADMIN_EMAIL;
  args.adminPassword ??= process.env.REGRESSION_ADMIN_PASSWORD;

  return args;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function assertStatus(
  response: Response,
  expected: number | number[],
  context: string,
): void {
  const expectedStatuses = Array.isArray(expected) ? expected : [expected];

  if (!expectedStatuses.includes(response.status)) {
    throw new Error(
      `${context} returned ${response.status}; expected ${expectedStatuses.join(" or ")}.`,
    );
  }
}

function assertNoPatterns(
  text: string,
  patterns: RegExp[],
  context: string,
): void {
  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match) {
      throw new Error(`${context} contains forbidden marker ${pattern}.`);
    }
  }
}

function collectTextFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const files: string[] = [];
  const entries = readdirSync(root, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectTextFiles(path));
      continue;
    }

    if (entry.isFile() && textExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

function scanBuildOutput(): CheckResult[] {
  const roots = [".output/public", "dist/client"];
  const existingRoots = roots.filter((root) => existsSync(root));

  if (existingRoots.length === 0) {
    throw new Error("No public build output found. Run `bun run build` first.");
  }

  const files = existingRoots.flatMap(collectTextFiles);

  for (const file of files) {
    const contents = readFileSync(file, "utf8");
    assertNoPatterns(contents, privateMarkerPatterns, file);
    assertNoPatterns(contents, serverBundlePatterns, file);
  }

  return [
    {
      detail: `${files.length} public build files scanned`,
      name: "build-output-privacy",
    },
  ];
}

async function waitForServer(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);

      if (response.ok) {
        return;
      }

      lastError = new Error(`/api/health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await Bun.sleep(250);
  }

  throw new Error(
    `Timed out waiting for ${baseUrl}. Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

async function startBuiltServer(): Promise<{
  baseUrl: string;
  process: Subprocess<"ignore", "pipe", "pipe">;
}> {
  const serverEntry = resolve(".output/server/index.mjs");

  if (!existsSync(serverEntry)) {
    throw new Error("No built server found. Run `bun run build` first.");
  }

  const explicitPort = parseOptionalPort(process.env.PORT);
  const bundle = await resolveWorktreePorts({
    env: {
      ...process.env,
      PORT: explicitPort === undefined ? undefined : String(explicitPort),
    },
    worktreeRoot: process.cwd(),
  });
  const port = explicitPort ?? bundle.app.port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(["node", serverEntry], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  try {
    await waitForServer(baseUrl);
  } catch (error) {
    child.kill();
    throw error;
  }

  return { baseUrl, process: child };
}

function isRedirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function assertRedirectToPath(
  response: Response,
  allowedPaths: string[],
): void {
  if (!isRedirectStatus(response.status)) {
    throw new Error(
      `/admin returned ${response.status}; expected redirect to ${allowedPaths.join(", ")}.`,
    );
  }

  const location = response.headers.get("location");

  if (!location) {
    throw new Error("/admin redirect did not include a Location header.");
  }

  const path = new URL(location, response.url).pathname;

  if (!allowedPaths.some((allowedPath) => path === allowedPath)) {
    throw new Error(
      `/admin redirected to ${path}; expected ${allowedPaths.join(", ")}.`,
    );
  }
}

async function checkRoutes(
  baseUrl: string,
  siteId: string,
  credentials?: {
    email: string;
    password: string;
  },
): Promise<CheckResult[]> {
  const health = await fetch(`${baseUrl}/api/health`);
  assertStatus(health, 200, "/api/health");

  const healthJson = (await health.json()) as { ok?: unknown };

  if (healthJson.ok !== true) {
    throw new Error("/api/health did not return ok: true.");
  }

  const home = await fetch(`${baseUrl}/`, { redirect: "manual" });
  assertStatus(home, [301, 302, 303, 307, 308], "/");

  const viewer = await fetch(`${baseUrl}/${siteId}`);
  assertStatus(viewer, 200, `/${siteId}`);
  const viewerHtml = await viewer.text();
  assertNoPatterns(viewerHtml, privateMarkerPatterns, `/${siteId}`);

  const admin = await fetch(`${baseUrl}/admin`, { redirect: "manual" });
  assertRedirectToPath(admin, [
    "/admin/login",
    "/admin/setup",
    `/admin/${siteId}`,
  ]);

  const setup = await fetch(`${baseUrl}/admin/setup`, { redirect: "manual" });
  assertStatus(setup, [200, 301, 302, 303, 307, 308], "/admin/setup");

  const login = await fetch(`${baseUrl}/admin/login`, { redirect: "manual" });
  assertStatus(login, [200, 301, 302, 303, 307, 308], "/admin/login");

  const results: CheckResult[] = [
    {
      detail: `checked /, /${siteId}, /api/health, /admin, /admin/setup, /admin/login`,
      name: "route-smoke",
    },
    {
      detail: `rendered /${siteId} scanned`,
      name: "viewer-html-privacy",
    },
  ];

  if (credentials) {
    const loginResponse = await fetch(`${baseUrl}/admin/login/submit`, {
      body: new URLSearchParams({
        email: credentials.email,
        password: credentials.password,
      }),
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      method: "POST",
      redirect: "manual",
    });

    assertStatus(loginResponse, 303, "/admin/login/submit");
    const loginLocation = loginResponse.headers.get("location");
    const loginCookie = loginResponse.headers.get("set-cookie");

    if (!loginLocation) {
      throw new Error("Admin login did not include a Location header.");
    }

    if (new URL(loginLocation, baseUrl).pathname !== `/admin/${siteId}`) {
      throw new Error(
        `Admin login redirected to ${loginLocation}; expected /admin/${siteId}.`,
      );
    }

    if (!loginCookie?.includes("house_calendar_admin_session=")) {
      throw new Error("Admin login did not set the admin session cookie.");
    }

    results.push({
      detail: "credential-backed login returned 303 and set session cookie",
      name: "admin-login",
    });
  }

  return results;
}

function printResult(result: CheckResult): void {
  console.log(
    `PASS ${result.name}${result.detail ? ` - ${result.detail}` : ""}`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  const appConfig = await loadAppConfig();
  const siteId = args.siteId ?? getDefaultSiteId(appConfig);
  const credentials =
    args.adminEmail && args.adminPassword
      ? {
          email: args.adminEmail,
          password: args.adminPassword,
        }
      : undefined;
  const startedServer = args.url ? null : await startBuiltServer();
  const baseUrl = normalizeBaseUrl(args.url ?? startedServer?.baseUrl ?? "");

  try {
    if (startedServer) {
      for (const result of scanBuildOutput()) {
        printResult(result);
      }
    }

    for (const result of await checkRoutes(baseUrl, siteId, credentials)) {
      printResult(result);
    }
  } finally {
    startedServer?.process.kill();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
