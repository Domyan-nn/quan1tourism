import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CircleAlert,
  Clock3,
  Eye,
  FileCheck2,
  History,
  ImagePlus,
  MapPin,
  RotateCcw,
  Save,
  ShieldCheck,
} from "lucide-react";
import {
  api,
  ApiError,
  uiMessage,
  SourceAttribution,
  SpeechPlayer,
  LocationEditor,
} from "@quan1/api-client";
import { getCategoryLabel } from "@quan1/contracts";
import type {
  Audit,
  Category,
  Language,
  Locale,
  NarrationReview,
  Poi,
  Release,
  User,
  WikipediaDraft,
} from "@quan1/contracts";
import { Badge, Cover, Dialog, Loading } from "./components";
import { messages, type UiLocale } from "./i18n";
import { WikipediaImport } from "./WikipediaImport";
import { NarrationTranslations } from "./NarrationTranslations";
import {
  displayedReviews,
  reviewLabel,
  sourceEdited,
} from "./narration-review";

type Props = {
  initial: Poi | "new";
  initialPreview?: boolean;
  categories: Category[];
  languages: Language[];
  user: User;
  locale: UiLocale;
  onClose: () => void;
  onSaved: (message: string) => void;
  onPersisted: (poi: Poi) => void;
  navigationGuard: RefObject<() => boolean>;
};
type HistoryData = { events: Audit[]; releases: Release[] };
const inputData = (p: Poi) => ({
  name: p.name,
  address: p.address,
  short_description: p.short_description ?? "",
  status: "draft",
  category_id: p.category_id,
  latitude: p.latitude,
  longitude: p.longitude,
  trigger_radius_m: p.trigger_radius_m ?? 100,
  auto_narration_enabled: p.auto_narration_enabled ?? false,
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
  initialPreview = false,
  categories,
  languages,
  user,
  locale,
  onClose,
  onSaved,
  onPersisted,
  navigationGuard,
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
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [saved, setSaved] = useState(initialPoi);
  const [form, setForm] = useState(initialPoi);
  const [step, setStep] = useState(
    initial !== "new" &&
      ["in_review", "approved", "archived"].includes(initial.status)
      ? 2
      : 0,
  );
  const [lang, setLang] = useState<Locale>("vi");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [proposalDirty, setProposalDirty] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [preview, setPreview] = useState(initialPreview);
  const [history, setHistory] = useState<HistoryData | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [confirm, setConfirm] = useState<"archive" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [confirmedReview, setConfirmedReview] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [savedAt, setSavedAt] = useState(
    initial === "new" ? "" : initial.updated_at,
  );
  const [method, setMethod] = useState<"manual" | "wikipedia">("manual");
  const [importPreview, setImportPreview] = useState<WikipediaDraft | null>(
    null,
  );
  const [sourceVerified, setSourceVerified] = useState(false);
  const [generateTarget, setGenerateTarget] = useState("en");
  const [generateFailed, setGenerateFailed] = useState(false);
  const [duplicates, setDuplicates] = useState<
    { id: string; name: string; address: string }[]
  >([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadAttempt = useRef<{
    id: string;
    poiId: string;
    revision: number;
    file: File;
  } | null>(null);
  const dirty =
    !!imageFile ||
    form.status !== saved.status ||
    JSON.stringify(inputData(form)) !== JSON.stringify(inputData(saved));
  const locked = user.role !== "admin";
  const reviewer = user.role === "reviewer" || user.role === "admin";
  const administrator = user.role === "admin";
  const enabledLanguages = languages.filter((language) => language.enabled);
  const languageCodes = enabledLanguages.map((language) => language.code);
  const translation = (code: string) =>
    form.translations[code] ?? { title: "", text: "", tts_ready: false };
  const narrationReviews = displayedReviews(form, saved);
  const syncReviews = useCallback(
    (
      reviews: Record<string, NarrationReview>,
      revision: number,
      poiId: string,
    ) => {
      setSaved((current) =>
        current.revision === revision && current.id === poiId
          ? { ...current, narration_review: reviews }
          : current,
      );
      setForm((current) =>
        current.revision === revision && current.id === poiId
          ? { ...current, narration_review: reviews }
          : current,
      );
    },
    [],
  );
  const languageName = (code: string) =>
    languages.find((language) => language.code === code)?.native_name ?? code;
  const checklistLanguages = enabledLanguages.filter(
    (language) =>
      language.required ||
      translation(language.code).title.trim() ||
      translation(language.code).text.trim(),
  );
  const categoryReady = categories.some((c) => c.id === form.category_id);
  const basicReady = Boolean(
    form.name.trim() && form.address.trim() && categoryReady,
  );
  const locationReady =
    (form.latitude === null) === (form.longitude === null) &&
    (form.latitude === null ||
      (Number.isFinite(form.latitude) && Math.abs(form.latitude) <= 90)) &&
    (form.longitude === null ||
      (Number.isFinite(form.longitude) && Math.abs(form.longitude) <= 180)) &&
    Number.isInteger(form.trigger_radius_m ?? 100) &&
    (form.trigger_radius_m ?? 100) >= 20 &&
    (form.trigger_radius_m ?? 100) <= 1000 &&
    (!form.auto_narration_enabled || form.latitude !== null);
  const narrationReady = checklistLanguages.every(
    ({ code }) =>
      translation(code).title.trim() && translation(code).text.trim(),
  );
  const ready = basicReady && locationReady && narrationReady;
  const saveState = busy
    ? t.saving
    : error
      ? vi
        ? "Lưu chưa hoàn tất — xem thông báo"
        : "Save incomplete — see message"
      : proposalDirty
        ? vi
          ? "Đề xuất AI đã sửa — dùng bản này để lưu"
          : "AI proposal edited — apply this version to save"
        : dirty
          ? vi
            ? "Có thay đổi chưa lưu"
            : "Unsaved changes"
          : !saved.id
            ? vi
              ? "Chưa lưu địa điểm mới"
              : "New place has not been saved"
            : `${vi ? "Đã lưu lúc" : "Saved at"} ${new Date(savedAt || saved.updated_at).toLocaleTimeString(vi ? "vi-VN" : "en-GB", { timeZone: "Asia/Bangkok" })}`;
  const steps = [
    {
      icon: MapPin,
      title: t.step1,
      short: vi ? "Tên, vị trí & ảnh" : "Name, location & photo",
    },
    {
      icon: BookOpen,
      title: vi ? "Thuyết minh" : "Narration",
      short: vi ? "Chọn ngôn ngữ & viết bài" : "Choose a language & write",
    },
    {
      icon: FileCheck2,
      title: vi ? "Kiểm tra & công bố" : "Review & publish",
      short: vi ? "Sẵn sàng đến du khách" : "Ready for your visitors",
    },
  ];

  useEffect(() => {
    if (!imageFile) {
      setImagePreview("");
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);
  useEffect(() => {
    setConfirmedReview(false);
  }, [saved.id, saved.revision]);
  useEffect(() => {
    if (saved.id || !form.name.trim()) {
      setDuplicates([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api<{ items: typeof duplicates }>("/admin/pois/check-duplicates", {
        method: "POST",
        body: JSON.stringify(inputData(form)),
        signal: controller.signal,
      })
        .then((result) => {
          if (!controller.signal.aborted) setDuplicates(result.items);
        })
        .catch(() => {
          /* Saving always checks again on the server. */
        });
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [saved.id, form.name, form.source]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty || proposalDirty || busy) e.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirty, proposalDirty, busy]);
  useEffect(() => {
    navigationGuard.current = () =>
      !busy &&
      (!(dirty || proposalDirty) ||
        window.confirm(
          vi
            ? "Bạn có thay đổi chưa lưu. Rời trang và bỏ các thay đổi này?"
            : "You have unsaved changes. Leave and discard them?",
        ));
    return () => {
      navigationGuard.current = () => true;
    };
  }, [dirty, proposalDirty, busy, vi, navigationGuard]);
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
    if (!navigationGuard.current()) return;
    onClose();
  }
  function focusField(target: number, id: string, code?: string) {
    setStep(target);
    if (code) setLang(code);
    requestAnimationFrame(() => {
      const field = document.getElementById(id);
      if (field) {
        const details = field.closest("details");
        if (details) details.open = true;
        if (id === "place-location") {
          const location = field.querySelector("details");
          if (location) location.open = true;
        }
        field.scrollIntoView({ block: "center" });
        field.focus({ preventScroll: true });
      }
    });
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
    setSavedAt(new Date().toISOString());
    onPersisted(p);
    onSaved(vi ? "Đã lưu nội dung." : "Content saved.");
  }
  async function persist(): Promise<Poi> {
    setAttempted(true);
    if (!basicReady || !locationReady) {
      focusField(
        0,
        !form.name.trim()
          ? "place-name"
          : !categoryReady
            ? "place-category"
            : !form.address.trim()
              ? "place-address"
              : "place-location",
      );
      throw new Error(
        vi
          ? "Kiểm tra tên, danh mục, địa chỉ và cấu hình vị trí bên dưới. Dữ liệu đang nhập được giữ lại."
          : "Check the name, category, address and location settings below. Your edits are preserved.",
      );
    }
    if (!dirty && saved.id) return saved;
    let p = saved;
    let pendingImage = imageFile;
    const checkpoint = (value: Poi) => {
      setSaved(value);
      setSavedAt(new Date().toISOString());
      onPersisted(value);
      setForm((current) => ({
        ...current,
        id: value.id,
        revision: value.revision,
        image_id: value.image_id,
        has_published: value.has_published,
        narration_meta: value.narration_meta,
        narration_review: value.narration_review,
      }));
    };
    const sendImage = async () => {
      const attempt = uploadAttempt.current!;
      const body = new FormData();
      body.append("file", attempt.file);
      try {
        p = await api<Poi>(
          `/admin/pois/${attempt.poiId}/upload?kind=image&revision=${attempt.revision}&upload_id=${attempt.id}`,
          { method: "POST", body },
        );
      } catch (error) {
        const cause = error as ApiError;
        if (cause.status === 409) setConflict(true);
        const message =
          cause.status === 409
            ? vi
              ? "Thông tin đã lưu; phiên bản đã thay đổi. Dữ liệu đang nhập và ảnh được giữ lại. Mở lại địa điểm để đối chiếu trước khi lưu tiếp."
              : "Information was saved; the revision changed. Your form and image are preserved. Reopen the place and compare before saving again."
            : cause.status === 0 ||
                (cause.status >= 500 && cause.status !== 503)
              ? vi
                ? "Thông tin đã lưu; chưa xác nhận ảnh tải lên. Bấm Lưu thay đổi để kiểm tra và thử lại ảnh."
                : "Information was saved; the image upload is unconfirmed. Save changes to check and retry the image."
              : vi
                ? "Thông tin đã lưu, ảnh chưa tải lên. Bấm Lưu thay đổi để thử lại ảnh."
                : "Information was saved, but the image was not uploaded. Save changes to retry the image.";
        throw new Error(`${message} ${cause.message}`);
      }
      checkpoint(p);
      // A later visibility failure must never upload an already saved image again.
      setImageFile(null);
      uploadAttempt.current = null;
      pendingImage = null;
    };
    // Resolve an uncertain upload before writing further form edits. The same
    // upload ID lets the backend acknowledge an earlier committed request.
    if (uploadAttempt.current) await sendImage();
    const content = (value: Poi) =>
      JSON.stringify({ ...inputData(value), status: "draft", revision: 0 });
    if (!p.id || content(form) !== content(p)) {
      p = await api<Poi>(p.id ? `/admin/pois/${p.id}` : "/admin/pois", {
        method: p.id ? "PUT" : "POST",
        body: JSON.stringify({
          ...inputData(form),
          revision: p.revision,
          ...(pendingImage ? { status: "draft" } : {}),
        }),
      });
      checkpoint(p);
    }
    if (pendingImage) {
      uploadAttempt.current = {
        id: crypto.randomUUID().replaceAll("-", ""),
        poiId: p.id,
        revision: p.revision,
        file: pendingImage,
      };
      await sendImage();
    }
    accept(p);
    return p;
  }
  async function save(next?: number) {
    setBusy(true);
    setError("");
    setConflict(false);
    setFeedback("");
    try {
      await persist();
      setFeedback(vi ? "Đã lưu thay đổi." : "Changes saved.");
      if (next !== undefined) setStep(next);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setConflict(true);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveAndGenerate() {
    setBusy(true);
    setError("");
    setFeedback("");
    let persisted = false;
    try {
      const poi = await persist();
      persisted = true;
      const ai = await api<{ ready: boolean }>("/admin/ai/status");
      if (!ai.ready)
        throw new Error(
          vi
            ? "Worker chưa kết nối. Kết nối worker rồi thử lại."
            : "The worker is unavailable. Connect it and retry.",
        );
      await api(`/admin/pois/${poi.id}/narration-jobs`, {
        method: "POST",
        body: JSON.stringify({
          revision: poi.revision,
          language_codes: [generateTarget],
          confirmed_source: sourceVerified,
          replace_existing: false,
        }),
      });
      setGenerateFailed(false);
      setLang(generateTarget);
      setFeedback(
        vi
          ? "Đã lưu nháp và tạo tác vụ AI. Theo dõi ngôn ngữ đã chọn bên dưới."
          : "Draft saved and AI job queued. Follow the selected language below.",
      );
    } catch (e) {
      setGenerateFailed(persisted);
      setError(
        `${persisted ? (vi ? "Đã lưu nháp, chưa tạo được tác vụ AI. Thử lại chỉ tạo tác vụ cho địa điểm đã lưu. " : "Draft saved, but the AI job could not be queued. Retry uses the saved place. ") : ""}${(e as Error).message}`,
      );
    } finally {
      setBusy(false);
    }
  }
  function upload(file: File | undefined, _kind: "image") {
    if (!file) return;
    setError("");
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 10 * 1024 * 1024
    ) {
      setError(
        vi
          ? "Chọn JPG, PNG hoặc WebP, tối đa 10 MB."
          : "Choose JPG, PNG or WebP up to 10 MB.",
      );
      return;
    }
    if (uploadAttempt.current) {
      setError(
        vi
          ? "Lần tải ảnh trước chưa được xác nhận. Bấm Lưu thay đổi để kiểm tra trước khi chọn ảnh khác."
          : "The previous image upload is unconfirmed. Save changes to check it before choosing another image.",
      );
      return;
    }
    setImageFile(file);
    setFeedback(
      vi
        ? "Ảnh sẽ được tải lên khi lưu thay đổi."
        : "The image will upload when you save changes.",
    );
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
          confirmed_review: type === "approve" && confirmedReview,
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
    ai_supplement: vi ? "Tạo tác vụ thuyết minh AI" : "AI narration queued",
    ai_translation_save: vi
      ? "Áp dụng bản AI vào nháp"
      : "AI proposal saved to draft",
    ai_translation_discard: vi ? "Bỏ đề xuất AI" : "AI proposal discarded",
  };

  return (
    <div className="editor-page">
      <header className="editor-page-header">
        <button className="button secondary" onClick={close} disabled={busy}>
          <ArrowLeft size={17} />
          {vi ? "Quay lại danh sách" : "Back to list"}
        </button>
        <div>
          <h1>{saved.id ? form.name : t.add}</h1>
          <div className="editor-page-meta">
            <Badge status={saved.status} t={t} />
            <span>
              {saved.id
                ? `${vi ? "Bản biên tập" : "Editorial revision"} ${saved.revision}`
                : vi
                  ? "Bản mới chưa lưu"
                  : "Unsaved new place"}
            </span>
          </div>
        </div>
        <span className="save-state" role="status">
          {saveState}
        </span>
      </header>
      <nav
        className="editor-page-tabs"
        role="tablist"
        aria-label={vi ? "Biên tập địa điểm" : "Place editor"}
      >
        {steps.map(({ icon: Icon, title }, i) => (
          <button
            key={i}
            id={`editor-tab-${i}`}
            role="tab"
            aria-selected={step === i}
            aria-controls={`editor-panel-${i}`}
            tabIndex={step === i ? 0 : -1}
            onKeyDown={(event) => {
              if (
                ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              ) {
                event.preventDefault();
                const target =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? 2
                      : (step + (event.key === "ArrowRight" ? 1 : 2)) % 3;
                setStep(target);
                document.getElementById(`editor-tab-${target}`)?.focus();
              }
            }}
            onClick={() => setStep(i)}
          >
            <Icon size={18} />
            {title}
            {((i === 0 && (!basicReady || !locationReady)) ||
              (i === 1 && !narrationReady) ||
              (i === 2 && !ready)) && (
              <span aria-label={vi ? "Thiếu thông tin" : "Missing information"}>
                !
              </span>
            )}
          </button>
        ))}
      </nav>
      <div className="editor-main">
        <div className="editor-body">
          {saved.is_demo && (
            <div className="notice info compact">
              <SparkleIcon />
              <span>{t.demoDesc}</span>
            </div>
          )}
          <div className="notice info compact" role="status">
            <FileCheck2 size={18} />
            <span>
              {dirty
                ? vi
                  ? "Đang sửa thay đổi chưa lưu."
                  : "Editing unsaved changes."
                : vi
                  ? `Đang xem bản đã lưu · phiên bản ${saved.revision}.`
                  : `Viewing saved content · revision ${saved.revision}.`}{" "}
              {saved.has_published
                ? vi
                  ? "Du khách đang xem phiên bản đã công bố gần nhất."
                  : "Visitors see the most recently published version."
                : vi
                  ? "Chưa có bản công khai. Lưu nháp, gửi duyệt và công bố tại tab cuối."
                  : "No public version exists. Save a draft, submit for review and publish in the final tab."}
            </span>
          </div>
          {saved.has_published && (saved.status !== "published" || dirty) && (
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
          {duplicates.length > 0 && (
            <div className="notice error" role="alert">
              <strong>
                {vi ? "Địa điểm đã tồn tại" : "Place already exists"}
              </strong>
              {duplicates.map((item) => (
                <p key={item.id}>
                  {item.name} · {item.address}
                </p>
              ))}
              <p>
                {vi
                  ? "Đóng biểu mẫu và mở địa điểm hiện có để kiểm tra, chỉnh sửa."
                  : "Close this form and open the existing place to review or edit it."}
              </p>
            </div>
          )}
          {error && (
            <div className="notice error" role="alert">
              <CircleAlert size={18} />
              <span>
                {uiMessage(error, vi ? "vi" : "en")}
                {conflict && saved.id && (
                  <a
                    className="text-button"
                    href={`#places/${encodeURIComponent(saved.id)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {vi
                      ? "Mở bản đã lưu trong tab mới để đối chiếu"
                      : "Open the saved version in a new tab to compare"}
                  </a>
                )}
              </span>
            </div>
          )}
          {feedback && (
            <div className="notice success" role="status">
              <Check size={18} />
              <span>{uiMessage(feedback, vi ? "vi" : "en", "success")}</span>
            </div>
          )}
          <section
            hidden={step !== 0}
            id="editor-panel-0"
            role="tabpanel"
            aria-labelledby="editor-tab-0"
          >
            <fieldset disabled={busy || locked} className="editor-fields">
              {!saved.id && (
                <div className="creation-methods">
                  <div
                    className="creation-method-buttons"
                    role="group"
                    aria-label={vi ? "Cách thêm địa điểm" : "Creation method"}
                  >
                    <button
                      className="button secondary"
                      aria-pressed={method === "manual"}
                      onClick={() => setMethod("manual")}
                    >
                      {vi ? "Nhập thủ công" : "Enter manually"}
                    </button>
                    <button
                      className="button secondary"
                      aria-pressed={method === "wikipedia"}
                      onClick={() => setMethod("wikipedia")}
                    >
                      {vi ? "Tạo từ Wikipedia" : "Create from Wikipedia"}
                    </button>
                  </div>
                  <p className="field-hint">
                    {vi
                      ? "Chỉ cần tên, danh mục và địa chỉ để lưu nháp. Ảnh, vị trí và thuyết minh có thể thêm sau. Bản chưa lưu và file ảnh không được khôi phục sau khi tải lại."
                      : "Save a draft with a name, category and address. Add an image, location and narration later. Unsaved forms and image files cannot be restored after reloading."}
                  </p>
                  <div hidden={method !== "wikipedia"}>
                    <WikipediaImport
                      languages={languages}
                      vi={vi}
                      busy={importing}
                      onBusy={setImporting}
                      onApply={setImportPreview}
                    />
                    {importPreview && (
                      <div className="wikipedia-review">
                        <h3>
                          {vi
                            ? "Xem trước thông tin Wikipedia"
                            : "Wikipedia preview"}
                        </h3>
                        <p>
                          <strong>{importPreview.draft.name}</strong> ·{" "}
                          {importPreview.draft.address ||
                            (vi ? "Chưa có địa chỉ" : "Address missing")}
                        </p>
                        <p>
                          {vi ? "Danh mục" : "Category"}:{" "}
                          {getCategoryLabel(
                            categories.find(
                              (c) => c.id === importPreview.draft.category_id,
                            ),
                            locale,
                          ) || (vi ? "Cần chọn danh mục" : "Choose a category")}
                        </p>
                        <p>
                          {vi ? "Tọa độ" : "Coordinates"}:{" "}
                          {importPreview.draft.latitude != null &&
                          importPreview.draft.longitude != null
                            ? `${importPreview.draft.latitude}, ${importPreview.draft.longitude}`
                            : vi
                              ? "Chưa có tọa độ"
                              : "No coordinates"}
                        </p>
                        <details>
                          <summary>
                            {vi
                              ? "Bài AI sẽ áp dụng"
                              : "AI narrations to apply"}{" "}
                            (
                            {
                              Object.keys(importPreview.draft.translations)
                                .length
                            }
                            )
                          </summary>
                          {Object.entries(importPreview.draft.translations).map(
                            ([code, tr]) => (
                              <section key={code}>
                                <h4>{languageName(code)}</h4>
                                <p
                                  lang={code}
                                  dir={
                                    languages.find((l) => l.code === code)
                                      ?.direction
                                  }
                                >
                                  <strong>{tr.title}</strong>
                                </p>
                                <p
                                  className="narration-text"
                                  lang={code}
                                  dir={
                                    languages.find((l) => l.code === code)
                                      ?.direction
                                  }
                                >
                                  {tr.text}
                                </p>
                              </section>
                            ),
                          )}
                        </details>
                        <SourceAttribution
                          source={importPreview.draft.source}
                          vi={vi}
                        />
                        <p>
                          {vi
                            ? "Áp dụng sẽ thay tên, địa chỉ, danh mục, tọa độ, nguồn và các bài AI bên trên. Các ngôn ngữ khác và ảnh đang chọn được giữ lại."
                            : "Applying replaces the name, address, category, coordinates, source and the AI narrations shown above. Other languages and the selected image are preserved."}
                        </p>
                        <button
                          className="button primary"
                          onClick={() => {
                            if (
                              (form.name.trim() ||
                                form.address.trim() ||
                                form.latitude !== null ||
                                form.longitude !== null ||
                                form.category_id !== saved.category_id ||
                                Object.values(form.translations).some(
                                  (tr) => tr.title || tr.text,
                                )) &&
                              !window.confirm(
                                vi
                                  ? "Thay các trường hiện có bằng bản xem trước Wikipedia?"
                                  : "Replace existing fields with this Wikipedia preview?",
                              )
                            )
                              return;
                            setForm((current) => ({
                              ...current,
                              ...importPreview.draft,
                              auto_narration_enabled: Boolean(
                                importPreview.draft.latitude != null &&
                                importPreview.draft.longitude != null &&
                                current.auto_narration_enabled,
                              ),
                              translations: {
                                ...current.translations,
                                ...Object.fromEntries(
                                  Object.entries(
                                    importPreview.draft.translations,
                                  ).map(([code, tr]) => [
                                    code,
                                    {
                                      ...tr,
                                      tts_ready: Boolean(tr.title && tr.text),
                                    },
                                  ]),
                                ),
                              },
                            }));
                            setImportPreview(null);
                            setFeedback(
                              vi
                                ? "Đã điền bản nháp từ Wikipedia. Kiểm tra các trường trước khi lưu."
                                : "Wikipedia details applied to the form. Review the fields before saving.",
                            );
                          }}
                        >
                          {vi ? "Dùng thông tin này" : "Use these details"}
                        </button>
                        <button
                          className="button secondary"
                          onClick={() => setImportPreview(null)}
                        >
                          {vi ? "Bỏ đề xuất" : "Discard proposal"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
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
                  id="place-name"
                  aria-label={vi ? "Tên địa điểm" : "Place name"}
                  aria-invalid={attempted && !form.name.trim()}
                  aria-describedby={
                    attempted && !form.name.trim()
                      ? "place-name-error"
                      : undefined
                  }
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
                {attempted && !form.name.trim() && (
                  <small id="place-name-error" className="field-error">
                    {vi ? "Nhập tên địa điểm." : "Enter a place name."}
                  </small>
                )}
              </label>
              <label className="field-label">
                {vi ? "Danh mục" : "Category"}{" "}
                <span className="required">*</span>
                <select
                  id="place-category"
                  aria-label={vi ? "Danh mục" : "Category"}
                  aria-invalid={attempted && !categoryReady}
                  aria-describedby={
                    attempted && !categoryReady
                      ? "place-category-error"
                      : undefined
                  }
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
                      {getCategoryLabel(c, locale)}
                    </option>
                  ))}
                </select>
                {attempted && !categoryReady && (
                  <small id="place-category-error" className="field-error">
                    {vi ? "Chọn danh mục." : "Choose a category."}
                  </small>
                )}
              </label>
              <label className="field-label">
                {vi ? "Địa chỉ" : "Address"}
                <input
                  id="place-address"
                  aria-label={vi ? "Địa chỉ" : "Address"}
                  aria-invalid={attempted && !form.address.trim()}
                  aria-describedby={
                    attempted && !form.address.trim()
                      ? "place-address-error"
                      : undefined
                  }
                  required
                  className="input"
                  value={form.address}
                  maxLength={300}
                  onChange={(e) => update("address", e.target.value)}
                  placeholder={
                    vi ? "Số nhà, tên đường, khu vực" : "Street address"
                  }
                />
                {attempted && !form.address.trim() && (
                  <small id="place-address-error" className="field-error">
                    {vi ? "Nhập địa chỉ." : "Enter an address."}
                  </small>
                )}
              </label>
              <label className="field-label">
                {vi ? "Mô tả ngắn" : "Short description"}
                <textarea
                  className="input"
                  rows={3}
                  aria-label={vi ? "Mô tả ngắn" : "Short description"}
                  maxLength={2000}
                  value={form.short_description ?? ""}
                  onChange={(event) =>
                    update("short_description", event.target.value)
                  }
                />
              </label>
              <div className="field-label">
                {vi ? "Ảnh đại diện" : "Cover image"}
                <div className="image-upload">
                  {imagePreview ? (
                    <img
                      className="staged-image"
                      src={imagePreview}
                      alt={form.name}
                    />
                  ) : (
                    <Cover poi={form} />
                  )}
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
              <div id="place-location" tabIndex={-1}>
                {attempted && !locationReady && (
                  <p className="field-error" role="alert">
                    {vi
                      ? "Nhập cặp tọa độ hợp lệ, bán kính nguyên từ 20–1000 m. Tự thuyết minh cần tọa độ."
                      : "Enter a valid coordinate pair and an integer radius of 20–1000 m. Automatic narration requires coordinates."}
                  </p>
                )}
                <LocationEditor
                  value={form}
                  saved={saved}
                  vi={vi}
                  disabled={busy || locked}
                  onChange={(point) =>
                    setForm((current) => ({ ...current, ...point }))
                  }
                />
              </div>
            </fieldset>
          </section>
          <section
            hidden={step !== 1}
            id="editor-panel-1"
            role="tabpanel"
            aria-labelledby="editor-tab-1"
          >
            <p className="language-review-legend">
              {vi
                ? "✓ Admin đã duyệt nội dung hiện tại · ○ Có nội dung chưa duyệt · * Ngôn ngữ bắt buộc"
                : "✓ Current content approved by an administrator · ○ Content awaiting review · * Required language"}
            </p>
            <div className="narration-workspace">
              <div
                className="language-tabs"
                role="tablist"
                aria-label={t.language}
                aria-orientation="vertical"
              >
                {languageCodes.map((code, index) => (
                  <button
                    key={code}
                    id={`language-tab-${code}`}
                    role="tab"
                    aria-selected={lang === code}
                    aria-controls="narration-panel"
                    tabIndex={lang === code ? 0 : -1}
                    title={reviewLabel(narrationReviews[code], vi)}
                    className={lang === code ? "active" : ""}
                    onKeyDown={(event) => {
                      if (
                        ["ArrowDown", "ArrowUp", "Home", "End"].includes(
                          event.key,
                        )
                      ) {
                        event.preventDefault();
                        const target =
                          event.key === "Home"
                            ? 0
                            : event.key === "End"
                              ? languageCodes.length - 1
                              : (index +
                                  (event.key === "ArrowDown"
                                    ? 1
                                    : languageCodes.length - 1)) %
                                languageCodes.length;
                        setLang(languageCodes[target]);
                        document
                          .getElementById(
                            `language-tab-${languageCodes[target]}`,
                          )
                          ?.focus();
                      }
                    }}
                    onClick={() => setLang(code)}
                  >
                    <span className="lang-flag">{code.toUpperCase()}</span>
                    {languageName(code)}
                    {languages.find((l) => l.code === code)?.required
                      ? " *"
                      : ""}
                    <span className="language-review-symbol" aria-hidden="true">
                      {narrationReviews[code]?.state === "approved"
                        ? "✓"
                        : narrationReviews[code]?.state === "pending"
                          ? "○"
                          : ""}
                    </span>
                    <span className="sr-only">
                      {reviewLabel(narrationReviews[code], vi)}
                    </span>
                  </button>
                ))}
              </div>
              <div
                className="narration-active"
                id="narration-panel"
                role="tabpanel"
                aria-labelledby={`language-tab-${lang}`}
              >
                <h2>{languageName(lang)}</h2>
                <p className="narration-review-status">
                  {reviewLabel(narrationReviews[lang], vi)}
                </p>
                {lang !== "vi" &&
                  (sourceEdited(form, saved) ||
                    saved.narration_meta?.[lang]?.stale) && (
                    <p className="notice warning">
                      {vi
                        ? "Nguồn đã thay đổi. Kiểm tra lại bản dịch này trước khi duyệt; nội dung được giữ nguyên."
                        : "The source changed. Recheck this translation before approval; existing text is preserved."}
                    </p>
                  )}
                {lang === "vi" && (
                  <p className="notice info compact">
                    {vi
                      ? "Bài nguồn tiếng Việt — AI dùng bản đã lưu để tạo bản dịch. Thay đổi nguồn sẽ đánh dấu các bản dịch liên quan cần kiểm tra lại; nội dung cũ được giữ."
                      : "Vietnamese source — AI translates the saved version. Source changes mark affected translations for review and preserve existing text."}
                  </p>
                )}
                <fieldset disabled={busy || locked}>
                  <label className="field-label">
                    {vi ? "Tiêu đề thuyết minh" : "Narration title"}
                    <input
                      id="narration-title"
                      className="input"
                      value={translation(lang).title}
                      lang={lang}
                      dir={languages.find((l) => l.code === lang)?.direction}
                      maxLength={180}
                      onChange={(e) =>
                        updateTranslation("title", e.target.value)
                      }
                    />
                  </label>
                  <label className="field-label">
                    {vi ? "Bài thuyết minh" : "Narration text"}
                    <textarea
                      id="narration-text"
                      aria-label={vi ? "Bài thuyết minh" : "Narration text"}
                      className="input narration-input"
                      value={translation(lang).text}
                      lang={lang}
                      dir={languages.find((l) => l.code === lang)?.direction}
                      maxLength={30000}
                      onChange={(e) =>
                        updateTranslation("text", e.target.value)
                      }
                    />
                  </label>
                </fieldset>
                <p className="field-hint">
                  {translation(lang).text.length.toLocaleString(locale)}{" "}
                  {vi ? "ký tự" : "characters"}
                </p>
                <SpeechPlayer
                  key={lang}
                  text={translation(lang).text}
                  speechLocale={
                    languages.find((l) => l.code === lang)?.speech_locale ??
                    lang
                  }
                  uiLocale={locale}
                />
                {administrator && saved.id && (
                  <NarrationTranslations
                    poi={saved}
                    languages={languages}
                    activeLocale={lang}
                    onDraftChange={setProposalDirty}
                    onBusy={setBusy}
                    vi={vi}
                    disabled={dirty || busy}
                    onApplied={accept}
                    reviews={narrationReviews}
                    onReviewChange={syncReviews}
                  />
                )}
                {administrator && (!saved.id || generateFailed) && (
                  <div className="save-generate">
                    <p>
                      {vi
                        ? "Lưu nguồn trước khi tạo một ngôn ngữ bằng hàng đợi AI hiện có."
                        : "Save the source before generating one language through the existing AI queue."}
                    </p>
                    <label className="field-label">
                      {vi ? "Ngôn ngữ cần tạo" : "Target language"}
                      <select
                        className="input"
                        value={generateTarget}
                        onChange={(e) => setGenerateTarget(e.target.value)}
                      >
                        {enabledLanguages
                          .filter(
                            (l) =>
                              l.code !== "vi" &&
                              !translation(l.code).text &&
                              !translation(l.code).title,
                          )
                          .map((l) => (
                            <option key={l.code} value={l.code}>
                              {l.native_name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="review-confirmation">
                      <input
                        type="checkbox"
                        checked={sourceVerified}
                        onChange={(e) => setSourceVerified(e.target.checked)}
                      />
                      {vi
                        ? "Tôi đã kiểm tra nguồn tiếng Việt."
                        : "I have verified the Vietnamese source."}
                    </label>
                    <button
                      className="button secondary"
                      disabled={
                        busy ||
                        !sourceVerified ||
                        !translation("vi").text.trim() ||
                        !enabledLanguages.some(
                          (l) => l.code === generateTarget,
                        ) ||
                        Boolean(
                          translation(generateTarget).text ||
                          translation(generateTarget).title,
                        )
                      }
                      onClick={saveAndGenerate}
                    >
                      {generateFailed
                        ? vi
                          ? "Thử tạo tác vụ AI lại"
                          : "Retry AI job"
                        : vi
                          ? "Lưu nháp và tạo thuyết minh"
                          : "Save draft and generate narration"}
                    </button>
                  </div>
                )}
                {locked && (
                  <p>
                    {vi
                      ? "Bạn có quyền xem; cần quản trị viên để sửa, tạo AI và duyệt nội dung."
                      : "You have read access. An administrator is required to edit, generate or approve content."}
                  </p>
                )}
              </div>
            </div>
          </section>
          <section
            hidden={step !== 2}
            id="editor-panel-2"
            role="tabpanel"
            aria-labelledby="editor-tab-2"
            className="editor-fields publication-panel"
          >
            <div className={`readiness ${ready ? "is-ready" : ""}`}>
              <FileCheck2 size={28} />
              <div>
                <h2>
                  {vi
                    ? "Kiểm tra bản nháp trước khi công bố"
                    : "Review the draft before publishing"}
                </h2>
                <p>
                  {vi
                    ? "Lưu nháp, duyệt nội dung và công bố là ba thao tác riêng. Du khách tiếp tục thấy bản đã công bố cho đến khi công bố lại."
                    : "Saving, approval and publication are separate actions. Visitors keep seeing the previous public version until you publish again."}
                </p>
              </div>
            </div>
            <Checklist
              ok={basicReady}
              label={
                vi
                  ? "Tên, danh mục và địa chỉ (bắt buộc)"
                  : "Name, category and address (required)"
              }
              vi={vi}
              onFix={() =>
                focusField(
                  0,
                  !form.name.trim()
                    ? "place-name"
                    : !categoryReady
                      ? "place-category"
                      : "place-address",
                )
              }
            />
            <Checklist
              ok={locationReady}
              label={
                vi
                  ? "Tọa độ và bán kính hợp lệ khi dùng tự thuyết minh"
                  : "Valid coordinates and radius for automatic narration"
              }
              vi={vi}
              onFix={() => focusField(0, "place-location")}
            />
            <p className="field-hint">
              {vi
                ? "Ảnh được khuyến nghị, không bắt buộc để công bố."
                : "A cover image is recommended and is not required for publication."}{" "}
              <button
                className="text-button"
                onClick={() => focusField(0, "place-name")}
              >
                {vi ? "Xem thông tin" : "View details"}
              </button>
            </p>
            {checklistLanguages.map(({ code, required }) => (
              <div className="checklist-language" key={code}>
                <h3>
                  {languageName(code)}{" "}
                  {required
                    ? "*"
                    : vi
                      ? "(đã có nội dung tùy chọn)"
                      : "(optional content entered)"}
                </h3>
                <Checklist
                  ok={Boolean(
                    translation(code).title.trim() &&
                    translation(code).text.trim(),
                  )}
                  label={
                    vi
                      ? "Tiêu đề và bài thuyết minh đầy đủ"
                      : "Complete title and narration"
                  }
                  vi={vi}
                  onFix={() =>
                    focusField(
                      1,
                      !translation(code).title.trim()
                        ? "narration-title"
                        : "narration-text",
                      code,
                    )
                  }
                />
                <p>
                  {reviewLabel(narrationReviews[code], vi)}{" "}
                  <button
                    className="text-button"
                    onClick={() => focusField(1, "narration-text", code)}
                  >
                    {vi ? "Kiểm tra nội dung" : "Review content"}
                  </button>
                </p>
              </div>
            ))}
            {form.source && <SourceAttribution source={form.source} vi={vi} />}
            <div className="publication-actions">
              {saved.has_published && saved.status !== "archived" && (
                <a
                  className="button secondary"
                  href={`${location.port === "5173" ? "http://127.0.0.1:5174/" : "/"}?poi=${encodeURIComponent(saved.id)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {vi ? "Mở bản đang công khai" : "Open current public version"}
                </a>
              )}
              <button
                className="button secondary"
                onClick={() => setPreview(true)}
              >
                <Eye size={17} />
                {vi ? "Xem trước bản nháp" : "Preview draft"}
              </button>
              {administrator &&
                (saved.status === "draft" || !saved.id || dirty) && (
                  <button
                    className="button secondary"
                    disabled={busy || !ready}
                    onClick={() => action("submit")}
                  >
                    {dirty || !saved.id
                      ? vi
                        ? "Lưu và gửi duyệt"
                        : "Save and submit for review"
                      : vi
                        ? "Gửi duyệt"
                        : "Submit for review"}
                  </button>
                )}
              {administrator && saved.status === "in_review" && !dirty && (
                <>
                  <label className="review-confirmation">
                    <input
                      type="checkbox"
                      checked={confirmedReview}
                      onChange={(e) => setConfirmedReview(e.target.checked)}
                    />
                    {vi
                      ? "Tôi đã kiểm tra thông tin, nguồn, vị trí và các bài thuyết minh của phiên bản này."
                      : "I have checked this revision’s details, sources, location and narrations."}
                  </label>
                  <button
                    className="button primary"
                    disabled={busy || !ready || !confirmedReview}
                    onClick={() => action("approve")}
                  >
                    <ShieldCheck size={17} />
                    {vi ? "Duyệt nội dung" : "Approve content"}
                  </button>
                </>
              )}
              {administrator &&
                ["in_review", "approved"].includes(saved.status) &&
                !dirty && (
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setConfirm("reject")}
                  >
                    {vi ? "Yêu cầu chỉnh sửa" : "Request changes"}
                  </button>
                )}
              {administrator && (
                <button
                  className="button primary"
                  disabled={
                    busy || dirty || !ready || saved.status !== "approved"
                  }
                  onClick={() => action("publish")}
                >
                  {vi ? "Công bố" : "Publish"}
                </button>
              )}
              {administrator && saved.id && saved.status !== "archived" && (
                <button
                  className="button secondary"
                  disabled={busy || dirty}
                  onClick={() => setConfirm("archive")}
                >
                  {vi ? "Ẩn địa điểm" : "Hide place"}
                </button>
              )}
              {administrator && saved.status === "archived" && (
                <button
                  className="button secondary"
                  disabled={busy || dirty}
                  onClick={() => action("restore")}
                >
                  {vi ? "Mở lại thành bản nháp" : "Reopen as draft"}
                </button>
              )}
            </div>
            {(dirty || saved.status !== "approved") && (
              <p className="field-hint">
                {vi
                  ? "Cần lưu phiên bản hiện tại, gửi duyệt và xác nhận duyệt trước khi công bố."
                  : "Save the current revision, submit it and confirm approval before publishing."}
              </p>
            )}
            {administrator && saved.id && (
              <details className="history-details">
                <summary>
                  {vi ? "Thống kê địa điểm" : "Place statistics"}
                </summary>
                <p>
                  {vi ? "Lượt xem" : "Views"}: {saved.view_count ?? 0} ·{" "}
                  {vi ? "Lượt bắt đầu nghe" : "Listening starts"}:{" "}
                  {saved.listen_count ?? 0}
                </p>
              </details>
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
                    {uiMessage(historyError, vi ? "vi" : "en")}
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
                            {new Date(release.created_at).toLocaleDateString(
                              vi ? "vi-VN" : "en-GB",
                              {
                                timeZone: "Asia/Bangkok",
                              },
                            )}
                          </small>
                        </span>
                        <button
                          className="button secondary small"
                          disabled={
                            busy ||
                            !administrator ||
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
          </section>
        </div>
        <footer className="editor-footer">
          <span className="save-state" role="status">
            {saveState}
          </span>
          <div>
            <button
              className="button secondary"
              disabled={busy}
              onClick={close}
            >
              {t.cancel}
            </button>
            {!locked && (
              <button
                className="button primary"
                disabled={busy || (!dirty && Boolean(saved.id))}
                onClick={() => save()}
              >
                <Save size={16} />
                {busy
                  ? t.saving
                  : saved.id
                    ? vi
                      ? "Lưu thay đổi"
                      : "Save changes"
                    : vi
                      ? "Lưu nháp"
                      : "Save draft"}
              </button>
            )}
            <button
              className="button secondary"
              onClick={() => {
                setStep(2);
                requestAnimationFrame(() =>
                  document.getElementById("editor-tab-2")?.focus(),
                );
              }}
            >
              {vi ? "Kiểm tra công bố" : "Check publication"}
            </button>
          </div>
        </footer>
      </div>
      {preview && (
        <Dialog
          locale={locale}
          title={vi ? "Bản xem trước · Chưa công khai" : "Preview · Private"}
          onClose={() => setPreview(false)}
        >
          <div className="visitor-preview">
            {imagePreview ? (
              <img
                className="staged-image large"
                src={imagePreview}
                alt={form.name}
              />
            ) : (
              <Cover poi={form} large />
            )}
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
            <h2
              lang={lang}
              dir={languages.find((l) => l.code === lang)?.direction}
            >
              {translation(lang).title || form.name}
            </h2>
            <p className="muted">
              <MapPin size={14} />
              {form.address}
            </p>
            <p>{form.short_description}</p>
            <SpeechPlayer
              key={lang}
              text={translation(lang).text}
              speechLocale={
                languages.find((language) => language.code === lang)
                  ?.speech_locale ?? lang
              }
              uiLocale={locale}
            />
            <p
              className="narration-text"
              lang={lang}
              dir={languages.find((l) => l.code === lang)?.direction}
            >
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
          locale={locale}
          title={
            confirm === "reject"
              ? vi
                ? "Yêu cầu chỉnh sửa"
                : "Request changes"
              : vi
                ? "Ẩn địa điểm"
                : "Hide place"
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
                {uiMessage(error, vi ? "vi" : "en")}
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
                      ? "Ẩn địa điểm"
                      : "Hide place"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
function SparkleIcon() {
  return <span aria-hidden="true">✧</span>;
}
function GlobeIcon() {
  return <ShieldCheck size={17} />;
}

function Checklist({
  ok,
  label,
  vi,
  onFix,
}: {
  ok: boolean;
  label: string;
  vi: boolean;
  onFix: () => void;
}) {
  return (
    <div className="checklist-item">
      <span className={ok ? "ready" : "missing"}>
        {ok ? (
          <Check size={16} aria-label={vi ? "Đạt" : "Complete"} />
        ) : (
          <CircleAlert
            size={16}
            aria-label={vi ? "Cần bổ sung" : "Incomplete"}
          />
        )}
      </span>
      <span>{label}</span>
      {!ok && (
        <button className="text-button" onClick={onFix}>
          {vi ? "Bổ sung" : "Complete"}
          <ArrowRight size={13} />
        </button>
      )}
    </div>
  );
}
