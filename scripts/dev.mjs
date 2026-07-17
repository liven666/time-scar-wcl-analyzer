import { spawn } from "node:child_process";

const children = [
  spawn("vinext", ["dev"], { stdio: "inherit", env: process.env }),
  spawn(process.execPath, ["scripts/live-log-server.mjs"], {
    stdio: "inherit",
    env: process.env,
  }),
];

let shuttingDown = false;
function shutdown(signal = "SIGTERM", exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
  setTimeout(() => process.exit(exitCode), 150).unref();
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const failed = code !== 0 && signal === null;
    shutdown("SIGTERM", failed ? code ?? 1 : 0);
  });
  child.on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    shutdown("SIGTERM", 1);
  });
}

process.on("SIGINT", () => shutdown("SIGINT", 0));
process.on("SIGTERM", () => shutdown("SIGTERM", 0));
