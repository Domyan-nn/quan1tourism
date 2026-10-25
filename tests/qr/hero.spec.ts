import { test, expect } from "@playwright/test";

const expoUrl = process.env.QR_TEST_EXPO_URL || "exp://192.0.2.10:8081";

test.beforeEach(async ({ page }) => {
  // Mock data is confined to automated UI tests; the app itself always uses the API.
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/me"))
      return route.fulfill({ status: 401, json: { detail: "Unauthorized" } });
    if (path.endsWith("/languages"))
      return route.fulfill({
        json: [
          {
            code: "vi",
            name: "Vietnamese",
            native_name: "Tiếng Việt",
            speech_locale: "vi-VN",
            enabled: true,
            required: true,
            sort_order: 0,
            direction: "ltr",
          },
          {
            code: "en",
            name: "English",
            native_name: "English",
            speech_locale: "en-US",
            enabled: true,
            required: true,
            sort_order: 1,
            direction: "ltr",
          },
        ],
      });
    if (path.endsWith("/categories")) return route.fulfill({ json: [] });
    return route.fulfill({ json: { items: [] } });
  });
});

test("disabled QR preserves the original hero", async ({ page }) => {
  await page.goto("http://127.0.0.1:5195");
  await expect(
    page.getByRole("heading", { name: /Sài Gòn, qua/ }),
  ).toBeVisible();
  await expect(page.locator(".mobile-app-card")).toHaveCount(0);
  await expect(page.locator(".hero")).not.toHaveClass(/hero-with-mobile/);
});

test("QR card uses the configured Expo link, supports copying and translates with UI language", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          (window as any).__copied = text;
        },
      },
      configurable: true,
    });
  });
  await page.goto("/");
  const card = page.getByRole("complementary", {
    name: "Trải nghiệm trên điện thoại",
  });
  await expect(card).toBeVisible();
  await expect(
    card.getByRole("img", { name: "Mã QR mở ứng dụng trong Expo Go" }),
  ).toBeVisible();
  await card.getByRole("button", { name: "Sao chép liên kết" }).click();
  await expect(card.getByRole("status")).toHaveText("Đã sao chép liên kết");
  expect(await page.evaluate(() => (window as any).__copied)).toBe(expoUrl);
  await page.getByRole("button", { name: "Ngôn ngữ giao diện" }).click();
  await expect(
    page.getByRole("complementary", { name: "Try it on your phone" }),
  ).toBeVisible();
  await expect(page.locator(".mobile-app-card").getByRole("status")).toHaveText(
    "Link copied",
  );
  await expect(
    page.getByRole("combobox", { name: "Narration language" }),
  ).toHaveValue("vi");
});

test("clipboard failure leaves a selectable link", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Sao chép liên kết" }).click();
  await expect(page.getByLabel("Chọn và sao chép liên kết:")).toHaveValue(
    expoUrl,
  );
});

for (const width of [390, 768, 1366, 1440, 1920]) {
  test(`hero fits at ${width}px, including larger text`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto("/");
    const card = page.locator(".mobile-app-card");
    await expect(card).toBeVisible();
    for (const size of ["14px", "17.5px"]) {
      await page.evaluate(
        (size) => (document.documentElement.style.fontSize = size),
        size,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const intro = await page.locator(".hero-copy").boundingBox();
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      if (width <= 800) {
        expect(box!.y).toBeGreaterThanOrEqual(intro!.y + intro!.height);
        await expect(
          card.getByRole("link", { name: "Mở bằng Expo Go" }),
        ).toBeVisible();
        await expect(
          card.getByRole("link", { name: "Mở bằng Expo Go" }),
        ).toHaveAttribute("href", expoUrl);
      } else {
        expect(box!.x).toBeGreaterThanOrEqual(intro!.x + intro!.width);
      }
    }
    if (
      process.env.QR_TEST_SCREENSHOTS === "true" &&
      process.env.QR_TEST_EXPO_URL &&
      [390, 1440].includes(width)
    ) {
      await page.evaluate(
        () => (document.documentElement.style.fontSize = "14px"),
      );
      await page.getByRole("button", { name: "Ngôn ngữ giao diện" }).click();
      await expect(
        page.getByRole("heading", { name: "Try it on your phone" }),
      ).toBeVisible();
      await page
        .locator(".hero")
        .screenshot({
          path: `.runtime/screenshots/hero-expo-${width === 390 ? "mobile" : "desktop"}.png`,
        });
    }
  });
}
