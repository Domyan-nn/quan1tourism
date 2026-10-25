import { test } from "node:test";
import assert from "node:assert/strict";
import { expoGoUrl } from "../apps/web/src/expo-link.ts";

test("Expo QR is opt-in and preserves the exact configured CLI project URL", () => {
  for (const value of [
    "exp://192.0.2.10:8081",
    "exps://test-session.exp.direct",
    "exp://preview.example.test:8081/",
  ]) {
    assert.equal(expoGoUrl("true", value), value);
    assert.equal(expoGoUrl("false", value), null);
    assert.equal(expoGoUrl(undefined, value), null);
  }
});
test("Expo QR rejects website, backend, unsafe and non-project URLs", () => {
  for (const value of [
    undefined,
    "",
    "https://example.test",
    "http://192.0.2.10:8081",
    "javascript:alert(1)",
    "exp://",
    "exp://user:password@example.test",
    "exp://example.test/--/place",
    "exp://example.test?token=abc",
    "exp://example.test#x",
    "exp://example.test?",
    "exp://example.test#",
    "exp://localhost:8081",
    "exp://127.0.0.1:8081",
    "exp://0.0.0.0:8081",
    "exp://[::1]:8081",
    "exp://[::]:8081",
    "exp://app.localhost:8081",
    "exp://example.test:0",
    "exp://example.test:65536",
    "exp://999.0.2.1:8081",
    "exp://bad_host:8081",
    "exp://-bad.test",
    "exp://example.test\\evil",
    " exp://example.test",
    "exp://example.test\n",
    "exp://example.test/a",
    "exp://example.test:abc",
  ])
    assert.equal(expoGoUrl("true", value), null, String(value));
  assert.equal(expoGoUrl("1", "exp://192.0.2.10:8081"), null);
});
