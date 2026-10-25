import { useEffect, useState } from "react";
import {
  uiMessage,
  api,
  SpeechPlayer,
  aiIssueMessage,
} from "@quan1/api-client";
import type { Language, NarrationReview, Poi, Translation } from "@quan1/contracts";
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
  onEdit,
  onPreview,
  reviews,
  onReviewChange,
}: {
  poi: Poi;
  languages: Language[];
  vi: boolean;
  disabled: boolean;
  onApplied: (poi: Poi) => void;
  onEdit: (locale: string) => void;
  onPreview: (locale: string) => void;
  reviews: Record<string, NarrationReview>;
  onReviewChange: (reviews: Record<string, NarrationReview>, revision: number, poiId: string) => void;
}) {
  const targets = languages.filter((l) => l.enabled && l.code !== "vi");
  const [selection, setSelection] = useState<string[]>([]);
  const [policy, setPolicy] = useState({
    enabled: true,
    batch_limit: 1,
    verified_locales: [] as string[],
  });
  const [workerReady, setWorkerReady] = useState(true);
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
    if (!review) return;
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
      const result = await api<Poi>(`/admin/pois/${poi.id}/narration-jobs/${job.id}/discard`, {
        method: "POST", body: JSON.stringify({ revision: poi.revision }),
      });
      setJobs((current) => current.map((item) => item.id === job.id
        ? { ...item, result: item.result ? { ...item.result, discarded_at: new Date().toISOString() } : null } : item));
      onApplied(result);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
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
  return (
    <section
      className="translation-supplement"
      aria-label={vi ? "Thuyết minh đa ngôn ngữ" : "Multilingual narration"}
    >
      <h3>{vi ? "Thuyết minh đa ngôn ngữ" : "Multilingual narration"}</h3>
      {remoteChanged && <p role="alert">{vi
        ? "Địa điểm đã được cập nhật ở phiên khác. Mở lại địa điểm để xem nội dung và trạng thái duyệt mới nhất."
        : "This place changed in another session. Reopen it to view the latest content and approval states."}</p>}
      <p>
        {vi
          ? "AI dùng bài tiếng Việt đã lưu và thông tin địa điểm. Kết quả là bản nháp riêng; cần kiểm tra ngôn ngữ, sự thật và nghe thử trước khi công bố."
          : "AI uses the saved Vietnamese narration and place facts. Results are private drafts: verify language, facts and speech before publishing."}
      </p>
      <label>
        <input
          type="checkbox"
          checked={verified}
          onChange={(e) => setVerified(e.target.checked)}
        />
        {vi
          ? "Tôi đã xác minh và lưu nội dung nguồn tiếng Việt."
          : "I have verified and saved the Vietnamese source narration."}
      </label>
      <p role="status">
        {vi
          ? `Tối đa ${policy.batch_limit} ngôn ngữ mỗi lượt. Ngôn ngữ chưa kiểm chứng chỉ thử riêng lẻ.`
          : `Up to ${policy.batch_limit} languages per request. Unverified languages are available for individual trials.`}
      </p>
      {!policy.enabled && <p role="status">{vi ? "Tạo bản dịch AI đang tạm khóa. Bạn vẫn có thể nhập và sửa nội dung thủ công."
        : "AI translation is paused. Manual content editing remains available."}</p>}
      {!workerReady && (
        <p role="status">
          {aiIssueMessage("worker_unavailable", vi ? "vi" : "en")}
        </p>
      )}
      {disabled && (
        <p role="status">
          {vi
            ? "Lưu hoặc khôi phục thay đổi đang nhập trước khi dùng AI."
            : "Save or restore your current edits before using AI."}
        </p>
      )}
      <p role="status">
        {vi ? "Đạt kiểm tra tự động" : "Passed automated checks"}:{" "}
        {latest.filter((j) => j.reviewable).length}
        {" · "}
        {vi ? "Lỗi/cần kiểm tra" : "Failed/uncertain"}:{" "}
        {
          latest.filter(
            (j) =>
              j.status === "failed" ||
              (j.status === "completed" && !j.reviewable),
          ).length
        }
        {" · "}
        {vi ? "Đang chờ/xử lý" : "Waiting/running"}:{" "}
        {latest.filter((j) => ["queued", "running"].includes(j.status)).length}
      </p>
      <table className="narration-language-table">
        <thead>
          <tr>
            <th>{vi ? "Chọn ngôn ngữ" : "Select language"}</th>
            <th>{vi ? "Trạng thái / nguồn" : "Status / source"}</th>
            <th>{vi ? "Thao tác" : "Actions"}</th>
          </tr>
        </thead>
        <tbody>
          {targets.map((language) => {
            const code = language.code,
              job = jobs.find((j) => j.locale === code),
              translation = poi.translations[code],
              state = reviews[code],
              pendingJob = jobs.find((j) => j.id === state?.pending_job_id);
            return (
              <tr key={code}>
                <td data-label={vi ? "Ngôn ngữ" : "Language"}>
                  <label className="narration-language-choice">
                    <input
                      type="checkbox"
                      checked={selection.includes(code)}
                      onChange={(e) =>
                        setSelection((current) =>
                          e.target.checked
                            ? [...current, code]
                            : current.filter((c) => c !== code),
                        )
                      }
                    />
                    <span><strong>{code.toUpperCase()}</strong> {language.native_name}</span>
                  </label>
                </td>
                <td data-label={vi ? "Trạng thái / nguồn" : "Status / source"}>
                  <p className="narration-review-status">{reviewLabel(state, vi)}</p>
                  {state?.source && <small className="narration-status-detail">
                    {vi ? "Nguồn" : "Source"}: {state.source === "ai" ? "AI" : vi ? "Thủ công" : "Manual"}
                  </small>}
                  {job && !job.result?.applied_at && !job.result?.discarded_at && (
                    <p className="narration-status-detail">{job.status === "completed" && !job.reviewable
                      ? vi ? "Kết quả cần kiểm tra lại" : "Result needs revalidation"
                      : labels[job.status]}</p>
                  )}
                  {(job?.source_changed ||
                    poi.narration_meta?.[code]?.stale) && (
                    <p>
                      {vi
                        ? "Nguồn đã thay đổi — cần kiểm tra"
                        : "Source changed — review required"}
                    </p>
                  )}
                  {poi.narration_meta?.[code]?.model && (
                    <small className="narration-status-detail">{vi ? "Mô hình" : "Model"}: {poi.narration_meta[code].model}</small>
                  )}
                  {job?.result?.model && job.result.model !== poi.narration_meta?.[code]?.model && (
                    <small className="narration-status-detail">{vi ? "Mô hình" : "Model"}: {job.result.model}</small>
                  )}
                  {job?.timings && (
                    <small className="narration-status-detail">
                      {vi ? "Chờ" : "Queue"}:{" "}
                      {Math.round(job.timings.queue_wait_seconds ?? 0)}s
                      {job.timings.generation_seconds != null &&
                        ` · ${vi ? "Xử lý" : "Generation"}: ${Math.round(job.timings.generation_seconds)}s`}
                    </small>
                  )}
                  {job && !job.result?.discarded_at && !job.result?.applied_at &&
                    (job.status === "failed" ||
                      (job.status === "completed" && !job.reviewable)) && (
                      <p>
                        {(job.issue_codes?.length
                          ? job.issue_codes
                          : [job.error || "language_uncertain"]
                        )
                          .map(
                            (code) =>
                              aiIssueMessage(code, vi ? "vi" : "en") ||
                              aiIssueMessage(
                                "generation_failed",
                                vi ? "vi" : "en",
                              ),
                          )
                          .join(" ")}
                      </p>
                    )}
                </td>
                <td data-label={vi ? "Thao tác" : "Actions"}>
                  <div className="narration-row-actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => onEdit(code)}
                  >
                    {vi ? "Xem / chỉnh sửa" : "View / edit"}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={!translation?.tts_ready}
                    onClick={() => onPreview(code)}
                  >
                    {vi ? "Nghe thử" : "Preview speech"}
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={
                      !policy.enabled || disabled ||
                      busy ||
                      !verified ||
                      job?.status === "queued" ||
                      job?.status === "running"
                    }
                    onClick={() => generate([code])}
                  >
                    {translation?.text
                      ? vi
                        ? "AI tạo lại"
                        : "AI regenerate"
                      : vi
                        ? "AI bổ sung / thử lại"
                        : "AI generate / retry"}
                  </button>
                  {pendingJob?.result && (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => {
                        setReview({ job: pendingJob, ...pendingJob.result!.translation });
                        setChecked(false);
                      }}
                    >
                      {vi ? "Xem & chỉnh bản AI" : "Review & edit AI draft"}
                    </button>
                  )}
                  {pendingJob && <button type="button" className="button secondary" disabled={disabled || busy}
                    onClick={() => discard(pendingJob)}>
                    {vi ? "Bỏ bản AI mới" : "Discard new AI draft"}
                  </button>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        type="button"
        className="button"
        disabled={
          !policy.enabled || disabled ||
          busy ||
          !verified ||
          !selection.length ||
          selection.length > policy.batch_limit ||
          (selection.length > 1 &&
            selection.some((c) => !policy.verified_locales.includes(c)))
        }
        onClick={() => generate(selection)}
      >
        {vi ? "AI tạo các ngôn ngữ đã chọn" : "Generate selected languages"}
      </button>
      <button
        type="button"
        className="button secondary"
        onClick={() =>
          setSelection(
            targets
              .filter(
                (l) =>
                  !poi.translations[l.code]?.text.trim() &&
                  !poi.translations[l.code]?.title.trim(),
              )
              .map((l) => l.code)
              .slice(0, policy.batch_limit),
          )
        }
      >
        {vi ? "Chọn ngôn ngữ còn thiếu" : "Select missing languages"}
      </button>
      {review && (
        <div className="ai-review">
          <h4>
            {vi ? "Kiểm tra bản dịch" : "Review translation"} ·{" "}
            {review.job.locale}
          </h4>
          <label className="field-label">
            {vi ? "Tiêu đề" : "Title"}
            <input
              className="input"
              value={review.title}
              maxLength={180}
              onChange={(e) => setReview({ ...review, title: e.target.value })}
            />
          </label>
          <label className="field-label">
            {vi ? "Bài thuyết minh" : "Narration text"}
            <textarea
              className="input"
              lang={review.job.locale}
              dir={
                languages.find((l) => l.code === review.job.locale)?.direction
              }
              value={review.text}
              maxLength={30000}
              onChange={(e) => setReview({ ...review, text: e.target.value })}
            />
          </label>
          <SpeechPlayer
            text={review.text}
            speechLocale={
              languages.find((l) => l.code === review.job.locale)
                ?.speech_locale ?? review.job.locale
            }
            uiLocale={vi ? "vi" : "en"}
          />
          <label>
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
            className="button"
            disabled={!checked || disabled || busy}
            onClick={apply}
          >
            {vi ? "Lưu bản dịch vào nháp" : "Save translation to draft"}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => setReview(null)}
          >
            {vi ? "Hủy" : "Cancel"}
          </button>
        </div>
      )}
      {error && <p role="alert">{uiMessage(error, vi ? "vi" : "en")}</p>}
    </section>
  );
}
