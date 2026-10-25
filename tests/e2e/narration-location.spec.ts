import { test, expect } from "./fixtures";
import { mockSpeech } from "./speech";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const origin = "http://127.0.0.1:5184";
const text =
  "Xin chào Sài Gòn. Đây là câu chuyện đầy đủ với tiếng Việt có dấu, 日本語 và 😀. ".repeat(
    30,
  ) + "Câu cuối cùng phải được đọc.";
const poi = {
  id: "gps-test",
  name: "GPS narration test",
  address: "Quận 1",
  image_id: null,
  latitude: 10.779,
  longitude: 106.699,
  auto_narration_enabled: true,
  trigger_radius_m: 100,
  translations: { vi: { title: "GPS narration test", text, tts_ready: true } },
};

test("every enabled backend language reads its complete text with its matching mock voice", async ({
  page,
}) => {
  const languages = await (
    await page.request.get(origin + "/api/v1/languages")
  ).json();
  await mockSpeech(
    page,
    languages.map((l: { speech_locale: string }) => l.speech_locale),
  );
  const translations = Object.fromEntries(
    languages.map((l: { code: string; native_name: string }) => [
      l.code,
      {
        title: poi.name,
        text: `${l.native_name}: ${text}`,
        tts_ready: true,
      },
    ]),
  );
  await page.route("**/api/v1/pois**", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 204 })
      : route.fulfill({ json: { items: [{ ...poi, translations }] } }),
  );
  await page.goto(origin);
  for (const language of languages) {
    await page
      .getByRole("combobox", { name: "Ngôn ngữ thuyết minh", exact: true })
      .selectOption(language.code);
    await page.getByRole("button").filter({ hasText: poi.name }).click();
    const before = await page.evaluate(
      () => (window as any).__speech.calls.length,
    );
    await page
      .getByRole("button", { name: "Nghe thuyết minh", exact: true })
      .click();
    const calls = await page.evaluate(async (offset: number) => {
      const s = (window as any).__speech;
      for (let n = 0; n < 500 && s.active; n++) {
        s.finish();
        await Promise.resolve();
      }
      return s.calls.slice(offset);
    }, before);
    expect(calls.map((c: { text: string }) => c.text).join("")).toBe(
      translations[language.code].text,
    );
    expect(
      calls.every(
        (c: { lang: string; voice: string }) =>
          c.lang === language.speech_locale &&
          c.voice === language.speech_locale,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Tất cả địa điểm", exact: true })
      .click();
  }
});

async function fixture(page: Page) {
  await page.route("**/api/v1/pois**", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 204 })
      : route.fulfill({ json: { items: [poi] } }),
  );
  await page.addInitScript(() => {
    let next = 1,
      requests = 0,
      cleared = 0;
    const watchers = new Map<
      number,
      { success: PositionCallback; error?: PositionErrorCallback | null }
    >();
    const singles: {
      success: PositionCallback;
      error?: PositionErrorCallback | null;
    }[] = [];
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (
          success: PositionCallback,
          error: PositionErrorCallback,
        ) => {
          requests++;
          singles.push({ success, error });
        },
        watchPosition: (
          success: PositionCallback,
          error: PositionErrorCallback,
        ) => {
          const id = next++;
          watchers.set(id, { success, error });
          return id;
        },
        clearWatch: (id: number) => {
          cleared++;
          watchers.delete(id);
        },
      },
    });
    Object.defineProperty(window, "__gps", {
      value: {
        get requests() {
          return requests;
        },
        get watchers() {
          return watchers.size;
        },
        get cleared() {
          return cleared;
        },
        emit: (accuracy = 5, longitude = 106.699, stamp = Date.now()) => {
          const position = {
            coords: { latitude: 10.779, longitude, accuracy },
            timestamp: stamp,
          } as GeolocationPosition;
          singles.splice(0).forEach((c) => c.success(position));
          watchers.forEach((c) => c.success(position));
        },
        fail: (code: number) => {
          const error = { code } as GeolocationPositionError;
          singles.splice(0).forEach((c) => c.error?.(error));
          watchers.forEach((c) => c.error?.(error));
        },
      },
    });
  });
}

