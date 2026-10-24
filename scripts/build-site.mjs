import { spawnSync } from "node:child_process";
import { cpSync, writeFileSync } from "node:fs";
if (process.argv.includes("--cloudflare")) process.env.VITE_MAP_TILE_URL = "/map-tiles/{z}/{x}/{y}.png";

// One artifact works on Render or Cloudflare Pages: visitors /, administration /admin/.
const result = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "apps/admin"], {
  env: { ...process.env, VITE_ADMIN_BASE: "/admin/" }, stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status || 1);
const visitor = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "apps/web"], {
  stdio: "inherit",
});
if (visitor.status !== 0) process.exit(visitor.status || 1);
cpSync("apps/admin/dist", "apps/web/dist/admin", { recursive: true });
writeFileSync("apps/web/dist/release.json", JSON.stringify({
  release: process.env.RELEASE_SHA || process.env.GITHUB_SHA || process.env.RENDER_GIT_COMMIT || process.env.WORKERS_CI_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA || "local",
  worker_protocol: 2,
}) + "\n");
