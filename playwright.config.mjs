import { defineConfig, devices } from "@playwright/test";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
const release = JSON.parse(readFileSync("apps/web/dist/release.json", "utf8")).release;
const python = process.env.E2E_PYTHON || resolve(
  process.platform === "win32"
    ? "services/backend/.venv/Scripts/python.exe"
    : "services/backend/.venv/bin/python",
);
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5183",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 1100 },
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["Pixel 7"],
        browserName: "chromium",
      },
    },
  ],
  webServer: [
    {
      command: `"${python}" scripts/e2e_backend.py`,
      env: { RELEASE_SHA: release },
      url: "http://127.0.0.1:8010/api/v1/health/ready",
      reuseExistingServer: false,
      timeout: 60000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "node scripts/serve-built.mjs --admin --port 5183",
      url: "http://127.0.0.1:5183",
      reuseExistingServer: false,
    },
    {
      command: "node scripts/serve-built.mjs --port 5184",
      url: "http://127.0.0.1:5184",
      reuseExistingServer: false,
    },
  ],
  globalSetup: "./tests/e2e/setup.mjs",
});
