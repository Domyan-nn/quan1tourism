import { defineConfig } from "@playwright/test";

// Reserved fixture host is used only for automated UI checks; it is not a live Expo session.
const expoUrl = process.env.QR_TEST_EXPO_URL || "exp://192.0.2.10:8081";
export default defineConfig({
  testDir: "./tests/qr",
  workers: 1,
  timeout: 30000,
  reporter: "list",
  use: { browserName: "chromium", baseURL: "http://127.0.0.1:5194" },
  webServer: [
    {
      command:
        "node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 5194 --strictPort --mode e2e",
      url: "http://127.0.0.1:5194",
      env: { VITE_EXPO_QR_ENABLED: "true", VITE_EXPO_GO_URL: expoUrl },
      reuseExistingServer: false,
    },
    {
      command:
        "node node_modules/vite/bin/vite.js apps/web --host 127.0.0.1 --port 5195 --strictPort --mode e2e",
      url: "http://127.0.0.1:5195",
      env: { VITE_EXPO_QR_ENABLED: "false", VITE_EXPO_GO_URL: expoUrl },
      reuseExistingServer: false,
    },
  ],
});