test("UI language preserves narration, complete chunks, pause/resume and invalidates stale callbacks", async ({
  page,
}) => {
  await mockSpeech(page);
  await fixture(page);
  await page.goto(origin);
  await page.getByRole("button").filter({ hasText: poi.name }).click();
  await page
    .getByRole("button", { name: "Nghe thuyết minh", exact: true })
    .click();
  await page.getByRole("button", { name: "Tạm dừng", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__speech.paused)).toBe(true);
  await page
    .getByRole("button", { name: "Ngôn ngữ giao diện", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).__speech.calls.length)).toBe(
    1,
  );
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.evaluate(() => (window as any).__speech.finish());
  await expect
    .poll(() => page.evaluate(() => (window as any).__speech.calls.length))
    .toBe(2);
  await page.evaluate(() => (window as any).__speech.oldEnd(0));
  expect(await page.evaluate(() => (window as any).__speech.calls.length)).toBe(
    2,
  );
  const spoken = await page.evaluate(async () => {
    const engine = (window as any).__speech;
    for (let n = 0; n < 500 && engine.active; n++) {
      engine.finish();
      await Promise.resolve();
    }
    return engine.calls.map((c: { text: string }) => c.text).join("");
  });
  expect(spoken).toBe(text);
  await expect(page.locator(".speech-player")).toHaveAttribute(
    "data-state",
    "ready",
  );
  await page
    .getByRole("button", { name: "Listen to narration", exact: true })
    .click();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  const count = await page.evaluate(() => {
    const s = (window as any).__speech;
    s.oldEnd(0);
    return s.calls.length;
  });
  await expect(page.locator(".speech-player")).toHaveAttribute(
    "data-state",
    "stopped",
  );
  expect(await page.evaluate(() => (window as any).__speech.calls.length)).toBe(
    count,
  );
});

