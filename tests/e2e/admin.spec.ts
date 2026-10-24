import { type Page } from "@playwright/test";
import { test, expect, offline } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { mockSpeech } from "./speech";

async function login(page: Page, role = "admin") {
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill(`${role}@quan1.local`);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("Quan1Demo!2026");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Địa điểm", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".place-name, .place-card h3 button").first(),
  ).toBeVisible();
}
test("admin accessibility on dashboard", async ({ page }) => {
  await login(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    results.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        summary: n.failureSummary,
      })),
    })),
  ).toEqual([]);
});

test("accessible login and editor", async ({ page }) => {
  await page.goto("/");
  for (const screen of ["login", "editor"]) {
    if (screen === "editor") {
      await page
        .getByRole("button", {
          name: "Trải nghiệm tài khoản demo",
          exact: true,
        })
        .click();
      await page
        .getByRole("button", { name: "Thêm địa điểm", exact: true })
        .click();
    }
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      result.violations.map((v) => ({
        screen,
        id: v.id,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
    ).toEqual([]);
  }
});

test("search, empty state, filters and responsive navigation", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);
  await page.screenshot({
    path: `.runtime/screenshots/admin-${info.project.name}.png`,
    fullPage: true,
  });
  const search = page.getByRole("textbox", { name: "Tìm địa điểm, địa chỉ…" });
  await search.fill("dinh doc lap");
  await expect(
    page.getByRole("button", { name: "Dinh Độc Lập", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Nhà thờ Đức Bà", exact: true }),
  ).toHaveCount(0);
  await search.fill("khong-co-dia-diem");
  await expect(
    page.getByRole("heading", { name: "Chưa tìm thấy địa điểm" }),
  ).toBeVisible();
  await page
    .locator(".empty")
    .getByRole("button", { name: "Bỏ bộ lọc", exact: true })
    .click();
  await expect(
    page.locator(".place-name, .place-card h3 button").first(),
  ).toBeVisible();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Mở menu", exact: true }).click();
  await page
    .getByRole("button", { name: "Duyệt nội dung", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Chưa có nội dung cần duyệt",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("keyboard accessible help and display preferences", async ({
  page,
}, info) => {
  await login(page);
  await page
    .getByRole("button", { name: "Xem hướng dẫn", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Hướng dẫn sử dụng" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Mở menu", exact: true }).click();
  await page
    .getByRole("button", { name: "Tùy chỉnh giao diện", exact: true })
    .click();
  await page.getByRole("switch", { name: "Cỡ chữ lớn" }).check();
  await expect(page.locator("html")).toHaveClass("large-text");
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "Ngôn ngữ giao diện", exact: true })
    .selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Make yourself at home" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator("html")).toHaveClass("large-text");
  await expect(
    page.getByRole("heading", { name: "Places", exact: true }),
  ).toBeVisible();
});

test("admin publishes text and visitor listens in both languages with TTS", async ({
  page,
  browser,
}, info) => {
  await login(page, "admin");
  await page
    .getByRole("button", { name: "Thêm địa điểm", exact: true })
    .click();
  const name = `Địa điểm E2E ${info.project.name} ${Date.now()}`;
  const viTitle = `Câu chuyện tiếng Việt ${info.project.name}`;
  const enTitle = `The English story ${info.project.name}`;
  await page.getByLabel("Tên địa điểm", { exact: false }).fill(name);
  await page
    .getByLabel("Địa chỉ", { exact: true })
    .fill("Quận 1, TP. Hồ Chí Minh");
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page.getByLabel("Tiêu đề thuyết minh", { exact: false }).fill(viTitle);
  await page
    .getByLabel("Bài thuyết minh", { exact: false })
    .fill("Nội dung thử nghiệm giao diện.");
  await page.getByRole("tab", { name: "EN English" }).click();
  await page.getByLabel("Tiêu đề thuyết minh", { exact: false }).fill(enTitle);
  await page
    .getByLabel("Bài thuyết minh", { exact: false })
    .fill("User interface test content.");
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await expect(page.locator(".tts-preview-card")).toHaveCount(2);
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page
    .getByRole("button", { name: "Bước 1: Thông tin địa điểm", exact: true })
    .click();
  await page
    .getByLabel("Trạng thái hiển thị", { exact: true })
    .selectOption("published");
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await expect(
    page.getByText("Đã lưu thay đổi.", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `.runtime/screenshots/editor-${info.project.name}.png`,
    fullPage: true,
  });
  const guestContext = await browser.newContext();
  await offline(guestContext);
  const guest = await guestContext.newPage();
  await mockSpeech(guest);
  await guest.goto("http://127.0.0.1:5184");
  await guest.getByRole("button").filter({ hasText: viTitle }).click();
  await expect(
    guest.getByRole("heading", { name: viTitle, exact: true }),
  ).toBeVisible();
  await expect(guest.locator("audio")).toHaveCount(0);
  await guest
    .getByRole("button", { name: "Nghe thuyết minh", exact: true })
    .click();
  expect(
    await guest.evaluate(() => (window as any).__speech.calls[0]),
  ).toMatchObject({
    lang: "vi-VN",
    text: "Nội dung thử nghiệm giao diện.",
    voice: "vi-VN",
  });
  await guest.getByRole("button", { name: "Tạm dừng", exact: true }).click();
  await expect(
    guest.getByRole("button", { name: "Tiếp tục đọc" }),
  ).toBeVisible();
  await guest.getByRole("button", { name: "Tiếp tục đọc" }).click();
  await guest
    .getByRole("combobox", { name: "Ngôn ngữ thuyết minh" })
    .selectOption("en");
  await expect(
    guest.getByRole("heading", { name: enTitle, exact: true }),
  ).toBeVisible();
  await guest
    .getByRole("button", { name: "Ngôn ngữ giao diện", exact: true })
    .click();
  await guest.getByLabel("Speed", { exact: true }).selectOption("1.5");
  await guest
    .getByRole("button", { name: "Listen to narration", exact: true })
    .click();
  expect(
    await guest.evaluate(() => (window as any).__speech.calls.at(-1)),
  ).toMatchObject({
    lang: "en-US",
    rate: 1.5,
    text: "User interface test content.",
  });
  await guest.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(
    guest.getByRole("button", { name: "Listen to narration", exact: true }),
  ).toBeVisible();
  await guestContext.close();
});

test("Wikipedia AI import fills a draft and persists its source", async ({
  page,
}, info) => {
  const name = `Địa điểm Wikipedia ${info.project.name}`;
  const sourceUrl = `https://vi.wikipedia.org/wiki/POI_${info.project.name}`;
  await page.route("**/api/v1/admin/ai/status", (route) =>
    route.fulfill({
      json: { ready: true, model: "qwen3:4b", message: "Sẵn sàng" },
    }),
  );
  await page.route("**/api/v1/admin/ai/wikipedia", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      url: sourceUrl,
      language_codes: ["vi"],
    });
    await route.fulfill({
      json: {
        draft: {
          name,
          address: "4 Phạm Ngọc Thạch",
          category_id: "culture",
          latitude: null,
          longitude: null,
          translations: {
            vi: {
              title: name,
              text: "Bài giới thiệu tiếng Việt từ nguồn Wikipedia.",
            },
            en: {
              title: "Wikipedia place",
              text: "An English narration based on Wikipedia.",
            },
          },
          source: {
            url: sourceUrl,
            title: name,
            revision_id: 123,
            retrieved_at: "2026-10-23T03:00:00Z",
            license: "CC BY-SA",
            model: "qwen3:4b",
            warnings: ["Nguồn chưa có tọa độ. Hãy bổ sung vị trí chính xác."],
            wikidata_id: null,
            coordinate_source: null,
            image_url: null,
            image_page_url: null,
            image_author: null,
            image_license: null,
          },
        },
        missing_fields: ["latitude", "longitude", "image"],
        elapsed_seconds: 60,
        existing_poi: null,
      },
    });
  });
  await login(page);
  await page
    .getByRole("button", { name: "Thêm địa điểm", exact: true })
    .click();
  await page.getByLabel("URL Wikipedia", { exact: true }).fill(sourceUrl);
  await page
    .getByRole("button", { name: "Tạo thông tin bằng AI", exact: true })
    .click();
  await expect(page.getByLabel("Tên địa điểm", { exact: false })).toHaveValue(
    name,
  );
  await expect(page.getByLabel("Địa chỉ", { exact: true })).toHaveValue(
    "4 Phạm Ngọc Thạch",
  );
  await expect(
    page.getByText("Nguồn chưa có tọa độ. Hãy bổ sung vị trí chính xác.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.locator(".location-details > summary").click();
  await expect(page.getByLabel("Vĩ độ", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Kinh độ", { exact: true })).toHaveValue("");
  await page.screenshot({
    path: `.runtime/screenshots/wikipedia-import-${info.project.name}.png`,
    fullPage: true,
  });
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/admin/pois") &&
        response.request().method() === "POST",
      { timeout: 10000 },
    ),
    page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click(),
  ]);
  expect(response.status()).toBe(201);
  const poi = await response.json();
  expect(poi.status).toBe("draft");
  expect(poi.source.url).toBe(sourceUrl);
  expect(poi.latitude).toBeNull();
  expect(poi.translations.vi.text).toContain("Wikipedia");
  expect(poi.translations.en.text).toContain("Wikipedia");
  await page.keyboard.press("Escape");
  await page
    .getByRole("textbox", { name: "Tìm địa điểm, địa chỉ…" })
    .fill(name);
  await page.getByRole("button", { name, exact: true }).click();
  await expect(
    page.getByRole("link", { name: `${name} · Wikipedia`, exact: true }),
  ).toHaveAttribute("href", sourceUrl + "?oldid=123");
});

