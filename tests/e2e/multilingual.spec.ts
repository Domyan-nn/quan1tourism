import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { mockSpeech } from "./speech";

async function openStory(page: Page, text: string) {
  const poi = {
    id: "speech-test",
    name: "Câu chuyện thử nghiệm",
    address: "Quận 1",
    image_id: null,
    translations: {
      vi: { title: "Câu chuyện thử nghiệm", text, tts_ready: true },
    },
  };
  await page.route("**/api/v1/pois**", (route) =>
    route.fulfill({ json: { items: [poi] } }),
  );
  await page.goto("http://127.0.0.1:5184");
  await page
    .getByRole("button")
    .filter({ hasText: "Câu chuyện thử nghiệm" })
    .click();
}

test("long narration is chunked, speech errors are shown, and leaving the story stops playback", async ({
  page,
}) => {
  await mockSpeech(page);
  const text = "Xin chào Sài Gòn. ".repeat(100);
  await openStory(page, text);
  const listen = page.getByRole("button", {
    name: "Nghe thuyết minh",
    exact: true,
  });
  await listen.click();
  expect(
    await page.evaluate(() => (window as any).__speech.calls[0].text.length),
  ).toBeLessThanOrEqual(180);
  await page.evaluate(() => (window as any).__speech.finish());
  await expect
    .poll(() => page.evaluate(() => (window as any).__speech.calls.length))
    .toBe(2);
  await page.evaluate(() => (window as any).__speech.fail());
  await expect(page.getByRole("alert")).toContainText(
    "Không phát được giọng đọc",
  );
  await listen.click();
  const before = await page.evaluate(
    () => (window as any).__speech.cancellations,
  );
  await page
    .getByRole("button", { name: "Tất cả địa điểm", exact: true })
    .click();
  expect(
    await page.evaluate(() => (window as any).__speech.cancellations),
  ).toBeGreaterThan(before);
});

test("missing device voice keeps narration readable and disables speech", async ({
  page,
}) => {
  await mockSpeech(page, ["en-US"]);
  await openStory(page, "Văn bản vẫn đọc được khi thiếu giọng.");
  await expect(page.getByRole("status")).toContainText(
    "Chưa có giọng đọc vi-VN",
  );
  await expect(
    page.getByRole("button", { name: "Nghe thuyết minh", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".narration")).toHaveText(
    "Văn bản vẫn đọc được khi thiếu giọng.",
  );
});

test("admin adds a language and it appears in the editor and visitor selector", async ({
  page,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Trải nghiệm tài khoản demo", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Địa điểm", exact: true })).toBeVisible();
  await page.goto("/admin/#languages");
  await page
    .getByRole("button", { name: "Thêm ngôn ngữ", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Thêm ngôn ngữ",
    exact: true,
  });
  const code = info.project.name === "desktop" ? "ms-MY" : "ms-SG";
  const nativeName = `Bahasa Melayu ${info.project.name}`;
  await dialog.getByLabel("Mã ngôn ngữ", { exact: true }).fill(code);
  await dialog.getByLabel("Tên quốc tế", { exact: true }).fill("Malay");
  await dialog.getByLabel("Tên bản địa", { exact: true }).fill(nativeName);
  await dialog.getByLabel("Mã giọng đọc", { exact: true }).fill("ms-MY");
  await dialog
    .getByRole("button", { name: "Lưu ngôn ngữ", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.locator(".language-registry").getByText(nativeName, { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Tìm địa điểm, địa chỉ…" })
    .fill("Dinh Độc Lập");
  await page.getByRole("button", { name: "Dinh Độc Lập", exact: true }).click();
  await page
    .getByRole("button", { name: "Bước 2: Nội dung đa ngôn ngữ", exact: true })
    .click();
  await page.getByRole("tab").filter({ hasText: nativeName }).click();
  await expect(
    page.getByLabel("Tiêu đề thuyết minh", { exact: false }),
  ).toHaveValue("");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await page.goto("http://127.0.0.1:5184");
  await expect(
    page
      .getByRole("combobox", { name: "Ngôn ngữ thuyết minh" })
      .locator(`option[value="${code}"]`),
  ).toHaveText(nativeName);
});
