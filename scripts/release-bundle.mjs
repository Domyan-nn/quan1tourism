// All inputs are public release metadata. Credentials never enter this artifact.
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { createHash } from "node:crypto";

const root = resolve(".runtime/release");
const metadata = JSON.parse(readFileSync("services/backend/app/release-metadata.json", "utf8"));
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Release cannot contain symlinks");
    return entry.isDirectory() ? files(path) : [path];
  });
}
const mode = process.argv[2];
if (mode === "pack") {
  const release = process.env.RELEASE_SHA || process.env.GITHUB_SHA;
  if (!/^[a-f0-9]{40}$/.test(release || "")) throw new Error("Full commit required");
  mkdirSync(root, { recursive: true });
  cpSync("apps/web/dist", resolve(root, "site"), { recursive: true });
  cpSync(".runtime/worker-bundle/worker.js", resolve(root, "worker.js"));
  const checksums = Object.fromEntries(files(root).filter((f) => !f.endsWith("manifest.json"))
    .map((file) => [relative(root, file).split(sep).join("/"), hash(file)]));
  writeFileSync(resolve(root, "manifest.json"), JSON.stringify({
    release, ...metadata, files: checksums,
  }, null, 2) + "\n");
} else {
  const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
  if (manifest.release !== process.env.RELEASE_SHA) throw new Error("Artifact commit mismatch");
  if (manifest.schema_revision !== metadata.schema_revision || manifest.worker_protocol !== metadata.worker_protocol) {
    throw new Error("Artifact compatibility metadata mismatch");
  }
  const actual = files(root).filter((f) => f !== resolve(root, "manifest.json"));
  if (actual.length !== Object.keys(manifest.files).length) throw new Error("Unexpected artifact files");
  for (const [name, digest] of Object.entries(manifest.files)) {
    const path = resolve(root, name);
    if (!path.startsWith(root + sep) || hash(path) !== digest) throw new Error("Artifact checksum mismatch");
  }
  const site = JSON.parse(readFileSync(resolve(root, "site/release.json")));
  if (site.release !== manifest.release || site.schema_revision !== manifest.schema_revision || site.worker_protocol !== manifest.worker_protocol) {
    throw new Error("Site identity or compatibility metadata mismatch");
  }
  if (mode === "config") {
    if (process.env.CLOUDFLARE_CONFIG_REVIEWED !== "true") throw new Error("Review existing Worker routes/settings first");
    const origin = new URL(process.env.BACKEND_ORIGIN);
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("HTTPS backend origin required");
    const name = process.env.CLOUDFLARE_WORKER_NAME;
    if (!/^[a-z0-9-]+$/.test(name || "")) throw new Error("Existing Worker name required");
    if (!process.env.CLOUDFLARE_ROUTES_JSON || !["true", "false"].includes(process.env.CLOUDFLARE_WORKERS_DEV)) {
      throw new Error("Explicit reviewed routes JSON and workers.dev setting required; no domain defaults");
    }
    const routes = JSON.parse(process.env.CLOUDFLARE_ROUTES_JSON);
    if (!Array.isArray(routes)) throw new Error("Routes must be the reviewed array from the existing Worker");
    writeFileSync(".runtime/deploy-wrangler.json", JSON.stringify({
      name, main: resolve(root, "worker.js"), compatibility_date: "2026-10-23", keep_vars: true,
      workers_dev: process.env.CLOUDFLARE_WORKERS_DEV === "true", routes,
      assets: { directory: resolve(root, "site"), binding: "ASSETS", run_worker_first: ["/api", "/api/*", "/map-tiles/*", "/release.json"] },
      vars: { RENDER_API_ORIGIN: origin.origin, RELEASE_SHA: manifest.release },
    }, null, 2) + "\n");
  } else if (mode !== "verify") throw new Error("Use pack, verify or config");
  console.log(`Verified release ${manifest.release}; manifest SHA256 ${hash(resolve(root, "manifest.json"))}`);
}
