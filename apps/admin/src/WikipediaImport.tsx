import { useEffect, useRef, useState } from "react";
import { BookOpen, LoaderCircle, Sparkles } from "lucide-react";
import { uiMessage, api, ApiError, aiIssueMessage } from "@quan1/api-client";
import type { AiJob, Language, WikipediaDraft } from "@quan1/contracts";

type Props = {
  languages: Language[];
  vi: boolean;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onApply: (result: WikipediaDraft) => void;
};

export function WikipediaImport({
  languages,
  vi,
  busy,
  onBusy,
  onApply,
}: Props) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<{
    ready: boolean;
    model: string;
    message: string;
    mode: "direct" | "worker";
  } | null>(null);
  const [selected, setSelected] = useState(
    languages
      .filter((item) => item.enabled && item.code === "vi")
      .map((item) => item.code),
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [jobId, setJobId] = useState(
    () => localStorage.getItem("quan1-ai-job") ?? "",
  );
  const [jobState, setJobState] = useState("");
  const [jobTimings, setJobTimings] = useState<AiJob["timings"]>();
  const callbacks = useRef({ onApply, onBusy });
  callbacks.current = { onApply, onBusy };
  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setGenerating(true);
    callbacks.current.onBusy(true);
    async function poll() {
      try {
        const job = await api<AiJob>(`/admin/ai/jobs/${jobId}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setJobState(job.status);
        setJobTimings(job.timings);
        if (job.status === "failed")
          throw new Error(
            aiIssueMessage(
              job.issue_codes?.[0] || job.error,
              document.documentElement.lang,
            ) ||
              (document.documentElement.lang === "en"
                ? "AI generation failed. Check the worker and try again."
                : "Tạo nội dung AI thất bại. Kiểm tra máy AI rồi thử lại."),
          );
        if (job.status === "completed" && job.result) {
          if (!job.reviewable)
            throw new Error(
              aiIssueMessage(
                Object.values(job.validation ?? {}).flatMap(
                  (r) => r.issues,
                )[0] || "language_uncertain",
                document.documentElement.lang,
              ),
            );
          callbacks.current.onApply(job.result);
          finish();
          return;
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        // Network/server interruptions keep the persisted job; a reload resumes polling.
        if (
          err instanceof ApiError &&
          (err.status === 0 || err.status >= 500)
        ) {
          setJobState("reconnecting");
        } else {
          setError((err as Error).message);
          finish();
          return;
        }
      }
      timer = setTimeout(poll, 2500);
    }
    function finish() {
      localStorage.removeItem("quan1-ai-job");
      setJobId("");
      setGenerating(false);
      callbacks.current.onBusy(false);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
      callbacks.current.onBusy(false);
    };
  }, [jobId]);
  useEffect(() => {
    let ignore = false;
    api<typeof status>("/admin/ai/status")
      .then((result) => {
        if (!ignore) setStatus(result);
      })
      .catch((err: Error) => {
        if (!ignore) setError(err.message);
      });
    return () => {
      ignore = true;
    };
  }, [retry]);

  async function generate() {
    setError("");
    setJobTimings(undefined);
    setGenerating(true);
    onBusy(true);
    let queued = false;
    try {
      if (status?.mode === "worker") {
        const job = await api<AiJob>("/admin/ai/jobs", {
          method: "POST",
          body: JSON.stringify({ url: url.trim(), language_codes: selected }),
        });
        localStorage.setItem("quan1-ai-job", job.id);
        setJobId(job.id);
        queued = true;
        return;
      }
      const result = await api<WikipediaDraft>("/admin/ai/wikipedia", {
        method: "POST",
        body: JSON.stringify({ url: url.trim(), language_codes: selected }),
        signal: AbortSignal.timeout(660_000),
      });
      if (result.existing_poi) {
        throw new Error(
          vi
            ? `Địa điểm “${result.existing_poi.name}” đã được nhập từ bài này. Hãy mở địa điểm hiện có để chỉnh sửa.`
            : `“${result.existing_poi.name}” was already imported. Open the existing place to edit it.`,
        );
      }
      onApply(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      if (!queued) {
        setGenerating(false);
        onBusy(false);
      }
    }
  }

  return (
    <section
      className="wikipedia-import"
      aria-labelledby="wikipedia-import-title"
      aria-busy={generating}
    >
      <div className="wikipedia-import-heading">
        <Sparkles size={20} aria-hidden="true" />
        <h3 id="wikipedia-import-title">
          {vi ? "Tạo địa điểm từ Wikipedia" : "Create a place from Wikipedia"}
        </h3>
      </div>
      <p>
        {vi
          ? "Dán URL bài viết. AI sẽ điền thông tin và bài thuyết minh để bạn kiểm tra trước khi lưu nháp."
          : "Paste an article URL. AI fills in the place details and narration for you to review before saving a draft."}
      </p>
      <label className="field-label">
        {vi ? "URL Wikipedia" : "Wikipedia URL"}
        <input
          className="input"
          type="url"
          maxLength={2000}
          value={url}
          disabled={busy}
          placeholder="https://vi.wikipedia.org/wiki/..."
          onChange={(event) => setUrl(event.target.value)}
        />
      </label>
      <details className="wikipedia-languages">
        <summary>
          {vi
            ? `Ngôn ngữ thuyết minh (${selected.length})`
            : `Narration languages (${selected.length})`}
        </summary>
        <div className="wikipedia-language-options">
          {languages
            .filter((item) => item.enabled)
            .map((item) => (
              <label key={item.code}>
                <input
                  type="checkbox"
                  checked={selected.includes(item.code)}
                  disabled={busy || item.code === "vi"}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, item.code]
                        : current.filter((code) => code !== item.code),
                    )
                  }
                />
                {item.native_name}
                {item.required ? " *" : ""}
              </label>
            ))}
        </div>
      </details>
      <div className="wikipedia-import-actions">
        <button
          type="button"
          className="button primary"
          disabled={busy || !url.trim() || !status?.ready}
          onClick={generate}
        >
          {generating ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <BookOpen size={16} />
          )}
          {generating
            ? vi
              ? "Đang tạo nội dung…"
              : "Generating…"
            : vi
              ? "Tạo thông tin bằng AI"
              : "Generate place details"}
        </button>
        <span className="field-hint" role="status">
          {generating
            ? vi
              ? jobState === "queued"
                ? "Đang chờ máy AI nhận việc. Bạn có thể tải lại trang và tiếp tục chờ."
                : jobState === "reconnecting"
                  ? "Đang kết nối lại để lấy kết quả…"
                  : "Máy AI đang tạo bản nháp để quản trị viên kiểm tra…"
              : jobState === "queued"
                ? "Waiting for your AI computer. Reloading will resume this request."
                : "Generating a draft for administrator review…"
            : status
              ? status.ready
                ? vi
                  ? "Sẵn sàng"
                  : "Ready"
                : vi
                  ? "Máy AI chưa sẵn sàng; kiểm tra kết nối và model."
                  : "AI worker unavailable; check its connection and model."
              : vi
                ? "Đang kiểm tra AI local…"
                : "Checking local AI…"}
        </span>
        {!status?.ready && !busy && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              setError("");
              setRetry((value) => value + 1);
            }}
          >
            {vi ? "Kiểm tra lại" : "Check again"}
          </button>
        )}
      </div>
      <details>
        <summary>
          {vi ? "Chi tiết kỹ thuật AI" : "AI technical details"}
        </summary>
        <p>{status?.model || "—"}</p>
        {generating && jobTimings && (
          <p className="field-hint" role="status">
            {vi ? "Đã chờ" : "Queue wait"}:{" "}
            {Math.round(jobTimings.queue_wait_seconds ?? 0)}s
            {jobTimings.generation_seconds != null &&
              ` · ${vi ? "Đang xử lý" : "Processing"}: ${Math.round(jobTimings.generation_seconds)}s`}
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
