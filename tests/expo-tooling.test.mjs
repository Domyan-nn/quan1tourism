import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";

const mobileRequire = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const expoRequire = createRequire(mobileRequire.resolve("expo/package.json"));
const cliPackage = expoRequire.resolve("@expo/cli/package.json");
const cliRequire = createRequire(cliPackage);
const server = join(dirname(cliPackage), "build/src/start/server");

test("Expo plugin schemas still validate commands and output with patched Zod", () => {
  assert.equal(cliRequire("zod/package.json").version, "4.6.7");
  const { PluginSchema, DevToolsPluginOutputSchema } = cliRequire(join(server, "DevToolsPlugin.schema.js"));
  const plugin = {
    packageName: "fixture-plugin",
    packageRoot: "/fixture",
    cliExtensions: {
      description: "Tooling compatibility fixture",
      entryPoint: "index.js",
      commands: [{
        name: "inspect", title: "Inspect", environments: ["cli", "mcp"],
        parameters: [
          { name: "label", type: "text" },
          { name: "count", type: "number" },
          { name: "enabled", type: "confirm" },
        ],
      }],
    },
  };
  assert.equal(PluginSchema.safeParse(plugin).success, true);
  assert.equal(PluginSchema.safeParse({ ...plugin, packageName: "" }).success, false);
  assert.equal(DevToolsPluginOutputSchema.safeParse([
    { type: "text", text: "Ready", level: "info" },
    { type: "image", url: "https://example.com/image.png" },
  ]).success, true);
  assert.equal(DevToolsPluginOutputSchema.safeParse([{ type: "image", url: "invalid" }]).success, false);

  const { createMCPDevToolsExtensionSchema } = cliRequire(join(server, "createMCPDevToolsExtensionSchema.js"));
  const schema = createMCPDevToolsExtensionSchema(plugin);
  assert.deepEqual(schema.parse({ command: "inspect", label: "POI", count: 2, enabled: true }),
    { command: "inspect", label: "POI", count: 2, enabled: true });
  for (const invalid of [
    { command: "unknown" }, { command: "inspect", count: "two" },
    { command: "inspect", enabled: "yes" }, { command: "inspect", extra: true },
  ]) assert.equal(schema.safeParse(invalid).success, false);
});

test("ngrok creates a tunnel name with the patched CommonJS UUID API", async (t) => {
  const ngrokRequire = createRequire(mobileRequire.resolve("@expo/ngrok/package.json"));
  assert.equal(ngrokRequire("uuid/package.json").version, "11.1.1");
  const processModule = ngrokRequire("./src/process");
  const { NgrokClient } = ngrokRequire("./src/client");
  // Exercise ngrok's real connect path without starting a binary or opening a tunnel.
  t.mock.method(processModule, "getProcess", async () => "http://127.0.0.1:4040");
  t.mock.method(NgrokClient.prototype, "startTunnel", async (options) => {
    assert.match(options.name, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.equal(options.addr, 8081);
    return { public_url: "https://example.com" };
  });
  const ngrok = mobileRequire("@expo/ngrok");
  assert.equal(await ngrok.connect({ addr: 8081 }), "https://example.com");
});
