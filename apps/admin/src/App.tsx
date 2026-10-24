import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowDownWideNarrow,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Eye,
  FileCheck2,
  Globe2,
  Grid2X2,
  Headphones,
  LayoutDashboard,
  List,
  LogOut,
  MapPin,
  Menu,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Tags,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { uiMessage, api, ApiError } from "@quan1/api-client";
import type {
  Category,
  Language,
  Page,
  Poi,
  Summary,
  User,
} from "@quan1/contracts";
import { Badge, Brand, Cover, Dialog, Empty, Loading } from "./components";
import { messages, type UiLocale } from "./i18n";
import { Editor } from "./Editor";
import { LanguageManager } from "./Languages";

type View = "overview" | "places" | "categories" | "languages" | "review";
const views: View[] = [
  "overview",
  "places",
  "categories",
  "languages",
  "review",
];
const nav = [
  { id: "overview", icon: LayoutDashboard },
  { id: "places", icon: MapPin },
  { id: "categories", icon: Tags },
  { id: "languages", icon: Globe2 },
  { id: "review", icon: FileCheck2 },
] as const;
const emptySummary: Summary = {
  total: 0,
  published: 0,
  in_review: 0,
  draft: 0,
  tts_ready: 0,
  translations_ready: 0,
};

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [locale, setLocale] = useState<UiLocale>(() =>
    localStorage.getItem("quan1-locale") === "en" ? "en" : "vi",
  );
  const [large, setLarge] = useState(
    () => localStorage.getItem("quan1-large") === "true",
  );
  const [view, setView] = useState<View>(() =>
    views.includes(location.hash.slice(1) as View)
      ? (location.hash.slice(1) as View)
      : "places",
  );
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const [settings, setSettings] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [narrow, setNarrow] = useState(
    () => matchMedia("(max-width: 760px)").matches,
  );
  const [summary, setSummary] = useState(emptySummary);
  const [categories, setCategories] = useState<Category[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const enabledLanguages = languages.filter((language) => language.enabled);
  const languageCodes = enabledLanguages.map((language) => language.code);
  const [data, setData] = useState<Page<Poi>>({
    items: [],
    total: 0,
    page: 1,
    page_size: 8,
  });
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("views");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() =>
    matchMedia("(max-width: 760px)").matches ? 4 : 8,
  );
  const [layout, setLayout] = useState<"list" | "grid">("list");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<Poi | "new" | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [toast, setToast] = useState("");
  const [categoryDialog, setCategoryDialog] = useState(false);
  const [categoryEditing, setCategoryEditing] = useState<Category | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryError, setCategoryError] = useState("");
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const t = messages[locale];
  useEffect(() => {
    const toggle = () =>
      setLocale((current) => (current === "vi" ? "en" : "vi"));
    window.addEventListener("quan1-ui-language", toggle);
    return () => window.removeEventListener("quan1-ui-language", toggle);
  }, []);
  const date = new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  });

  useEffect(() => {
    api<User>("/admin/auth/me")
      .then(setUser)
      .catch((e) => {
        if (!(e instanceof ApiError) || e.status !== 401)
          setAuthError(e.message);
      })
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    localStorage.setItem("quan1-locale", locale);
  }, [locale]);
  useEffect(() => {
    document.documentElement.classList.toggle("large-text", large);
    localStorage.setItem("quan1-large", String(large));
  }, [large]);
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
    const timer = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
    const update = () => setNarrow(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const onHash = () => {
      const v = location.hash.slice(1);
      if (views.includes(v as View)) {
        setView(v as View);
        setPage(1);
      }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    document.title = `${t[view]} · Saigon Stories`;
  }, [view, t]);
  useEffect(() => {
    if (!user) return;
    let ignore = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      q: debounced,
      status: view === "review" ? "in_review" : status,
      category,
      sort,
      page: String(view === "languages" ? 1 : page),
      page_size: String(view === "languages" ? 100 : pageSize),
    });
    Promise.all([
      api<Page<Poi>>(`/admin/pois?${params}`),
      api<Summary>("/admin/summary"),
      api<Category[]>("/admin/categories"),
      api<Language[]>("/admin/languages"),
    ])
      .then(([list, stats, cats, langs]) => {
        if (!ignore) {
          setData(list);
          setSummary(stats);
          setCategories(cats);
          setLanguages(langs);
        }
      })
      .catch((e) => {
        if (!ignore) {
          setError(e.message);
          if (e instanceof ApiError && e.status === 401) setUser(null);
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [user, debounced, status, category, sort, page, pageSize, refresh, view]);

  function navigate(v: View) {
    setView(v);
    location.hash = v;
    setPage(1);
    setStatus("");
    setCategory("");
    setQuery("");
    setMenu(false);
  }
  function notify(message: string) {
    setToast(message);
    setRefresh((x) => x + 1);
  }
  function clearFilters() {
    setQuery("");
    setStatus("");
    setCategory("");
    setPage(1);
  }
  async function logout() {
    try {
      await api("/auth/logout", { method: "POST" });
      setMenu(false);
      setUser(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function createCategory(e: FormEvent) {
    e.preventDefault();
    setCategoryBusy(true);
    setCategoryError("");
    try {
      await api(
        categoryEditing
          ? `/admin/categories/${categoryEditing.id}`
          : "/admin/categories",
        {
          method: categoryEditing ? "PUT" : "POST",
          body: JSON.stringify({
            name: categoryName,
            color:
              categoryEditing?.color ??
              ["green", "orange", "purple", "blue"][categories.length % 4],
          }),
        },
      );
      setCategoryDialog(false);
      setCategoryName("");
      setCategoryEditing(null);
      notify(locale === "vi" ? "Đã lưu danh mục." : "Category saved.");
    } catch (e) {
      setCategoryError((e as Error).message);
    } finally {
      setCategoryBusy(false);
    }
  }
  async function deleteCategory() {
    if (!deleteTarget) return;
    setCategoryBusy(true);
    setCategoryError("");
    try {
      await api(`/admin/categories/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      notify(
        locale === "vi" ? "Đã xóa danh mục trống." : "Empty category deleted.",
      );
    } catch (e) {
      setCategoryError((e as Error).message);
    } finally {
      setCategoryBusy(false);
    }
  }
  const categoryFor = (id: string) => categories.find((c) => c.id === id);
  const title =
    view === "overview"
      ? `${t.welcome}, ${user?.name.split(" ").slice(-1)[0] ?? ""} ☀`
      : t[view];
  const subtitle =
    view === "overview"
      ? t.today
      : view === "languages"
        ? t.langDesc
        : view === "categories"
          ? t.categoryDesc
          : view === "review"
            ? t.reviewDesc
            : t.description;
  const stats = [
    {
      label: t.allPlaces,
      value: summary.total,
      icon: MapPin,
      color: "green",
      caption:
        locale === "vi" ? "trong không gian của bạn" : "in your workspace",
    },
    {
      label: t.published,
      value: summary.published,
      icon: Globe2,
      color: "blue",
      caption: locale === "vi" ? "sẵn sàng cho du khách" : "ready for visitors",
    },
    {
      label: t.translated,
      value: summary.translations_ready,
      icon: BookOpen,
      color: "purple",
      caption: enabledLanguages
        .filter((language) => language.required)
        .map((language) =>
          locale === "vi" ? language.native_name : language.name,
        )
        .join(" · "),
    },
    {
      label: t.waiting,
      value: summary.in_review,
      icon: FileCheck2,
      color: "orange",
      caption:
        locale === "vi" ? "cần kiểm tra nội dung" : "ready for a closer look",
    },
  ];

  if (checking)
    return (
      <div className="auth-loading">
        <Brand vi={locale === "vi"} />
        <Loading text={t.loading} />
      </div>
    );
  if (!user)
    return (
      <Login
        onLogin={setUser}
        initialError={authError}
        locale={locale}
        setLocale={setLocale}
      />
    );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {t.goTo}
      </a>
      {menu && (
        <button
          className="mobile-scrim"
          aria-label={t.close}
          onClick={() => setMenu(false)}
        />
      )}
      <aside
        className={`sidebar ${menu ? "is-open" : ""}`}
        aria-label="Điều hướng chính"
      >
        <div className="sidebar-brand">
          <Brand vi={locale === "vi"} />
          <button
            className="icon-button mobile-close"
            onClick={() => setMenu(false)}
            aria-label={t.close}
          >
            <X />
          </button>
        </div>
        <div className="workspace-card">
          <div className="workspace-icon">
            <MapPin size={18} />
          </div>
          <div>
            <strong>Quận 1 Tourism</strong>
            <small>
              {locale === "vi" ? "Không gian nội dung" : "Content workspace"}
            </small>
          </div>
          <ChevronDown size={15} />
        </div>
        <div className="nav-label">{t.manage}</div>
        <nav>
          {nav.map(({ id, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${view === id ? "active" : ""}`}
              aria-current={view === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={19} />
              <span>{t[id]}</span>
              {id === "review" && summary.in_review > 0 && (
                <span className="nav-count">{summary.in_review}</span>
              )}
              {view === id && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div className="little-stars">✧</div>
          <strong>
            {locale === "vi"
              ? "Mỗi nơi, một câu chuyện."
              : "Every place has a story."}
          </strong>
          <p>
            {locale === "vi"
              ? "Cùng đưa vẻ đẹp Quận 1 đến gần hơn với mọi người."
              : "Bring the beauty of District 1 closer to everyone."}
          </p>
          <a href="http://127.0.0.1:5174" target="_blank" rel="noreferrer">
            {t.openWeb}
            <ArrowUpRight size={15} />
          </a>
        </div>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => setHelp(true)}>
            <CircleHelp size={19} />
            {t.help}
            <ArrowUpRight size={15} />
          </button>
          <button className="nav-item" onClick={() => setSettings(true)}>
            <Settings2 size={19} />
            {t.settings}
          </button>
          <div className="profile">
            <span className="avatar">
              {user.name
                .split(" ")
                .map((n) => n[0])
                .slice(-2)
                .join("")}
            </span>
            <div>
              <strong>{user.name}</strong>
              <small>{t[user.role]}</small>
            </div>
            <button
              className="icon-button"
              onClick={logout}
              aria-label={t.logout}
              title={t.logout}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMenu(true)}
              aria-label="Mở menu"
            >
              <Menu size={22} />
            </button>
            <span>{t.workspace}</span>
            <ChevronRight size={14} />
            <strong>{t[view]}</strong>
          </div>
          <div className="topbar-actions">
            <span className={`connection ${online ? "" : "disconnected"}`}>
              <i />
              {online ? t.connected : "Offline"}
            </span>
            <button
              className="locale-button"
              onClick={() => setLocale(locale === "vi" ? "en" : "vi")}
              aria-label={t.uiLanguage}
            >
              <Globe2 size={16} />
              {locale === "vi" ? "Tiếng Việt" : "English"}
              <ChevronDown size={13} />
            </button>
            <span className="topbar-divider" />
            <button
              className="icon-button"
              onClick={() => setHelp(true)}
              aria-label={t.help}
            >
              <CircleHelp size={20} />
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {!online && (
            <div className="notice warning" role="status">
              {t.offline}
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span />
                {t.district}
              </div>
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
            {view !== "categories" && user.role === "admin" && (
              <button
                className="button primary"
                onClick={() => setEditing("new")}
              >
                <Plus size={19} />
                {t.add}
              </button>
            )}
            {view === "categories" && (
              <button
                className="button primary"
                onClick={() => {
                  setCategoryError("");
                  setCategoryEditing(null);
                  setCategoryName("");
                  setCategoryDialog(true);
                }}
              >
                <Plus size={18} />
                {t.addCategory}
              </button>
            )}
          </div>
          {(view === "places" || view === "overview") && (
            <div className="stats">
              {stats.map(({ label, value, icon: Icon, color, caption }) => (
                <div className="stat-card" key={label}>
                  <div className="stat-top">
                    <span>{label}</span>
                    <div className={`stat-icon ${color}`}>
                      <Icon size={18} />
                    </div>
                  </div>
                  <strong>
                    {loading ? "—" : value.toString().padStart(2, "0")}
                  </strong>
                  <small>{caption}</small>
                </div>
              ))}
            </div>
          )}
          {error && (
            <div className="notice error" role="alert">
              <span>{uiMessage(error, locale)}</span>
              <button
                className="button small"
                onClick={() => setRefresh((x) => x + 1)}
              >
                {t.retry}
              </button>
            </div>
          )}
          {view === "overview" && (
            <div className="overview-layout">
              <section className="panel task-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">WORKSPACE</span>
                    <h2>{t.attention}</h2>
                  </div>
                  <Sparkles size={21} />
                </div>
                {[
                  {
                    n: summary.total - summary.translations_ready,
                    text: t.translateTask,
                    icon: BookOpen,
                    v: "languages" as View,
                  },
                  {
                    n: summary.total - summary.tts_ready,
                    text: t.audioTask,
                    icon: Headphones,
                    v: "languages" as View,
                  },
                  {
                    n: summary.in_review,
                    text: t.reviewTask,
                    icon: FileCheck2,
                    v: "review" as View,
                  },
                ].map(({ n, text, icon: Icon, v }) => (
                  <button
                    className="task"
                    key={text}
                    onClick={() => navigate(v)}
                  >
                    <span className="task-icon">
                      <Icon size={19} />
                    </span>
                    <span>
                      <strong>
                        {n} {text}
                      </strong>
                      <small>
                        {locale === "vi"
                          ? "Xem và tiếp tục hoàn thiện nội dung"
                          : "Review and complete your content"}
                      </small>
                    </span>
                    <ArrowRight size={17} />
                  </button>
                ))}
              </section>
              <section className="panel recent-panel">
                <div className="panel-heading">
                  <h2>{t.recent}</h2>
                  <button
                    className="text-button"
                    onClick={() => navigate("places")}
                  >
                    {t.all}
                    <ArrowRight size={15} />
                  </button>
                </div>
                {loading ? (
                  <Loading text={t.loading} />
                ) : (
                  data.items.slice(0, 4).map((p) => (
                    <button
                      className="recent-place"
                      onClick={() => setEditing(p)}
                      key={p.id}
                    >
                      <Cover poi={p} />
                      <div>
                        <strong>{p.name}</strong>
                        <small>{categoryFor(p.category_id)?.name}</small>
                      </div>
                      <Badge status={p.status} t={t} />
                    </button>
                  ))
                )}
              </section>
            </div>
          )}
          {view === "languages" && (
            <LanguageManager
              languages={languages}
              locale={locale}
              canEdit={user.role === "admin"}
              onSaved={notify}
            />
          )}
          {(view === "places" || view === "review" || view === "languages") && (
            <section className="panel places-panel" aria-label={t[view]}>
              {view === "places" && (
                <div className="filter-tabs" role="group" aria-label={t.status}>
                  {[
                    { id: "", label: t.all, count: summary.total },
                    { id: "published", label: t.published },
                    { id: "draft", label: t.draft },
                    { id: "in_review", label: t.waiting },
                    { id: "approved", label: t.approved },
                    { id: "archived", label: t.archived },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      className={status === tab.id ? "selected" : ""}
                      onClick={() => {
                        setStatus(tab.id);
                        setPage(1);
                      }}
                      aria-pressed={status === tab.id}
                    >
                      {tab.label}
                      {tab.count !== undefined && (
                        <span>{loading ? "–" : tab.count}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              <div className="toolbar">
                <label className="search-field">
                  <Search size={18} />
                  <input
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPage(1);
                    }}
                    placeholder={t.search}
                    aria-label={t.search}
                  />
                  {query && (
                    <button onClick={() => setQuery("")} aria-label={t.clear}>
                      <X size={16} />
                    </button>
                  )}
                </label>
                <div className="toolbar-right">
                  <label className="select-wrap">
                    <Tags size={16} />
                    <select
                      value={category}
                      onChange={(e) => {
                        setCategory(e.target.value);
                        setPage(1);
                      }}
                      aria-label={t.category}
                    >
                      <option value="">{t.allCategories}</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="select-wrap sort-select">
                    <ArrowDownWideNarrow size={16} />
                    <select
                      value={sort}
                      onChange={(e) => {
                        setSort(e.target.value);
                        setPage(1);
                      }}
                      aria-label={
                        locale === "vi" ? "Sắp xếp địa điểm" : "Sort places"
                      }
                    >
                      <option value="views">
                        {locale === "vi" ? "Lượt xem giảm dần" : "Most viewed"}
                      </option>
                      <option value="updated">{t.updated}</option>
                      <option value="name">{t.nameSort}</option>
                    </select>
                  </label>
                  {view === "places" && (
                    <div className="view-toggle">
                      <button
                        className={layout === "list" ? "active" : ""}
                        aria-label={t.listView}
                        aria-pressed={layout === "list"}
                        onClick={() => setLayout("list")}
                      >
                        <List size={18} />
                      </button>
                      <button
                        className={layout === "grid" ? "active" : ""}
                        aria-label={t.gridView}
                        aria-pressed={layout === "grid"}
                        onClick={() => setLayout("grid")}
                      >
                        <Grid2X2 size={17} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {loading ? (
                <div
                  className="skeleton-list"
                  aria-label={t.loading}
                  role="status"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <div key={n}>
                      <span />
                      <i />
                      <i />
                      <i />
                    </div>
                  ))}
                </div>
              ) : data.items.length === 0 ? (
                <Empty
                  title={
                    view === "review" && !query && !category
                      ? t.emptyReview
                      : t.noResults
                  }
                  description={
                    view === "review" && !query && !category
                      ? t.emptyReviewDesc
                      : t.noResultsDesc
                  }
                >
                  {(query || status || category) && (
                    <button className="button secondary" onClick={clearFilters}>
                      {t.clear}
                    </button>
                  )}
                </Empty>
              ) : view === "languages" ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>{t.name}</th>
                        {enabledLanguages.map((language) => (
                          <th key={language.code}>{language.native_name}</th>
                        ))}
                        <th>{t.actions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <div className="place-cell">
                              <Cover poi={p} />
                              <div>
                                <button
                                  className="place-name"
                                  onClick={() => setEditing(p)}
                                >
                                  {p.name}
                                </button>
                                <small>
                                  {categoryFor(p.category_id)?.name}
                                </small>
                              </div>
                            </div>
                          </td>
                          {languageCodes.map((lang) => (
                            <td key={lang}>
                              <div className="translation-cell">
                                <span
                                  className={
                                    p.translations[lang]?.text
                                      ? "ready"
                                      : "missing"
                                  }
                                >
                                  <BookOpen size={14} />
                                  {p.translations[lang]?.text
                                    ? t.complete
                                    : t.missing}
                                </span>
                                <span
                                  className={
                                    p.translations[lang]?.tts_ready
                                      ? "ready"
                                      : "missing"
                                  }
                                >
                                  <Volume2 size={14} />
                                  {p.translations[lang]?.tts_ready
                                    ? t.validAudio
                                    : t.needAudio}
                                </span>
                              </div>
                            </td>
                          ))}
                          <td>
                            <button
                              className="row-edit"
                              onClick={() => setEditing(p)}
                            >
                              {t.edit}
                              <ArrowUpRight size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (layout === "grid" || narrow) &&
                (view === "places" || view === "review") ? (
                <div className="place-grid">
                  {data.items.map((p) => (
                    <article className="place-card" key={p.id}>
                      <button
                        className="cover-button"
                        onClick={() => setEditing(p)}
                        aria-label={`${t.edit}: ${p.name}`}
                      >
                        <Cover poi={p} large />
                      </button>
                      <div className="place-card-content">
                        <Badge status={p.status} t={t} />
                        {user.role === "admin" && (
                          <p className="card-statistics">
                            {locale === "vi" ? "Lượt xem" : "Views"}:{" "}
                            {p.view_count ?? 0} ·{" "}
                            {locale === "vi" ? "Lượt nghe" : "Listening starts"}
                            : {p.listen_count ?? 0}
                          </p>
                        )}
                        <h3>
                          <button onClick={() => setEditing(p)}>
                            {p.name}
                          </button>
                        </h3>
                        <p>
                          <MapPin size={13} />
                          {p.address}
                        </p>
                        <div className="card-bottom">
                          <span>{categoryFor(p.category_id)?.name}</span>
                          <span className="language-chips">
                            {languageCodes
                              .filter((code) => p.translations[code]?.tts_ready)
                              .map((code) => code.toUpperCase())
                              .join(" · ")}
                          </span>
                        </div>
                        <button
                          className="button secondary small"
                          onClick={() => {
                            setPreviewing(true);
                            setEditing(p);
                          }}
                        >
                          <Eye size={14} />
                          {locale === "vi" ? "Xem trước" : "Preview"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>{t.name}</th>
                        <th>{t.category}</th>
                        <th>{t.language}</th>
                        <th>{t.audio}</th>
                        <th>{t.status}</th>
                        {user.role === "admin" && (
                          <>
                            <th>{locale === "vi" ? "Lượt xem" : "Views"}</th>
                            <th>
                              {locale === "vi"
                                ? "Lượt nghe"
                                : "Listening starts"}
                            </th>
                          </>
                        )}
                        <th>{t.updatedAt}</th>
                        <th className="sr-only">{t.actions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((p) => {
                        const c = categoryFor(p.category_id);
                        const audio = languageCodes.filter(
                          (code) => p.translations[code]?.tts_ready,
                        ).length;
                        return (
                          <tr key={p.id}>
                            <td>
                              <div className="place-cell">
                                <Cover poi={p} />
                                <div>
                                  <button
                                    className="place-name"
                                    onClick={() => setEditing(p)}
                                  >
                                    {p.name}
                                  </button>
                                  <small>
                                    <MapPin size={11} />
                                    {p.address.split(",")[0]}
                                  </small>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className={`category-pill ${c?.color}`}>
                                {c?.name ?? "—"}
                              </span>
                            </td>
                            <td>
                              <div className="language-chips">
                                {enabledLanguages
                                  .filter(
                                    (language) =>
                                      language.required ||
                                      p.translations[language.code]?.tts_ready,
                                  )
                                  .map(({ code: l }) => (
                                    <span
                                      key={l}
                                      className={
                                        p.translations[l]?.text
                                          ? "available"
                                          : "unavailable"
                                      }
                                      title={
                                        p.translations[l]?.text
                                          ? t.complete
                                          : t.missing
                                      }
                                    >
                                      {l.toUpperCase()}
                                      {p.translations[l]?.text && (
                                        <Check size={10} />
                                      )}
                                    </span>
                                  ))}
                              </div>
                            </td>
                            <td>
                              <span
                                className={`audio-count ${enabledLanguages.filter((language) => language.required).every((language) => p.translations[language.code]?.tts_ready) ? "ready" : ""}`}
                                title={`${audio}/${languageCodes.length} ${t.validAudio}`}
                              >
                                <Headphones size={15} />
                                {audio}/{languageCodes.length}
                              </span>
                            </td>
                            <td>
                              <Badge status={p.status} t={t} />
                              {p.has_published && p.status !== "published" && (
                                <small className="live-note">
                                  {locale === "vi"
                                    ? "Có bản đang phát hành"
                                    : "Live version available"}
                                </small>
                              )}
                            </td>
                            {user.role === "admin" && (
                              <>
                                <td>{p.view_count ?? 0}</td>
                                <td>{p.listen_count ?? 0}</td>
                              </>
                            )}
                            <td>
                              <span className="date-cell">
                                {new Intl.DateTimeFormat(
                                  locale === "vi" ? "vi-VN" : "en-GB",
                                  {
                                    day: "2-digit",
                                    month: "2-digit",
                                    year: "numeric",
                                    timeZone: "Asia/Bangkok",
                                  },
                                ).format(new Date(p.updated_at))}
                              </span>
                            </td>
                            <td>
                              <button
                                className="row-edit"
                                onClick={() => {
                                  setPreviewing(true);
                                  setEditing(p);
                                }}
                                aria-label={`${locale === "vi" ? "Xem trước" : "Preview"}: ${p.name}`}
                              >
                                <Eye size={17} />
                              </button>
                              <button
                                className="row-edit"
                                onClick={() => setEditing(p)}
                                aria-label={`${t.edit}: ${p.name}`}
                                title={t.edit}
                              >
                                <ArrowUpRight size={17} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {view !== "languages" && (
                <div className="pagination">
                  <span>
                    {data.total > 0
                      ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, data.total)}`
                      : "0"}{" "}
                    <span className="muted">
                      / {data.total} {t.results}
                    </span>
                  </span>
                  <div>
                    <label className="per-page">
                      <select
                        value={pageSize}
                        onChange={(e) => {
                          setPageSize(Number(e.target.value));
                          setPage(1);
                        }}
                        aria-label={t.perPage}
                      >
                        {[4, 8, 16, 32].map((n) => (
                          <option key={n} value={n}>
                            {n} / {t.perPage}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="icon-button page-button"
                      disabled={page === 1 || loading}
                      onClick={() => setPage((p) => p - 1)}
                      aria-label={t.previous}
                    >
                      <ChevronLeft size={17} />
                    </button>
                    <span className="current-page">{page}</span>
                    <button
                      className="icon-button page-button"
                      disabled={page * pageSize >= data.total || loading}
                      onClick={() => setPage((p) => p + 1)}
                      aria-label={t.next}
                    >
                      <ChevronRight size={17} />
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
          {view === "categories" &&
            (loading ? (
              <Loading text={t.loading} />
            ) : (
              <div className="categories-grid">
                {categories.map((c) => (
                  <article className={`category-card ${c.color}`} key={c.id}>
                    <span className="category-icon">
                      <Tags size={23} />
                    </span>
                    <h2>{c.name}</h2>
                    <p>
                      {c.count} {t.results}
                    </p>
                    <div>
                      <button
                        className="text-button"
                        onClick={() => {
                          navigate("places");
                          setCategory(c.id);
                        }}
                      >
                        {t.managePlaces}
                        <ArrowRight size={16} />
                      </button>
                      {user.role === "admin" && (
                        <button
                          className="text-button"
                          onClick={() => {
                            setCategoryEditing(c);
                            setCategoryName(c.name);
                            setCategoryError("");
                            setCategoryDialog(true);
                          }}
                        >
                          {locale === "vi"
                            ? "Sửa tên danh mục"
                            : "Edit category name"}
                        </button>
                      )}
                      {user.role === "admin" && (
                        <button
                          className="icon-button"
                          disabled={c.count > 0}
                          onClick={() => {
                            setCategoryError("");
                            setDeleteTarget(c);
                          }}
                          aria-label={`${t.delete}: ${c.name}`}
                          title={
                            c.count > 0
                              ? locale === "vi"
                                ? "Chỉ xóa được danh mục trống"
                                : "Only empty categories can be deleted"
                              : t.delete
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            ))}
          <div className="guide-banner">
            <span className="guide-icon">
              <BookOpen size={23} />
            </span>
            <div>
              <strong>{t.guideTitle}</strong>
              <p>{t.guideDesc}</p>
            </div>
            <button className="button secondary" onClick={() => setHelp(true)}>
              {t.seeGuide}
              <ArrowRight size={15} />
            </button>
          </div>
          <footer className="page-footer">
            <span>
              © {new Date().getFullYear()} Saigon Stories <i>•</i>{" "}
              {locale === "vi"
                ? "Chăm chút từng trải nghiệm"
                : "Made for meaningful experiences"}
            </span>
            <span>{date.format(new Date())}</span>
          </footer>
        </main>
      </div>
      {editing && (
        <Editor
          initial={editing}
          initialPreview={previewing}
          categories={categories}
          languages={languages}
          user={user}
          locale={locale}
          onClose={() => {
            setEditing(null);
            setPreviewing(false);
          }}
          onSaved={notify}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={19} />
          <span>{uiMessage(toast, locale, "success")}</span>
          <button onClick={() => setToast("")} aria-label={t.close}>
            <X size={15} />
          </button>
        </div>
      )}
      {help && (
        <Dialog locale={locale} title={t.help} onClose={() => setHelp(false)}>
          <div className="dialog-content help-content">
            <div className="help-lead">
              <span>
                <Headphones size={26} />
              </span>
              <p>{t.helpIntro}</p>
            </div>
            {[1, 2, 3, 4].map((n) => (
              <div className="help-step" key={n}>
                <span>{n.toString().padStart(2, "0")}</span>
                <div>
                  <h3>{t[`step${n}` as keyof typeof t]}</h3>
                  <p>{t[`step${n}desc` as keyof typeof t]}</p>
                </div>
              </div>
            ))}
            <div className="notice info">
              <ShieldCheck size={20} />
              <p>
                {locale === "vi"
                  ? "Biên tập viên gửi duyệt. Người duyệt có thể yêu cầu sửa. Quản trị viên kiểm tra, xác nhận và xuất bản. Du khách chỉ nhìn thấy bản đã xuất bản."
                  : "Editors submit drafts. Reviewers can request changes. Administrators check, confirm and publish. Visitors only see published versions."}
              </p>
            </div>
            <button
              className="button primary full-width"
              onClick={() => setHelp(false)}
            >
              {locale === "vi"
                ? "Đã hiểu, bắt đầu thôi"
                : "Got it, let’s get started"}
              <ArrowRight size={17} />
            </button>
          </div>
        </Dialog>
      )}
      {settings && (
        <Dialog
          locale={locale}
          title={t.custom}
          onClose={() => setSettings(false)}
        >
          <div className="dialog-content">
            <label className="preference">
              <span>
                <strong>{t.textSize}</strong>
                <small>{t.textSizeDesc}</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={large}
                onChange={(e) => setLarge(e.target.checked)}
              />
            </label>
            <label className="preference">
              <strong>{t.uiLanguage}</strong>
              <select
                className="input"
                value={locale}
                onChange={(e) => setLocale(e.target.value as UiLocale)}
              >
                <option value="vi">Tiếng Việt</option>
                <option value="en">English</option>
              </select>
            </label>
            <p className="muted text-small">{t.settingsSaved}</p>
          </div>
        </Dialog>
      )}
      {categoryDialog && (
        <Dialog
          locale={locale}
          title={t.addCategory}
          onClose={() => {
            if (!categoryBusy) {
              setCategoryDialog(false);
              setCategoryEditing(null);
              setCategoryName("");
            }
          }}
        >
          <form className="dialog-content" onSubmit={createCategory}>
            <label className="field-label">
              {t.categoryName}
              <input
                className="input"
                autoFocus
                required
                maxLength={100}
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder={
                  locale === "vi"
                    ? "Ví dụ: Ẩm thực địa phương"
                    : "e.g. Local food"
                }
              />
            </label>
            {categoryError && (
              <div className="notice error" role="alert">
                {uiMessage(categoryError, locale)}
              </div>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setCategoryDialog(false);
                  setCategoryEditing(null);
                  setCategoryName("");
                }}
                disabled={categoryBusy}
              >
                {t.cancel}
              </button>
              <button
                className="button primary"
                disabled={categoryBusy || !categoryName.trim()}
              >
                {categoryBusy
                  ? t.saving
                  : categoryEditing
                    ? locale === "vi"
                      ? "Lưu danh mục"
                      : "Save category"
                    : t.create}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {deleteTarget && (
        <Dialog
          locale={locale}
          title={t.delete}
          onClose={() => {
            if (!categoryBusy) setDeleteTarget(null);
          }}
        >
          <div className="dialog-content">
            <p>
              {locale === "vi"
                ? `Xóa danh mục trống “${deleteTarget.name}”?`
                : `Delete the empty category “${deleteTarget.name}”?`}
            </p>
            {categoryError && (
              <div className="notice error" role="alert">
                {uiMessage(categoryError, locale)}
              </div>
            )}
            <div className="dialog-actions">
              <button
                className="button secondary"
                disabled={categoryBusy}
                onClick={() => setDeleteTarget(null)}
              >
                {t.cancel}
              </button>
              <button
                className="button danger"
                disabled={categoryBusy}
                onClick={deleteCategory}
              >
                {t.delete}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function Login({
  onLogin,
  initialError,
  locale,
  setLocale,
}: {
  onLogin: (u: User) => void;
  initialError: string;
  locale: UiLocale;
  setLocale: (l: UiLocale) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  async function submit(e?: FormEvent, demo = false) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      onLogin(
        await api<User>("/admin/auth/login", {
          method: "POST",
          body: JSON.stringify({
            email: demo ? "admin@quan1.local" : email,
            password: demo ? "Quan1Demo!2026" : password,
          }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const vi = locale === "vi";
  return (
    <div className="login-page">
      <section className="login-story">
        <Brand vi={locale === "vi"} />
        <div className="login-story-content">
          <span className="login-kicker">SAIGON, ONE STORY AT A TIME</span>
          <h1>
            {vi ? (
              <>
                Những câu chuyện
                <br />
                bắt đầu từ <em>bạn.</em>
              </>
            ) : (
              <>
                Great stories
                <br />
                begin with <em>you.</em>
              </>
            )}
          </h1>
          <p>
            {vi
              ? "Một không gian để gìn giữ di sản, kết nối văn hóa và mang Sài Gòn đến gần hơn với mỗi du khách."
              : "A space to preserve heritage, connect cultures and bring Saigon closer to every visitor."}
          </p>
          <div className="login-illustration">
            <Cover poi={{ cover: 1, image_id: null, name: "Sài Gòn" }} large />
            <Cover poi={{ cover: 0, image_id: null, name: "Sài Gòn" }} large />
            <Cover poi={{ cover: 3, image_id: null, name: "Sài Gòn" }} large />
          </div>
        </div>
        <small>
          {vi
            ? "QUẬN 1 TOURISM · KHÔNG GIAN NỘI DUNG"
            : "DISTRICT 1 TOURISM · CONTENT STUDIO"}
        </small>
      </section>
      <section className="login-form-wrap">
        <button
          className="locale-button login-language"
          onClick={() => setLocale(vi ? "en" : "vi")}
        >
          <Globe2 size={16} />
          {vi ? "English" : "Tiếng Việt"}
        </button>
        <form className="login-form" onSubmit={(e) => submit(e)}>
          <div className="login-icon">
            <Headphones size={26} />
          </div>
          <h2>{vi ? "Chào mừng trở lại" : "Welcome back"}</h2>
          <p>
            {vi
              ? "Đăng nhập để tiếp tục chăm chút những câu chuyện."
              : "Sign in to keep your stories moving."}
          </p>
          <label className="field-label">
            Email
            <input
              className="input"
              autoComplete="username"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ban@example.com"
            />
          </label>
          <label className="field-label">
            {vi ? "Mật khẩu" : "Password"}
            <input
              className="input"
              autoComplete="current-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={vi ? "Nhập mật khẩu của bạn" : "Your password"}
            />
          </label>
          {error && (
            <div className="notice error" role="alert">
              {uiMessage(error, locale)}
            </div>
          )}
          <button className="button primary full-width" disabled={busy}>
            {busy
              ? vi
                ? "Đang đăng nhập…"
                : "Signing in…"
              : vi
                ? "Đăng nhập"
                : "Sign in"}
            <ArrowRight size={17} />
          </button>
          <div className="login-divider">
            <span>
              {vi ? "KHÔNG GIAN THỬ NGHIỆM LOCAL" : "LOCAL DEMO WORKSPACE"}
            </span>
          </div>
          <button
            type="button"
            className="button secondary full-width"
            disabled={busy}
            onClick={() => submit(undefined, true)}
          >
            <Sparkles size={16} />
            {vi ? "Trải nghiệm tài khoản demo" : "Explore the demo workspace"}
          </button>
          <small className="login-footnote">
            {vi
              ? "Tài khoản demo chỉ có sau khi chạy seed local. Dữ liệu được gắn nhãn mẫu, không tự động công khai."
              : "Run the local seed first. Sample content is labeled and never published automatically."}
          </small>
        </form>
        <span className="login-copyright">
          © Saigon Stories ·{" "}
          {vi ? "Lắng nghe. Khám phá. Kết nối." : "Listen. Explore. Connect."}
        </span>
      </section>
    </div>
  );
}