test("admin UI switch preserves unsaved radius; restore and cancel never write it", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Trải nghiệm tài khoản demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Địa điểm", exact: true }),
  ).toBeVisible();
  const name = `Unicode địa điểm 日本 ${info.project.name} ${Date.now()}`;
  const created = await page.request.post("/api/v1/admin/pois", {
    headers: { "X-Requested-With": "Quan1Admin" },
    data: {
      name,
      category_id: "culture",
      address: "Quận 1",
      latitude: 10.779,
      longitude: 106.699,
      translations: {
        vi: { title: name, text },
        en: { title: name, text: "Saved narration." },
      },
    },
  });
  expect(created.status()).toBe(201);
  const saved = await created.json();
  await page.reload();
  await page
    .getByRole("textbox", { name: "Tìm địa điểm, địa chỉ…" })
    .fill(name);
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByText("Chỉnh sửa nâng cao", { exact: true }).click();
  await page.getByLabel("Bán kính kích hoạt (m)").fill("260");
  await page.getByLabel("Cho phép thuyết minh theo vị trí").check();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Ngôn ngữ giao diện", exact: true })
    .click();
  await expect(page.getByLabel("Trigger radius (m)")).toHaveValue("260");
  await expect(page.getByLabel("Enable location narration")).toBeChecked();
  await page
    .getByRole("button", { name: "Restore saved location", exact: true })
    .click();
  await expect(page.getByLabel("Trigger radius (m)")).toHaveValue("100");
  await expect(page.getByLabel("Enable location narration")).not.toBeChecked();
  await page.getByLabel("Trigger radius (m)").fill("180");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    (await (await page.request.get(`/api/v1/admin/pois/${saved.id}`)).json())
      .trigger_radius_m,
  ).toBe(100);
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByText("Advanced editing", { exact: true }).click();
  await page.getByLabel("Trigger radius (m)").fill("80");
  await page.getByLabel("Enable location narration").check();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/v1/admin/pois/${saved.id}`)
          ).json()
        ).trigger_radius_m,
    )
    .toBe(80);
  expect(
    (await (await page.request.get(`/api/v1/admin/pois/${saved.id}`)).json())
      .auto_narration_enabled,
  ).toBe(true);
});

test("Unicode category survives admin create/rename and the public visitor card with its ID intact", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Trải nghiệm tài khoản demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Địa điểm", exact: true }),
  ).toBeVisible();
  await page.goto("/admin/#categories");
  await page
    .getByRole("button", { name: "Thêm danh mục", exact: true })
    .click();
  const categoryName = `Văn hóa 日本 العربية ${info.project.name} ${Date.now()}`;
  const categoryNameEn = `Culture ${info.project.name} ${Date.now()}`;
  await page.getByLabel("Tên tiếng Anh", { exact: true }).fill(categoryNameEn);
  await page.getByLabel("Tên tiếng Việt", { exact: true }).fill(categoryName);
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/v1/admin/categories") &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Tạo danh mục", exact: true }).click();
  const category = await (await response).json();
  await page
    .locator(".category-card")
    .filter({ hasText: categoryName })
    .getByRole("button", { name: "Sửa tên danh mục", exact: true })
    .click();
  await page
    .getByLabel("Tên tiếng Việt", { exact: true })
    .fill(categoryName + " mới");
  await page.getByRole("button", { name: "Lưu danh mục", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: categoryName + " mới", exact: true }),
  ).toBeVisible();
  const name = `Unicode visitor ${info.project.name} ${Date.now()}`;
  const created = await page.request.post("/api/v1/admin/pois", {
    headers: { "X-Requested-With": "Quan1Admin" },
    data: {
      name,
      category_id: category.id,
      address: "Địa chỉ có dấu",
      status: "published",
      translations: {
        vi: { title: name, text },
        en: { title: name, text: "Verified English text." },
      },
    },
  });
  expect(created.status()).toBe(201);
  expect((await created.json()).category_id).toBe(category.id);
  await page.goto(origin);
  await page.getByLabel("Tìm địa điểm", { exact: true }).fill(name);
  await expect(
    page.locator(".place").getByText(categoryName + " mới", { exact: true }),
  ).toBeVisible();
  const publicCategories = await (
    await page.request.get(origin + "/api/v1/categories")
  ).json();
  expect(
    publicCategories.find((c: { id: string }) => c.id === category.id).name_vi,
  ).toBe(categoryName + " mới");
  expect(
    publicCategories.find((c: { id: string }) => c.id === category.id).name,
  ).toBe(categoryNameEn);
  expect(publicCategories.every((c: object) => !("count" in c))).toBe(true);
});

test("admin supplements an existing place through worker protocol 3 and reviews a private draft", async ({
  page,
}, info) => {
  await mockSpeech(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Trải nghiệm tài khoản demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Địa điểm", exact: true }),
  ).toBeVisible();
  const name = `Bổ sung AI ${info.project.name} ${Date.now()}`;
  const translationSource = JSON.parse(
    readFileSync("tests/fixtures/translation-corpus.json", "utf8"),
  ).sources[0].text;
  const response = await page.request.post("/api/v1/admin/pois", {
    headers: { "X-Requested-With": "Quan1Admin" },
    data: {
      name,
      category_id: "culture",
      address: "Quận 1",
      status: "published",
      translations: {
        vi: { title: name, text: translationSource },
        en: { title: name, text: "Existing English narration must stay." },
      },
    },
  });
  expect(response.status()).toBe(201);
  const saved = await response.json();
  await page.reload();
  await page
    .getByRole("textbox", { name: "Tìm địa điểm, địa chỉ…" })
    .fill(name);
  await page.getByRole("button", { name, exact: true }).click();
  await page
    .getByRole("button", { name: "Bước 2: Nội dung đa ngôn ngữ", exact: true })
    .click();
  const region = page.getByRole("region", {
    name: "Thuyết minh đa ngôn ngữ",
    exact: true,
  });
  const row = region.getByRole("row").filter({ hasText: "Français" });
  await expect(row.getByRole("checkbox")).not.toBeChecked();
  await expect(
    region
      .getByRole("row")
      .filter({ hasText: "English" })
      .getByRole("checkbox"),
  ).not.toBeChecked();
  await region
    .getByLabel("Tôi đã xác minh và lưu nội dung nguồn tiếng Việt.")
    .check();
  await row
    .getByRole("button", { name: "AI bổ sung / thử lại", exact: true })
    .click();
  await expect(row).toContainText("Đang chờ máy AI");
  const workerHeaders = {
    "X-Requested-With": "Quan1Admin",
    Authorization: "Bearer isolated-e2e-worker-credential-only",
  };
  const claimed = await (
    await page.request.post("/api/v1/worker/claim", {
      headers: workerHeaders,
      data: { protocol: 3 },
    })
  ).json();
  expect(claimed.job.payload.poi_id).toBe(saved.id);
  const french =
    "Découvrez ce lieu à partir des informations vérifiées par notre équipe. Prenez le temps de regarder les détails et les espaces décrits dans le texte source. Cette présentation reste fidèle aux éléments enregistrés par les responsables et demande une vérification avant toute publication.";
  const completion = await page.request.post(
    `/api/v1/worker/jobs/${claimed.job.id}/complete`,
    {
      headers: workerHeaders,
      data: {
        lease: claimed.job.lease,
        locale: claimed.job.payload.locale,
        source_revision: claimed.job.payload.source_revision,
        source_hash: claimed.job.payload.source_hash,
        done_reason: "stop",
        translation: { title: "Présentation vérifiée", text: french },
        model: "mock-ollama",
      },
    },
  );
  expect(completion.status()).toBe(200);
  expect((await completion.json()).status).toBe("completed");
  await row
    .getByRole("button", { name: "Xem & chỉnh bản AI", exact: true })
    .click();
  await region
    .getByLabel("Tôi đã kiểm tra ngôn ngữ và thông tin của bản dịch.")
    .check();
  await region
    .getByRole("button", { name: "Lưu bản dịch vào nháp", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/v1/admin/pois/${saved.id}`)
          ).json()
        ).translations.fr.text,
    )
    .toBe(french);
  // Persistence can finish before the apply response updates the review panel.
  await expect(region.locator(".ai-review")).toBeHidden();
  const publicPoi = await (
    await page.request.get(`/api/v1/pois/${saved.id}?track_view=false`)
  ).json();
  expect(publicPoi.translations.fr?.text).toBeFalsy();
  expect(publicPoi.translations.en.text).toBe(
    "Existing English narration must stay.",
  );
  // Close the editor; the translation review has its own cancel action.
  await page.locator(".editor-footer").getByRole("button", { name: "Hủy", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await page
    .getByRole("button", { name: "Bước 2: Nội dung đa ngôn ngữ", exact: true })
    .click();
  await page.getByRole("tab").filter({ hasText: "Français" }).click();
  await expect(
    page.getByLabel("Bài thuyết minh", { exact: false }),
  ).toHaveValue(french);
});

