import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { __MAP_TILE_URL__: JSON.stringify(loadEnv(mode, ".", "VITE_").VITE_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png") },
  server: {
    proxy: {
      "/api":
        mode === "e2e" ? "http://127.0.0.1:8010" : "http://127.0.0.1:8000",
    },
  },
}));
