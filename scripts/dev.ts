import { spawn } from "node:child_process";
import {
  appUrl,
  buildWorktreeEnv,
  resolveWorktreePorts,
} from "./worktree-ports";

const bundle = await resolveWorktreePorts({ worktreeRoot: process.cwd() });
const env = buildWorktreeEnv(bundle, process.env);

console.log(`Starting TanStack Start on ${appUrl(bundle)}`);
console.log(
  `Expected Postgres on postgresql://127.0.0.1:${bundle.postgres.port}`,
);

const child = spawn(
  process.execPath,
  [
    "x",
    "vite",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    String(bundle.app.port),
  ],
  {
    cwd: bundle.worktreeRoot,
    env,
    stdio: "inherit",
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
