import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { Narrator } from "../apps/mobile/src/narrator.ts";
import { apiOrigin, DEFAULT_API_ORIGIN } from "../apps/mobile/src/config.ts";
import { Geofence, fixProblem } from "../packages/contracts/src/geofencing.ts";

const voices = [
  { identifier: "english", language: "en-US" },
  { identifier: "vietnamese", language: "vi-VN" },
  { identifier: "traditional-chinese", language: "zh-TW" },
];
const tick = () => new Promise(resolve => setImmediate(resolve));
function speech(overrides = {}) {
  const calls = [], states = [];
  const port = { stop: async () => {}, voices: async () => voices,
    speak: (text, options) => calls.push({ text, options }), ...overrides };
  return { calls, states, narrator: new Narrator(port, state => states.push(state)) };
}

test("mobile API configuration accepts public HTTPS origins and rejects local or embedded credentials", () => {
  assert.equal(apiOrigin(undefined), DEFAULT_API_ORIGIN);
  assert.equal(apiOrigin(" https://api.example.test/ "), "https://api.example.test");
  for (const origin of ["http://api.example.test", "https://localhost", "https://a.localhost",
    "https://127.0.0.1", "https://[::1]", "https://[::]", "https://0.0.0.0",
    "https://user:secret@api.example.test", "https://api.example.test/api/v1",
    "https://api.example.test?secret=x", "https://api.example.test#fragment", "invalid"]) {
    assert.throws(() => apiOrigin(origin), undefined, origin);
  }
});

test("native narration reads the entire Unicode article and counts once on actual first playback", async () => {
  const { narrator, calls, states } = speech();
  const text = "Xin chào Việt Nam. 日本語。 😀𠮷e\u0301\n".repeat(120);
  let listens = 0;
  await narrator.play(text, "vi-VN", () => listens++);
  assert.equal(narrator.busy, true);
  assert.equal(listens, 0); // Queuing speech or looking up a voice is not listening.
  let index = 0;
  while (index < calls.length) {
    const current = calls[index++];
    assert.equal(current.options.voice, "vietnamese");
    assert.equal(current.options.language, "vi-VN");
    assert.ok(current.text.length <= 180);
    current.options.onStart();
    current.options.onStart(); // Device callbacks cannot count a chunk twice.
    current.options.onDone();
  }
  assert.ok(calls.length > 1);
  assert.equal(calls.map(call => call.text).join(""), text);
  assert.equal(listens, 1);
  assert.equal(narrator.busy, false);
  assert.equal(states.at(-1), "idle");
});

test("missing or wrong-script voices retain readable text without using a wrong language", async () => {
  const { narrator, calls, states } = speech();
  let listens = 0;
  await narrator.play("简体中文。", "zh-CN", () => listens++);
  assert.equal(calls.length, 0);
  assert.equal(listens, 0);
  assert.equal(states.at(-1), "missing-voice");
  assert.equal(narrator.busy, false);
});

test("switching place invalidates pending voice lookups and stale speech callbacks", async () => {
  const lookups = [];
  const { narrator, calls } = speech({ voices: () => new Promise(resolve => lookups.push(resolve)) });
  let oldStarts = 0, newStarts = 0;
  const old = narrator.play("Old narration", "vi-VN", () => oldStarts++);
  await tick();
  const current = narrator.play("Current narration", "en-US", () => newStarts++);
  await tick();
  lookups[1](voices);
  await current;
  lookups[0](voices);
  await old;
  assert.deepEqual(calls.map(call => call.text), ["Current narration"]);
  calls[0].options.onStart();
  assert.equal(newStarts, 1);
  await narrator.stop();
  calls[0].options.onDone();
  calls[0].options.onStart();
  assert.equal(calls.length, 1);
  assert.equal(newStarts, 1);
  assert.equal(oldStarts, 0);
  assert.equal(narrator.busy, false);
});

test("stop before native playback starts cancels the old queue without recording listening", async () => {
  const { narrator, calls, states } = speech();
  let listens = 0;
  await narrator.play("Waiting narration", "en-US", () => listens++);
  await narrator.stop();
  calls[0].options.onStart();
  calls[0].options.onDone();
  assert.equal(listens, 0);
  assert.equal(states.at(-1), "idle");
});

test("native errors release the playback lock for a later article", async () => {
  const { narrator, calls, states } = speech();
  await narrator.play("First", "en-US", () => {});
  calls[0].options.onError();
  assert.equal(narrator.busy, false);
  assert.equal(states.at(-1), "error");
  await narrator.play("Second", "en-US", () => {});
  assert.equal(calls[1].text, "Second");
});

