import { spawn } from "node:child_process";
import {
  buildWorktreeEnv,
  detectRunningComposePostgresPort,
  resolveWorktreePorts,
} from "./worktree-ports";

const command = Bun.argv.slice(2);

if (command.length === 0) {
  throw new Error("Usage: bun run scripts/with-worktree-env.ts -- <command>");
}

const worktreeRoot = process.cwd();
const bundle = await resolveWorktreePorts({
  runningPostgresPort: detectRunningComposePostgresPort({ worktreeRoot }),
  worktreeRoot,
});
const child = spawn(command[0], command.slice(1), {
  cwd: bundle.worktreeRoot,
  env: buildWorktreeEnv(bundle, process.env),
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
