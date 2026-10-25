import { useEffect, useState } from "react";
import {
  uiMessage,
  api,
  SpeechPlayer,
  aiIssueMessage,
} from "@quan1/api-client";
import type {
  Language,
  NarrationReview,
  Poi,
  Translation,
} from "@quan1/contracts";
import { reviewLabel } from "./narration-review";

type Job = {
  id: string;
  locale: string;
  status: "queued" | "running" | "completed" | "failed";
  error: string;
  source_changed?: boolean;
  issue_codes?: string[];
  reviewable?: boolean;
  validation?: { status: string; issues: string[] } | null;
  timings?: {
    queue_wait_seconds?: number | null;
    generation_seconds?: number | null;
  };
  result: null | {
    translation: Pick<Translation, "title" | "text">;
    model: string;
    applied_at?: string;
    discarded_at?: string;
  };
};

export function NarrationTranslations({
  poi,
  languages,
  vi,
  disabled,
  onApplied,
  activeLocale,
  onBusy,
  onDraftChange,
  reviews,
  onReviewChange,
}: {
  poi: Poi;
  languages: Language[];
  vi: boolean;
  disabled: boolean;
  onApplied: (poi: Poi) => void;
  activeLocale: string;
  onBusy: (busy: boolean) => void;
  onDraftChange: (dirty: boolean) => void;
  reviews: Record<string, NarrationReview>;
  onReviewChange: (
    reviews: Record<string, NarrationReview>,
    revision: number,
    poiId: string,
  ) => void;
}) {
  const targets = languages.filter((l) => l.enabled && l.code !== "vi");
  const [selection, setSelection] = useState<string[]>([]);
  const [policy, setPolicy] = useState({
    enabled: true,
    batch_limit: 1,
    verified_locales: [] as string[],
  });
  const [workerReady, setWorkerReady] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [review, setReview] = useState<{
    job: Job;
    title: string;
    text: string;
  } | null>(null);
  const [checked, setChecked] = useState(false);
  const [comparison, setComparison] = useState<"current" | "proposal">(
    "proposal",
  );
  const [reviewOpen, setReviewOpen] = useState(false);
  const proposalDirty = Boolean(
    review &&
    (review.title !== review.job.result?.translation.title ||
      review.text !== review.job.result?.translation.text),
  );
  useEffect(() => {
    onDraftChange(proposalDirty);
    return () => onDraftChange(false);
  }, [proposalDirty, onDraftChange]);
  useEffect(() => {
    if (!busy) return;
    onBusy(true);
    return () => onBusy(false);
  }, [busy, onBusy]);
  useEffect(() => {
    setVerified(false);
    setChecked(false);
  }, [poi.id, poi.revision]);
  useEffect(() => {
    let alive = true;
    setRemoteChanged(false);
    async function refresh() {
      try {
        const result = await api<{
          items: Job[];
          policy?: typeof policy;
          worker_ready?: boolean;
          narration_review: Record<string, NarrationReview>;
          poi_revision: number;
        }>(`/admin/pois/${poi.id}/narration-jobs`);
        if (alive) {
          if (result.poi_revision !== poi.revision) {
            setRemoteChanged(true);
            return;
          }
          setJobs(result.items);
          if (result.policy) setPolicy(result.policy);
          setWorkerReady(result.worker_ready !== false);
          onReviewChange(result.narration_review, result.poi_revision, poi.id);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    }
    void refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [poi.id, poi.revision, onReviewChange]);
  const latest = targets
    .map((l) => jobs.find((j) => j.locale === l.code))
    .filter((j): j is Job => !!j);
  async function generate(codes: string[]) {
    if (!codes.length || busy || disabled || remoteChanged || !workerReady)
      return;
    const replacing = codes.some(
      (code) =>
        poi.translations[code]?.text.trim() ||
        poi.translations[code]?.title.trim(),
    );
    if (
      replacing &&
      !window.confirm(
        vi
          ? "Tạo lại bản dịch đã có? Nội dung chỉ được thay sau khi bạn duyệt và lưu bản nháp."
          : "Regenerate existing translations? Replacement happens only after you review and save the draft.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ items: Job[] }>(
        `/admin/pois/${poi.id}/narration-jobs`,
        {
          method: "POST",
          body: JSON.stringify({
            revision: poi.revision,
            language_codes: codes,
            replace_existing: replacing,
            confirmed_source: verified,
          }),
        },
      );
      setJobs((current) => [
        ...result.items,
        ...current.filter((j) => !result.items.some((n) => n.id === j.id)),
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!review || busy || disabled || remoteChanged) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<Poi>(
        `/admin/pois/${poi.id}/narration-jobs/${review.job.id}/apply`,
        {
          method: "POST",
          body: JSON.stringify({
            revision: poi.revision,
            confirmed_review: checked,
            translation: { title: review.title, text: review.text },
          }),
        },
      );
      setReview(null);
      onApplied(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function discard(job: Job) {
    setBusy(true);
    setError("");
    try {
      const result = await api<Poi>(
        `/admin/pois/${poi.id}/narration-jobs/${job.id}/discard`,
        {
          method: "POST",
          body: JSON.stringify({ revision: poi.revision }),
        },
      );
      setJobs((current) =>
        current.map((item) =>
          item.id === job.id
            ? {
                ...item,
                result: item.result
                  ? { ...item.result, discarded_at: new Date().toISOString() }
                  : null,
              }
            : item,
        ),
      );
      onApplied(result);
      setReview((current) => (current?.job.id === job.id ? null : current));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const labels = vi
    ? {
        queued: "Đang chờ máy AI",
        running: "Đang tạo",
        completed: "Đã tạo — chờ kiểm tra",
        failed: "Thất bại",
      }
    : {
        queued: "Waiting for AI worker",
        running: "Generating",
        completed: "Generated — needs review",
        failed: "Failed",
      };
  const language = languages.find((l) => l.code === activeLocale);
  const job = jobs.find((j) => j.locale === activeLocale);
  const pendingJob = jobs.find(
    (j) => j.id === reviews[activeLocale]?.pending_job_id,
  );
  const running = job && ["queued", "running"].includes(job.status);
  const reason = remoteChanged
    ? vi
      ? "Phiên bản đã đổi. Mở lại địa điểm để đối chiếu; dữ liệu đang nhập được giữ lại."
      : "The revision changed. Reopen the place to compare; your edits are preserved."
    : disabled
      ? vi
        ? "Lưu thay đổi trước khi dùng AI."
        : "Save your edits before using AI."
      : !policy.enabled
        ? vi
          ? "Tạo AI đang tạm khóa. Bạn vẫn có thể nhập thủ công."
          : "AI generation is paused. You can still edit manually."
        : !poi.translations.vi?.text.trim()
          ? vi
            ? "Nhập và lưu bài nguồn tiếng Việt trước."
            : "Enter and save the Vietnamese source first."
          : !workerReady
            ? aiIssueMessage("worker_unavailable", vi ? "vi" : "en")
            : running
              ? vi
                ? "Ngôn ngữ này có tác vụ đang chờ hoặc xử lý."
                : "This language has a queued or running job."
              : !verified
                ? vi
                  ? "Xác nhận đã kiểm tra nguồn để tạo AI."
                  : "Confirm that you have verified the source to generate with AI."
                : "";
  const batchInvalid =
    !selection.length ||
    selection.length > policy.batch_limit ||
    selection.some((code) =>
      jobs.some(
        (j) => j.locale === code && ["queued", "running"].includes(j.status),
      ),
    ) ||
    (selection.length > 1 &&
      selection.some((c) => !policy.verified_locales.includes(c)));
  const activeReview =
    reviewOpen && review?.job.locale === activeLocale ? review : null;
  return (
    <section
      className="translation-supplement"
      aria-label={vi ? "Thuyết minh đa ngôn ngữ" : "Multilingual narration"}
    >
      <h3>{vi ? "Tạo và duyệt bằng AI" : "Generate and review with AI"}</h3>
      <p>
        {vi
          ? "AI dùng nguồn tiếng Việt đã lưu. Tạo bản AI không thay nội dung đang lưu hoặc bản công khai."
          : "AI uses the saved Vietnamese source. Generating a proposal preserves saved and public content."}
      </p>
      {remoteChanged && (
        <p className="notice warning" role="alert">
          {reason}
        </p>
      )}
      <label className="review-confirmation">
        <input
          type="checkbox"
          checked={verified}
          disabled={busy}
          onChange={(e) => setVerified(e.target.checked)}
        />
        {vi
          ? "Tôi đã xác minh và lưu nội dung nguồn tiếng Việt."
          : "I have verified and saved the Vietnamese source narration."}
      </label>
      {activeLocale !== "vi" && (
        <div className="active-ai-actions">
          <button
            type="button"
            className="button secondary"
            disabled={Boolean(reason) || busy}
            onClick={() => generate([activeLocale])}
          >
            {poi.translations[activeLocale]?.text
              ? vi
                ? "AI tạo lại"
                : "AI regenerate"
              : vi
                ? "Tạo bằng AI"
                : "Generate with AI"}
          </button>
          {pendingJob?.result && (
            <>
              <button
                type="button"
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  if (review?.job.id !== pendingJob.id) {
                    if (
                      proposalDirty &&
                      !window.confirm(
                        vi
                          ? "Bỏ chỉnh sửa đề xuất AI trước để mở đề xuất khác?"
                          : "Discard your edited AI proposal to open another one?",
                      )
                    )
                      return;
                    setReview({
                      job: pendingJob,
                      ...pendingJob.result!.translation,
                    });
                    setChecked(false);
                  }
                  setReviewOpen(true);
                  setComparison("proposal");
                }}
              >
                {vi ? "Xem & chỉnh bản AI" : "Review & edit AI draft"}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={disabled || busy || remoteChanged}
                onClick={() => discard(pendingJob)}
              >
                {vi ? "Bỏ đề xuất" : "Discard proposal"}
              </button>
            </>
          )}
        </div>
      )}
      {reason && (
        <p className="field-hint" role="status">
          {reason}
        </p>
      )}
      {language && activeLocale !== "vi" && (
        <p>
          {language.native_name}: {reviewLabel(reviews[activeLocale], vi)}
        </p>
      )}
      {(job?.source_changed || poi.narration_meta?.[activeLocale]?.stale) && (
        <p className="notice warning">
          {vi
            ? "Nguồn đã thay đổi — kiểm tra lại bản dịch này."
            : "The source changed — review this translation."}
        </p>
      )}
      {job && !job.result?.discarded_at && !job.result?.applied_at && (
        <p role="status">
          {language?.native_name}: {labels[job.status]}
          {job.status === "completed" && !job.reviewable
            ? vi
              ? " · Chưa đạt kiểm tra; hãy chỉnh và xác minh lại."
              : " · Validation needs review; edit and recheck."
            : ""}
        </p>
      )}
      {job &&
        !job.result?.discarded_at &&
        !job.result?.applied_at &&
        (job.status === "failed" ||
          (job.status === "completed" && !job.reviewable)) && (
          <p className="notice error" role="alert">
            {(job.issue_codes?.length
              ? job.issue_codes
              : [job.error || "language_uncertain"]
            )
              .map(
                (code) =>
                  aiIssueMessage(code, vi ? "vi" : "en") ||
                  aiIssueMessage("generation_failed", vi ? "vi" : "en"),
              )
              .join(" ")}
          </p>
        )}
      {activeReview && (
        <div className="ai-review">
          <div
            className="comparison-switch"
            role="group"
            aria-label={vi ? "So sánh bản dịch" : "Compare translations"}
          >
            <button
              className="button secondary"
              aria-pressed={comparison === "current"}
              onClick={() => setComparison("current")}
            >
              {vi ? "Nội dung đang lưu" : "Saved content"}
            </button>
            <button
              className="button secondary"
              aria-pressed={comparison === "proposal"}
              onClick={() => setComparison("proposal")}
            >
              {vi ? "Đề xuất AI mới" : "New AI proposal"}
            </button>
          </div>
          <div className={`ai-comparison show-${comparison}`}>
            <section className="comparison-current">
              <h4>{vi ? "Nội dung đang lưu" : "Saved content"}</h4>
              <p lang={activeLocale} dir={language?.direction}>
                {poi.translations[activeLocale]?.title}
              </p>
              <p
                className="narration-text"
                lang={activeLocale}
                dir={language?.direction}
              >
                {poi.translations[activeLocale]?.text ||
                  (vi ? "Chưa có nội dung" : "No saved content")}
              </p>
            </section>
            <section className="comparison-proposal">
              <h4>{vi ? "Đề xuất AI mới" : "New AI proposal"}</h4>
              <fieldset disabled={busy}>
                <label className="field-label">
                  {vi ? "Tiêu đề đề xuất" : "Proposal title"}
                  <input
                    className="input"
                    lang={activeLocale}
                    dir={language?.direction}
                    value={activeReview.title}
                    maxLength={180}
                    onChange={(e) => {
                      setReview({ ...activeReview, title: e.target.value });
                      setChecked(false);
                    }}
                  />
                </label>
                <label className="field-label">
                  {vi ? "Bài thuyết minh đề xuất" : "Proposal narration"}
                  <textarea
                    aria-label={
                      vi ? "Bài thuyết minh đề xuất" : "Proposal narration"
                    }
                    className="input"
                    lang={activeLocale}
                    dir={language?.direction}
                    value={activeReview.text}
                    maxLength={30000}
                    onChange={(e) => {
                      setReview({ ...activeReview, text: e.target.value });
                      setChecked(false);
                    }}
                  />
                </label>
              </fieldset>
              <SpeechPlayer
                text={activeReview.text}
                speechLocale={language?.speech_locale ?? activeLocale}
                uiLocale={vi ? "vi" : "en"}
              />
            </section>
          </div>
          <p>
            {vi
              ? "Áp dụng ghi nội dung này vào bản nháp, vẫn cần duyệt ở tab Kiểm tra & công bố. Bản công khai được giữ nguyên."
              : "Applying saves this content to the draft. It still needs approval in Review & publish. The public version is preserved."}
          </p>
          <label className="review-confirmation">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            {vi
              ? "Tôi đã kiểm tra ngôn ngữ và thông tin của bản dịch."
              : "I have checked the translation language and facts."}
          </label>
          <button
            type="button"
            className="button primary"
            disabled={!checked || disabled || busy || remoteChanged}
            onClick={apply}
          >
            {vi ? "Dùng bản này vào nháp" : "Use this version in draft"}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => setReviewOpen(false)}
          >
            {vi ? "Đóng so sánh" : "Close comparison"}
          </button>
        </div>
      )}
      <details className="batch-generation">
        <summary>
          {vi ? "Tạo nhiều ngôn ngữ" : "Generate multiple languages"}
        </summary>
        <p>
          {vi
            ? `Tối đa ${policy.batch_limit} ngôn ngữ mỗi lượt. Ngôn ngữ chưa xác minh chỉ thử riêng lẻ.`
            : `Up to ${policy.batch_limit} languages per request. Unverified languages can only be tried individually.`}
        </p>
        <div className="batch-options">
          {targets.map((l) => (
            <label key={l.code}>
              <input
                type="checkbox"
                checked={selection.includes(l.code)}
                disabled={busy}
                onChange={(e) =>
                  setSelection((current) =>
                    e.target.checked
                      ? [...current, l.code]
                      : current.filter((code) => code !== l.code),
                  )
                }
              />
              {l.native_name}
              {l.required ? " *" : ""}
            </label>
          ))}
        </div>
        <button
          type="button"
          className="button secondary"
          onClick={() =>
            setSelection(
              targets
                .filter(
                  (l) =>
                    !poi.translations[l.code]?.text &&
                    !poi.translations[l.code]?.title,
                )
                .map((l) => l.code)
                .slice(0, policy.batch_limit),
            )
          }
        >
          {vi ? "Chọn ngôn ngữ còn thiếu" : "Select missing languages"}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={
            disabled ||
            remoteChanged ||
            busy ||
            !verified ||
            !workerReady ||
            !policy.enabled ||
            batchInvalid ||
            !poi.translations.vi?.text.trim()
          }
          onClick={() => generate(selection)}
        >
          {vi ? "AI tạo các ngôn ngữ đã chọn" : "Generate selected languages"}
        </button>
        {batchInvalid && (
          <p className="field-hint">
            {vi
              ? "Chọn ngôn ngữ trong giới hạn; tránh tác vụ đang chạy và tạo riêng ngôn ngữ chưa được xác minh."
              : "Stay within the batch limit, avoid running jobs and try unverified languages individually."}
          </p>
        )}
        <p role="status">
          {vi ? "Tác vụ đang chờ/xử lý" : "Queued/running jobs"}:{" "}
          {latest
            .filter((j) => ["queued", "running"].includes(j.status))
            .map((j) => `${j.locale.toUpperCase()}: ${labels[j.status]}`)
            .join(" · ") || "0"}
        </p>
      </details>
      <details>
        <summary>
          {vi ? "Chi tiết kỹ thuật AI" : "AI technical details"}
        </summary>
        <p>
          {vi ? "Model" : "Model"}:{" "}
          {job?.result?.model ||
            poi.narration_meta?.[activeLocale]?.model ||
            "—"}
        </p>
        <p>{job?.issue_codes?.join(" · ")}</p>
        {job?.timings && (
          <p>
            {vi ? "Thời gian chờ" : "Queue wait"}:{" "}
            {Math.round(job.timings.queue_wait_seconds ?? 0)}s ·{" "}
            {vi ? "Xử lý" : "Processing"}:{" "}
            {Math.round(job.timings.generation_seconds ?? 0)}s
          </p>
        )}
      </details>
      {error && (
        <p className="notice error" role="alert">
          {uiMessage(error, vi ? "vi" : "en")}
        </p>
      )}
    </section>
  );
}