test("mobile shares backend radius, dwell, fix quality, overlap and cooldown behavior", () => {
  const fence = new Geofence();
  const place = (id, longitude, radius = 60) => ({ id, latitude: 0, longitude,
    trigger_radius_m: radius, auto_narration_enabled: true,
    translations: { en: { text: "A narration", tts_ready: true } } });
  const point = (timestamp, changes = {}) => ({ latitude: 0, longitude: 0,
    accuracy: 5, timestamp, ...changes });
  const places = [place("far", 0.0003), place("near", 0)];
  assert.equal(fixProblem(point(1000, { accuracy: 80 }), 1000), "accuracy");
  assert.equal(fixProblem(point(1000), 17000), "stale");
  assert.equal(fence.offer(point(1000), places, "en", 1000, true), null);
  assert.equal(fence.offer(point(6000), places, "en", 6000, true), null);
  assert.equal(fence.offer(point(7000), places, "en", 7000, false), null);
  assert.equal(fence.offer(point(12000), places, "en", 12000, false), "near");
  fence.started("near", 12000);
  fence.reset();
  assert.equal(fence.offer(point(13000), places, "en", 13000, false), null);
  assert.equal(fence.offer(point(18000), places, "en", 18000, true), null);
  assert.equal(fence.offer(point(19000), places, "vi", 19000, false), null);
});

// Compile the real API module while replacing only native storage/crypto and HTTP.
// Node cannot load Expo's device runtime, so these ports are isolated test doubles.
const apiCode = ts.transpileModule(readFileSync(new URL("../apps/mobile/src/api.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const TOKEN_KEY = "quan1.native.session";
function nativeApi(fetchResponse, failWrite = false) {
  const store = new Map([[TOKEN_KEY, "old-token"], ["quan1.native.visit", "a".repeat(64)]]);
  const calls = [], exported = {};
  const modules = {
    "expo-secure-store": {
      WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only",
      getItemAsync: async key => store.get(key) ?? null,
      setItemAsync: async (key, value) => {
        if (key === TOKEN_KEY && failWrite) throw new Error("SecureStore unavailable");
        store.set(key, value);
      },
      deleteItemAsync: async key => { store.delete(key); },
    },
    "expo-crypto": { getRandomBytesAsync: async length => new Uint8Array(length) },
    "./config": { apiOrigin },
  };
  runInNewContext(apiCode, {
    exports: exported, require: name => {
      assert.ok(name in modules, `Unexpected native dependency: ${name}`);
      return modules[name];
    },
    process: {env: {}}, Headers, AbortController, setTimeout, clearTimeout,
    fetch: async (url, options) => { calls.push({url, options}); return fetchResponse(url, options); },
  });
  return { api: exported, store, calls };
}
const response = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const loginBody = { user: {id: "visitor", role: "visitor"}, access_token: "new-token" };

test("failed secure storage revokes the newly issued credential using its explicit Authorization header", async () => {
  const {api, calls} = nativeApi(url => response(url.endsWith("/login") ? 200 : 204, loginBody), true);
  await assert.rejects(api.authenticate("login", {email: "visitor@example.test", password: "private"}), /SecureStore unavailable/);
  assert.equal(calls[0].options.headers.get("Authorization"), "Bearer old-token");
  assert.equal(calls[1].options.headers.get("Authorization"), "Bearer new-token");
  assert.ok(calls[1].url.endsWith("/native/auth/logout"));
  assert.equal(calls[0].options.credentials, "omit");
});

test("a stale unauthorized response cannot delete a newer login from secure storage", async () => {
  let finishOld;
  const {api, store} = nativeApi(url => url.endsWith("/login") ? response(200, loginBody) :
    new Promise(resolve => {finishOld = resolve;}));
  const stale = api.request("/native/auth/me");
  const failed = assert.rejects(stale, error => error.status === 401);
  await tick();
  await api.authenticate("login", {email: "visitor@example.test", password: "private"});
  finishOld(response(401));
  await failed;
  assert.equal(store.get(TOKEN_KEY), "new-token");
});

test("incorrect login credentials preserve the existing authenticated session", async () => {
  const {api, store} = nativeApi(() => response(401));
  await assert.rejects(api.authenticate("login", {email: "visitor@example.test", password: "incorrect"}), error => error.status === 401);
  assert.equal(store.get(TOKEN_KEY), "old-token");
});

test("logout retains retryable network sessions and clears an already expired server session", async () => {
  let offline = true;
  const {api, store} = nativeApi(() => {
    if (offline) throw new Error("Offline");
    return response(401);
  });
  await assert.rejects(api.logout(), /Offline/);
  assert.equal(store.get(TOKEN_KEY), "old-token");
  offline = false;
  await api.logout();
  assert.equal(store.has(TOKEN_KEY), false);
});
