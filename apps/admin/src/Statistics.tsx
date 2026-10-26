import { useEffect, useState } from "react";
import {
  Activity,
  CalendarDays,
  Globe2,
  RefreshCw,
  UsersRound,
} from "lucide-react";
import { api, uiMessage } from "@quan1/api-client";
import type { SiteStatistics } from "@quan1/contracts";
import { Loading } from "./components";
import type { UiLocale } from "./i18n";

export function Statistics({ locale }: { locale: UiLocale }) {
  const [data, setData] = useState<SiteStatistics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const vi = locale === "vi";
  const number = new Intl.NumberFormat(vi ? "vi-VN" : "en-GB");
  const date = new Intl.DateTimeFormat(vi ? "vi-VN" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  });

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    let pending = false;
    const load = () => {
      if (pending || document.visibilityState !== "visible") return;
      pending = true;
      void api<SiteStatistics>("/admin/statistics", {
        signal: controller.signal,
      })
        .then((stats) => {
          if (!controller.signal.aborted) {
            setData(stats);
            setError("");
          }
        })
        .catch((issue) => {
          if (!controller.signal.aborted) setError(issue.message);
        })
        .finally(() => {
          pending = false;
          if (!controller.signal.aborted) setLoading(false);
        });
    };
    load();
    const interval = window.setInterval(load, 15_000);
    document.addEventListener("visibilitychange", load);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", load);
    };
  }, [refresh]);

  const days = data?.daily.slice(-7) ?? [];
  const maximum = Math.max(1, ...days.map((day) => day.visits));
  return (
    <section
      className="panel site-statistics"
      aria-labelledby="site-statistics-title"
    >
      <div className="panel-heading">
        <div>
          <h2 id="site-statistics-title">
            {vi ? "Thống kê lượt truy cập" : "Website visits"}
          </h2>
          <p className="muted">
            {vi
              ? "Mỗi phiên được tính tối đa một lượt trong 30 phút. Ngày tính theo giờ Việt Nam (UTC+7)."
              : "Each session counts at most once per 30 minutes. Days use Vietnam time (UTC+7)."}
          </p>
        </div>
        <button
          className="button secondary small"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          <RefreshCw size={16} />
          {vi ? "Làm mới" : "Refresh"}
        </button>
      </div>
      {loading ? (
        <Loading text={vi ? "Đang tải thống kê…" : "Loading statistics…"} />
      ) : error ? (
        <p className="notice error" role="alert">
          {uiMessage(error, locale)}
        </p>
      ) : (
        data && (
          <>
            <div className="active-visitors">
              <div className="active-visitors-label">
                <UsersRound size={22} aria-hidden="true" />
                <span>{vi ? "Đang truy cập" : "Visitors online"}</span>
                <strong>{number.format(data.active_visitors)}</strong>
              </div>
              <p>
                {vi
                  ? `Phiên du khách hoạt động trong ${data.active_window_seconds} giây gần nhất · Tự cập nhật mỗi 15 giây`
                  : `Visitor sessions active in the last ${data.active_window_seconds} seconds · Updates every 15 seconds`}
              </p>
            </div>
            <div className="stats">
              {[
                {
                  label: vi ? "Tổng lượt truy cập" : "Total visits",
                  value: data.total_visits,
                  icon: Globe2,
                  color: "green",
                },
                {
                  label: vi ? "Hôm nay" : "Today",
                  value: data.today_visits,
                  icon: Activity,
                  color: "blue",
                },
                {
                  label: vi ? "7 ngày qua" : "Last 7 days",
                  value: data.last_7_days_visits,
                  icon: CalendarDays,
                  color: "purple",
                },
                {
                  label: vi ? "30 ngày qua" : "Last 30 days",
                  value: data.last_30_days_visits,
                  icon: CalendarDays,
                  color: "orange",
                },
              ].map(({ label, value, icon: Icon, color }) => (
                <div className="stat-card" key={label}>
                  <div className="stat-top">
                    <span>{label}</span>
                    <span className={`stat-icon ${color}`}>
                      <Icon size={18} />
                    </span>
                  </div>
                  <strong>{number.format(value)}</strong>
                </div>
              ))}
            </div>
            <h3>
              {vi
                ? "Lượt truy cập theo ngày · 7 ngày qua"
                : "Daily visits · Last 7 days"}
            </h3>
            {data.last_7_days_visits === 0 && (
              <p className="muted">
                {vi
                  ? "Chưa có lượt truy cập trong 7 ngày qua."
                  : "No visits in the last 7 days."}
              </p>
            )}
            <ul className="visit-history">
              {days.map((day) => (
                <li key={day.date}>
                  <time dateTime={day.date}>
                    {date.format(new Date(`${day.date}T00:00:00+07:00`))}
                  </time>
                  <span className="visit-track" aria-hidden="true">
                    <span
                      style={{ width: `${(day.visits / maximum) * 100}%` }}
                    />
                  </span>
                  <strong>{number.format(day.visits)}</strong>
                </li>
              ))}
            </ul>
            <p className="visit-engagement">
              {vi ? "Tổng lượt xem địa điểm" : "Total place views"}:{" "}
              <strong>{number.format(data.total_views)}</strong>
              <span aria-hidden="true"> · </span>
              {vi ? "Tổng lượt nghe" : "Total listens"}:{" "}
              <strong>{number.format(data.total_listens)}</strong>
            </p>
          </>
        )
      )}
    </section>
  );
}
