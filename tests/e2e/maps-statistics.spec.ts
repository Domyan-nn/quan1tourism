import { publishDraft } from "./editor-helpers";
import { type Page } from "@playwright/test";
import { test, expect, offline } from "./fixtures";
import { mockSpeech } from "./speech";

const headers = { "X-Requested-With": "Quan1Admin" };
async function admin(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Trải nghiệm tài khoản demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Địa điểm", exact: true }),
  ).toBeVisible();
}
async function create(page: Page, name: string, longitude = 106.699) {
  const response = await page.request.post("/api/v1/admin/pois", {
    headers,
    data: {
      name,
      address: "Quận 1, Thành phố Hồ Chí Minh",
      category_id: "culture",
      status: "published",
      short_description: "Mô tả ngắn trên thẻ bản đồ.",
      latitude: 10.779,
      longitude,
      translations: {
        vi: { title: name, text: "Thuyết minh tiếng Việt." },
        en: { title: name + " English", text: "An English narration." },
      },
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}
async function read(page: Page, id: string) {
  return (await page.request.get(`/api/v1/admin/pois/${id}`)).json();
}

test("admin position changes stay local until save, restore and cancel discard them", async ({
  page,
}, info) => {
  await mockSpeech(page);
  await admin(page);
  const name = `Vị trí bản đồ ${info.project.name} ${Date.now()}`;
  const poi = await create(page, name);
  await page.reload();
  await page
    .getByRole("textbox", { name: "Tìm địa điểm, địa chỉ…" })
    .fill(name);
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.locator(".location-editor")).toHaveCount(0);
  await page.getByText("Chỉnh vị trí", { exact: true }).click();
  await expect(page.getByLabel("Vĩ độ", { exact: true })).toHaveValue("10.779");
  await page.locator(".place-map").click({ position: { x: 125, y: 110 } });
  await expect(page.getByLabel("Vĩ độ", { exact: true })).not.toHaveValue(
    "10.779",
  );
  expect((await read(page, poi.id)).latitude).toBe(10.779);
  await page
    .getByRole("button", { name: "Khôi phục vị trí", exact: true })
    .click();
  await expect(page.getByLabel("Vĩ độ", { exact: true })).toHaveValue("10.779");
  const pin = page.locator(".place-pin");
  await pin.scrollIntoViewIfNeeded();
  const box = await pin.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 16, box!.y + 20);
  await page.mouse.down();
  await page.mouse.move(box!.x + 66, box!.y + 50, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByLabel("Kinh độ", { exact: true })).not.toHaveValue(
    "106.699",
  );
  await expect(page.getByLabel("Địa chỉ", { exact: true })).toHaveValue(
    poi.address,
  );
  await page.route("**/api/v1/admin/map-search?**", (route) =>
    route.fulfill({
      json: {
        items: [
          { label: "Vị trí tìm được", latitude: 10.782, longitude: 106.697 },
        ],
      },
    }),
  );
  await page.getByLabel("Tìm vị trí", { exact: true }).fill("Nhà Văn hóa");
  await page
    .getByRole("button", { name: "Tìm trên bản đồ", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Vị trí tìm được", exact: true })
    .click();
  await expect(page.getByLabel("Vĩ độ", { exact: true })).toHaveValue("10.782");
  await page.locator("#editor-tab-2").click();
  await page.getByRole("button", { name: "Xem trước bản nháp", exact: true }).click();
  await page
    .getByRole("button", { name: "Nghe thuyết minh", exact: true })
    .click();
  expect((await read(page, poi.id)).listen_count).toBe(0);
  await page.keyboard.press("Escape");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Hủy", exact: true }).click();
  expect((await read(page, poi.id)).latitude).toBe(10.779);
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByText("Chỉnh vị trí", { exact: true }).click();
  await page.getByLabel("Vĩ độ", { exact: true }).fill("10.781");
  await page.getByLabel("Kinh độ", { exact: true }).fill("106.702");
  await page.locator('input[type="file"]').setInputFiles({
    name: "cover.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAC0lEQVR4nGNgQAYAAA4AAamRc7EAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  expect((await read(page, poi.id)).image_id).toBeNull();
  await expect(page.locator(".staged-image")).toBeVisible();
  await page.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await expect(
    page.getByText("Đã lưu thay đổi.", { exact: true }),
  ).toBeVisible();
  expect(await read(page, poi.id)).toMatchObject({
    latitude: 10.781,
    longitude: 106.702,
    view_count: 0,
    listen_count: 0,
  });
  expect((await read(page, poi.id)).image_id).not.toBeNull();
  await page.getByRole("button", { name: "Quay lại danh sách", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
  await page.getByText("Chỉnh vị trí", { exact: true }).click();
  await expect(page.getByLabel("Vĩ độ", { exact: true })).toHaveValue("10.781");
  await page.screenshot({
    path: `.runtime/screenshots/location-editor-${info.project.name}.png`,
    fullPage: true,
  });
});

test("admin can publish a place left in the legacy review workflow", async ({
  page,
}, info) => {
  await admin(page);
  const name = `Legacy review ${info.project.name} ${Date.now()}`;
  let poi = await create(page, name);
  const draft = await page.request.put(`/api/v1/admin/pois/${poi.id}`, {
    headers,
    data: {
      name,
      address: poi.address,
      category_id: poi.category_id,
      status: "draft",
      revision: poi.revision,
      translations: {
        vi: { title: name, text: "Nội dung." },
        en: { title: name, text: "Narration." },
      },
    },
  });
  poi = await draft.json();
  const review = await page.request.post(
    `/api/v1/admin/pois/${poi.id}/actions`,
    { headers, data: { action: "submit", revision: poi.revision } },
  );
  expect(review.status()).toBe(200);
  await page.reload();
  await page
    .getByRole("textbox", { name: "Tìm địa điểm, địa chỉ…" })
    .fill(name);
  await page.getByRole("button", { name, exact: true }).click();
  await publishDraft(page);
  expect((await read(page, poi.id)).status).toBe("published");
});

test("visitor listens on map, switches places and detail shares the deduplication window", async ({
  page,
  browser,
}, info) => {
  await admin(page);
  const prefix = `Map stories ${info.project.name} ${Date.now()}`;
  const first = await create(page, prefix + " A");
  const second = await create(page, prefix + " B", 106.708);
  const context = await browser.newContext();
  await offline(context);
  const visitor = await context.newPage();
  await mockSpeech(visitor);
  const starts: string[] = [];
  visitor.on("request", (request) => {
    if (request.url().endsWith("/events/listen")) starts.push(request.url());
  });
  await visitor.goto("http://127.0.0.1:5184");
  await visitor.getByLabel("Tìm địa điểm", { exact: true }).fill(prefix);
  const response = await visitor.request.get(
    "http://127.0.0.1:5184/api/v1/pois",
  );
  expect(
    (await response.json()).items.every(
      (poi: any) => !("view_count" in poi) && !("listen_count" in poi),
    ),
  ).toBe(true);
  expect(await read(page, first.id)).toMatchObject({
    view_count: 0,
    listen_count: 0,
  });
  await visitor.getByRole("button", { name: "Bản đồ", exact: true }).click();
  await visitor.locator(`.place-pin[title="${first.name}"]`).click();
  const card = visitor.getByRole("region", { name: "Thông tin địa điểm" });
  await expect(card).toContainText(first.short_description);
  await expect
    .poll(async () => (await read(page, first.id)).view_count)
    .toBe(1);
  await card
    .getByRole("button", { name: "Nghe thuyết minh", exact: true })
    .click();
  await expect
    .poll(async () => (await read(page, first.id)).listen_count)
    .toBe(1);
  await card.getByRole("button", { name: "Tạm dừng", exact: true }).click();
  await card.getByRole("button", { name: "Tiếp tục đọc", exact: true }).click();
  expect(starts).toHaveLength(1);
  await card
    .getByLabel("Ngôn ngữ thuyết minh", { exact: true })
    .selectOption("en");
  await card
    .getByRole("button", { name: "Nghe thuyết minh", exact: true })
    .click();
  expect(
    await visitor.evaluate(() => (window as any).__speech.calls.at(-1).lang),
  ).toBe("en-US");
  await card.getByRole("button", { name: "Xem chi tiết", exact: true }).click();
  await expect(visitor.locator(".story")).toBeVisible();
  await expect
    .poll(async () => (await read(page, first.id)).view_count)
    .toBe(1);
  await visitor
    .getByRole("button", { name: "Tất cả địa điểm", exact: true })
    .click();
  await visitor.locator(`.place-pin[title="${second.name}"]`).click();
  await card
    .getByRole("button", { name: "Nghe thuyết minh", exact: true })
    .click();
  await expect
    .poll(async () => (await read(page, second.id)).listen_count)
    .toBe(1);
  expect(
    await visitor.evaluate(() => (window as any).__speech.cancellations),
  ).toBeGreaterThan(1);
  await visitor.screenshot({
    path: `.runtime/screenshots/visitor-map-${info.project.name}.png`,
    fullPage: true,
  });
  await context.close();
});
