import { useEffect, useState } from "react";
import { BookOpen, LoaderCircle, Sparkles } from "lucide-react";
import { api } from "@quan1/api-client";
import type { Language, WikipediaDraft } from "@quan1/contracts";

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
  } | null>(null);
  const [selected, setSelected] = useState(
    languages
      .filter((item) => item.enabled && item.required)
      .map((item) => item.code),
  );
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
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
    setGenerating(true);
    onBusy(true);
    try {
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
      setGenerating(false);
      onBusy(false);
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
                  disabled={busy || item.required}
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
              ? "Có thể mất vài phút. Nhiều ngôn ngữ sẽ lâu hơn."
              : "This may take a few minutes. More languages take longer."
            : status
              ? `${status.model} · ${status.message}`
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
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