test("delayed voices recover without wrong-language fallback or losing text", async ({
  page,
}) => {
  await mockSpeech(page, []);
  await fixture(page);
  await page.goto(origin);
  await page.getByRole("button").filter({ hasText: poi.name }).click();
  await expect(
    page.getByRole("button", { name: "Nghe thuyết minh", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".narration")).toHaveText(text);
  await page.evaluate(() => (window as any).__speech.voices(["en-US"]));
  await expect(
    page.getByRole("button", { name: "Nghe thuyết minh", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() =>
    (window as any).__speech.voices(["vi-VN", "en-US"]),
  );
  await page
    .getByRole("button", { name: "Nghe thuyết minh", exact: true })
    .click();
  expect(
    await page.evaluate(() => (window as any).__speech.calls[0].lang),
  ).toBe("vi-VN");
});

test("GPS requires opt-in, fresh accurate dwell; auto listening sends no view and clears watcher", async ({
  page,
}) => {
  await mockSpeech(page);
  await fixture(page);
  await page.clock.install();
  const events: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/events/")) events.push(request.url());
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "Bản đồ", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__gps.requests)).toBe(0);
  await page
    .getByRole("button", { name: "Bật thuyết minh theo vị trí", exact: true })
    .click();
  expect(await page.evaluate(() => (window as any).__gps.watchers)).toBe(1);
  await page.evaluate(() => (window as any).__gps.emit(100));
  await page.clock.runFor(6000);
  expect(await page.evaluate(() => (window as any).__speech.calls.length)).toBe(
    0,
  );
  await page.evaluate(() => (window as any).__gps.emit());
  await page.clock.runFor(5000);
  expect(await page.evaluate(() => (window as any).__speech.calls.length)).toBe(
    0,
  ); // Timer alone cannot trigger.
  await page.evaluate(() => (window as any).__gps.emit());
  await expect(page.getByRole("heading", { name: poi.name })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).__speech.calls.length))
    .toBe(1);
  await expect
    .poll(() => events.filter((e) => e.endsWith("/listen")).length)
    .toBe(1);
  expect(events.filter((e) => e.endsWith("/view"))).toHaveLength(0);
  await page
    .getByRole("button", { name: "Tắt thuyết minh theo vị trí", exact: true })
    .click();
  expect(await page.evaluate(() => (window as any).__gps.watchers)).toBe(0);
  expect(await page.evaluate(() => (window as any).__speech.active)).toBe(
    false,
  );
});

