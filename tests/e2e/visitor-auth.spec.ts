import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ baseURL: "http://127.0.0.1:5184" });

test("visitor registers, stays signed in after reload, signs out and signs in again", async ({
  page,
}, info) => {
  const email = `visitor-${info.project.name}-${Date.now()}@example.com`;
  await page.goto("/");
  await page.getByRole("button", { name: "Đăng ký", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Tạo tài khoản" });
  await expect(page.getByLabel("Họ và tên", { exact: true })).toBeFocused();
  await dialog
    .getByLabel("Họ và tên", { exact: true })
    .fill("Du khách Sài Gòn");
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await dialog.getByLabel("Mật khẩu", { exact: true }).fill("Visitor!2026");
  await dialog
    .getByLabel("Nhập lại mật khẩu", { exact: true })
    .fill("Wrong!2026");
  await dialog
    .getByRole("button", { name: "Tạo tài khoản", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Mật khẩu nhập lại chưa khớp.",
  );
  await dialog
    .getByLabel("Nhập lại mật khẩu", { exact: true })
    .fill("Visitor!2026");
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({
    path: `.runtime/screenshots/visitor-register-${info.project.name}.png`,
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Tạo tài khoản", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByText("Du khách Sài Gòn", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Du khách Sài Gòn", { exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/v1/admin/pois")).status()).toBe(403);
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  const login = page.getByRole("dialog", { name: "Đăng nhập", exact: true });
  await login.getByLabel("Email", { exact: true }).fill(email);
  await login.getByLabel("Mật khẩu", { exact: true }).fill("Wrong!2026");
  await login.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(login.getByRole("alert")).toBeVisible();
  await login.getByLabel("Mật khẩu", { exact: true }).fill("Visitor!2026");
  await login.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(
    page.getByText("Du khách Sài Gòn", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("visitor auth supports English, switching forms and keyboard dismissal", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Ngôn ngữ thuyết minh", exact: true })
    .selectOption("en");
  const signIn = page.getByRole("button", { name: "Sign in", exact: true });
  await signIn.click();
  await expect(
    page.getByRole("dialog", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(signIn).toBeFocused();
  await signIn.click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign up", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Create an account", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Sign in", exact: true }),
  ).toBeVisible();
});
