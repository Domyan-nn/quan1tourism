import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: loadEnv(mode, ".", "VITE_").VITE_ADMIN_BASE || "/",
  server: {
    proxy: {
      "/api":
        mode === "e2e" ? "http://127.0.0.1:8010" : "http://127.0.0.1:8000",
    },
  },
  build: { sourcemap: true },
}));