test("GPS errors do not interrupt manual narration; turning off preserves manual audio", async ({
  page,
}) => {
  await mockSpeech(page);
  await fixture(page);
  await page.goto(origin);
  await page.getByRole("button", { name: "Bản đồ", exact: true }).click();
  await page
    .getByRole("button", { name: "Bật thuyết minh theo vị trí", exact: true })
    .click();
  await page.evaluate(() => (window as any).__gps.fail(1));
  await expect(page.locator(".gps-controls").getByRole("status")).toContainText("chưa cấp quyền");
  await page.locator('.place-pin[title="GPS narration test"]').click();
  await page
    .getByRole("button", { name: "Nghe thuyết minh", exact: true })
    .click();
  await page.evaluate(() => (window as any).__gps.fail(3));
  await expect(page.locator(".gps-controls").getByRole("status")).toContainText("quá thời gian");
  await page
    .getByRole("button", { name: "Tắt thuyết minh theo vị trí", exact: true })
    .click();
  expect(await page.evaluate(() => (window as any).__speech.active)).toBe(true);
  await page.getByRole("button", { name: "Danh sách", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__gps.watchers)).toBe(0);
});

test("autoplay denial is visible and never records a listen before manual onstart", async ({
  page,
}) => {
  await mockSpeech(page);
  await fixture(page);
  await page.clock.install();
  const listens: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/events/listen")) listens.push(r.url());
  });
  await page.goto(origin);
  await page.evaluate(() => (window as any).__speech.deny(true));
  await page.getByRole("button", { name: "Bản đồ", exact: true }).click();
  await page
    .getByRole("button", { name: "Bật thuyết minh theo vị trí", exact: true })
    .click();
  await page.evaluate(() => (window as any).__gps.emit());
  await page.clock.runFor(5000);
  await page.evaluate(() => (window as any).__gps.emit());
  await expect
    .poll(() => page.evaluate(() => (window as any).__speech.calls.length))
    .toBe(1);
  await page.clock.runFor(5000);
  await expect(page.locator(".map-card")).toContainText(
    "Chạm Nghe thuyết minh",
  );
  expect(listens).toHaveLength(0);
  await page.evaluate(() => (window as any).__speech.deny(false));
  await page
    .getByRole("button", { name: "Nghe thuyết minh", exact: true })
    .click();
  await expect.poll(() => listens.length).toBe(1);
});

