import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const script = resolve("scripts/release-bundle.mjs");
const metadata = JSON.parse(readFileSync("services/backend/app/release-metadata.json", "utf8"));
const release = "a".repeat(40);

test("immutable bundle rejects different compatibility metadata even with valid checksums", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "quan1-release-"));
  t.after(() => {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir(), "quan1-release-")));
    rmSync(dir, { recursive: true, force: true });
  });
  for (const path of ["apps/web/dist", ".runtime/worker-bundle", "services/backend/app"]) {
    mkdirSync(join(dir, path), { recursive: true });
  }
  writeFileSync(join(dir, "services/backend/app/release-metadata.json"), JSON.stringify(metadata));
  writeFileSync(join(dir, "apps/web/dist/release.json"), JSON.stringify({ release, ...metadata }));
  writeFileSync(join(dir, ".runtime/worker-bundle/worker.js"), "export default {};\n");
  const run = (mode) => spawnSync(process.execPath, [script, mode], {
    cwd: dir, env: { ...process.env, RELEASE_SHA: release }, encoding: "utf8",
  });
  assert.equal(run("pack").status, 0);
  assert.equal(run("verify").status, 0);
  const manifestPath = join(dir, ".runtime/release/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, schema_revision: "another-revision" }));
  assert.notEqual(run("verify").status, 0);
  const sitePath = join(dir, ".runtime/release/site/release.json");
  writeFileSync(sitePath, JSON.stringify({ release, ...metadata, schema_revision: "another-revision" }));
  manifest.files["site/release.json"] = createHash("sha256").update(readFileSync(sitePath)).digest("hex");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.notEqual(run("verify").status, 0);
});
