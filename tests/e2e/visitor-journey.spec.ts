import { test, expect } from "./fixtures";
import AxeBuilder from "@axe-core/playwright";
import { mockSpeech } from "./speech";

const origin = "http://127.0.0.1:5184";
const place = {
  id: "journey-palace", name: "Dinh Độc Lập", address: "135 Nam Kỳ Khởi Nghĩa, Quận 1",
  category_id: "culture", latitude: 10.779, longitude: 106.699,
  trigger_radius_m: 100, auto_narration_enabled: true,
  translations: {
    vi: { title: "Câu chuyện Dinh Độc Lập", text: "Dinh Độc Lập. Câu chuyện tiếng Việt có dấu. ".repeat(20), tts_ready: true },
    en: { title: "Independence Palace", text: "The story of Independence Palace. ".repeat(20), tts_ready: true },
  },
};

test.beforeEach(async ({ page }) => {
  await mockSpeech(page);
  await page.route("**/api/v1/pois**", (route) => route.request().method() === "POST"
    ? route.fulfill({ status: 204 }) : route.fulfill({ json: { items: [place, ...Array.from({ length: 8 }, (_, i) => ({ ...place, id: `other-${i}`, latitude: place.latitude + (i + 1) * 0.002, longitude: place.longitude + (i + 1) * 0.002, name: `Địa điểm ${i}`, translations: { vi: { title: `Địa điểm ${i}`, text: "Bài mẫu.", tts_ready: true } } }))] } }));
});

test("accent-insensitive search, browser Back/Forward, reload and UI language preserve context", async ({ page }, info) => {
  await page.goto(origin);
  const search = page.getByRole("textbox", { name: "Tìm địa điểm", exact: true });
  await search.fill("  DINH   doc lap  ");
  await expect(page.locator(".place")).toHaveCount(1);
  await expect(page.locator(".place h3")).toHaveText("Câu chuyện Dinh Độc Lập");
  await page.locator(".place").click();
  await expect(page).toHaveURL(/poi=journey-palace/);
  await page.getByRole("button", { name: "Nghe thuyết minh", exact: true }).click();
  await page.getByRole("button", { name: "Ngôn ngữ giao diện", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__speech.calls.length)).toBe(1);
  await page.goBack();
  await expect(page.getByRole("textbox", { name: "Search places", exact: true })).toHaveValue("  DINH   doc lap  ");
  await page.goForward();
  await expect(page.locator(".story h1")).toContainText("Dinh Độc Lập");
  await page.reload();
  await expect(page.locator(".story h1")).toContainText("Dinh Độc Lập");
  await page.getByRole("button", { name: "All places", exact: true }).click();
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.locator(".place")).toHaveCount(9);
  await page.screenshot({ path: `.runtime/screenshots/completion-home-${info.project.name}.png`, fullPage: true });
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(a11y.violations).toEqual([]);
});

test("list scroll and map viewport survive details; empty search keeps GPS controls", async ({ page }, info) => {
  await page.goto(origin);
  await page.locator(".place").last().scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => window.scrollY);
  await page.locator(".place").last().click();
  await page.goBack();
  await expect(page.locator(".place")).toHaveCount(9);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(scroll, 0);
  await page.getByRole("button", { name: "Bản đồ", exact: true }).click();
  const map = page.getByRole("region", { name: "Bản đồ địa điểm", exact: true });
  await map.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  const viewport = await page.evaluate(() => history.state.visitor.map);
  expect(viewport).toBeTruthy();
  await page.locator('.place-pin[title="Dinh Độc Lập"]').click();
  await page.getByRole("button", { name: "Xem chi tiết", exact: true }).click();
  await page.goBack();
  await expect(map).toBeVisible();
  expect(await page.evaluate(() => history.state.visitor.map)).toEqual(viewport);
  await page.getByRole("textbox", { name: "Tìm địa điểm", exact: true }).fill("không khớp");
  await expect(page.getByRole("button", { name: "Bật thuyết minh theo vị trí", exact: true })).toBeVisible();
  await expect(page.locator(".gps-controls")).toContainText("mọi địa điểm công khai");
  await page.screenshot({ path: `.runtime/screenshots/completion-map-${info.project.name}.png`, fullPage: true });
});

test("responsive widths, enlarged text and missing-link recovery", async ({ page }, info) => {
  await page.goto(origin);
  for (const width of [390, 768, 1366, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => document.documentElement.style.fontSize = "17.5px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.goto(origin + "/?poi=removed&q=dinh&view=map");
  await expect(page.getByRole("heading", { name: "Địa điểm không còn công khai" })).toBeVisible();
  await page.getByRole("button", { name: "Tất cả địa điểm", exact: true }).click();
  await expect(page.getByRole("button", { name: "Bản đồ", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("textbox", { name: "Tìm địa điểm", exact: true })).toHaveValue("dinh");
});
