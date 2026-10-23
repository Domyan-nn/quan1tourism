// Exercise the packaged Worker, not a separately transpiled implementation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { default: worker } = await import(`data:text/javascript;base64,${readFileSync(".runtime/worker-bundle/worker.js").toString("base64")}`);
const release = "a".repeat(40);
const env = {
  RELEASE_SHA: release,
  ASSETS: { fetch: async (request) => new Response(new URL(request.url).pathname === "/release.json"
    ? JSON.stringify({ release }) : "compiled asset") },
};

test("packaged Worker exposes its release identity and prevents stale release caching", async () => {
  const response = await worker.fetch(new Request("https://front.test/release.json"), env);
  assert.equal(response.headers.get("x-release-sha"), release);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).release, release);
});

test("packaged Worker routes admin/static requests to the assets binding", async () => {
  for (const path of ["/", "/admin/", "/admin/assets/app.js"]) {
    assert.equal(await (await worker.fetch(new Request("https://front.test" + path), env)).text(), "compiled asset");
  }
});

test("Workers Builds uses its immutable asset release when no runtime SHA is configured", async () => {
  const response = await worker.fetch(new Request("https://front.test/release.json"), { ASSETS: env.ASSETS });
  assert.equal(response.headers.get("x-release-sha"), release);
  assert.equal((await response.json()).release, release);
});
