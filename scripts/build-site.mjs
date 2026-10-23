import { spawnSync } from "node:child_process";
import { cpSync } from "node:fs";

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
