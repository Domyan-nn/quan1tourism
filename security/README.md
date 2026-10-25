# node-forge RSA backport

Expo SDK 58 uses `node-forge@1.4.0` via its CLI and code-signing tools. The latest
published release still has [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
The fix in [upstream PR #1152](https://github.com/digitalbazaar/forge/pull/1152),
commit `ceba34402e329f0365134f23fe19898756527d65`, is open and unreleased as of 2026-10-25.

`node-forge-1.4.0.json` records the local backport of its nested DigestAlgorithm
element-count check. `npm ci` applies the change through the root `postinstall`
script. Only the exact original `lib/rsa.js` SHA256 can be patched; an already
patched file is accepted unchanged. Unknown bytes or package versions stop installation.
The package version and npm tarball integrity remain unchanged.

Run **`npm run audit:security`** for the CI security gate. It first runs the RSA,
Expo signing compatibility and audit-policy regression tests, then runs real
`npm audit --json --audit-level=high`. The raw report is retained in
`.runtime/security/npm-audit.json`.

The four findings for this one advisory are accepted only after verifying the
patched file's full SHA256, exact installed version, installation path and the
node-forge paths resolved by both Expo consumers. Additional copies, different
advisories, critical severity, unknown dependency chains, malformed audit output
and audit service errors all block the gate. Other high/critical findings remain
blocking; the moderate threshold is unchanged.

Plain `npm audit --audit-level=high` still reports four high findings because the
registry sees version 1.4.0, not local file changes. This is a verified source
backport, not a claim that an official patched release exists or that raw audit is clean.
`npm ci --ignore-scripts` skips the fix and therefore fails the security check.
Docker copies the patch script and policy before its `npm ci` layer.

When an official fix is available, upgrade and review its behavior, remove the
backport/postinstall and the special advisory handling, and return the CI audit
step to plain npm audit. Do not update the version/checksums to silence a failure
without reviewing the actual code and rerunning the regression tests.
