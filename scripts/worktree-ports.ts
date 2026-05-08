import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";

export const DEFAULT_WORKTREE_DEV_BASE_PORT = 4321;
export const DEFAULT_WORKTREE_POSTGRES_BASE_PORT = 5432;
export const DEFAULT_WORKTREE_PORT_SPAN = 1000;
export const WORKTREE_DEV_BASE_PORT_ENV = "WORKTREE_DEV_BASE_PORT";
export const WORKTREE_DEV_PORT_ENV = "WORKTREE_DEV_PORT";
export const WORKTREE_POSTGRES_BASE_PORT_ENV = "WORKTREE_POSTGRES_BASE_PORT";
export const WORKTREE_POSTGRES_PORT_ENV = "WORKTREE_POSTGRES_PORT";
export const WORKTREE_PORT_OFFSET_ENV = "WORKTREE_PORT_OFFSET";
export const WORKTREE_PORT_SPAN_ENV = "WORKTREE_PORT_SPAN";

const MAX_PORT = 65535;
const CHROME_BLOCKED_WEB_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723,
  2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697,
  10080,
]);

type PortResolution = {
  basePort: number;
  offset: number;
  pathKey: string;
  port: number;
  span: number;
  usingExplicitPort: boolean;
};

type WorktreePortBundle = {
  app: PortResolution;
  postgres: PortResolution;
  databaseUrl: string;
  projectName: string;
  worktreeRoot: string;
};

function parsePortLike(
  value: string | undefined,
  name: string,
): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_PORT) {
    throw new Error(`${name} must be an integer from 1 to ${MAX_PORT}.`);
  }

  return parsed;
}

function parsePositiveInteger(
  value: string | undefined,
  name: string,
): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

export function worktreePathKey(worktreeRoot: string): string {
  return resolve(worktreeRoot)
    .split(/[\\/]+/)
    .filter(Boolean)
    .join("/");
}

export function worktreePortOffset(worktreeRoot: string, span: number): number {
  const digest = createHash("sha256")
    .update(worktreePathKey(worktreeRoot))
    .digest();
  return digest.readUInt32BE(0) % span;
}

export function worktreeComposeProjectName(worktreeRoot: string): string {
  const digest = createHash("sha256")
    .update(worktreePathKey(worktreeRoot))
    .digest("hex")
    .slice(0, 10);

  return `house_calendar_${digest}`;
}

function resolvePort({
  basePort,
  basePortEnvName,
  defaultBasePort,
  disallowedPorts,
  env,
  explicitPortEnvName,
  fallbackPortEnvName,
  pathKey,
  span,
  worktreeRoot,
}: {
  basePort?: number;
  basePortEnvName: string;
  defaultBasePort: number;
  disallowedPorts?: ReadonlySet<number>;
  env: NodeJS.ProcessEnv;
  explicitPortEnvName: string;
  fallbackPortEnvName?: string;
  pathKey: string;
  span: number;
  worktreeRoot: string;
}): Omit<PortResolution, "port"> & { port?: number } {
  const primaryExplicitPortValue = env[explicitPortEnvName];
  const primaryExplicitPort = parsePortLike(
    primaryExplicitPortValue,
    explicitPortEnvName,
  );
  const fallbackExplicitPort =
    primaryExplicitPortValue === undefined || primaryExplicitPortValue === ""
      ? parsePortLike(
          fallbackPortEnvName ? env[fallbackPortEnvName] : undefined,
          fallbackPortEnvName ?? explicitPortEnvName,
        )
      : undefined;
  const shouldIgnoreBlockedFallbackExplicitPort =
    primaryExplicitPort === undefined &&
    fallbackExplicitPort !== undefined &&
    disallowedPorts?.has(fallbackExplicitPort);
  const explicitPort = primaryExplicitPort ?? fallbackExplicitPort;
  const explicitPortSource =
    primaryExplicitPort !== undefined
      ? explicitPortEnvName
      : fallbackExplicitPort !== undefined
        ? (fallbackPortEnvName ?? explicitPortEnvName)
        : explicitPortEnvName;
  const resolvedBasePort =
    basePort ??
    parsePortLike(env[basePortEnvName], basePortEnvName) ??
    defaultBasePort;

  if (explicitPort !== undefined) {
    if (shouldIgnoreBlockedFallbackExplicitPort) {
      if (resolvedBasePort + span - 1 > MAX_PORT) {
        throw new Error(
          `${basePortEnvName} + ${WORKTREE_PORT_SPAN_ENV} - 1 must not exceed ${MAX_PORT}.`,
        );
      }

      return {
        basePort: resolvedBasePort,
        offset: worktreePortOffset(worktreeRoot, span),
        pathKey,
        span,
        usingExplicitPort: false,
      };
    }

    if (disallowedPorts?.has(explicitPort)) {
      throw new Error(
        `${explicitPortSource} resolves to ${explicitPort}, which is blocked for browser-accessible app ports.`,
      );
    }

    return {
      basePort: defaultBasePort,
      offset: worktreePortOffset(worktreeRoot, span),
      pathKey,
      port: explicitPort,
      span,
      usingExplicitPort: true,
    };
  }

  if (resolvedBasePort + span - 1 > MAX_PORT) {
    throw new Error(
      `${basePortEnvName} + ${WORKTREE_PORT_SPAN_ENV} - 1 must not exceed ${MAX_PORT}.`,
    );
  }

  const offset = worktreePortOffset(worktreeRoot, span);

  return {
    basePort: resolvedBasePort,
    offset,
    pathKey,
    span,
    usingExplicitPort: false,
  };
}

