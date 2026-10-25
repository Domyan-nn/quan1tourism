import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../package.json", import.meta.url));
export const policy = JSON.parse(readFileSync(new URL("../security/node-forge-1.4.0.json", import.meta.url), "utf8"));
const sha256 = (source) => createHash("sha256").update(source).digest("hex");

export function patchSource(source, version) {
  assert.equal(version, policy.version, "Review the backport when node-forge changes version");
  const digest = sha256(source);
  if (digest === policy.patchedSha256) return source;
  assert.equal(digest, policy.originalSha256, "Unknown node-forge RSA source; refusing to patch");
  assert.equal(source.split(policy.before).length, 2, "Backport must match exactly one location");
  const patched = source.replace(policy.before, policy.after);
  assert.equal(sha256(patched), policy.patchedSha256, "Backport checksum mismatch");
  return patched;
}

function installedForge() {
  const manifest = require.resolve("node-forge/package.json");
  const version = JSON.parse(readFileSync(manifest, "utf8")).version;
  const file = join(dirname(manifest), policy.file);
  const source = readFileSync(file, "utf8");
  const node = relative(root, dirname(manifest)).split(sep).join("/");
  assert.equal(node, "node_modules/node-forge", "Unexpected node-forge installation path");
  return { version, file, source, node };
}

export function applyForgePatch() {
  const installed = installedForge();
  const patched = patchSource(installed.source, installed.version);
  if (patched !== installed.source) writeFileSync(installed.file, patched);
  console.log(`Applied/verified node-forge ${policy.version} RSA backport (GHSA-86w9-cpqp-85rv)`);
}

export function verifyForgePatch() {
  const installed = installedForge();
  assert.equal(installed.version, policy.version, "Review the backport when node-forge changes version");
  assert.equal(sha256(installed.source), policy.patchedSha256, "node-forge backport is missing or modified; run npm ci");
  // Both actual Expo consumers must resolve the installation whose bytes we checked.
  const mobileRequire = createRequire(join(root, "apps/mobile/package.json"));
  const expoRequire = createRequire(mobileRequire.resolve("expo/package.json"));
  const cliRequire = createRequire(expoRequire.resolve("@expo/cli/package.json"));
  const certificateRequire = createRequire(cliRequire.resolve("@expo/code-signing-certificates/package.json"));
  for (const consumer of [cliRequire, certificateRequire]) {
    assert.equal(consumer.resolve("node-forge/lib/rsa.js"), installed.file,
      "An Expo consumer resolves a different, unpatched node-forge installation");
  }
  return { node: installed.node, version: installed.version, sha256: sha256(installed.source) };
}

const coveredPackages = new Set(["node-forge", "@expo/code-signing-certificates", "@expo/cli", "expo"]);
const severity = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
export function assessAudit(report, proof) {
  assert.equal(report?.auditReportVersion, 2, "Unsupported npm audit report");
  assert.ok(!report.error && report.vulnerabilities && typeof report.vulnerabilities === "object"
    && !Array.isArray(report.vulnerabilities), "npm audit did not return a valid vulnerability report");
  const entries = Object.entries(report.vulnerabilities);
  const counts = Object.fromEntries(Object.keys(severity).map((level) => [level, 0]));
  for (const [name, item] of entries) {
    assert.ok(item && item.name === name && Object.hasOwn(severity, item.severity)
      && Array.isArray(item.via) && item.via.length > 0
      && Array.isArray(item.nodes) && item.nodes.length > 0, `Invalid audit entry: ${name}`);
    counts[item.severity]++;
  }
  for (const [level, count] of Object.entries(counts)) {
    assert.equal(report.metadata?.vulnerabilities?.[level], count, "Incomplete npm audit report");
  }
  assert.equal(report.metadata.vulnerabilities.total, entries.length, "Incomplete npm audit report");

  const verified = proof?.node === "node_modules/node-forge"
    && proof?.version === policy.version && proof?.sha256 === policy.patchedSha256;
  function covered(name, seen = new Set()) {
    if (!verified || !coveredPackages.has(name) || seen.has(name)) return false;
    const item = report.vulnerabilities[name];
    if (!item || item.severity !== "high") return false;
    if (name === "node-forge" && (item.nodes.length !== 1 || item.nodes[0] !== proof.node)) return false;
    return item.via.every((cause) => {
      if (typeof cause === "string") return covered(cause, new Set([...seen, name]));
      return name === "node-forge" && cause.name === "node-forge"
        && cause.dependency === "node-forge" && cause.url === policy.advisory
        && cause.severity === "high" && cause.range === "<=1.4.0";
    });
  }
  const mitigated = entries.filter(([name]) => covered(name)).map(([name]) => name);
  const blocked = entries.filter(([name, item]) => severity[item.severity] >= severity.high
    && !mitigated.includes(name)).map(([name]) => name);
  return { mitigated, blocked, counts };
}

function audit() {
  const proof = verifyForgePatch();
  assert.ok(process.env.npm_execpath, "Run npm run audit:security");
  const result = spawnSync(process.execPath,
    [process.env.npm_execpath, "audit", "--json", "--audit-level=high"],
    { cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
  assert.ok(!result.error && [0, 1].includes(result.status), `npm audit failed: ${result.error || result.stderr}`);
  mkdirSync(join(root, ".runtime/security"), { recursive: true });
  writeFileSync(join(root, ".runtime/security/npm-audit.json"), result.stdout);
  const report = JSON.parse(result.stdout);
  const assessment = assessAudit(report, proof);
  assert.equal(result.status, assessment.counts.high + assessment.counts.critical > 0 ? 1 : 0,
    "npm audit exit status does not match its report");
  console.log("npm audit findings:", report.metadata.vulnerabilities);
  if (assessment.mitigated.length) {
    console.log(`Verified RSA backport for ${policy.advisory}: ${assessment.mitigated.join(", ")}`);
    console.log(`node-forge ${proof.version}, lib/rsa.js SHA256 ${proof.sha256}`);
  }
  assert.equal(assessment.blocked.length, 0,
    `Unmitigated high/critical vulnerabilities: ${assessment.blocked.join(", ")}`);
  console.log("Security audit passed: no unmitigated high/critical findings.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "patch") applyForgePatch();
    else if (process.argv[2] === "audit") audit();
    else throw new Error("Use patch or audit");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
