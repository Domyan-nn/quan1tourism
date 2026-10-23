import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = ts.transpileModule(readFileSync("cloudflare/map-tiles.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { mapTile } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("tile proxy validates coordinates and preserves caching and application identity", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://tile.openstreetmap.org/14/13047/7698.png");
    assert.match(options.headers["User-Agent"], /Quan1Tourism/);
    assert.equal(options.headers.Referer, "https://tourism.example/");
    assert.equal(options.headers["Cache-Control"], undefined);
    return new Response("image", { headers: { "Cache-Control": "public, max-age=900000" } });
  };
  try {
    const response = await mapTile(new Request("https://tourism.example/map-tiles/14/13047/7698.png"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=900000");
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal((await mapTile(new Request("https://tourism.example/map-tiles/1/999/1.png"))).status, 404);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("provider errors are not returned as successful map images", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  try {
    assert.equal((await mapTile(new Request("https://tourism.example/map-tiles/1/0/0.png"))).status, 502);
  } finally { globalThis.fetch = original; }
});
