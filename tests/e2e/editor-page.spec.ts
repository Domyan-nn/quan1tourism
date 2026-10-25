import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockSpeech } from "./speech";

const headers = { "X-Requested-With": "Quan1Admin" };
async function login(page: Page) {
  await page.goto("/admin/");
  await page
    .getByRole("button", { name: "Trải nghiệm tài khoản demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Địa điểm", exact: true }),
  ).toBeVisible();
}
async function basic(page: Page, name: string) {
  await page.getByLabel("Tên địa điểm").fill(name);
  await page.getByLabel("Danh mục", { exact: false }).selectOption("culture");
  await page
    .getByLabel("Địa chỉ", { exact: true })
    .fill("Quận 1, TP. Hồ Chí Minh");
}
async function tab(page: Page, index: number) {
  await page.locator(`#editor-tab-${index}`).click();
}
async function created(page: Page, name: string, published = false) {
  const response = await page.request.post("/api/v1/admin/pois", {
    headers,
    data: {
      name,
      address: "Quận 1",
      category_id: "culture",
      status: published ? "published" : "draft",
      translations: {
        vi: {
          title: name,
          text: "Bài thuyết minh tiếng Việt để kiểm tra bản nháp.",
        },
        en: {
          title: "English story",
          text: "Saved English narration for visitors.",
        },
      },
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

test("minimum manual draft works offline, validates fields and reloads its stable URL", async ({
  page,
}, info) => {
  await page.route("**/api/v1/admin/ai/status", (route) =>
    route.fulfill({ json: { ready: false, mode: "worker", model: "Offline" } }),
  );
  await login(page);
  await page
    .getByRole("button", { name: "Thêm địa điểm", exact: true })
    .click();
  await expect(page).toHaveURL(/#places\/new$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Lưu nháp", exact: true }).click();
  await expect(page.locator("#place-name")).toBeFocused();
  await expect(page.locator("#place-name-error")).toBeVisible();
  await expect(page.locator("#place-address-error")).toBeVisible();
  const name = `Manual draft ${info.project.name} ${Date.now()}`;
  await basic(page, name);
  await page
    .getByRole("button", { name: "Tạo từ Wikipedia", exact: true })
    .click();
  await expect(page.getByText(/Máy AI chưa sẵn sàng/)).toBeVisible();
  await page
    .getByRole("button", { name: "Nhập thủ công", exact: true })
    .click();
  await expect(page.getByLabel("Tên địa điểm")).toHaveValue(name);
  await page.getByRole("button", { name: "Lưu nháp", exact: true }).click();
  await expect(page).toHaveURL(/#places\/(?!new$)[^/]+$/);
  const url = page.url();
  await page.reload();
  await expect(page.getByLabel("Tên địa điểm")).toHaveValue(name);
  await expect(page.getByLabel("Địa chỉ", { exact: true })).toHaveValue(
    "Quận 1, TP. Hồ Chí Minh",
  );
  await expect(page).toHaveURL(url);
  const poi = await (
    await page.request.get(`/api/v1/admin/pois/${url.split("/").pop()}`)
  ).json();
  expect(poi.status).toBe("draft");
  expect(poi.has_published).toBe(false);
  expect(poi.latitude).toBeNull();
  expect(poi.translations.vi.text).toBe("");
  await tab(page, 2);
  await page
    .locator(".checklist-language")
    .filter({ hasText: "Tiếng Việt" })
    .getByRole("button", { name: "Bổ sung", exact: true })
    .click();
  await expect(page.locator("#narration-title")).toBeFocused();
  await tab(page, 0);
  await page.screenshot({
    path: `.runtime/screenshots/editor-edit-${info.project.name}.png`,
    fullPage: true,
  });
});

test("tabs, UI language and browser navigation preserve edits and list context", async ({
  page,
}, info) => {
  await login(page);
  const name = `Navigation ${info.project.name} ${Date.now()}`;
  const poi = await created(page, name);
  await page.getByLabel("Tìm địa điểm, địa chỉ…").fill(name);
  const grid = page.getByRole("button", { name: "Xem dạng thẻ", exact: true });
  if (await grid.isVisible()) await grid.click();
  await page.getByRole("button", { name, exact: true }).click();
  await page
    .getByLabel("Mô tả ngắn", { exact: true })
    .fill("Giữ nguyên nội dung khi chuyển tab.");
  await tab(page, 1);
  await page.getByRole("tab").filter({ hasText: "English" }).click();
  await page
    .getByLabel("Bài thuyết minh", { exact: true })
    .fill("New unsaved English narration.");
  await page.getByRole("tab").filter({ hasText: "Tiếng Việt" }).click();
  await page.getByRole("tab").filter({ hasText: "English" }).click();
  await expect(page.getByLabel("Bài thuyết minh", { exact: true })).toHaveValue(
    "New unsaved English narration.",
  );
  await page
    .getByRole("button", { name: "Ngôn ngữ giao diện", exact: true })
    .click();
  await expect(page.getByLabel("Narration text", { exact: true })).toHaveValue(
    "New unsaved English narration.",
  );
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.evaluate(() => history.back());
  await expect(page).toHaveURL(new RegExp(`#places/${poi.id}$`));
  await expect(page.getByLabel("Narration text", { exact: true })).toHaveValue(
    "New unsaved English narration.",
  );
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Changes saved.", { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel("Search places, addresses…")).toHaveValue(name);
  await expect(page.locator(".place-card")).toHaveCount(1);
  await page.goForward();
  await tab(page, 1);
  await page.getByRole("tab").filter({ hasText: "English" }).click();
  await expect(page.getByLabel("Narration text", { exact: true })).toHaveValue(
    "New unsaved English narration.",
  );
  await tab(page, 0);
  await expect(
    page.getByLabel("Short description", { exact: true }),
  ).toHaveValue("Giữ nguyên nội dung khi chuyển tab.");
  await page.getByRole("button", { name: "Back to list", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("Search places, addresses…")).toHaveValue(name);
  await expect(page.locator(".place-card")).toHaveCount(1);
});

test("draft preview and speech do not track statistics; save, approval, publish and hide stay separate", async ({
  page,
}, info) => {
  await mockSpeech(page);
  await login(page);
  const name = `Publication ${info.project.name} ${Date.now()}`;
  const poi = await created(page, name, true);
  await page.goto(`/admin/#places/${poi.id}`);
  await tab(page, 1);
  const en = page.getByRole("tab").filter({ hasText: "English" });
  await en.click();
  await expect(en.locator(".language-review-symbol")).toHaveText("✓");
  await page
    .getByLabel("Bài thuyết minh", { exact: true })
    .fill("The next revision remains private until publication.");
  await expect(en.locator(".language-review-symbol")).toHaveText("○");
  await page
    .getByLabel("Bài thuyết minh", { exact: true })
    .fill("Saved English narration for visitors.");
  await expect(en.locator(".language-review-symbol")).toHaveText("✓");
  await expect(
    page.getByRole("button", { name: "Lưu thay đổi", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Bài thuyết minh", { exact: true })
    .fill("The next revision remains private until publication.");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `.runtime/screenshots/editor-edit-narration-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await expect(
    page.getByText("Đã lưu thay đổi.", { exact: true }),
  ).toBeVisible();
  const read = async () =>
    (await page.request.get(`/api/v1/admin/pois/${poi.id}`)).json();
  expect((await read()).status).toBe("draft");
  expect(
    (
      await (
        await page.request.get(`/api/v1/pois/${poi.id}?track_view=false`)
      ).json()
    ).translations.en.text,
  ).toBe("Saved English narration for visitors.");
  await tab(page, 2);
  await expect(
    page.getByRole("button", { name: "Công bố", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Xem trước bản nháp", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "The next revision remains private until publication.",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Nghe thuyết minh", exact: true })
    .click();
  await page.keyboard.press("Escape");
  expect((await read()).view_count).toBe(0);
  expect((await read()).listen_count).toBe(0);
  await page.getByRole("button", { name: "Gửi duyệt", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Duyệt nội dung", exact: true }).last(),
  ).toBeDisabled();
  await page
    .getByLabel(
      "Tôi đã kiểm tra thông tin, nguồn, vị trí và các bài thuyết minh của phiên bản này.",
    )
    .check();
  await page
    .locator(".publication-actions")
    .getByRole("button", { name: "Duyệt nội dung", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Công bố", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Công bố", exact: true }).click();
  await expect.poll(async () => (await read()).status).toBe("published");
  expect(
    (
      await (
        await page.request.get(`/api/v1/pois/${poi.id}?track_view=false`)
      ).json()
    ).translations.en.text,
  ).toBe("The next revision remains private until publication.");
  await page.getByRole("button", { name: "Ẩn địa điểm", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("lịch sử");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Ẩn địa điểm", exact: true })
    .click();
  await expect.poll(async () => (await read()).status).toBe("archived");
  const history = await (
    await page.request.get(`/api/v1/admin/pois/${poi.id}/history`)
  ).json();
  expect(history.events.map((event: any) => event.action)).toEqual(
    expect.arrayContaining([
      "update",
      "submit",
      "approve",
      "publish",
      "archive",
    ]),
  );
  expect((await read()).translations.en.text).toContain("next revision");
});

test("409 preserves the draft and pending file instead of overwriting another revision", async ({
  page,
}, info) => {
  await login(page);
  const poi = await created(
    page,
    `Conflict ${info.project.name} ${Date.now()}`,
  );
  await page.goto(`/admin/#places/${poi.id}`);
  await page
    .getByLabel("Mô tả ngắn", { exact: true })
    .fill("My unsaved version");
  await page.locator('input[type="file"]').setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAK0lEQVR4nGNkaGAgGzCRr5VhVDOpgIlkHUhgVDOJgIlUDchgVDOJgKIAAwDFMgCoOrIAcgAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await page.request.put(`/api/v1/admin/pois/${poi.id}`, {
    headers,
    data: {
      name: poi.name,
      address: poi.address,
      category_id: poi.category_id,
      revision: poi.revision,
      status: "draft",
      short_description: "Another session",
    },
  });
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Mô tả ngắn", { exact: true })).toHaveValue(
    "My unsaved version",
  );
  const current = await (
    await page.request.get(`/api/v1/admin/pois/${poi.id}`)
  ).json();
  expect(current.short_description).toBe("Another session");
  await expect(page.locator(".staged-image")).toBeVisible();
  expect(
    await page
      .locator('input[type="file"]')
      .evaluate((input: HTMLInputElement) => input.files?.[0]?.name),
  ).toBe("cover.png");
  await expect(
    page.getByRole("link", {
      name: "Mở bản đã lưu trong tab mới để đối chiếu",
      exact: true,
    }),
  ).toHaveAttribute("target", "_blank");
});

test("a failed publication retries its action without uploading the saved image again", async ({
  page,
}, info) => {
  await login(page);
  const poi = await created(
    page,
    `Publish retry ${info.project.name} ${Date.now()}`,
  );
  await page.goto(`/admin/#places/${poi.id}`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAABQAAAAUCAIAAAAC64paAAAAK0lEQVR4nGNkaGAgGzCRr5VhVDOpgIlkHUhgVDOJgIlUDchgVDOJgKIAAwDFMgCoOrIAcgAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  let uploads = 0,
    publications = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/upload")
    )
      uploads++;
  });
  await page.route(`**/admin/pois/${poi.id}/actions`, (route) => {
    if (
      route.request().postDataJSON().action === "publish" &&
      ++publications === 1
    )
      return route.fulfill({
        status: 503,
        json: { detail: "temporary_failure" },
      });
    return route.continue();
  });
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await expect(
    page.getByText("Đã lưu thay đổi.", { exact: true }),
  ).toBeVisible();
  await tab(page, 2);
  await page.getByRole("button", { name: "Gửi duyệt", exact: true }).click();
  await page
    .getByLabel(
      "Tôi đã kiểm tra thông tin, nguồn, vị trí và các bài thuyết minh của phiên bản này.",
    )
    .check();
  await page
    .locator(".publication-actions")
    .getByRole("button", { name: "Duyệt nội dung", exact: true })
    .click();
  await page.getByRole("button", { name: "Công bố", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  let saved = await (
    await page.request.get(`/api/v1/admin/pois/${poi.id}`)
  ).json();
  expect(saved.status).toBe("approved");
  expect(saved.has_published).toBe(false);
  const image = saved.image_id;
  expect(image).toBeTruthy();
  await page.getByRole("button", { name: "Công bố", exact: true }).click();
  await expect(
    page.getByText("Đã xuất bản. Du khách có thể xem và nghe nội dung này.", {
      exact: true,
    }),
  ).toBeVisible();
  saved = await (await page.request.get(`/api/v1/admin/pois/${poi.id}`)).json();
  expect(saved.image_id).toBe(image);
  expect(saved.status).toBe("published");
  expect(uploads).toBe(1);
  expect(publications).toBe(2);
});

test("saving before a failed AI enqueue reports partial success and retries the same place", async ({
  page,
}, info) => {
  await page.route("**/api/v1/admin/ai/status", (route) =>
    route.fulfill({ json: { ready: true, mode: "worker" } }),
  );
  await login(page);
  await page
    .getByRole("button", { name: "Thêm địa điểm", exact: true })
    .click();
  await basic(page, `Save then AI ${info.project.name} ${Date.now()}`);
  await tab(page, 1);
  await page
    .getByLabel("Tiêu đề thuyết minh", { exact: true })
    .fill("Bài nguồn");
  await page
    .getByLabel("Bài thuyết minh", { exact: true })
    .fill("Nguồn tiếng Việt đã được kiểm tra trước khi tạo bản dịch mới.");
  await page.getByLabel("Tôi đã kiểm tra nguồn tiếng Việt.").check();
  let creates = 0,
    enqueues = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/admin/pois")
    )
      creates++;
  });
  await page.route("**/narration-jobs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    enqueues++;
    if (enqueues === 1)
      return route.fulfill({
        status: 503,
        json: { detail: "temporary_failure" },
      });
    return route.continue();
  });
  await page
    .getByRole("button", { name: "Lưu nháp và tạo thuyết minh", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Đã lưu nháp, chưa tạo được tác vụ AI",
  );
  await expect(page).toHaveURL(/#places\/(?!new$)[^/]+$/);
  const id = page.url().split("/").pop();
  await page
    .getByRole("button", { name: "Thử tạo tác vụ AI lại", exact: true })
    .click();
  await expect(page.getByText(/Đã lưu nháp và tạo tác vụ AI/)).toBeVisible();
  expect(creates).toBe(1);
  const jobs = await (
    await page.request.get(`/api/v1/admin/pois/${id}/narration-jobs`)
  ).json();
  expect(jobs.items).toHaveLength(1);
  // The existing backend coalesces an uncertain retry of an active job.
  const poi = await (await page.request.get(`/api/v1/admin/pois/${id}`)).json();
  await page.request.post(`/api/v1/admin/pois/${id}/narration-jobs`, {
    headers,
    data: {
      revision: poi.revision,
      language_codes: ["en"],
      confirmed_source: true,
    },
  });
  expect(
    (
      await (
        await page.request.get(`/api/v1/admin/pois/${id}/narration-jobs`)
      ).json()
    ).items,
  ).toHaveLength(1);
  const claimed = await (
    await page.request.post("/api/v1/worker/claim", {
      headers: {
        ...headers,
        Authorization: "Bearer isolated-e2e-worker-credential-only",
      },
      data: { protocol: 3 },
    })
  ).json();
  if (claimed.job)
    await page.request.post(`/api/v1/worker/jobs/${claimed.job.id}/complete`, {
      headers: {
        ...headers,
        Authorization: "Bearer isolated-e2e-worker-credential-only",
      },
      data: {
        lease: claimed.job.lease,
        error: "generation_failed",
        locale: claimed.job.payload.locale,
        source_revision: claimed.job.payload.source_revision,
        source_hash: claimed.job.payload.source_hash,
      },
    });
});

test("three editor tabs fit target widths, large text and RTL without clipped actions", async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await login(page);
  await page
    .getByRole("button", { name: "Thêm địa điểm", exact: true })
    .click();
  await basic(page, "Địa điểm kiểm thử bố cục — một câu chuyện dài ở Sài Gòn");
  for (const width of [1366, 1440, 1920, 768, 390]) {
    for (const enlarged of [false, true]) {
      await page.setViewportSize({
        width: Math.floor(width / (enlarged ? 1.25 : 1)),
        height: 1000,
      });
      await page.evaluate(
        (value) =>
          document.documentElement.classList.toggle("large-text", value),
        enlarged,
      );
      for (const index of [0, 1, 2]) {
        await tab(page, index);
        await expect(page.locator(".editor-page-header .save-state")).toBeVisible();
        await expect(page.locator(".editor-footer .save-state")).toBeVisible();
        if (index === 1) {
          await page.getByRole("tab").filter({ hasText: "العربية" }).click();
          await page
            .getByLabel("Bài thuyết minh", { exact: true })
            .fill("هذه قصة عن مكان جميل في مدينة سايغون.");
          await expect(page.locator("#narration-text")).toHaveAttribute(
            "dir",
            "rtl",
          );
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        for (const button of await page.locator(".editor-footer button").all())
          await expect(button).toBeInViewport();
        if (!enlarged && [1440, 390].includes(width)) {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({
            path: `.runtime/screenshots/editor-new-${info.project.name}-${width}-tab-${index}.png`,
            fullPage: true,
          });
        }
      }
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() =>
    document.documentElement.classList.remove("large-text"),
  );
  for (const index of [0, 1, 2]) {
    await tab(page, index);
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      result.violations.map((violation) => ({
        index,
        id: violation.id,
        targets: violation.nodes.map((node) => node.target),
      })),
    ).toEqual([]);
  }
});
