import { useState, type FormEvent } from "react";
import { api, uiMessage } from "@quan1/api-client";
import type { Language } from "@quan1/contracts";
import { Dialog } from "./components";
import type { UiLocale } from "./i18n";

const blank: Language = {
  code: "",
  name: "",
  native_name: "",
  speech_locale: "",
  enabled: true,
  required: false,
  sort_order: 100,
  direction: "ltr",
};

export function LanguageManager({
  languages,
  locale,
  canEdit,
  onSaved,
}: {
  languages: Language[];
  locale: UiLocale;
  canEdit: boolean;
  onSaved: (message: string) => void;
}) {
  const vi = locale === "vi";
  const [form, setForm] = useState<Language | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function open(language?: Language) {
    setForm(language ? { ...language } : { ...blank });
    setEditing(!!language);
    setError("");
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setError("");
    try {
      await api<Language>(
        editing
          ? `/admin/languages/${encodeURIComponent(form.code)}`
          : "/admin/languages",
        {
          method: editing ? "PUT" : "POST",
          body: JSON.stringify(form),
        },
      );
      setForm(null);
      onSaved(vi ? "Đã lưu ngôn ngữ." : "Language saved.");
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel language-manager">
      <div className="language-manager-heading">
        <h2>{vi ? "Ngôn ngữ thuyết minh" : "Narration languages"}</h2>
        {canEdit && (
          <button className="button primary" onClick={() => open()}>
            {vi ? "Thêm ngôn ngữ" : "Add language"}
          </button>
        )}
      </div>
      <p>
        {vi
          ? "Ngôn ngữ bắt buộc cần có nội dung trước khi xuất bản. Tắt ngôn ngữ sẽ ẩn lựa chọn trên trang du khách và giữ lại bản dịch."
          : "Required languages need content before publishing. Disabling a language hides it from visitors and preserves its translations."}
      </p>
      <div className="language-registry">
        {languages.map((language) => (
          <div className="language-registry-item" key={language.code}>
            <strong>{language.native_name}</strong>
            <span>
              {language.code} · {language.speech_locale}
            </span>
            <small>
              {language.enabled
                ? vi
                  ? "Đang bật"
                  : "Enabled"
                : vi
                  ? "Đã tắt"
                  : "Disabled"}
              {language.required ? (vi ? " · Bắt buộc" : " · Required") : ""}
            </small>
            {canEdit && (
              <button
                className="text-button"
                onClick={() => open(language)}
                aria-label={`${vi ? "Sửa" : "Edit"} ${language.native_name}`}
              >
                {vi ? "Sửa" : "Edit"}
              </button>
            )}
          </div>
        ))}
      </div>
      {form && (
        <Dialog
          locale={vi ? "vi" : "en"}
          title={
            editing
              ? vi
                ? "Sửa ngôn ngữ"
                : "Edit language"
              : vi
                ? "Thêm ngôn ngữ"
                : "Add language"
          }
          onClose={() => {
            if (!busy) setForm(null);
          }}
        >
          <form onSubmit={save} className="language-form">
            <fieldset disabled={busy}>
              {(
                [
                  ["code", vi ? "Mã ngôn ngữ" : "Language code"],
                  ["name", vi ? "Tên quốc tế" : "International name"],
                  ["native_name", vi ? "Tên bản địa" : "Native name"],
                  ["speech_locale", vi ? "Mã giọng đọc" : "Speech locale"],
                ] as const
              ).map(([key, label]) => (
                <label className="field-label" key={key}>
                  {label}
                  <input
                    className="input"
                    required
                    maxLength={
                      key === "code" || key === "speech_locale" ? 35 : 100
                    }
                    disabled={key === "code" && editing}
                    value={form[key]}
                    placeholder={
                      key === "code"
                        ? "ms"
                        : key === "speech_locale"
                          ? "ms-MY"
                          : ""
                    }
                    onChange={(event) =>
                      setForm({ ...form, [key]: event.target.value })
                    }
                  />
                </label>
              ))}
              <label className="field-label">
                {vi ? "Thứ tự hiển thị" : "Display order"}
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={10000}
                  required
                  value={form.sort_order}
                  onChange={(event) =>
                    setForm({ ...form, sort_order: Number(event.target.value) })
                  }
                />
              </label>
              <label className="field-label">
                {vi ? "Hướng chữ" : "Text direction"}
                <select
                  className="input"
                  value={form.direction}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      direction: event.target.value as "ltr" | "rtl",
                    })
                  }
                >
                  <option value="ltr">
                    {vi ? "Trái sang phải" : "Left to right"}
                  </option>
                  <option value="rtl">
                    {vi ? "Phải sang trái" : "Right to left"}
                  </option>
                </select>
              </label>
              <label className="language-check">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  disabled={form.code === "vi"}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      enabled: event.target.checked,
                      required: event.target.checked && form.required,
                    })
                  }
                />
                {vi ? "Bật ngôn ngữ" : "Enable language"}
              </label>
              <label className="language-check">
                <input
                  type="checkbox"
                  checked={form.required}
                  disabled={form.code === "vi"}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      required: event.target.checked,
                      enabled: event.target.checked || form.enabled,
                    })
                  }
                />
                {vi ? "Bắt buộc trước khi xuất bản" : "Required for publishing"}
              </label>
              {error && (
                <p className="notice error" role="alert">
                  {uiMessage(error, vi ? "vi" : "en")}
                </p>
              )}
              <button className="button primary" disabled={busy}>
                {busy
                  ? vi
                    ? "Đang lưu…"
                    : "Saving…"
                  : vi
                    ? "Lưu ngôn ngữ"
                    : "Save language"}
              </button>
            </fieldset>
          </form>
        </Dialog>
      )}
    </section>
  );
}
