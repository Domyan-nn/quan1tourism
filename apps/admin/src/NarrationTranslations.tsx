import { useEffect, useState } from "react";
import { uiMessage, api, SpeechPlayer } from "@quan1/api-client";
import type { Language, Poi, Translation } from "@quan1/contracts";

type Job = {
  id: string;
  locale: string;
  status: "queued" | "running" | "completed" | "failed";
  error: string;
  source_changed?: boolean;
  result: null | {
    translation: Pick<Translation, "title" | "text">;
    model: string;
    applied_at?: string;
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
}: {
  poi: Poi;
  languages: Language[];
  vi: boolean;
  disabled: boolean;
  onApplied: (poi: Poi) => void;
  onEdit: (locale: string) => void;
  onPreview: (locale: string) => void;
}) {
  const targets = languages.filter((l) => l.enabled && l.code !== "vi");
  const [selection, setSelection] = useState<string[]>(() =>
    targets
      .filter(
        (l) =>
          !poi.translations[l.code]?.text.trim() &&
          !poi.translations[l.code]?.title.trim(),
      )
      .map((l) => l.code),
  );
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
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
    async function refresh() {
      try {
        const result = await api<{ items: Job[] }>(
          `/admin/pois/${poi.id}/narration-jobs`,
        );
        if (alive) setJobs(result.items);
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
  }, [poi.id, poi.revision]);
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
  const labels = vi
    ? {
        queued: "Đang chờ máy AI",
        running: "Đang tạo",
        completed: "Chờ duyệt",
        failed: "Thất bại",
      }
    : {
        queued: "Waiting for AI worker",
        running: "Generating",
        completed: "Needs review",
        failed: "Failed",
      };
  return (
    <section
      className="translation-supplement"
      aria-label={vi ? "Thuyết minh đa ngôn ngữ" : "Multilingual narration"}
    >
      <h3>{vi ? "Thuyết minh đa ngôn ngữ" : "Multilingual narration"}</h3>
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
      {disabled && (
        <p role="status">
          {vi
            ? "Lưu hoặc khôi phục thay đổi đang nhập trước khi dùng AI."
            : "Save or restore your current edits before using AI."}
        </p>
      )}
      <p role="status">
        {vi ? "Đã xử lý" : "Processed"}:{" "}
        {
          latest.filter((j) => ["completed", "failed"].includes(j.status))
            .length
        }
        /{latest.length}
      </p>
      <table>
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
              translation = poi.translations[code];
            return (
              <tr key={code}>
                <td>
                  <label>
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
                    {language.native_name}
                  </label>
                </td>
                <td>
                  {job && !job.result?.applied_at
                    ? labels[job.status]
                    : translation?.published
                      ? vi
                        ? "Đã công bố"
                        : "Published"
                      : translation?.tts_ready
                        ? vi
                          ? "Bản đã lưu"
                          : "Saved draft"
                        : vi
                          ? "Chưa có"
                          : "Missing"}
                  {(job?.source_changed ||
                    poi.narration_meta?.[code]?.stale) && (
                    <p>
                      {vi
                        ? "Nguồn đã thay đổi — cần kiểm tra"
                        : "Source changed — review required"}
                    </p>
                  )}
                  {poi.narration_meta?.[code]?.model && (
                    <small>{poi.narration_meta[code].model}</small>
                  )}
                  {job?.status === "failed" && (
                    <p>
                      {vi
                        ? "Tạo bản dịch thất bại. Thử lại riêng ngôn ngữ này hoặc chỉnh tay."
                        : "Translation failed. Retry this language or edit manually."}
                    </p>
                  )}
                </td>
                <td>
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
                      disabled ||
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
                  {job?.result && !job.result.applied_at && (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => {
                        setReview({ job, ...job.result!.translation });
                        setChecked(false);
                      }}
                    >
                      {vi ? "Xem & chỉnh bản AI" : "Review & edit AI draft"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        type="button"
        className="button"
        disabled={disabled || busy || !verified || !selection.length}
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
              .map((l) => l.code),
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
