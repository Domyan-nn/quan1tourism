import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const windows = process.platform === "win32";
const python = join(
  root,
  "services",
  "backend",
  ".venv",
  windows ? "Scripts" : "bin",
  windows ? "python.exe" : "python",
);
const vite = join(root, "node_modules", "vite", "bin", "vite.js");
const children = [];
let stopping = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.all(
    children
      .filter((child) => child.exitCode === null)
      .map(
        (child) =>
          new Promise((resolve) => {
            if (windows) {
              // Only terminate process trees created by this launcher in this session.
              const killer = spawn(
                "taskkill",
                ["/PID", String(child.pid), "/T", "/F"],
                { windowsHide: true, stdio: "ignore" },
              );
              killer.on("close", resolve);
              killer.on("error", resolve);
            } else {
              child.kill("SIGTERM");
              resolve();
            }
          }),
      ),
  );
  process.exit(code);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (data) => {
    if (data.includes(3) || data.toString().trim() === "q") void stop();
  });
}

function checkPort(port) {
  return new Promise((resolve, reject) => {
    const socket = createServer();
    socket.once("error", () =>
      reject(
        new Error(`Port ${port} is in use. Stop the existing server first.`),
      ),
    );
    socket.listen(port, "127.0.0.1", () => socket.close(resolve));
  });
}
function start(executable, args, cwd) {
  const child = spawn(executable, args, {
    cwd,
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    void stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(
        `A local server exited (${code}). Stopping the other servers.`,
      );
      void stop(code || 1);
    }
  });
}
try {
  if (!existsSync(python) || !existsSync(vite))
    throw new Error(
      "Install dependencies first: npm ci and uv sync --frozen in services/backend. See README.",
    );
  await Promise.all([8000, 5173, 5174].map(checkPort));
  start(
    python,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
    join(root, "services", "backend"),
  );
  for (const [app, port] of [
    ["admin", 5173],
    ["web", 5174],
  ])
    start(
      process.execPath,
      [vite, "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
      join(root, "apps", app),
    );
  console.log(
    "\nAdmin: http://127.0.0.1:5173\nVisitor: http://127.0.0.1:5174\nAPI: http://127.0.0.1:8000/docs\nPress Ctrl+C to stop all three local servers.\n",
  );
} catch (error) {
  console.error(error.message);
  await stop(1);
}
