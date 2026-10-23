import { test, expect, type Page } from "@playwright/test";
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
    page.getByRole("button", { name: "Dinh Độc Lập", exact: true }),
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
    page.getByRole("button", { name: "Dinh Độc Lập", exact: true }),
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

test("editor publishes text and visitor listens in both languages with TTS", async ({
  page,
  browser,
}, info) => {
  await login(page, "editor");
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
  await page
    .getByRole("button", { name: "Lưu & tiếp tục", exact: true })
    .click();
  await page.getByLabel("Tiêu đề thuyết minh", { exact: false }).fill(viTitle);
  await page
    .getByLabel("Bài thuyết minh", { exact: false })
    .fill("Nội dung thử nghiệm giao diện.");
  await page.getByRole("tab", { name: "EN English" }).click();
  await page.getByLabel("Tiêu đề thuyết minh", { exact: false }).fill(enTitle);
  await page
    .getByLabel("Bài thuyết minh", { exact: false })
    .fill("User interface test content.");
  await page
    .getByRole("button", { name: "Lưu & tiếp tục", exact: true })
    .click();
  await expect(page.locator(".tts-preview-card")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Lưu & tiếp tục", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Gửi duyệt", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: `.runtime/screenshots/editor-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Gửi duyệt", exact: true }).click();
  await expect(
    page
      .locator(".dialog-wide")
      .getByRole("button", { name: "Duyệt nội dung", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Hoàn tất", exact: true }).click();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Mở menu", exact: true }).click();
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await login(page, "reviewer");
  await page
    .getByRole("textbox", { name: "Tìm địa điểm, địa chỉ…" })
    .fill(name);
  await page.getByRole("button", { name, exact: true }).click();
  await page
    .getByRole("button", { name: "Duyệt nội dung", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("button", { name: "Xuất bản", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Xuất bản", exact: true }).click();
  await expect(
    page.getByText("Đã xuất bản. Du khách có thể xem và nghe nội dung này.", {
      exact: true,
    }),
  ).toBeVisible();
  const guestContext = await browser.newContext();
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
