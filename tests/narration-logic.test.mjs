import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextChunk,
  voiceMatches,
} from "../packages/api-client/src/speech-chunks.ts";
test("voice selection respects language and script variants", () => {
  assert.equal(voiceMatches("vi-VN", "en-US"), false);
  assert.equal(voiceMatches("vi-VN", "vi_VN"), true);
  assert.equal(voiceMatches("en-GB", "en-US"), true);
  assert.equal(voiceMatches("zh-TW", "zh-CN"), false);
  assert.equal(voiceMatches("zh-TW", "zh-Hant-HK"), true);
  assert.equal(voiceMatches("sr-Latn", "sr-Cyrl"), false);
});
import {
  Geofence,
  GPS,
  distanceM,
  fixProblem,
} from "../apps/web/src/geofencing.ts";

for (const text of [
  "Xin chào.",
  "A complete final sentence.",
  "Tiếng Việt có dấu.\n\n".repeat(600),
  "English sentence! ".repeat(1000),
  "日本語の最後の文。".repeat(1200),
  "العربية الجميلة. ".repeat(500),
  "한국어를 읽습니다. ".repeat(900),
  "ภาษาไทยไม่มีช่องว่าง".repeat(800),
  "😀𠮷e\u0301".repeat(3000),
]) {
  test(`complete lossless Unicode chunks (${text.length})`, () => {
    let position = 0;
    const chunks = [];
    while (position < text.length) {
      const chunk = nextChunk(text, position);
      assert.ok(chunk.length > 0 && chunk.length <= 180);
      assert.ok(!/[\ud800-\udbff]$/u.test(chunk));
      chunks.push(chunk);
      position += chunk.length;
    }
    assert.equal(chunks.join(""), text);
  });
}
const target = (id = "a", longitude = 0) => ({
  id,
  latitude: 0,
  longitude,
  trigger_radius_m: 100,
  auto_narration_enabled: true,
  translations: { vi: { text: "Narration", tts_ready: true } },
});
const fix = (timestamp, longitude = 0, accuracy = 5) => ({
  latitude: 0,
  longitude,
  accuracy,
  timestamp,
});

test("haversine, trustworthy fix thresholds and coordinate validation", () => {
  assert.ok(Math.abs(distanceM(fix(0), fix(0, 1)) - 111195) < 1);
  assert.equal(fixProblem(fix(0), 15001), "stale");
  assert.equal(fixProblem(fix(100), 100), "ready");
  assert.equal(fixProblem(fix(100, 0, 51), 100), "accuracy");
  assert.equal(fixProblem({ ...fix(100), latitude: NaN }, 100), "unavailable");
});
test("dwell needs successive fresh samples, no timer or duplicate timestamp activation", () => {
  const fence = new Geofence(),
    targets = [target()];
  assert.equal(fence.offer(fix(1000), targets, "vi", 1000, false), null);
  assert.equal(fence.offer(fix(1000), targets, "vi", 7000, false), null);
  assert.equal(fence.offer(fix(4000), targets, "vi", 4000, false), null);
  assert.equal(fence.offer(fix(6000), targets, "vi", 6000, false), "a");
  assert.equal(fence.offer(fix(12000), targets, "vi", 12000, false), null);
});
test("nearest overlap wins; manual/paused audio cannot be interrupted", () => {
  const fence = new Geofence(),
    targets = [target("far", 0.0003), target("near")];
  assert.equal(fence.offer(fix(1000), targets, "vi", 1000, true), null);
  assert.equal(fence.offer(fix(6000), targets, "vi", 6000, true), null);
  fence.offer(fix(7000), targets, "vi", 7000, false);
  assert.equal(fence.offer(fix(12000), targets, "vi", 12000, false), "near");
});
test("hysteresis and cooldown survive reset/off-on; sustained presence never repeats", () => {
  const fence = new Geofence(),
    targets = [target()];
  fence.offer(fix(1000), targets, "vi", 1000, false);
  assert.equal(fence.offer(fix(6000), targets, "vi", 6000, false), "a");
  fence.started("a", 6000);
  fence.reset();
  for (const time of [7000, 20000, 606001, 620000])
    assert.equal(fence.offer(fix(time), targets, "vi", time, false), null);
  fence.offer(fix(621000, 0.001), targets, "vi", 621000, false); // 111 m: inside exit buffer
  assert.equal(fence.offer(fix(622000), targets, "vi", 622000, false), null);
  fence.offer(fix(623000, 0.002), targets, "vi", 623000, false); // outside exit buffer
  fence.offer(fix(624000), targets, "vi", 624000, false);
  assert.equal(fence.offer(fix(629000), targets, "vi", 629000, false), "a");
});
test("poor accuracy, missing locale, disabled targets and long sample gaps reset dwell", () => {
  const fence = new Geofence(),
    targets = [target()];
  for (const time of [1000, 6000])
    assert.equal(
      fence.offer(fix(time, 0, 60), targets, "vi", time, false),
      null,
    );
  for (const time of [7000, 12000])
    assert.equal(fence.offer(fix(time), targets, "en", time, false), null);
  for (const time of [13000, 18000])
    assert.equal(
      fence.offer(
        fix(time),
        [{ ...target(), auto_narration_enabled: false }],
        "vi",
        time,
        false,
      ),
      null,
    );
  fence.offer(fix(20000), targets, "vi", 20000, false);
  assert.equal(fence.offer(fix(40000), targets, "vi", 40000, false), null);
  assert.equal(fence.offer(fix(45000), targets, "vi", 45000, false), "a");
  assert.equal(GPS.dwellMs, 5000);
});
