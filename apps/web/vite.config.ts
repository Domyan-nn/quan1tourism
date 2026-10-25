import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
// npm workspace scripts run from apps/web; build:site runs from the repo root.
// Resolve configuration against this file so both read the same root .env.
const envDir = fileURLToPath(new URL("../..", import.meta.url));
export default defineConfig(({ mode }) => ({
  envDir,
  plugins: [react()],
  define: {
    __MAP_TILE_URL__: JSON.stringify(
      loadEnv(mode, envDir, "VITE_").VITE_MAP_TILE_URL ||
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    ),
    __EXPO_QR_ENABLED__: JSON.stringify(
      loadEnv(mode, envDir, "VITE_").VITE_EXPO_QR_ENABLED || "false",
    ),
    __EXPO_GO_URL__: JSON.stringify(
      loadEnv(mode, envDir, "VITE_").VITE_EXPO_GO_URL || "",
    ),
  },
  server: {
    proxy: {
      "/api":
        mode === "e2e" ? "http://127.0.0.1:8010" : "http://127.0.0.1:8000",
    },
  },
}));
