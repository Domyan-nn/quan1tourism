import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Eye,
  FileCheck2,
  Headphones,
  History,
  ImagePlus,
  LoaderCircle,
  MapPin,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Volume2,
} from "lucide-react";
import { api, SourceAttribution, SpeechPlayer } from "@quan1/api-client";
import type {
  Audit,
  Category,
  Language,
  Locale,
  Poi,
  Release,
  User,
} from "@quan1/contracts";
import { Badge, Cover, Dialog, Loading } from "./components";
import { messages, type UiLocale } from "./i18n";
import { WikipediaImport } from "./WikipediaImport";

type Props = {
  initial: Poi | "new";
  categories: Category[];
  languages: Language[];
  user: User;
  locale: UiLocale;
  onClose: () => void;
  onSaved: (message: string) => void;
};
type HistoryData = { events: Audit[]; releases: Release[] };
const inputData = (p: Poi) => ({
  name: p.name,
  address: p.address,
  category_id: p.category_id,
  latitude: p.latitude,
  longitude: p.longitude,
  source: p.source ?? null,
  translations: Object.fromEntries(
    Object.entries(p.translations).map(([l, tr]) => [
      l,
      { title: tr.title, text: tr.text },
    ]),
  ),
  revision: p.revision,
});

export function Editor({
  initial,
  categories,
  languages,
  user,
  locale,
  onClose,
  onSaved,
}: Props) {
  const vi = locale === "vi",
    t = messages[locale];
  const initialPoi: Poi =
    initial === "new"
      ? {
          id: "",
          name: "",
          address: "",
          category_id: categories[0]?.id ?? "",
          latitude: null,
          longitude: null,
          source: null,
          status: "draft",
          revision: 1,
          updated_at: new Date().toISOString(),
          image_id: null,
          cover: 0,
          translations: Object.fromEntries(
            languages.map((language) => [
              language.code,
              { title: "", text: "", tts_ready: false },
            ]),
          ),
          has_published: false,
          note: "",
          is_demo: false,
        }
      : initial;
  const [saved, setSaved] = useState(initialPoi);
  const [form, setForm] = useState(initialPoi);
  const [step, setStep] = useState(
    initial !== "new" &&
      ["in_review", "approved", "archived"].includes(initial.status)
      ? 3
      : 0,
  );
  const [lang, setLang] = useState<Locale>("vi");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [preview, setPreview] = useState(false);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [confirm, setConfirm] = useState<"archive" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty =
    JSON.stringify(inputData(form)) !== JSON.stringify(inputData(saved));
  const locked = ["in_review", "archived"].includes(saved.status);
  const reviewer = user.role === "reviewer" || user.role === "admin";
  const enabledLanguages = languages.filter((language) => language.enabled);
  const languageCodes = enabledLanguages.map((language) => language.code);
  const translation = (code: string) =>
    form.translations[code] ?? { title: "", text: "", tts_ready: false };
  const languageName = (code: string) =>
    languages.find((language) => language.code === code)?.native_name ?? code;
  const checklistLanguages = enabledLanguages.filter(
    (language) =>
      language.required ||
      translation(language.code).title.trim() ||
      translation(language.code).text.trim(),
  );
  const ready =
    checklistLanguages.length > 0 &&
    checklistLanguages.every(
      ({ code }) =>
        translation(code).title.trim() && translation(code).text.trim(),
    );
  const steps = [
    {
      icon: MapPin,
      title: t.step1,
      short: vi ? "Tên, vị trí & ảnh" : "Name, location & photo",
    },
    {
      icon: BookOpen,
      title: t.step2,
      short: vi ? "Chọn ngôn ngữ & viết bài" : "Choose a language & write",
    },
    {
      icon: Headphones,
      title: t.step3,
      short: vi ? "Nghe thử từ văn bản" : "Listen to the text",
    },
    {
      icon: FileCheck2,
      title: t.step4,
      short: vi ? "Sẵn sàng đến du khách" : "Ready for your visitors",
    },
  ];

  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty || busy) e.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty, busy]);
  useEffect(() => {
    if (!saved.id) return;
    let ignore = false;
    api<HistoryData>(`/admin/pois/${saved.id}/history`)
      .then((h) => {
        if (!ignore) {
          setHistory(h);
          setHistoryError("");
        }
      })
      .catch((e) => {
        if (!ignore) setHistoryError(e.message);
      });
    return () => {
      ignore = true;
    };
  }, [saved.id, saved.revision]);

  function close() {
    if (busy) return;
    if (
      dirty &&
      !window.confirm(
        vi
          ? "Bạn có thay đổi chưa lưu. Đóng và bỏ các thay đổi này?"
          : "You have unsaved changes. Discard them and close?",
      )
    )
      return;
    onClose();
  }
  function update(key: keyof Poi, value: unknown) {
    setForm((p) => ({ ...p, [key]: value }));
    setFeedback("");
  }
  function updateTranslation(key: "title" | "text", value: string) {
    setForm((p) => ({
      ...p,
      translations: {
        ...p.translations,
        [lang]: {
          ...(p.translations[lang] ?? {
            title: "",
            text: "",
            tts_ready: false,
          }),
          [key]: value,
        },
      },
    }));
    setFeedback("");
  }
  function accept(p: Poi) {
    setSaved(p);
    setForm(p);
    onSaved(vi ? "Đã lưu nội dung." : "Content saved.");
  }
  async function persist(): Promise<Poi> {
    if (!form.name.trim() || !form.category_id)
      throw new Error(
        vi
          ? "Hãy nhập tên địa điểm và chọn danh mục trước."
          : "Enter the place name and choose a category first.",
      );
    if (!dirty && saved.id) return saved;
    const p = await api<Poi>(
      saved.id ? `/admin/pois/${saved.id}` : "/admin/pois",
      {
        method: saved.id ? "PUT" : "POST",
        body: JSON.stringify(inputData(form)),
      },
    );
    accept(p);
    return p;
  }
  async function save(next?: number) {
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      await persist();
      setFeedback(
        vi
          ? "Đã lưu bản nháp. Bạn có thể tiếp tục sau."
          : "Draft saved. You can continue later.",
      );
      if (next !== undefined) setStep(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function move(n: number) {
    if (busy) return;
    if (n <= step || locked) {
      setStep(n);
      return;
    }
    await save(n);
  }
  async function upload(file: File | undefined, kind: "image") {
    if (!file) return;
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const p = await persist();
      const body = new FormData();
      body.append("file", file);
      const result = await api<Poi>(
        `/admin/pois/${p.id}/upload?kind=${kind}&revision=${p.revision}`,
        { method: "POST", body },
      );
      accept(result);
      setFeedback(
        vi
          ? "Đã tải ảnh. Hãy kiểm tra trước khi gửi duyệt."
          : "File uploaded. Check it before submitting for review.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function action(type: string, releaseId?: string) {
    setBusy(true);
    setError("");
    setFeedback("");
    try {
      const p = dirty ? await persist() : saved;
      const result = await api<Poi>(`/admin/pois/${p.id}/actions`, {
        method: "POST",
        body: JSON.stringify({
          action: type,
          revision: p.revision,
          note,
          release_id: releaseId,
        }),
      });
      accept(result);
      setConfirm(null);
      setNote("");
      setFeedback(
        (
          {
            submit: vi
              ? "Đã gửi duyệt. Người duyệt sẽ kiểm tra trước khi xuất bản."
              : "Submitted. A reviewer will check the content.",
            approve: vi
              ? "Đã duyệt nội dung. Bạn có thể xuất bản khi sẵn sàng."
              : "Approved. Publish when ready.",
            publish: vi
              ? "Đã xuất bản. Du khách có thể xem và nghe nội dung này."
              : "Published. Visitors can now see and hear this content.",
            reject: vi
              ? "Đã gửi yêu cầu chỉnh sửa cho biên tập viên."
              : "Returned to the editor with feedback.",
            archive: vi
              ? "Đã lưu trữ. Địa điểm không còn xuất hiện trên trang du khách."
              : "Archived. The place is hidden from the visitor website.",
            restore: vi
              ? "Đã khôi phục thành bản nháp mới. Hãy kiểm tra và gửi duyệt lại."
              : "Restored as a new draft. Check and resubmit for review.",
          } as Record<string, string>
        )[type],
      );
      if (type === "restore") setStep(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const actionNames: Record<string, string> = {
    create: vi ? "Tạo địa điểm" : "Created",
    update: vi ? "Cập nhật bản nháp" : "Draft updated",
    upload: vi ? "Tải tệp lên" : "File uploaded",
    submit: vi ? "Gửi duyệt" : "Submitted",
    approve: vi ? "Duyệt nội dung" : "Approved",
    reject: vi ? "Yêu cầu chỉnh sửa" : "Changes requested",
    publish: vi ? "Xuất bản" : "Published",
    archive: vi ? "Lưu trữ" : "Archived",
    restore: vi ? "Khôi phục bản nháp" : "Draft restored",
  };

  return (
    <Dialog
      wide
      title={saved.id ? (vi ? "Biên tập địa điểm" : "Edit place") : t.add}
      onClose={close}
    >
      <div className="editor-layout">
        <aside className="editor-steps">
          <div className="editor-place">
            <Cover poi={form} />
            <strong>{form.name || (vi ? "Địa điểm mới" : "New place")}</strong>
            <Badge status={saved.status} t={t} />
          </div>
          <nav aria-label={vi ? "Các bước biên tập" : "Editing steps"}>
            {steps.map(({ icon: Icon, title, short }, i) => (
              <button
                key={title}
                className={`${step === i ? "active" : ""}`}
                onClick={() => move(i)}
                disabled={busy}
                aria-current={step === i ? "step" : undefined}
                aria-label={`${vi ? "Bước" : "Step"} ${i + 1}: ${title}`}
              >
                <span>
                  {i < step ? <Check size={17} /> : <Icon size={17} />}
                </span>
                <div>
                  <strong>{title}</strong>
                  <small>{short}</small>
                </div>
                {i === step && <ChevronRight size={14} />}
              </button>
            ))}
          </nav>
          <p className="editor-autosave">
            <ShieldCheck size={15} />
            {vi
              ? "Bản nháp chỉ hiển thị trong trang quản trị."
              : "Drafts are visible only to your team."}
          </p>
        </aside>
        <div className="editor-main">
          <div className="editor-body">
            <div className="editor-section-heading">
              <span className="eyebrow">
                {vi ? "BƯỚC" : "STEP"} {step + 1} / 4
              </span>
              <h2>{steps[step].title}</h2>
              <p>
                {[t.step1desc, t.step2desc, t.step3desc, t.step4desc][step]}
              </p>
            </div>
            {saved.is_demo && (
              <div className="notice info compact">
                <SparkleIcon />
                <span>{t.demoDesc}</span>
              </div>
            )}
            {saved.has_published && saved.status !== "published" && (
              <div className="notice info compact">
                <GlobeIcon />
                <span>
                  {vi
                    ? "Du khách tiếp tục xem bản đã xuất bản. Thay đổi mới chỉ xuất hiện sau khi được duyệt và xuất bản lại."
                    : "Visitors keep seeing the published version until these changes are approved and published."}
                </span>
              </div>
            )}
            {saved.note && (
              <div className="notice warning">
                <CircleAlert size={18} />
                <div>
                  <strong>
                    {vi ? "Ghi chú từ người duyệt" : "Reviewer feedback"}
                  </strong>
                  <p>{saved.note}</p>
                </div>
              </div>
            )}
            {error && (
              <div className="notice error" role="alert">
                <CircleAlert size={18} />
                <span>{error}</span>
              </div>
            )}
            {feedback && (
              <div className="notice success" role="status">
                <Check size={18} />
                <span>{feedback}</span>
              </div>
            )}
            {step === 0 && (
              <fieldset disabled={busy || locked} className="editor-fields">
                {!saved.id && (
                  <WikipediaImport
                    languages={languages}
                    vi={vi}
                    busy={busy}
                    onBusy={setBusy}
                    onApply={(result) => {
                      setForm((current) => ({
                        ...current,
                        ...result.draft,
                        translations: {
                          ...current.translations,
                          ...Object.fromEntries(
                            Object.entries(result.draft.translations).map(
                              ([code, tr]) => [
                                code,
                                { ...tr, tts_ready: true },
                              ],
                            ),
                          ),
                        },
                      }));
                      setFeedback(
                        vi
                          ? "AI đã điền thông tin. Hãy kiểm tra nguồn và bổ sung thông tin thiếu trước khi lưu nháp."
                          : "AI filled in the details. Review the sources and missing information before saving.",
                      );
                    }}
                  />
                )}
                {form.source && (
                  <div className="wikipedia-review">
                    <strong>
                      {vi
                        ? "Nội dung AI · Cần kiểm tra trước khi xuất bản"
                        : "AI draft · Review before publishing"}
                    </strong>
                    {form.source.warnings.length > 0 && (
                      <ul>
                        {form.source.warnings.map((warning, index) => (
                          <li key={index}>{warning}</li>
                        ))}
                      </ul>
                    )}
                    <SourceAttribution
                      source={form.source}
                      vi={vi}
                      imageUsed={!form.image_id}
                    />
                  </div>
                )}
                <label className="field-label">
                  {vi ? "Tên địa điểm" : "Place name"}{" "}
                  <span className="required">*</span>
                  <input
                    className="input"
                    autoFocus
                    required
                    maxLength={180}
                    value={form.name}
                    placeholder={
                      vi
                        ? "Ví dụ: Bưu điện Trung tâm"
                        : "e.g. Central Post Office"
                    }
                    onChange={(e) => update("name", e.target.value)}
                  />
                </label>
                <label className="field-label">
                  {vi ? "Danh mục" : "Category"}{" "}
                  <span className="required">*</span>
                  <select
                    className="input"
                    required
                    value={form.category_id}
                    onChange={(e) => update("category_id", e.target.value)}
                  >
                    <option value="">
                      {vi ? "Chọn danh mục" : "Choose a category"}
                    </option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-label">
                  {vi ? "Địa chỉ" : "Address"}
                  <input
                    className="input"
                    value={form.address}
                    maxLength={300}
                    onChange={(e) => update("address", e.target.value)}
                    placeholder={
                      vi ? "Số nhà, tên đường, khu vực" : "Street address"
                    }
                  />
                </label>
                <div className="field-label">
                  {vi ? "Ảnh đại diện" : "Cover image"}
                  <div className="image-upload">
                    <Cover poi={form} />
                    <div>
                      <label className="button secondary upload-label">
                        <ImagePlus size={16} />
                        {form.image_id
                          ? vi
                            ? "Đổi ảnh"
                            : "Change image"
                          : vi
                            ? "Chọn ảnh"
                            : "Choose an image"}
                        <input
                          ref={fileRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="sr-only"
                          onChange={(e) => upload(e.target.files?.[0], "image")}
                          disabled={busy || locked}
                        />
                      </label>
                      <small>
                        JPG, PNG, WebP · {vi ? "Tối đa" : "Up to"} 10 MB
                      </small>
                    </div>
                  </div>
                </div>
                <details className="location-details">
                  <summary>
                    <MapPin size={16} />
                    {vi ? "Vị trí trên bản đồ" : "Map coordinates"}
                    <small>{vi ? "Tùy chọn nâng cao" : "Advanced"}</small>
                  </summary>
                  <p className="field-hint">
                    {vi
                      ? "Nhập tọa độ chính xác để hỗ trợ định vị ở giai đoạn tiếp theo."
                      : "Enter accurate coordinates for location features in a later phase."}
                  </p>
                  <div className="two-fields">
                    <label className="field-label">
                      {vi ? "Vĩ độ" : "Latitude"}
                      <input
                        className="input"
                        type="number"
                        min={-90}
                        max={90}
                        step="any"
                        value={form.latitude ?? ""}
                        onChange={(e) =>
                          update(
                            "latitude",
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                          )
                        }
                      />
                    </label>
                    <label className="field-label">
                      {vi ? "Kinh độ" : "Longitude"}
                      <input
                        className="input"
                        type="number"
                        min={-180}
                        max={180}
                        step="any"
                        value={form.longitude ?? ""}
                        onChange={(e) =>
                          update(
                            "longitude",
                            e.target.value === ""
                              ? null
                              : Number(e.target.value),
                          )
                        }
                      />
                    </label>
                  </div>
                </details>
              </fieldset>
            )}
            {step === 1 && (
              <div className="editor-fields">
                <div
                  className="language-tabs"
                  role="tablist"
                  aria-label={t.language}
                >
                  {languageCodes.map((l) => (
                    <button
                      key={l}
                      role="tab"
                      aria-selected={lang === l}
                      className={lang === l ? "active" : ""}
                      onClick={() => setLang(l)}
                    >
                      <span className="lang-flag">{l.toUpperCase()}</span>
                      {languageName(l)}
                      {languages.find((language) => language.code === l)
                        ?.required
                        ? " *"
                        : ""}
                      {translation(l).text && <Check size={14} />}
                    </button>
                  ))}
                </div>
                <fieldset disabled={busy || locked}>
                  <label className="field-label">
                    {vi ? "Tiêu đề thuyết minh" : "Narration title"}{" "}
                    <span className="required">*</span>
                    <input
                      className="input"
                      value={translation(lang).title}
                      lang={lang}
                      dir={
                        languages.find((language) => language.code === lang)
                          ?.direction
                      }
                      maxLength={180}
                      onChange={(e) =>
                        updateTranslation("title", e.target.value)
                      }
                      placeholder={
                        lang === "vi"
                          ? "Tên địa điểm bằng tiếng Việt"
                          : languageName(lang)
                      }
                    />
                  </label>
                  <label className="field-label">
                    {vi ? "Bài thuyết minh" : "Narration text"}{" "}
                    <span className="required">*</span>
                    <textarea
                      className="input narration-input"
                      value={translation(lang).text}
                      lang={lang}
                      dir={
                        languages.find((language) => language.code === lang)
                          ?.direction
                      }
                      maxLength={30000}
                      onChange={(e) =>
                        updateTranslation("text", e.target.value)
                      }
                      placeholder={
                        lang === "vi"
                          ? "Kể câu chuyện về địa điểm này…"
                          : "Tell the story of this place…"
                      }
                    />
                  </label>
                  <div className="text-metadata">
                    <span>
                      {translation(lang).text.length.toLocaleString()} / 30.000{" "}
                      {vi ? "ký tự" : "characters"}
                    </span>
                    <span>
                      <Clock3 size={13} />
                      {vi ? "Khoảng" : "About"}{" "}
                      {Math.max(
                        1,
                        Math.ceil(
                          translation(lang).text.trim().split(/\s+/).length /
                            150,
                        ),
                      )}{" "}
                      {vi ? "phút đọc" : "min read"}
                    </span>
                  </div>
                </fieldset>
                <div className="writing-tip">
                  <BookOpen size={18} />
                  <p>
                    {vi
                      ? "Viết tự nhiên, câu ngắn, dễ nghe. Nội dung được lưu dưới dạng văn bản thuần để hiển thị an toàn cho du khách."
                      : "Use a natural voice and short sentences. Content is stored as plain text for safe display."}
                  </p>
                </div>
                <div className="automation-note">
                  <span>✧</span>
                  <p>
                    {vi
                      ? "Dịch tự động chưa được cấu hình. Bạn có thể nhập bản dịch thủ công ngay tại đây."
                      : "Automatic translation is not configured. You can enter translations manually here."}
                  </p>
                </div>
              </div>
            )}
            {step === 2 && (
              <div className="editor-fields">
                <p className="notice info">
                  {vi
                    ? "Giọng đọc tạo từ văn bản trên thiết bị. Ngôn ngữ có dấu * là bắt buộc; các bản dịch khác có thể bổ sung sau."
                    : "Speech is generated from text on the device. Languages marked * are required; other translations can be added later."}
                </p>
                {enabledLanguages
                  .filter(({ code }) => translation(code).text.trim())
                  .map((language) => (
                    <section className="tts-preview-card" key={language.code}>
                      <h3>{language.native_name}</h3>
                      <p>{translation(language.code).title}</p>
                      <SpeechPlayer
                        text={translation(language.code).text}
                        speechLocale={language.speech_locale}
                        uiLocale={locale}
                      />
                    </section>
                  ))}
                {!enabledLanguages.some(({ code }) =>
                  translation(code).text.trim(),
                ) && (
                  <p>
                    {vi
                      ? "Hãy nhập bài thuyết minh ở bước 2 để nghe thử."
                      : "Enter narration in step 2 to preview speech."}
                  </p>
                )}
              </div>
            )}
            {step === 3 && (
              <div className="editor-fields">
                <div className={`readiness ${ready ? "is-ready" : ""}`}>
                  <span>
                    {ready ? (
                      <ShieldCheck size={28} />
                    ) : (
                      <FileCheck2 size={28} />
                    )}
                  </span>
                  <div>
                    <h3>
                      {ready
                        ? vi
                          ? "Nội dung đã sẵn sàng"
                          : "Your content is ready"
                        : vi
                          ? "Còn một chút để hoàn thiện"
                          : "A few finishing touches"}
                    </h3>
                    <p>
                      {ready
                        ? vi
                          ? "Hãy xem trước và gửi nội dung cho người duyệt."
                          : "Preview the place and submit it for review."
                        : vi
                          ? "Hoàn thành các mục bên dưới trước khi gửi duyệt."
                          : "Complete the items below before submitting."}
                    </p>
                  </div>
                </div>
                {checklistLanguages.map(({ code: l }) => (
                  <div className="checklist-language" key={l}>
                    <h3>
                      <span className="lang-flag">{l.toUpperCase()}</span>
                      {languageName(l)}
                    </h3>
                    {[
                      {
                        ok:
                          !!translation(l).title.trim() &&
                          !!translation(l).text.trim(),
                        label: vi
                          ? "Tiêu đề và bài thuyết minh"
                          : "Title and narration text",
                        target: 1,
                      },
                    ].map((item) => (
                      <div className="checklist-item" key={item.label}>
                        <span className={item.ok ? "ready" : "missing"}>
                          {item.ok ? (
                            <Check size={16} />
                          ) : (
                            <CircleAlert size={16} />
                          )}
                        </span>
                        <span>{item.label}</span>
                        {!item.ok && (
                          <button
                            className="text-button"
                            onClick={() => {
                              setLang(l);
                              setStep(item.target);
                            }}
                          >
                            {vi ? "Bổ sung" : "Complete"}
                            <ArrowRight size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
                <button
                  className="button secondary full-width"
                  onClick={() => setPreview(true)}
                >
                  <Eye size={17} />
                  {vi ? "Xem trước như du khách" : "Preview as a visitor"}
                </button>
                {saved.status === "in_review" && !reviewer && (
                  <div className="notice info compact">
                    <Clock3 size={18} />
                    {vi
                      ? "Nội dung đã được gửi. Hãy chờ người duyệt kiểm tra."
                      : "Content submitted. Waiting for a reviewer."}
                  </div>
                )}
                {saved.status === "archived" && (
                  <button
                    className="button secondary full-width"
                    disabled={busy}
                    onClick={() => action("restore")}
                  >
                    <RotateCcw size={16} />
                    {vi ? "Mở lại thành bản nháp" : "Reopen as draft"}
                  </button>
                )}
                {saved.status === "published" && (
                  <a
                    className="button secondary full-width"
                    href={`http://127.0.0.1:5174/?poi=${encodeURIComponent(saved.id)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <GlobeIcon />
                    {t.openWeb}
                    <ArrowRight size={15} />
                  </a>
                )}
                {saved.status === "published" && reviewer && (
                  <button
                    className="text-button danger-text"
                    disabled={busy}
                    onClick={() => setConfirm("archive")}
                  >
                    {vi ? "Lưu trữ địa điểm" : "Archive place"}
                  </button>
                )}
                {saved.id && (
                  <details className="history-details">
                    <summary>
                      <History size={17} />
                      {vi
                        ? "Lịch sử & phiên bản phát hành"
                        : "History & published versions"}
                    </summary>
                    {historyError ? (
                      <div className="notice error" role="alert">
                        {historyError}
                      </div>
                    ) : !history ? (
                      <Loading text={t.loading} />
                    ) : (
                      <>
                        <div className="timeline">
                          {history.events.map((event) => (
                            <div key={event.id}>
                              <i />
                              <div>
                                <strong>
                                  {actionNames[event.action] ?? event.action}
                                </strong>
                                <p>
                                  {event.actor} ·{" "}
                                  {new Date(event.created_at).toLocaleString(
                                    vi ? "vi-VN" : "en-GB",
                                    { timeZone: "Asia/Bangkok" },
                                  )}
                                </p>
                                {event.detail &&
                                  !event.detail.startsWith("audio:") &&
                                  !event.detail.startsWith("image:") && (
                                    <small>{event.detail}</small>
                                  )}
                              </div>
                            </div>
                          ))}
                        </div>
                        {history.releases.map((release) => (
                          <div className="release-row" key={release.id}>
                            <span>
                              {vi ? "Phiên bản" : "Version"} {release.revision}
                              <small>
                                {new Date(
                                  release.created_at,
                                ).toLocaleDateString(vi ? "vi-VN" : "en-GB", {
                                  timeZone: "Asia/Bangkok",
                                })}
                              </small>
                            </span>
                            <button
                              className="button secondary small"
                              disabled={
                                busy ||
                                !["draft", "published", "archived"].includes(
                                  saved.status,
                                )
                              }
                              onClick={() => action("restore", release.id)}
                            >
                              <RotateCcw size={13} />
                              {vi ? "Tạo nháp từ bản này" : "Restore as draft"}
                            </button>
                          </div>
                        ))}
                      </>
                    )}
                  </details>
                )}
              </div>
            )}
          </div>
          <footer className="editor-footer">
            <span className="save-state">
              {busy ? (
                <>
                  <LoaderCircle className="spin" size={15} />
                  {t.saving}
                </>
              ) : dirty ? (
                <>
                  <span className="unsaved-dot" />
                  {vi ? "Có thay đổi chưa lưu" : "Unsaved changes"}
                </>
              ) : (
                <>
                  <Check size={15} />
                  {saved.id
                    ? vi
                      ? "Đã lưu"
                      : "Saved"
                    : vi
                      ? "Bản nháp mới"
                      : "New draft"}
                </>
              )}
            </span>
            <div>
              {step > 0 && (
                <button
                  className="button secondary back-button"
                  disabled={busy}
                  onClick={() => setStep(step - 1)}
                >
                  <ArrowLeft size={16} />
                  {vi ? "Quay lại" : "Back"}
                </button>
              )}
              {!locked && (
                <button
                  className="button secondary"
                  disabled={busy || (!dirty && !!saved.id)}
                  onClick={() => save()}
                >
                  <Save size={16} />
                  {t.save}
                </button>
              )}
              {step < 3 ? (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => (locked ? setStep(step + 1) : save(step + 1))}
                >
                  {locked ? (vi ? "Tiếp tục" : "Continue") : t.continue}
                  <ArrowRight size={16} />
                </button>
              ) : saved.status === "draft" ? (
                <button
                  className="button primary"
                  disabled={busy || !ready}
                  onClick={() => action("submit")}
                >
                  <Send size={16} />
                  {vi ? "Gửi duyệt" : "Submit for review"}
                </button>
              ) : saved.status === "in_review" && reviewer ? (
                <>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setConfirm("reject")}
                  >
                    {vi ? "Yêu cầu sửa" : "Request changes"}
                  </button>
                  <button
                    className="button primary"
                    disabled={busy || !ready}
                    onClick={() => action("approve")}
                  >
                    <Check size={16} />
                    {vi ? "Duyệt nội dung" : "Approve content"}
                  </button>
                </>
              ) : saved.status === "approved" && reviewer ? (
                <button
                  className="button primary"
                  disabled={busy || !ready || dirty}
                  onClick={() => action("publish")}
                >
                  <ShieldCheck size={16} />
                  {vi ? "Xuất bản" : "Publish"}
                </button>
              ) : (
                <button
                  className="button primary"
                  onClick={close}
                  disabled={busy}
                >
                  {vi ? "Hoàn tất" : "Done"}
                  <Check size={16} />
                </button>
              )}
            </div>
          </footer>
        </div>
      </div>
      {preview && (
        <Dialog
          title={vi ? "Bản xem trước · Chưa công khai" : "Preview · Private"}
          onClose={() => setPreview(false)}
        >
          <div className="visitor-preview">
            <Cover poi={form} large />
            <div className="language-tabs">
              {languageCodes.map((l) => (
                <button
                  className={lang === l ? "active" : ""}
                  key={l}
                  onClick={() => setLang(l)}
                >
                  {languageName(l)}
                </button>
              ))}
            </div>
            <h2>{translation(lang).title || form.name}</h2>
            <p className="muted">
              <MapPin size={14} />
              {form.address}
            </p>
            <SpeechPlayer
              key={lang}
              text={translation(lang).text}
              speechLocale={
                languages.find((language) => language.code === lang)
                  ?.speech_locale ?? lang
              }
              uiLocale={locale}
            />
            <p className="narration-text">
              {translation(lang).text ||
                (vi
                  ? "Chưa có thuyết minh cho ngôn ngữ này."
                  : "No narration in this language yet.")}
            </p>
          </div>
        </Dialog>
      )}
      {confirm && (
        <Dialog
          title={
            confirm === "reject"
              ? vi
                ? "Yêu cầu chỉnh sửa"
                : "Request changes"
              : vi
                ? "Lưu trữ địa điểm"
                : "Archive place"
          }
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <div className="dialog-content">
            <p>
              {confirm === "archive"
                ? vi
                  ? "Địa điểm sẽ được ẩn khỏi trang du khách. Bạn vẫn có thể xem lịch sử và mở lại bản nháp."
                  : "This place will be hidden from visitors. History remains available and you can reopen it as a draft."
                : vi
                  ? "Ghi rõ nội dung cần sửa để biên tập viên dễ dàng thực hiện."
                  : "Explain what needs changing so the editor can act on your feedback."}
            </p>
            {confirm === "reject" && (
              <label className="field-label">
                {vi ? "Lý do cần chỉnh sửa" : "What needs changing"}
                <textarea
                  className="input"
                  maxLength={2000}
                  autoFocus
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={4}
                />
              </label>
            )}
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            <div className="dialog-actions">
              <button
                className="button secondary"
                onClick={() => setConfirm(null)}
                disabled={busy}
              >
                {t.cancel}
              </button>
              <button
                className={`button ${confirm === "archive" ? "danger" : "primary"}`}
                disabled={busy || (confirm === "reject" && !note.trim())}
                onClick={() => action(confirm)}
              >
                {busy
                  ? t.saving
                  : confirm === "reject"
                    ? vi
                      ? "Gửi yêu cầu"
                      : "Send feedback"
                    : vi
                      ? "Lưu trữ"
                      : "Archive"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}
function SparkleIcon() {
  return <span aria-hidden="true">✧</span>;
}
function GlobeIcon() {
  return <ShieldCheck size={17} />;
}
