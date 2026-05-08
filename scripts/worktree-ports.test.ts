import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveWorktreePorts,
  worktreePortOffset,
  writeWorktreeEnvFiles,
} from "./worktree-ports";

function listen(port: number): Promise<ReturnType<typeof createServer>> {
  return new Promise((resolveListen, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "::", () => resolveListen(server));
  });
}

async function reserveBasePortWithOccupiedOffset(
  span: number,
  targetOffset: number,
): Promise<{ basePort: number; server: ReturnType<typeof createServer> }> {
  const startPort = 49152;
  const endPort = 65535 - span + 1;

  for (let basePort = startPort; basePort <= endPort; basePort += 1) {
    const occupiedPort = basePort + targetOffset;

    try {
      const server = await listen(occupiedPort);
      return { basePort, server };
    } catch {
      continue;
    }
  }

  throw new Error(
    `Unable to reserve a test port for offset ${targetOffset} within a span of ${span}.`,
  );
}

function findWorktreeRootWithOffset(span: number, targetOffset: number): string {
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const worktreeRoot = join(
      tmpdir(),
      `house-calendar-test-offset-${span}-${targetOffset}-${attempt}`,
    );
    if (worktreePortOffset(worktreeRoot, span) === targetOffset) {
      return worktreeRoot;
    }
  }

  throw new Error(`Unable to find worktree root for offset ${targetOffset}.`);
}

describe("worktree ports", () => {
  test("encodes DATABASE_URL credentials safely", async () => {
    const bundle = await resolveWorktreePorts({
      worktreeRoot: join(tmpdir(), "house-calendar-test-encoded-url"),
      env: {
        NODE_ENV: "test",
        POSTGRES_DB: "house/calendar",
        POSTGRES_PASSWORD: "p@ss:/#word",
        POSTGRES_USER: "user:name",
      },
    });

    expect(bundle.databaseUrl).toContain("user%3Aname");
    expect(bundle.databaseUrl).toContain("p%40ss%3A%2F%23word");
    expect(bundle.databaseUrl).toContain("/house%2Fcalendar");
  });

  test("preserves existing .env.local when writing .env", async () => {
    const worktreeRoot = mkdtempSync(join(tmpdir(), "house-calendar-ports-"));
    const envLocalPath = join(worktreeRoot, ".env.local");
    writeFileSync(envLocalPath, "SECRET=value\n", "utf8");

    const bundle = await resolveWorktreePorts({ worktreeRoot });
    writeWorktreeEnvFiles(bundle);

    expect(readFileSync(envLocalPath, "utf8")).toBe("SECRET=value\n");
    expect(readFileSync(join(worktreeRoot, ".env"), "utf8")).toContain(
      "DATABASE_URL=",
    );
  });

  test("quotes dotenv credentials when writing .env", async () => {
    const worktreeRoot = mkdtempSync(join(tmpdir(), "house-calendar-ports-"));
    const bundle = await resolveWorktreePorts({
      worktreeRoot,
      env: {
        NODE_ENV: "test",
        POSTGRES_DB: "house calendar",
        POSTGRES_PASSWORD: "p@ss:/#word",
        POSTGRES_USER: "user name",
      },
    });

    writeWorktreeEnvFiles(bundle, {
      NODE_ENV: "test",
      POSTGRES_DB: "house calendar",
      POSTGRES_PASSWORD: "p@ss:/#word",
      POSTGRES_USER: "user name",
    });

    const envFile = readFileSync(join(worktreeRoot, ".env"), "utf8");
    expect(envFile).toContain('POSTGRES_DB="house calendar"');
    expect(envFile).toContain('POSTGRES_USER="user name"');
    expect(envFile).toContain('POSTGRES_PASSWORD="p@ss:/#word"');
  });

  test("probes forward when the hashed port is already occupied", async () => {
    const worktreeRoot = join(tmpdir(), "house-calendar-test-port-collision");
    const span = 5;
    const hashedOffset = worktreePortOffset(worktreeRoot, span);
    const { basePort, server } = await reserveBasePortWithOccupiedOffset(
      span,
      hashedOffset,
    );
    const occupiedPort = basePort + hashedOffset;

    try {
      const bundle = await resolveWorktreePorts({
        worktreeRoot,
        env: {
          NODE_ENV: "test",
          WORKTREE_DEV_BASE_PORT: String(basePort),
          WORKTREE_POSTGRES_BASE_PORT: "49200",
          WORKTREE_PORT_SPAN: String(span),
        },
      });

      expect(bundle.app.port).not.toBe(occupiedPort);
      expect(bundle.app.port).toBeGreaterThanOrEqual(basePort);
      expect(bundle.app.port).toBeLessThan(basePort + span);
    } finally {
      await new Promise<void>((resolveClose) =>
        server.close(() => resolveClose()),
      );
    }
  });

  test("skips browser-blocked app ports when the hashed port lands on one", async () => {
    const span = 4;
    const worktreeRoot = findWorktreeRootWithOffset(span, 1);
    const bundle = await resolveWorktreePorts({
      worktreeRoot,
      env: {
        NODE_ENV: "test",
        WORKTREE_DEV_BASE_PORT: "5059",
        WORKTREE_POSTGRES_BASE_PORT: "49200",
        WORKTREE_PORT_SPAN: String(span),
      },
    });

    expect(bundle.app.port).toBeGreaterThanOrEqual(5059);
    expect(bundle.app.port).toBeLessThan(5059 + span);
    expect(bundle.app.port).not.toBe(5060);
    expect(bundle.app.port).not.toBe(5061);
  });

  test("rejects explicit browser-blocked app ports", async () => {
    expect.assertions(1);

    try {
      await resolveWorktreePorts({
        worktreeRoot: join(tmpdir(), "house-calendar-test-explicit-blocked-port"),
        env: {
          NODE_ENV: "test",
          PORT: "5060",
        },
      });
    } catch (error) {
      expect((error as Error).message).toContain("blocked");
    }
  });

  test("ignores invalid fallback app ports when a primary explicit port is set", async () => {
    const bundle = await resolveWorktreePorts({
      worktreeRoot: join(
        tmpdir(),
        "house-calendar-test-primary-explicit-port-wins",
      ),
      env: {
        NODE_ENV: "test",
        PORT: "not-a-port",
        WORKTREE_DEV_PORT: "5059",
      },
    });

    expect(bundle.app.port).toBe(5059);
  });
});
