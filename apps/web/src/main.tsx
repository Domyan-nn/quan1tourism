import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowRight,
  Globe2,
  Headphones,
  MapPin,
  Map,
  List,
  Search,
  Volume2,
} from "lucide-react";
import {
  api,
  uiMessage,
  mediaUrl,
  SourceAttribution,
  SpeechPlayer,
  recordEngagement,
} from "@quan1/api-client";
import type { PublicCategory, Language, Locale, Poi } from "@quan1/contracts";
import { AuthControls } from "./Auth";
import { MapExplorer } from "./MapExplorer";
import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/500.css";
import "@fontsource/be-vietnam-pro/600.css";
import "./styles.css";

function Visitor() {
  const [uiLocale, setUiLocale] = useState(() =>
    localStorage.getItem("visitor-ui-locale") === "en" ? "en" : "vi",
  );
  const [locale, setLocale] = useState<Locale>(
    () => localStorage.getItem("visitor-locale") || "vi",
  );
  const [languages, setLanguages] = useState<Language[]>([]);
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [languageError, setLanguageError] = useState("");
  const [pois, setPois] = useState<Poi[]>([]);
  const [selected, setSelected] = useState<Poi | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const vi = uiLocale === "vi";
  const language = languages.find((item) => item.code === locale);
  useEffect(() => {
    let ignore = false;
    api<PublicCategory[]>("/categories")
      .then((items) => {
        if (!ignore) setCategories(items);
      })
      .catch(() => {});
    api<Language[]>("/languages")
      .then((items) => {
        if (ignore) return;
        setLanguages(items);
        setLocale((current) =>
          items.some((item) => item.code === current) ? current : "vi",
        );
        setLanguageError("");
      })
      .catch((error) => {
        if (!ignore) setLanguageError(error.message);
      });
    return () => {
      ignore = true;
    };
  }, [retry]);
  useEffect(() => {
    if (!language) return;
    localStorage.setItem("visitor-locale", locale);
  }, [locale, language?.code]);
  useEffect(() => {
    document.documentElement.lang = uiLocale;
    localStorage.setItem("visitor-ui-locale", uiLocale);
  }, [uiLocale]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    if (!language) return;
    let ignore = false;
    setLoading(true);
    setError("");
    setSelected(null);
    const id = new URLSearchParams(location.search).get("poi");
    (id
      ? api<Poi>(`/pois/${encodeURIComponent(id)}?locale=${locale}`).then(
          (p) => ({ items: [p] }),
        )
      : api<{ items: Poi[] }>(`/pois?locale=${locale}`)
    )
      .then((data) => {
        if (!ignore) {
          setPois(data.items);
          if (id) setSelected(data.items[0]);
        }
      })
      .catch((e) => {
        if (!ignore) setError(e.message);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [locale, language?.code, retry]);
  const narration = selected?.translations[locale];
  const list = pois.filter((p) =>
    `${p.name} ${p.address} ${p.translations[locale]?.title ?? ""}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  function back() {
    setSelected(null);
    history.replaceState(null, "", location.pathname);
    setRetry((n) => n + 1);
  }
  function openDetail(poi: Poi) {
    setSelected(poi);
    recordEngagement(poi.id, "view");
    history.replaceState(null, "", `?poi=${encodeURIComponent(poi.id)}`);
    window.scrollTo(0, 0);
  }
  return (
    <>
      <header>
        <a href="/" className="logo">
          <Headphones size={25} />
          <span>
            saigon<strong>stories.</strong>
          </span>
        </a>
        <div className="header-actions">
          <button
            className="button secondary"
            aria-label={vi ? "Ngôn ngữ giao diện" : "Interface language"}
            onClick={() => setUiLocale(vi ? "en" : "vi")}
          >
            {vi ? "Tiếng Việt / English" : "English / Tiếng Việt"}
          </button>
          <label className="language">
            <Globe2 size={16} />
            <select
              aria-label={vi ? "Ngôn ngữ thuyết minh" : "Narration language"}
              value={locale}
              disabled={!languages.length}
              onChange={(event) => setLocale(event.target.value)}
            >
              {languages.length ? (
                languages.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.native_name}
                  </option>
                ))
              ) : (
                <option value={locale}>{locale}</option>
              )}
            </select>
          </label>
          <AuthControls
            locale={uiLocale}
            onLocaleChange={() => setUiLocale(vi ? "en" : "vi")}
          />
        </div>
      </header>
      <main>
        {!online && (
          <p className="notice">
            {vi
              ? "Bạn đang ngoại tuyến. Phiên bản này cần kết nối mạng để tải nội dung."
              : "You are offline. This version needs a connection to load content."}
          </p>
        )}
        {languageError ? (
          <div className="empty">
            <p role="alert">{uiMessage(languageError, vi ? "vi" : "en")}</p>
            <button className="button" onClick={() => setRetry((n) => n + 1)}>
              {vi ? "Thử lại" : "Try again"}
            </button>
          </div>
        ) : loading ? (
          <div className="empty">
            {vi ? "Đang tìm những câu chuyện…" : "Finding stories…"}
          </div>
        ) : error ? (
          <div className="empty">
            <h2>
              {vi ? "Chưa tải được nội dung" : "Could not load this story"}
            </h2>
            <p role="alert">{uiMessage(error, vi ? "vi" : "en")}</p>
            <button className="button" onClick={() => setRetry((n) => n + 1)}>
              {vi ? "Thử lại" : "Try again"}
            </button>
          </div>
        ) : selected ? (
          <article className="story">
            <button className="back" onClick={back}>
              <ArrowLeft size={16} />
              {vi ? "Tất cả địa điểm" : "All places"}
            </button>
            <div className="story-cover">
              {selected.image_id || selected.source?.image_url ? (
                <img
                  src={
                    selected.image_id
                      ? mediaUrl(selected.image_id)
                      : (selected.source?.image_url ?? "")
                  }
                  alt={narration?.title}
                />
              ) : (
                <div className="illustration">
                  <MapPin size={54} />
                </div>
              )}
            </div>
            <span className="eyebrow">
              {vi ? "QUẬN 1" : "DISTRICT 1"} · SAIGON STORIES
            </span>
            <h1 lang={locale} dir={language?.direction}>
              {narration?.title || selected.name}
            </h1>
            <p className="address">
              <MapPin size={15} />
              {selected.address}
            </p>
            <p>
              {
                categories.find(
                  (category) => category.id === selected.category_id,
                )?.name
              }
            </p>
            {selected.is_demo && (
              <p className="notice">
                {vi
                  ? "Nội dung mẫu, không thay thế thông tin du lịch đã được xác minh."
                  : "Sample content. Verify travel information independently."}
              </p>
            )}
            <section
              className="player"
              aria-label={vi ? "Trình phát thuyết minh" : "Narration player"}
            >
              <div>
                <Volume2 size={21} />
                <strong>
                  {vi ? "Lắng nghe câu chuyện" : "Listen to the story"}
                </strong>
                <span>{language?.native_name}</span>
              </div>
              {narration?.text && language ? (
                <SpeechPlayer
                  key={`${selected.id}-${locale}`}
                  text={narration.text}
                  speechLocale={language.speech_locale}
                  uiLocale={vi ? "vi" : "en"}
                  onStarted={() => recordEngagement(selected.id, "listen")}
                />
              ) : (
                <p className="notice">
                  {vi
                    ? "Chưa có bài thuyết minh cho ngôn ngữ này. Hãy chọn ngôn ngữ khác."
                    : "No narration in this language. Please choose another language."}
                </p>
              )}
            </section>
            <h2 className="story-heading">
              {vi ? "Câu chuyện của địa điểm" : "The story of this place"}
            </h2>
            <p className="narration" lang={locale} dir={language?.direction}>
              {narration?.text}
            </p>
            <SourceAttribution
              source={selected.source}
              vi={vi}
              imageUsed={!selected.image_id}
            />
          </article>
        ) : (
          <>
            <div className="hero">
              <span className="eyebrow">HELLO, SAIGON EXPLORER</span>
              <h1>
                {vi ? (
                  <>
                    Sài Gòn, qua
                    <br />
                    <em>những câu chuyện.</em>
                  </>
                ) : (
                  <>
                    Saigon, told
                    <br />
                    <em>one story at a time.</em>
                  </>
                )}
              </h1>
              <p>
                {vi
                  ? "Chậm lại một chút. Lắng nghe và khám phá vẻ đẹp Quận 1 theo cách của riêng bạn."
                  : "Slow down. Listen to the stories and discover District 1 at your own pace."}
              </p>
            </div>
            <div className="list-heading">
              <h2>{vi ? "Địa điểm để lắng nghe" : "Places with a story"}</h2>
              <label className="search">
                <Search size={17} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label={vi ? "Tìm địa điểm" : "Search places"}
                  placeholder={vi ? "Bạn muốn khám phá đâu?" : "Where to next?"}
                />
              </label>
            </div>
            <div
              className="map-view-toggle"
              aria-label={vi ? "Chế độ xem địa điểm" : "Places view"}
            >
              <button
                aria-pressed={view === "list"}
                onClick={() => setView("list")}
              >
                <List size={17} />
                {vi ? "Danh sách" : "List"}
              </button>
              <button
                aria-pressed={view === "map"}
                onClick={() => setView("map")}
              >
                <Map size={17} />
                {vi ? "Bản đồ" : "Map"}
              </button>
            </div>
            {list.length === 0 ? (
              <div className="empty">
                <Headphones size={37} />
                <h2>
                  {vi
                    ? "Những câu chuyện đang được chuẩn bị"
                    : "Stories are on their way"}
                </h2>
                <p>
                  {query
                    ? vi
                      ? "Thử một từ khóa khác."
                      : "Try a different keyword."
                    : vi
                      ? "Các địa điểm sẽ xuất hiện sau khi được kiểm tra và xuất bản. Hẹn gặp bạn sớm!"
                      : "Places will appear here once reviewed and published. See you soon!"}
                </p>
              </div>
            ) : view === "map" ? (
              <MapExplorer
                places={list}
                languages={languages}
                locale={locale}
                uiLocale={uiLocale}
                categories={categories}
                onDetail={openDetail}
              />
            ) : (
              <div className="place-list">
                {list.map((p) => (
                  <button
                    className="place"
                    key={p.id}
                    onClick={() => openDetail(p)}
                  >
                    <div className="place-image">
                      {p.image_id || p.source?.image_url ? (
                        <img
                          src={
                            p.image_id
                              ? mediaUrl(p.image_id)
                              : (p.source?.image_url ?? "")
                          }
                          alt=""
                        />
                      ) : (
                        <MapPin size={36} />
                      )}
                    </div>
                    <div>
                      <small>{vi ? "QUẬN 1" : "DISTRICT 1"}</small>
                      <h3 lang={locale} dir={language?.direction}>
                        {p.translations[locale]?.title || p.name}
                      </h3>
                      <p>{p.address}</p>
                      <p>
                        {
                          categories.find(
                            (category) => category.id === p.category_id,
                          )?.name
                        }
                      </p>
                      <p className="place-description">
                        {p.short_description ||
                          p.translations[locale]?.text.slice(0, 150)}
                      </p>
                      <span>
                        <Headphones size={14} />
                        {vi ? "Lắng nghe câu chuyện" : "Listen to the story"}
                        <ArrowRight size={15} />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </main>
      <footer>
        Saigon Stories ·{" "}
        {vi ? "Lắng nghe. Khám phá. Kết nối." : "Listen. Explore. Connect."}
      </footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Visitor />
  </StrictMode>,
);
