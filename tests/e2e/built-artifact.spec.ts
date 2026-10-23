import { test, expect } from "./fixtures";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

test("read-only smoke checks the combined compiled artifact", async () => {
  const release = JSON.parse(readFileSync("apps/web/dist/release.json", "utf8")).release;
  const python = process.env.E2E_PYTHON || resolve(process.platform === "win32"
    ? "services/backend/.venv/Scripts/python.exe" : "services/backend/.venv/bin/python");
  const result = spawnSync(python, ["scripts/smoke.py", "--origin", "http://127.0.0.1:5184", "--release", release,
    "--no-tiles", "--allow-empty"], { encoding: "utf8", timeout: 60000 });
  expect(result.status, result.stdout + result.stderr).toBe(0);
});
