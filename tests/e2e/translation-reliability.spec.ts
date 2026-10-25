import { workerOnline } from "./editor-helpers";
import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures";
import { mockSpeech } from "./speech";

const corpus = JSON.parse(
  readFileSync("tests/fixtures/translation-corpus.json", "utf8"),
);
const headers = { "X-Requested-With": "Quan1Admin" };
const workerHeaders = {
  ...headers,
  Authorization: "Bearer isolated-e2e-worker-credential-only",
};

test("translation policy, safe errors, partial success and review stay consistent across UI languages", async ({
  page,
}, info) => {
  await mockSpeech(page);
  await page.goto("/admin/");
  await page
    .getByRole("button", { name: "Trải nghiệm tài khoản demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Địa điểm", exact: true }),
  ).toBeVisible();
  const name = `Translation reliability ${info.project.name} ${Date.now()}`;
  const source = corpus.sources[0].text;
  const created = await page.request.post("/api/v1/admin/pois", {
    headers,
    data: {
      name,
      address: "Quận 1",
      category_id: "culture",
      status: "published",
      translations: {
        vi: { title: name, text: source },
        en: { title: name, text: corpus.language_samples.en },
      },
    },
  });
  expect(created.status()).toBe(201);
  const poi = await created.json();
  await page.reload();
  await page
    .getByRole("textbox", { name: "Tìm địa điểm, địa chỉ…" })
    .fill(name);
  await page.getByRole("button", { name, exact: true }).click();
  await page
    .locator("#editor-tab-1")
    .click();
  const region = page.getByRole("region", {
    name: /^(Thuyết minh đa ngôn ngữ|Multilingual narration)$/,
    exact: true,
  });
  await workerOnline(page);
  await page.getByRole("tab").filter({ hasText: "Français" }).click();
  const french = region;
  const german = region;
  await region.getByText("Tạo nhiều ngôn ngữ", { exact: true }).click();
  await expect(region.getByLabel("Français", { exact: true })).not.toBeChecked();
  await region
    .getByLabel("Tôi đã xác minh và lưu nội dung nguồn tiếng Việt.")
    .check();
  await region.getByLabel("Français", { exact: true }).check();
  await region.getByLabel("Deutsch", { exact: true }).check();
  await expect(
    region.getByRole("button", {
      name: "AI tạo các ngôn ngữ đã chọn",
      exact: true,
    }),
  ).toBeDisabled();
  const blocked = await page.request.post(
    `/api/v1/admin/pois/${poi.id}/narration-jobs`,
    {
      headers,
      data: {
        revision: poi.revision,
        confirmed_source: true,
        language_codes: ["fr", "de"],
      },
    },
  );
  expect(blocked.status()).toBe(422);
  expect((await blocked.json()).detail).toBe("batch_limited");
  await french
    .getByRole("button", { name: "Tạo bằng AI", exact: true })
    .click();
  await expect(french).toContainText("Đang chờ máy AI");
  const obsolete = await page.request.post("/api/v1/worker/claim", {
    headers: workerHeaders,
    data: { protocol: 2 },
  });
  expect((await obsolete.json()).job).toBeNull();
  async function claim() {
    return (
      await (
        await page.request.post("/api/v1/worker/claim", {
          headers: workerHeaders,
          data: { protocol: 3 },
        })
      ).json()
    ).job;
  }
  async function finish(
    job: any,
    translation: { title: string; text: string },
  ) {
    return page.request.post(`/api/v1/worker/jobs/${job.id}/complete`, {
      headers: workerHeaders,
      data: {
        lease: job.lease,
        locale: job.payload.locale,
        source_revision: job.payload.source_revision,
        source_hash: job.payload.source_hash,
        done_reason: "stop",
        model: "mock-ollama",
        translation,
        validation: { status: "passed", issues: [] }, // Backend must ignore forged validation.
      },
    });
  }
  const frJob = await claim();
  expect(
    (await (await finish(frJob, { title: "Copied", text: source })).json())
      .status,
  ).toBe("failed");
  await expect(french).toContainText("AI chép lại bài nguồn");
  await expect(
    french.getByRole("button", { name: "Xem & chỉnh bản AI", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Ngôn ngữ giao diện", exact: true })
    .click();
  await expect(french).toContainText(
    "AI copied the source instead of translating",
  );
  await page.getByRole("tab").filter({ hasText: "Deutsch" }).click();
  await german
    .getByRole("button", { name: "Generate with AI", exact: true })
    .click();
  await expect(german).toContainText("Waiting for AI worker");
  const deJob = await claim();
  const deTranslation = {
    title: "Park am Fluss",
    text: corpus.language_samples.de,
  };
  expect((await (await finish(deJob, deTranslation)).json()).status).toBe(
    "completed",
  );
  await expect(german).toContainText("Generated — needs review");
  await page.getByRole("tab").filter({ hasText: "Français" }).click();
  await expect(region).toContainText("AI copied the source");
  await page.getByRole("tab").filter({ hasText: "Deutsch" }).click();
  expect(
    (await (await finish(deJob, { title: "Late copy", text: source })).json())
      .status,
  ).toBe("completed");
  const jobs = (
    await (
      await page.request.get(`/api/v1/admin/pois/${poi.id}/narration-jobs`)
    ).json()
  ).items;
  expect(jobs.find((j: any) => j.id === deJob.id).result.translation).toEqual(
    deTranslation,
  );
  await german
    .getByRole("button", { name: "Review & edit AI draft", exact: true })
    .click();
  await region
    .getByLabel("I have checked the translation language and facts.")
    .check();
  await region
    .getByRole("button", { name: "Use this version in draft", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await (await page.request.get(`/api/v1/admin/pois/${poi.id}`)).json())
          .translations.de.text,
    )
    .toBe(deTranslation.text);
  const published = await (
    await page.request.get(`/api/v1/pois/${poi.id}?track_view=false`)
  ).json();
  expect(published.translations.de?.text).toBeFalsy();
  const saved = await (
    await page.request.get(`/api/v1/admin/pois/${poi.id}`)
  ).json();
  expect(saved.view_count).toBe(0);
  expect(saved.listen_count).toBe(0);
});

test("known model failures are explained and retry remains scoped to one language", async ({
  page,
}, info) => {
  await page.goto("/admin/");
  await page
    .getByRole("button", { name: "Trải nghiệm tài khoản demo", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Địa điểm", exact: true }),
  ).toBeVisible();
  const name = `Timeout translation ${info.project.name} ${Date.now()}`;
  const response = await page.request.post("/api/v1/admin/pois", {
    headers,
    data: {
      name,
      category_id: "culture",
      address: "Quận 1",
      translations: {
        vi: { title: name, text: corpus.sources[0].text },
        en: { title: name, text: corpus.language_samples.en },
      },
    },
  });
  const poi = await response.json();
  await page.reload();
  await page
    .getByRole("textbox", { name: "Tìm địa điểm, địa chỉ…" })
    .fill(name);
  await page.getByRole("button", { name, exact: true }).click();
  await page
    .locator("#editor-tab-1")
    .click();
  const region = page.getByRole("region", {
    name: "Thuyết minh đa ngôn ngữ",
    exact: true,
  });
  await region
    .getByLabel("Tôi đã xác minh và lưu nội dung nguồn tiếng Việt.")
    .check();
  await workerOnline(page);
  await page.getByRole("tab").filter({ hasText: "العربية" }).click();
  const row = region;
  await row
    .getByRole("button", { name: "Tạo bằng AI", exact: true })
    .click();
  await expect(row).toContainText("Đang chờ máy AI");
  const job = (
    await (
      await page.request.post("/api/v1/worker/claim", {
        headers: workerHeaders,
        data: { protocol: 3 },
      })
    ).json()
  ).job;
  expect(job.payload.poi_id).toBe(poi.id);
  await page.request.post(`/api/v1/worker/jobs/${job.id}/complete`, {
    headers: workerHeaders,
    data: {
      lease: job.lease,
      locale: job.payload.locale,
      source_revision: job.payload.source_revision,
      source_hash: job.payload.source_hash,
      error: "model_timeout",
      issue_codes: ["model_timeout"],
    },
  });
  await expect(row).toContainText("Model AI xử lý quá thời gian giới hạn");
  await expect(
    row.getByRole("button", { name: "Tạo bằng AI", exact: true }),
  ).toBeEnabled();
  const jobs = (
    await (
      await page.request.get(`/api/v1/admin/pois/${poi.id}/narration-jobs`)
    ).json()
  ).items;
  expect(jobs).toHaveLength(1);
});
