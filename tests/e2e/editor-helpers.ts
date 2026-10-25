import { expect, type Page } from "@playwright/test";

export async function publishDraft(page: Page) {
  const save = page
    .locator(".editor-footer")
    .getByRole("button", { name: /^(Lưu nháp|Lưu thay đổi)$/ });
  if (await save.isEnabled()) {
    await save.click();
    await expect(
      page.getByText("Đã lưu thay đổi.", { exact: true }),
    ).toBeVisible();
  }
  await page.locator("#editor-tab-2").click();
  const submit = page.getByRole("button", { name: "Gửi duyệt", exact: true });
  const confirmation = page.getByLabel(
    "Tôi đã kiểm tra thông tin, nguồn, vị trí và các bài thuyết minh của phiên bản này.",
  );
  if (await submit.isVisible()) {
    await submit.click();
    await expect(confirmation).toBeVisible();
  }
  if (await confirmation.isVisible()) {
    await confirmation.check();
    await page
      .locator(".publication-actions")
      .getByRole("button", { name: "Duyệt nội dung", exact: true })
      .click();
  }
  await page.getByRole("button", { name: "Công bố", exact: true }).click();
  await expect(
    page.getByText("Đã xuất bản. Du khách có thể xem và nghe nội dung này.", {
      exact: true,
    }),
  ).toBeVisible();
}

export async function workerOnline(page: Page) {
  const response = await page.request.post("/api/v1/worker/heartbeat", {
    headers: {
      "X-Requested-With": "Quan1Admin",
      Authorization: "Bearer isolated-e2e-worker-credential-only",
    },
    data: { ready: true, protocol: 3, model: "synthetic-e2e-worker" },
  });
  expect(response.status()).toBe(200);
}
