import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = ts.transpileModule(readFileSync("functions/api/[[path]].ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { onRequest } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const env = { RENDER_API_ORIGIN: "https://backend.test" };

test("proxy preserves path, query, auth cookies and Set-Cookie; never caches API", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (request, options) => {
    assert.equal(request.url, "https://backend.test/api/v1/auth/me?a=1");
    assert.equal(request.headers.get("cookie"), "session=synthetic");
    assert.equal(options.redirect, "manual");
    return new Response("{}", { headers: { "Set-Cookie": "session=synthetic; HttpOnly; Secure; SameSite=Strict", "Cache-Control": "public" } });
  };
  try {
    const response = await onRequest({ request: new Request("https://front.test/api/v1/auth/me?a=1", {
      headers: { Cookie: "session=synthetic" },
    }), env });
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.match(response.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Strict/);
  } finally { globalThis.fetch = original; }
});

test("invalid origins and failed upstreams fail closed without leaking responses", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("sensitive upstream detail"); };
  try {
    const request = new Request("https://front.test/api/v1/health/ready");
    assert.equal((await onRequest({ request, env: { RENDER_API_ORIGIN: "http://bad.test" } })).status, 503);
    const failed = await onRequest({ request, env });
    assert.equal(failed.status, 502);
    assert.equal(failed.headers.get("cache-control"), "no-store");
    assert.equal(await failed.text(), "API unavailable");
  } finally { globalThis.fetch = original; }
});