test("disabling GPS cancels an automatic request waiting for delayed voices", async ({
  page,
}) => {
  await mockSpeech(page, []);
  await fixture(page);
  await page.clock.install();
  await page.goto(origin);
  await page.getByRole("button", { name: "Bản đồ", exact: true }).click();
  await page
    .getByRole("button", { name: "Bật thuyết minh theo vị trí", exact: true })
    .click();
  await page.evaluate(() => (window as any).__gps.emit());
  await page.clock.runFor(5000);
  await page.evaluate(() => (window as any).__gps.emit());
  await expect(page.locator(".map-card")).toBeVisible();
  await page
    .getByRole("button", { name: "Tắt thuyết minh theo vị trí", exact: true })
    .click();
  await page.evaluate(() => (window as any).__speech.voices(["vi-VN"]));
  await page.clock.runFor(5000);
  expect(await page.evaluate(() => (window as any).__speech.calls.length)).toBe(
    0,
  );
  expect(await page.evaluate(() => (window as any).__gps.watchers)).toBe(0);
});

test("hidden tab and stale samples cannot qualify dwell; visible tab needs fresh samples", async ({
  page,
}) => {
  await mockSpeech(page);
  await fixture(page);
  await page.clock.install();
  await page.addInitScript(() => {
    let hidden = false;
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });
    Object.defineProperty(window, "__hide", {
      value: (value: boolean) => {
        hidden = value;
        document.dispatchEvent(new Event("visibilitychange"));
      },
    });
  });
  await page.goto(origin);
  await page.getByRole("button", { name: "Bản đồ", exact: true }).click();
  await page
    .getByRole("button", { name: "Bật thuyết minh theo vị trí", exact: true })
    .click();
  await page.evaluate(() => {
    (window as any).__gps.emit(5, 106.699, Date.now() - 16000);
    (window as any).__hide(true);
  });
  await page.clock.runFor(5000);
  await page.evaluate(() => (window as any).__gps.emit());
  expect(await page.evaluate(() => (window as any).__speech.calls.length)).toBe(
    0,
  );
  await page.evaluate(() => (window as any).__hide(false));
  await page.clock.runFor(5000);
  expect(await page.evaluate(() => (window as any).__speech.calls.length)).toBe(
    0,
  );
  await page.evaluate(() => (window as any).__gps.emit());
  await page.clock.runFor(5000);
  await page.evaluate(() => (window as any).__gps.emit());
  await expect
    .poll(() => page.evaluate(() => (window as any).__speech.calls.length))
    .toBe(1);
});

test("search with no matching pins keeps GPS scope and explains dwell and missing content", async ({ page }) => {
  await mockSpeech(page);
  await fixture(page);
  await page.clock.install();
  await page.goto(origin);
  await page.getByRole("textbox", { name: "Tìm địa điểm", exact: true }).fill("không tìm thấy");
  await page.getByRole("button", { name: "Bản đồ", exact: true }).click();
  await expect(page.locator(".place-pin")).toHaveCount(0);
  await page.getByRole("button", { name: "Bật thuyết minh theo vị trí", exact: true }).click();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(() => (window as any).__gps.emit(Number.NaN));
  await expect(page.locator(".gps-controls").getByRole("status")).toContainText("Chưa xác định");
  expect(errors).toEqual([]);
  await page.evaluate(() => (window as any).__gps.emit(5, 106.72));
  await expect(page.locator(".gps-controls").getByRole("status")).toContainText("Chưa có địa điểm đủ gần");
  await page.evaluate(() => (window as any).__gps.emit());
  await expect(page.locator(".gps-controls").getByRole("status")).toContainText("Đang xác nhận");
  await page.clock.runFor(5000);
  await page.evaluate(() => (window as any).__gps.emit());
  await expect.poll(() => page.evaluate(() => (window as any).__speech.calls.length)).toBe(1);
  await expect(page.locator(".map-card")).toContainText(poi.name);
});
