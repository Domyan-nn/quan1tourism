import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { assessAudit, patchSource, policy, verifyForgePatch } from "../scripts/security-audit.mjs";

const require = createRequire(import.meta.url);
const proof = { node: "node_modules/node-forge", version: policy.version, sha256: policy.patchedSha256 };

function auditFixture() {
  const item = (name, via, node = `node_modules/${name}`) => ({ name, severity: "high", via, nodes: [node] });
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      "node-forge": item("node-forge", [{ name: "node-forge", dependency: "node-forge",
        url: policy.advisory, severity: "high", range: "<=1.4.0" }]),
      "@expo/code-signing-certificates": item("@expo/code-signing-certificates", ["node-forge"]),
      "@expo/cli": item("@expo/cli", ["node-forge", "@expo/code-signing-certificates"], "node_modules/expo/node_modules/@expo/cli"),
      expo: item("expo", ["@expo/cli"]),
    },
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 4, critical: 0, total: 4 } },
  };
}

test("backport verifies installed bytes and both Expo consumers; applying it again is safe", () => {
  assert.deepEqual(verifyForgePatch(), proof);
  const patched = readFileSync(require.resolve("node-forge/lib/rsa.js"), "utf8");
  const original = patched.replace(policy.after, policy.before);
  assert.equal(patchSource(original, "1.4.0"), patched);
  assert.equal(patchSource(patched, "1.4.0"), patched);
  assert.throws(() => patchSource(original + "\n", "1.4.0"), /Unknown node-forge/);
  assert.throws(() => patchSource(original, "1.4.1"), /changes version/);
});

test("RSA rejects nested DigestAlgorithm garbage and still verifies valid signatures and Expo certificates", () => {
  const forge = require("node-forge");
  // Small, ephemeral low-exponent key reproduces the affected parser path; never used by the app.
  const pem = generateKeyPairSync("rsa", { modulusLength: 1024, publicExponent: 3,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "pkcs1", format: "pem" } });
  const keys = { privateKey: forge.pki.privateKeyFromPem(pem.privateKey), publicKey: forge.pki.publicKeyFromPem(pem.publicKey) };
  const a = forge.asn1;
  const field = (type, value, constructed = false) => a.create(a.Class.UNIVERSAL, type, constructed, value);
  const digest = forge.md.sha256.create().update("security regression fixture").digest().getBytes();
  for (const withNull of [false, true]) {
    const algorithm = [field(a.Type.OID, a.oidToDer(forge.oids.sha256).getBytes())];
    if (withNull) algorithm.push(field(a.Type.NULL, ""));
    const encode = () => a.toDer(field(a.Type.SEQUENCE, [
      field(a.Type.SEQUENCE, algorithm, true), field(a.Type.OCTETSTRING, digest),
    ], true)).getBytes();
    assert.equal(keys.publicKey.verify(digest, keys.privateKey.sign(encode(), "NONE")), true);
    algorithm.push(field(a.Type.OCTETSTRING, "unexpected child"));
    // Unmodified node-forge 1.4.0 incorrectly returns true for these signatures.
    const malformed = keys.privateKey.sign(encode(), "NONE");
    assert.throws(() => keys.publicKey.verify(digest, malformed), /valid RSASSA-PKCS1-v1_5 DigestInfo/);
  }
  const signing = require("@expo/code-signing-certificates");
  const certificate = signing.generateSelfSignedCodeSigningCertificate({ keyPair: keys,
    validityNotBefore: new Date(Date.now() - 60000), validityNotAfter: new Date(Date.now() + 86400000),
    commonName: "Security test fixture" });
  signing.validateSelfSignedCertificate(certificate, keys);
  const payload = Buffer.from("Expo signing compatibility");
  const signature = signing.signBufferRSASHA256AndVerify(keys.privateKey, certificate, payload);
  const digestFor = (value) => forge.md.sha256.create().update(value).digest().getBytes();
  assert.equal(keys.publicKey.verify(digestFor(payload.toString()), forge.util.decode64(signature)), true);
  assert.equal(keys.publicKey.verify(digestFor("changed payload"), forge.util.decode64(signature)), false);
});

test("only the exact advisory and its existing dependency chain are mitigated with verified patch proof", () => {
  const result = assessAudit(auditFixture(), proof);
  assert.equal(result.mitigated.length, 4);
  assert.deepEqual(result.blocked, []);
  for (const invalidProof of [undefined, { ...proof, sha256: "wrong" }, { ...proof, version: "1.3.0" }]) {
    assert.equal(assessAudit(auditFixture(), invalidProof).blocked.length, 4);
  }
});

test("a new advisory on node-forge or a second unpatched copy blocks its entire dependency chain", () => {
  const report = auditFixture();
  report.vulnerabilities["node-forge"].via.push({ name: "node-forge", dependency: "node-forge",
    url: "https://github.com/advisories/GHSA-new-issue", severity: "high", range: "<=1.4.0" });
  assert.equal(assessAudit(report, proof).blocked.length, 4);
  const duplicate = auditFixture();
  duplicate.vulnerabilities["node-forge"].nodes.push("node_modules/other/node_modules/node-forge");
  assert.equal(assessAudit(duplicate, proof).blocked.length, 4);
  const escalated = auditFixture();
  escalated.vulnerabilities["node-forge"].severity = "critical";
  escalated.metadata.vulnerabilities.high--;
  escalated.metadata.vulnerabilities.critical++;
  assert.equal(assessAudit(escalated, proof).blocked.length, 4);
});

test("new high/critical findings are blocked while the existing moderate threshold is preserved", () => {
  for (const level of ["moderate", "high", "critical"]) {
    const report = auditFixture();
    report.vulnerabilities.other = { name: "other", severity: level, nodes: ["node_modules/other"],
      via: [{ name: "other", url: "https://example.com/new-advisory", severity: level }] };
    report.metadata.vulnerabilities[level]++;
    report.metadata.vulnerabilities.total++;
    assert.deepEqual(assessAudit(report, proof).blocked, level === "moderate" ? [] : ["other"]);
  }
});

test("unknown dependency chains, cycles, incomplete reports and registry errors fail closed", () => {
  const cycle = auditFixture();
  cycle.vulnerabilities["@expo/cli"].via = ["expo"];
  assert.deepEqual(assessAudit(cycle, proof).blocked.sort(), ["@expo/cli", "expo"]);
  const unknown = auditFixture();
  unknown.vulnerabilities["@expo/cli"].via.push("missing");
  assert.deepEqual(assessAudit(unknown, proof).blocked.sort(), ["@expo/cli", "expo"]);
  for (const report of [{}, { error: { code: "ENOTFOUND" } }, { ...auditFixture(), auditReportVersion: 3 },
    { ...auditFixture(), metadata: { vulnerabilities: { total: 0 } } }]) {
    assert.throws(() => assessAudit(report, proof));
  }
});
