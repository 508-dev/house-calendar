import { spawn } from "node:child_process";
import { buildWorktreeEnv, resolveWorktreePorts } from "./worktree-ports";

const COMMANDS = {
  logs: ["logs", "-f", "postgres"],
  start: ["up", "-d", "postgres"],
  stop: ["down"],
} as const;

type DbCommand = keyof typeof COMMANDS;

function parseCommand(argv: string[]): DbCommand {
  const command = argv[0];

  if (command === "logs" || command === "start" || command === "stop") {
    return command;
  }

  throw new Error("Usage: bun run scripts/db.ts <start|stop|logs>");
}

const command = parseCommand(Bun.argv.slice(2));
const bundle = await resolveWorktreePorts({ worktreeRoot: process.cwd() });
const child = spawn("docker", ["compose", ...COMMANDS[command]], {
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
