import { test, expect } from "./fixtures";
import { mockSpeech } from "./speech";
import type { Page } from "@playwright/test";

const visitor = "http://127.0.0.1:5184";

async function login(page: Page) {
  await page.goto("/admin/");
  await page
    .getByRole("button", { name: "Trải nghiệm tài khoản demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Địa điểm", exact: true }),
  ).toBeVisible();
}

test("bilingual category form keeps both names across UI switches, including edit and delete labels", async ({
  page,
}, info) => {
  await login(page);
  await page.goto("/admin/#categories");
  await page
    .getByRole("button", { name: "Thêm danh mục", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const en = `Café Culture ${info.project.name} ${Date.now()}`;
  const vi = `Văn hóa cà phê ${info.project.name}`;
  await dialog.getByLabel("Tên tiếng Anh", { exact: true }).fill(en);
  await expect(
    dialog.getByRole("button", { name: "Tạo danh mục", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("Tên tiếng Việt", { exact: true }).fill(vi);
  await dialog
    .getByRole("button", { name: "Ngôn ngữ giao diện", exact: true })
    .click();
  await expect(dialog.getByLabel("English name", { exact: true })).toHaveValue(
    en,
  );
  await expect(
    dialog.getByLabel("Vietnamese name", { exact: true }),
  ).toHaveValue(vi);
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/admin/categories") && r.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Create category", exact: true })
    .click();
  const created = await (await response).json();
  expect(created).toMatchObject({ name: en, name_vi: vi });
  const card = page
    .locator(".category-card")
    .filter({ has: page.getByRole("heading", { name: en, exact: true }) });
  await expect(card).toBeVisible();
  await card
    .getByRole("button", { name: "Edit category name", exact: true })
    .click();
  await expect(dialog.getByLabel("English name", { exact: true })).toHaveValue(
    en,
  );
  await expect(
    dialog.getByLabel("Vietnamese name", { exact: true }),
  ).toHaveValue(vi);
  await dialog.getByLabel("Vietnamese name", { exact: true }).fill(vi + " mới");
  await dialog
    .getByRole("button", { name: "Interface language", exact: true })
    .click();
  await expect(
    dialog.getByLabel("Tên tiếng Việt", { exact: true }),
  ).toHaveValue(vi + " mới");
  await dialog
    .getByRole("button", { name: "Lưu danh mục", exact: true })
    .click();
  const translated = page
    .locator(".category-card")
    .filter({ hasText: vi + " mới" });
  await translated
    .getByRole("button", { name: `Xóa danh mục: ${vi} mới`, exact: true })
    .click();
  await expect(dialog).toContainText(`Xóa danh mục trống “${vi} mới”?`);
  await dialog.getByRole("button", { name: "Hủy", exact: true }).click();
  await translated
    .getByRole("button", { name: "Quản lý địa điểm", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "DANH MỤC", exact: true }),
  ).toHaveValue(created.id);
  await page
    .getByRole("button", { name: "Ngôn ngữ giao diện", exact: true })
    .click();
  const filter = page.getByRole("combobox", { name: "CATEGORY", exact: true });
  await expect(filter).toHaveValue(created.id);
  await expect(filter.locator(`option[value="${created.id}"]`)).toHaveText(en);
});

test("Editor changes category labels without changing the selected ID or unsaved place", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("textbox", { name: "Tìm địa điểm, địa chỉ…", exact: true })
    .fill("Dinh Độc Lập");
  await page.getByRole("button", { name: "Dinh Độc Lập", exact: true }).click();
  const editor = page.locator(".editor-page");
  const select = editor
    .getByRole("combobox")
    .filter({ has: page.locator('option[value="heritage"]') });
  await expect(select.locator('option[value="heritage"]')).toHaveText(
    "Di tích lịch sử",
  );
  await select.selectOption("culture");
  await page
    .getByRole("button", { name: "Ngôn ngữ giao diện", exact: true })
    .click();
  await expect(select).toHaveValue("culture");
  await expect(select.locator('option[value="culture"]')).toHaveText(
    "Culture & Lifestyle",
  );
});

async function mockCategories(page: Page) {
  await mockSpeech(page);
  await page.route("**/api/v1/categories", (route) =>
    route.fulfill({
      json: [
        {
          id: "bilingual",
          name: "Historical Sites",
          name_vi: "Di tích lịch sử",
          color: "orange",
        },
        { id: "legacy", name: "Legacy label", name_vi: null, color: "green" },
      ],
    }),
  );
  const places = [
    {
      id: "story",
      name: "Bilingual story",
      category_id: "bilingual",
      address: "Quận 1",
      latitude: 10.779,
      longitude: 106.699,
    },
    {
      id: "legacy-story",
      name: "Legacy story",
      category_id: "legacy",
      address: "Quận 1",
      latitude: 10.78,
      longitude: 106.7,
    },
  ].map((p) => ({
    ...p,
    image_id: null,
    translations: {
      vi: {
        title: p.name,
        text: "Đây là bài thuyết minh tiếng Việt đầy đủ. ".repeat(20),
        tts_ready: true,
      },
      en: {
        title: p.name,
        text: "An English narration. ".repeat(20),
        tts_ready: true,
      },
    },
  }));
  await page.route("**/api/v1/pois**", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 204 })
      : route.fulfill({ json: { items: places } }),
  );
}

