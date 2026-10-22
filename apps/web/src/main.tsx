import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowRight,
  Globe2,
  Headphones,
  MapPin,
  Search,
  Volume2,
} from "lucide-react";
import { api, mediaUrl } from "@quan1/api-client";
import type { Locale, Poi } from "@quan1/contracts";
import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/500.css";
import "@fontsource/be-vietnam-pro/600.css";
import "./styles.css";

function Visitor() {
  const [locale, setLocale] = useState<Locale>(() =>
    localStorage.getItem("visitor-locale") === "en" ? "en" : "vi",
  );
  const [pois, setPois] = useState<Poi[]>([]);
  const [selected, setSelected] = useState<Poi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [retry, setRetry] = useState(0);
  const [rate, setRate] = useState(1);
  const [audioError, setAudioError] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const audioRef = useRef<HTMLAudioElement>(null);
  const vi = locale === "vi";
  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem("visitor-locale", locale);
  }, [locale]);
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
    let ignore = false;
    setLoading(true);
    setError("");
    setSelected(null);
    setAudioError(false);
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
  }, [locale, retry]);
  useEffect(() => {
    setAudioError(false);
    setRate(1);
  }, [selected?.id, locale]);
  const narration = selected?.translations[locale];
  const list = pois.filter((p) =>
    `${p.name} ${p.translations[locale].title}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  function back() {
    setSelected(null);
    history.replaceState(null, "", location.pathname);
    setRetry((n) => n + 1);
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
        <button
          className="language"
          onClick={() => setLocale(vi ? "en" : "vi")}
        >
          <Globe2 size={16} />
          {vi ? "Tiếng Việt" : "English"}
        </button>
      </header>
      <main>
        {!online && (
          <p className="notice">
            {vi
              ? "Bạn đang ngoại tuyến. Phiên bản này cần kết nối mạng để tải nội dung."
              : "You are offline. This version needs a connection to load content."}
          </p>
        )}
        {loading ? (
          <div className="empty">
            {vi ? "Đang tìm những câu chuyện…" : "Finding stories…"}
          </div>
        ) : error ? (
          <div className="empty">
            <h2>
              {vi ? "Chưa tải được nội dung" : "Could not load this story"}
            </h2>
            <p role="alert">{error}</p>
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
              {selected.image_id ? (
                <img src={mediaUrl(selected.image_id)} alt={narration?.title} />
              ) : (
                <div className="illustration">
                  <MapPin size={54} />
                </div>
              )}
            </div>
            <span className="eyebrow">QUẬN 1 · SAIGON STORIES</span>
            <h1>{narration?.title}</h1>
            <p className="address">
              <MapPin size={15} />
              {selected.address}
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
                <span>{vi ? "Tiếng Việt" : "English"}</span>
              </div>
              {narration?.audio_valid && narration.audio_id ? (
                <>
                  <audio
                    key={`${selected.id}-${locale}-${narration.audio_id}`}
                    ref={audioRef}
                    controls
                    preload="metadata"
                    src={mediaUrl(narration.audio_id)}
                    onError={() => setAudioError(true)}
                    aria-label={`${selected.name} · ${vi ? "Tiếng Việt" : "English"}`}
                  />
                  <label className="speed">
                    {vi ? "Tốc độ" : "Speed"}
                    <select
                      value={rate}
                      onChange={(e) => {
                        const r = Number(e.target.value);
                        setRate(r);
                        if (audioRef.current) audioRef.current.playbackRate = r;
                      }}
                    >
                      {[0.75, 1, 1.25, 1.5, 2].map((r) => (
                        <option key={r} value={r}>
                          {r}×
                        </option>
                      ))}
                    </select>
                  </label>
                  {audioError && (
                    <div className="notice" role="alert">
                      {vi
                        ? "Không tải được audio. Bạn vẫn có thể đọc bài thuyết minh."
                        : "Audio could not be loaded. You can still read the story."}
                      <button
                        onClick={() => {
                          setAudioError(false);
                          audioRef.current?.load();
                        }}
                      >
                        {vi ? "Thử lại" : "Retry"}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <p className="notice">
                  {vi
                    ? "Chưa có audio cho ngôn ngữ này. Hãy chọn ngôn ngữ khác."
                    : "No audio in this language. Please choose another language."}
                </p>
              )}
            </section>
            <h2 className="story-heading">
              {vi ? "Câu chuyện của địa điểm" : "The story of this place"}
            </h2>
            <p className="narration">{narration?.text}</p>
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
            ) : (
              <div className="place-list">
                {list.map((p) => (
                  <button
                    className="place"
                    key={p.id}
                    onClick={() => {
                      setSelected(p);
                      history.replaceState(
                        null,
                        "",
                        `?poi=${encodeURIComponent(p.id)}`,
                      );
                      window.scrollTo(0, 0);
                    }}
                  >
                    <div className="place-image">
                      {p.image_id ? (
                        <img src={mediaUrl(p.image_id)} alt="" />
                      ) : (
                        <MapPin size={36} />
                      )}
                    </div>
                    <div>
                      <small>QUẬN 1</small>
                      <h3>{p.translations[locale].title}</h3>
                      <p>{p.address}</p>
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