type PortProbeResult = "available" | "unavailable" | "unsupported";

function canListenOnPort(port: number, host: string): Promise<PortProbeResult> {
  return new Promise((resolvePortAvailability) => {
    const server = createServer();

    server.once("error", (error: NodeJS.ErrnoException) => {
      resolvePortAvailability(
        error.code === "EAFNOSUPPORT" ? "unsupported" : "unavailable",
      );
    });

    server.once("listening", () => {
      server.close(() => resolvePortAvailability("available"));
    });

    server.listen({ host, port });
  });
}

async function isPortAvailable(port: number): Promise<boolean> {
  const ipv6Result = await canListenOnPort(port, "::");

  if (ipv6Result === "available") {
    return true;
  }

  if (ipv6Result === "unavailable") {
    return false;
  }

  return (await canListenOnPort(port, "127.0.0.1")) === "available";
}

async function resolveAvailablePort(
  resolution: Omit<PortResolution, "port"> & { port?: number },
  disallowedPorts?: ReadonlySet<number>,
): Promise<PortResolution> {
  if (resolution.usingExplicitPort) {
    return {
      ...resolution,
      port: resolution.port ?? resolution.basePort,
    };
  }

  let skippedDisallowedPortCount = 0;

  for (let attempt = 0; attempt < resolution.span; attempt += 1) {
    const offset = (resolution.offset + attempt) % resolution.span;
    const port = resolution.basePort + offset;

    if (disallowedPorts?.has(port)) {
      skippedDisallowedPortCount += 1;
      continue;
    }

    if (await isPortAvailable(port)) {
      return {
        ...resolution,
        offset,
        port,
      };
    }
  }

  if (
    disallowedPorts !== undefined &&
    skippedDisallowedPortCount === resolution.span
  ) {
    throw new Error(
      `No available port found from ${resolution.basePort} to ${resolution.basePort + resolution.span - 1} because every candidate is blocked for browser-accessible app ports. Adjust ${WORKTREE_DEV_BASE_PORT_ENV} or ${WORKTREE_PORT_SPAN_ENV}.`,
    );
  }

  throw new Error(
    `No available port found from ${resolution.basePort} to ${resolution.basePort + resolution.span - 1}.`,
  );
}

