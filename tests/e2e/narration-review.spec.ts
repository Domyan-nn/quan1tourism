import { workerOnline } from "./editor-helpers";
import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures";
import { mockSpeech } from "./speech";

const corpus = JSON.parse(readFileSync("tests/fixtures/translation-corpus.json", "utf8"));
const headers = { "X-Requested-With": "Quan1Admin" };
const workerHeaders = { ...headers, Authorization: "Bearer isolated-e2e-worker-credential-only" };

test("active narration workspace fits its page and approval markers follow saved content and pending jobs", async ({ page }, info) => {
  test.setTimeout(180000);
  await mockSpeech(page);
  await page.goto("/admin/");
  await page.getByRole("button", { name: "Trải nghiệm tài khoản demo", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Địa điểm", exact: true })).toBeVisible();
  const name = `Narration review ${info.project.name} ${Date.now()}`;
  const response = await page.request.post("/api/v1/admin/pois", { headers, data: {
    name, address: "Quận 1", category_id: "culture", status: "published",
    translations: { vi: { title: name, text: corpus.sources[0].text },
      en: { title: "English narration", text: corpus.language_samples.en } },
  } });
  expect(response.status()).toBe(201);
  let poi = await response.json();
  async function generate(code: string, replace = false) {
    await workerOnline(page);
    const queued = await page.request.post(`/api/v1/admin/pois/${poi.id}/narration-jobs`, {
      headers, data: { revision: poi.revision, confirmed_source: true, language_codes: [code], replace_existing: replace },
    });
    expect(queued.status()).toBe(202);
    const claimed = await (await page.request.post("/api/v1/worker/claim", {
      headers: workerHeaders, data: { protocol: 3 },
    })).json();
    const job = claimed.job;
    const completed = await page.request.post(`/api/v1/worker/jobs/${job.id}/complete`, {
      headers: workerHeaders, data: { lease: job.lease, locale: job.payload.locale,
        source_revision: job.payload.source_revision, source_hash: job.payload.source_hash,
        done_reason: "stop", model: "a-long-model-name-without-any-spaces-".repeat(2),
        translation: { title: code === "fr" ? "Une promenade" : "English narration", text: corpus.language_samples[code] } },
    });
    expect(completed.status()).toBe(200);
    expect((await completed.json()).status).toBe("completed");
    return job;
  }
  await generate("fr");
  await page.reload();
  await page.getByRole("textbox", { name: "Tìm địa điểm, địa chỉ…" }).fill(name);
  await page.getByRole("button", { name, exact: true }).click();
  await page.locator("#editor-tab-1").click();
  const region = page.locator(".translation-supplement");
  const viTab = page.getByRole("tab").filter({ hasText: "Tiếng Việt" });
  const enTab = page.getByRole("tab").filter({ hasText: "English" });
  const frTab = page.getByRole("tab").filter({ hasText: "Français" });
  const deTab = page.getByRole("tab").filter({ hasText: "Deutsch" });
  await expect(viTab.locator(".language-review-symbol")).toHaveText("✓");
  await expect(enTab.locator(".language-review-symbol")).toHaveText("✓");
  await expect(frTab.locator(".language-review-symbol")).toHaveText("○");
  await expect(deTab.locator(".language-review-symbol")).toHaveText("");
  await frTab.click();
  await expect(region).toContainText("Bản AI chưa duyệt");
  await region.getByText("Chi tiết kỹ thuật AI", { exact: true }).click();
  await expect(region.getByText(/a-long-model-name-without-any-spaces-/)).toBeVisible();
  // Browser zoom reduces the effective CSS viewport. Model 125% with a
  // correspondingly smaller viewport; CSS zoom does not update media queries.
  for (const width of [1366, 1440, 1920, 768, 390]) {
    for (const enlarged of [false, true]) {
      await page.setViewportSize({ width: Math.floor(width / (enlarged ? 1.25 : 1)), height: 1100 });
      await page.evaluate((large) => {
        document.documentElement.classList.toggle("large-text", large);
      }, enlarged);
      await expect.poll(async () => page.evaluate(() => {
        const nodes = [document.documentElement, ...document.querySelectorAll<HTMLElement>(
          ".editor-body, .translation-supplement, .narration-workspace, .narration-active")];
        return nodes.filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => ({
          name: node.className || "html", scroll: node.scrollWidth, client: node.clientWidth,
          children: Array.from(document.querySelectorAll<HTMLElement>("body *")).map((child) => ({
            name: `${child.tagName}.${child.className}`, right: Math.round(child.getBoundingClientRect().right),
          })).filter((child) => child.right > innerWidth + 1).slice(0, 12),
        }));
      })).toEqual([]);
      const actions = region;
      for (const label of ["Tạo bằng AI", "Xem & chỉnh bản AI"]) {
        await actions.getByRole("button", { name: label, exact: true }).scrollIntoViewIfNeeded();
        await expect(actions.getByRole("button", { name: label, exact: true })).toBeInViewport();
      }
      if (!enlarged) {
        await page.locator(".editor-body").evaluate((element) => { element.scrollTop = 0; });
        await page.screenshot({ path: `.runtime/screenshots/narration-review-${info.project.name}-${width}.png`, fullPage: true });
        if (width === 1440 || width === 390) {
          await actions.scrollIntoViewIfNeeded();
          await page.screenshot({ path: `.runtime/screenshots/narration-review-ai-${info.project.name}-${width}.png`, fullPage: true });
          await page.locator(".narration-workspace > .language-tabs").scrollIntoViewIfNeeded();
          await page.screenshot({ path: `.runtime/screenshots/narration-review-tabs-${info.project.name}-${width}.png`, fullPage: true });
        }
      }
    }
  }
  await page.evaluate(() => { document.documentElement.classList.remove("large-text"); });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await generate("en", true);
  await expect(enTab.locator(".language-review-symbol")).toHaveText("○");
  await expect(enTab).toHaveAttribute("title", "Có bản AI mới chưa duyệt; bản đã duyệt trước vẫn được giữ.");
  await enTab.click();
  await region.getByRole("button", { name: "Bỏ đề xuất", exact: true }).click();
  await expect(enTab.locator(".language-review-symbol")).toHaveText("✓");
  await enTab.click();
  const narration = page.locator(".narration-input");
  await narration.fill("A manually edited draft waiting for approval.");
  await expect(enTab.locator(".language-review-symbol")).toHaveText("○");
  await expect(region).toContainText("Bản nháp chưa duyệt");
  await page.getByRole("button", { name: "Ngôn ngữ giao diện", exact: true }).click();
  await expect(narration).toHaveValue("A manually edited draft waiting for approval.");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByText("Changes saved.", { exact: true })).toBeVisible();
  poi = await (await page.request.get(`/api/v1/admin/pois/${poi.id}`)).json();
  expect(poi.status).toBe("draft");
  expect(poi.narration_review.en.state).toBe("pending");
  const publicPoi = await (await page.request.get(`/api/v1/pois/${poi.id}?track_view=false`)).json();
  expect(publicPoi.translations.en.text).toBe(corpus.language_samples.en);
  // Polling must not attach a different session's approval to the old form text.
  const translations = Object.fromEntries(Object.entries(poi.translations).map(([code, tr]: [string, any]) =>
    [code, { title: tr.title, text: tr.text }]));
  translations.en = { title: "Remote approved revision", text: corpus.language_samples.en };
  expect((await page.request.put(`/api/v1/admin/pois/${poi.id}`, { headers, data: {
    name: poi.name, address: poi.address, category_id: poi.category_id, revision: poi.revision,
    status: "published", translations,
  } })).status()).toBe(200);
  await expect(region.getByRole("alert")).toContainText("The revision changed");
  await expect(enTab.locator(".language-review-symbol")).toHaveText("○");
  await expect(narration).toHaveValue("A manually edited draft waiting for approval.");
});