test("visitor labels follow UI language while narration, selected place and speech keep their state", async ({
  page,
}) => {
  await mockCategories(page);
  await page.goto(visitor);
  await expect(
    page.locator(".place").getByText("Legacy label", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Tìm địa điểm", { exact: true }).fill("Bilingual");
  await expect(
    page.locator(".place").getByText("Di tích lịch sử", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Ngôn ngữ giao diện", exact: true })
    .click();
  await expect(page.getByLabel("Search places", { exact: true })).toHaveValue(
    "Bilingual",
  );
  await expect(
    page.locator(".place").getByText("Historical Sites", { exact: true }),
  ).toBeVisible();
  await page.locator(".place").click();
  await page
    .getByRole("button", { name: "Listen to narration", exact: true })
    .click();
  const before = await page.evaluate(() => ({
    count: (window as any).__speech.calls.length,
    canceled: (window as any).__speech.cancellations,
  }));
  await page
    .getByRole("button", { name: "Interface language", exact: true })
    .click();
  await expect(
    page.getByText("Di tích lịch sử", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Bilingual story", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Ngôn ngữ thuyết minh", { exact: true }),
  ).toHaveValue("vi");
  await expect(page.locator(".speech-player")).toHaveAttribute(
    "data-state",
    "playing",
  );
  expect(
    await page.evaluate(() => ({
      count: (window as any).__speech.calls.length,
      canceled: (window as any).__speech.cancellations,
    })),
  ).toEqual(before);
});

test("MapExplorer switches labels without losing its selected place, narration language or playback", async ({
  page,
}) => {
  await mockCategories(page);
  await page.goto(visitor);
  await page.getByRole("button", { name: "Bản đồ", exact: true }).click();
  await page.locator('.leaflet-marker-icon[title="Bilingual story"]').click();
  const card = page.locator(".map-card");
  await expect(
    card.getByText("Di tích lịch sử", { exact: true }),
  ).toBeVisible();
  await card
    .getByRole("combobox", { name: "Ngôn ngữ thuyết minh", exact: true })
    .selectOption("en");
  // Narration language alone does not change the Vietnamese category label.
  await expect(
    card.getByText("Di tích lịch sử", { exact: true }),
  ).toBeVisible();
  await card
    .getByRole("button", { name: "Nghe thuyết minh", exact: true })
    .click();
  const count = await page.evaluate(
    () => (window as any).__speech.calls.length,
  );
  await page
    .getByRole("button", { name: "Ngôn ngữ giao diện", exact: true })
    .click();
  await expect(
    card.getByText("Historical Sites", { exact: true }),
  ).toBeVisible();
  await expect(
    card.getByRole("heading", { name: "Bilingual story", exact: true }),
  ).toBeVisible();
  await expect(
    card.getByRole("combobox", { name: "Narration language", exact: true }),
  ).toHaveValue("en");
  await expect(card.locator(".speech-player")).toHaveAttribute(
    "data-state",
    "playing",
  );
  expect(await page.evaluate(() => (window as any).__speech.calls.length)).toBe(
    count,
  );
});

test("legacy categories show a fallback label and ask administrators to supply Vietnamese", async ({
  page,
}) => {
  await page.route("**/api/v1/admin/categories", (route) =>
    route.fulfill({
      json: [
        {
          id: "legacy",
          name: "Legacy category",
          name_vi: null,
          color: "green",
          count: 0,
        },
      ],
    }),
  );
  await login(page);
  await page.goto("/admin/#categories");
  const card = page.locator(".category-card");
  await expect(
    card.getByRole("heading", { name: "Legacy category", exact: true }),
  ).toBeVisible();
  await expect(card).toContainText("Chưa có tên tiếng Việt");
  await card
    .getByRole("button", { name: "Sửa tên danh mục", exact: true })
    .click();
  await expect(page.getByLabel("Tên tiếng Anh", { exact: true })).toHaveValue(
    "Legacy category",
  );
  await expect(page.getByLabel("Tên tiếng Việt", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    page.getByRole("button", { name: "Lưu danh mục", exact: true }),
  ).toBeDisabled();
});
