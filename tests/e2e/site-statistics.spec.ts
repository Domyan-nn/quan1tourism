import AxeBuilder from "@axe-core/playwright";
import { test, expect, offline } from "./fixtures";

test("website visits persist, deduplicate across reloads and appear in admin", async ({
  page,
  browser,
}, info) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Trải nghiệm tài khoản demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Địa điểm", exact: true }),
  ).toBeVisible();
  const before = await page.request.get("/api/v1/admin/statistics");
  const initial = await before.json();

  const visitorContext = await browser.newContext();
  await offline(visitorContext);
  const visitor = await visitorContext.newPage();
  try {
    for (let load = 0; load < 2; load++) {
      const tracked = visitor.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/events/visit") &&
          response.status() === 204,
      );
      await visitor.goto("http://127.0.0.1:5184");
      await tracked;
    }
    const after = await (
      await page.request.get("/api/v1/admin/statistics")
    ).json();
    expect(after.total_visits).toBe(initial.total_visits + 1);
    expect(after.today_visits).toBe(initial.today_visits + 1);
    await page.goto("/#overview");
    const panel = page.getByRole("region", { name: "Thống kê lượt truy cập" });
    await expect(
      panel.getByText("Tổng lượt truy cập", { exact: true }),
    ).toBeVisible();
    const total = panel
      .locator(".stat-card")
      .filter({ hasText: "Tổng lượt truy cập" });
    await expect(total.locator("strong")).toHaveText(
      new Intl.NumberFormat("vi-VN").format(after.total_visits),
    );
    await expect(panel.locator(".visit-history li")).toHaveCount(7);
    await page.reload();
    await expect(total.locator("strong")).toHaveText(
      new Intl.NumberFormat("vi-VN").format(after.total_visits),
    );
    await expect(
      panel.getByRole("button", { name: "Làm mới", exact: true }),
    ).toBeEnabled();
    const checked = await new AxeBuilder({ page })
      .include(".site-statistics")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(checked.violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.runtime/screenshots/site-statistics-${info.project.name}.png`,
      fullPage: true,
    });
  } finally {
    await visitorContext.close();
  }
});

test("statistics failures show a retry and recover without invented zeroes", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/v1/admin/statistics", async (route) => {
    if (fail)
      await route.fulfill({
        status: 503,
        json: { detail: "Statistics temporarily unavailable" },
      });
    else await route.continue();
  });
  await page.goto("/#overview");
  await page
    .getByRole("button", { name: "Trải nghiệm tài khoản demo", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "Thống kê lượt truy cập" });
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(panel.locator(".stat-card")).toHaveCount(0);
  fail = false;
  await panel.getByRole("button", { name: "Làm mới", exact: true }).click();
  await expect(panel.locator(".stat-card")).toHaveCount(4);
  await expect(panel.getByRole("alert")).toHaveCount(0);
});

test("visible visitors send heartbeats and admin updates online sessions automatically", async ({
  page,
  browser,
}) => {
  await page.clock.install();
  await page.goto("/#overview");
  await page.getByRole("button", { name: "Trải nghiệm tài khoản demo", exact: true }).click();
  const panel = page.getByRole("region", { name: "Thống kê lượt truy cập" });
  await expect(panel.locator(".active-visitors strong")).toBeVisible();
  const initial = await (await page.request.get("/api/v1/admin/statistics")).json();
  const visitorContext = await browser.newContext();
  await offline(visitorContext);
  const visitor = await visitorContext.newPage();
  await visitor.clock.install();
  let heartbeats = 0;
  visitor.on("response", (response) => {
    if (response.url().endsWith("/api/v1/events/presence") && response.status() === 204) heartbeats++;
  });
  try {
    await visitor.goto("http://127.0.0.1:5184");
    await expect.poll(() => heartbeats).toBeGreaterThan(0);
    const current = await (await page.request.get("/api/v1/admin/statistics")).json();
    expect(current.active_visitors).toBe(initial.active_visitors + 1);
    const refresh = page.waitForResponse((response) => response.url().endsWith("/api/v1/admin/statistics"));
    await page.clock.fastForward(15_000);
    expect((await refresh).status()).toBe(200);
    await expect(panel.locator(".active-visitors strong")).toHaveText(String(current.active_visitors));

    const heartbeatCount = heartbeats;
    await visitor.clock.fastForward(30_000);
    await expect.poll(() => heartbeats).toBeGreaterThan(heartbeatCount);
    const after = await (await page.request.get("/api/v1/admin/statistics")).json();
    expect(after.total_visits).toBe(current.total_visits);

    await visitor.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const hiddenCount = heartbeats;
    await visitor.clock.fastForward(60_000);
    expect(heartbeats).toBe(hiddenCount);
    await visitor.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect.poll(() => heartbeats).toBeGreaterThan(hiddenCount);
  } finally {
    await visitorContext.close();
  }
});