function buildDatabaseUrl(
  env: NodeJS.ProcessEnv,
  postgresPort: number,
): string {
  const user = env.POSTGRES_USER || "house_calendar";
  const password = env.POSTGRES_PASSWORD || "house_calendar";
  const database = env.POSTGRES_DB || "house_calendar";
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${postgresPort}/${encodeURIComponent(database)}`;
}

export async function resolveWorktreePorts({
  env = process.env,
  worktreeRoot,
}: {
  env?: NodeJS.ProcessEnv;
  worktreeRoot: string;
}): Promise<WorktreePortBundle> {
  if (!worktreeRoot) {
    throw new Error("worktreeRoot is required to resolve worktree ports.");
  }

  const span =
    parsePositiveInteger(env[WORKTREE_PORT_SPAN_ENV], WORKTREE_PORT_SPAN_ENV) ??
    DEFAULT_WORKTREE_PORT_SPAN;
  const pathKey = worktreePathKey(worktreeRoot);

  const [app, postgres] = await Promise.all([
    resolveAvailablePort(
      resolvePort({
        basePortEnvName: WORKTREE_DEV_BASE_PORT_ENV,
        defaultBasePort: DEFAULT_WORKTREE_DEV_BASE_PORT,
        disallowedPorts: CHROME_BLOCKED_WEB_PORTS,
        env,
        explicitPortEnvName: WORKTREE_DEV_PORT_ENV,
        fallbackPortEnvName: "PORT",
        pathKey,
        span,
        worktreeRoot,
      }),
      CHROME_BLOCKED_WEB_PORTS,
    ),
    resolveAvailablePort(
      resolvePort({
        basePortEnvName: WORKTREE_POSTGRES_BASE_PORT_ENV,
        defaultBasePort: DEFAULT_WORKTREE_POSTGRES_BASE_PORT,
        env,
        explicitPortEnvName: WORKTREE_POSTGRES_PORT_ENV,
        fallbackPortEnvName: "POSTGRES_PORT",
        pathKey,
        span,
        worktreeRoot,
      }),
    ),
  ]);

  return {
    app,
    postgres,
    databaseUrl: env.DATABASE_URL || buildDatabaseUrl(env, postgres.port),
    projectName: worktreeComposeProjectName(worktreeRoot),
    worktreeRoot: resolve(worktreeRoot),
  };
}

function formatDotenvValue(value: string): string {
  return JSON.stringify(value);
}

function buildEnvFileContents(
  bundle: WorktreePortBundle,
  env: NodeJS.ProcessEnv,
): string {
  const postgresUser = env.POSTGRES_USER || "house_calendar";
  const postgresPassword = env.POSTGRES_PASSWORD || "house_calendar";
  const postgresDb = env.POSTGRES_DB || "house_calendar";

  return [
    `COMPOSE_PROJECT_NAME=${formatDotenvValue(bundle.projectName)}`,
    `PORT=${bundle.app.port}`,
    `POSTGRES_PORT=${bundle.postgres.port}`,
    `POSTGRES_DB=${formatDotenvValue(postgresDb)}`,
    `POSTGRES_USER=${formatDotenvValue(postgresUser)}`,
    `POSTGRES_PASSWORD=${formatDotenvValue(postgresPassword)}`,
    `WORKTREE_PORT_OFFSET=${bundle.app.offset}`,
    `DATABASE_URL=${formatDotenvValue(bundle.databaseUrl)}`,
    "",
  ].join("\n");
}

export function writeWorktreeEnvFiles(
  bundle: WorktreePortBundle,
  env = process.env,
): void {
  const root = bundle.worktreeRoot;
  mkdirSync(root, { recursive: true });

  writeFileSync(
    resolve(root, ".env"),
    buildEnvFileContents(bundle, env),
    "utf8",
  );
}

function printSummary(bundle: WorktreePortBundle): void {
  console.log(`Worktree: ${bundle.worktreeRoot}`);
  console.log(`Compose project: ${bundle.projectName}`);
  console.log(`Path key: ${bundle.app.pathKey}`);
  console.log(`App port: ${bundle.app.port}`);
  console.log(`Postgres port: ${bundle.postgres.port}`);
  console.log(`Database URL: ${bundle.databaseUrl}`);
}

if (import.meta.main) {
  const args = new Set(Bun.argv.slice(2));
  const bundle = await resolveWorktreePorts({ worktreeRoot: process.cwd() });

  if (args.has("--write")) {
    writeWorktreeEnvFiles(bundle);
    printSummary(bundle);
    console.log("Wrote .env");
  } else if (args.has("--json")) {
    console.log(JSON.stringify(bundle, null, 2));
  } else if (args.has("--shell")) {
    console.log(buildEnvFileContents(bundle, process.env).trim());
  } else {
    printSummary(bundle);
  }
}