test("cloud AI request resumes after reload and returns a private draft", async ({
  page,
}) => {
  let completed = false;
  const name = "Bản nháp từ máy Ollama";
  await page.route("**/api/v1/admin/ai/status", (route) =>
    route.fulfill({
      json: {
        mode: "worker",
        ready: true,
        model: "qwen3:4b",
        message: "Máy AI sẵn sàng",
      },
    }),
  );
  await page.route("**/api/v1/admin/ai/jobs", (route) =>
    route.fulfill({
      status: 202,
      json: { id: "resume-test", status: "queued", result: null, error: "" },
    }),
  );
  await page.route("**/api/v1/admin/ai/jobs/resume-test", (route) =>
    route.fulfill({
      json: {
        id: "resume-test",
        status: completed ? "completed" : "queued",
        reviewable: completed,
        validation: completed
          ? {
              vi: { status: "passed", issues: [] },
              en: { status: "passed", issues: [] },
            }
          : null,
        error: "",
        result: completed
          ? {
              draft: {
                name,
                address: "Địa chỉ cần kiểm tra",
                category_id: "culture",
                latitude: null,
                longitude: null,
                translations: {
                  vi: { title: name, text: "Thuyết minh cần kiểm tra." },
                  en: { title: "Draft", text: "Review this draft." },
                },
                source: {
                  url: "https://vi.wikipedia.org/wiki/Worker_test",
                  title: name,
                  revision_id: 123,
                  retrieved_at: "2026-10-23T03:00:00Z",
                  license: "CC BY-SA",
                  model: "qwen3:4b",
                  warnings: [],
                  wikidata_id: null,
                  coordinate_source: null,
                  image_url: null,
                  image_page_url: null,
                  image_author: null,
                  image_license: null,
                },
              },
              missing_fields: ["latitude", "longitude", "image"],
              elapsed_seconds: 60,
              existing_poi: null,
            }
          : null,
      },
    }),
  );
  await login(page);
  await page
    .getByRole("button", { name: "Thêm địa điểm", exact: true })
    .click();
  await page
    .getByLabel("URL Wikipedia", { exact: true })
    .fill("https://vi.wikipedia.org/wiki/Worker_test");
  await page
    .getByRole("button", { name: "Tạo thông tin bằng AI", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("quan1-ai-job")))
    .toBe("resume-test");
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await page
    .getByRole("button", { name: "Thêm địa điểm", exact: true })
    .click();
  await expect(page.getByText(/Đang chờ máy AI nhận việc/)).toBeVisible();
  completed = true;
  await expect(page.getByLabel("Tên địa điểm", { exact: false })).toHaveValue(
    name,
  );
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("quan1-ai-job")))
    .toBeNull();
  await expect(
    page.getByRole("button", { name: "Lưu thay đổi", exact: true }),
  ).toBeEnabled();
});
