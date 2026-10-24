import { useState } from "react";
import { MapPin, X } from "lucide-react";
import {
  mediaUrl,
  PlaceMap,
  recordEngagement,
  SourceAttribution,
  SpeechPlayer,
} from "@quan1/api-client";
import type { PublicCategory, Language, Poi } from "@quan1/contracts";
import { useLocation } from "./useLocation";
import { distanceM } from "./geofencing";

export function MapExplorer({
  places,
  languages,
  locale,
  onDetail,
  uiLocale,
  categories,
}: {
  places: Poi[];
  languages: Language[];
  locale: string;
  onDetail: (poi: Poi) => void;
  uiLocale: string;
  categories: PublicCategory[];
}) {
  const [selected, setSelected] = useState<Poi | null>(null);
  const [narrationLocale, setNarrationLocale] = useState(locale);
  const vi = uiLocale === "vi";
  const [autoRequest, setAutoRequest] = useState(0);
  const [autoPoi, setAutoPoi] = useState("");
  const [blocked, setBlocked] = useState(false);
  const [recenter, setRecenter] = useState(0);
  const gps = useLocation(places, narrationLocale, (poi) => {
    setSelected(poi);
    setAutoPoi(poi.id);
    setBlocked(false);
    setAutoRequest((value) => value + 1);
  });
  const available = languages;
  const language = available.find((item) => item.code === narrationLocale);
  const narration = language && selected?.translations[language.code];
  function select(poi: Poi) {
    setAutoPoi("");
    setAutoRequest(0);
    setBlocked(false);
    setSelected(poi);
    setNarrationLocale(locale);
    recordEngagement(poi.id, "view");
  }
  return (
    <>
      <div className="gps-controls">
        <button
          className="button secondary"
          onClick={() => {
            gps.locate();
            setRecenter((n) => n + 1);
          }}
        >
          {vi ? "Vị trí của tôi" : "My location"}
        </button>
        <button
          className="button"
          aria-pressed={gps.enabled}
          onClick={gps.toggle}
        >
          {gps.enabled
            ? vi
              ? "Tắt thuyết minh theo vị trí"
              : "Disable location narration"
            : vi
              ? "Bật thuyết minh theo vị trí"
              : "Enable location narration"}
        </button>
        <p role="status">{gpsMessages[vi ? "vi" : "en"][gps.status]}</p>
        {!["idle", "ready", "locating"].includes(gps.status) && (
          <button className="button secondary" onClick={gps.locate}>
            {vi ? "Thử lại GPS" : "Retry GPS"}
          </button>
        )}
        <small>
          {vi
            ? "Chỉ hoạt động khi trang đang mở. Vị trí được xử lý trên thiết bị."
            : "Works while this page is open. Location stays on your device."}
        </small>
      </div>
      <div className="map-explorer">
        <PlaceMap
          places={places}
          onSelect={select}
          vi={vi}
          userPosition={gps.fix}
          recenter={recenter}
        />
        {places.some(
          (poi) => poi.latitude === null || poi.longitude === null,
        ) && (
          <p className="map-hint">
            {vi
              ? "Một số địa điểm chưa có tọa độ. Bạn có thể xem trong danh sách."
              : "Some places have no coordinates yet. Find them in the list."}
          </p>
        )}
        {selected && (
          <section
            className="map-card"
            aria-label={vi ? "Thông tin địa điểm" : "Place information"}
            key={selected.id}
          >
            <button
              className="map-card-close"
              aria-label={vi ? "Đóng thẻ địa điểm" : "Close place card"}
              onClick={() => setSelected(null)}
            >
              <X size={18} />
            </button>
            {selected.image_id || selected.source?.image_url ? (
              <img
                className="map-card-image"
                src={
                  selected.image_id
                    ? mediaUrl(selected.image_id)
                    : (selected.source?.image_url ?? "")
                }
                alt={selected.name}
              />
            ) : (
              <div className="map-card-placeholder">
                <MapPin size={32} />
              </div>
            )}
            <h3>{selected.name}</h3>
            <p>
              {
                categories.find(
                  (category) => category.id === selected.category_id,
                )?.name
              }
            </p>
            {gps.fix &&
              selected.latitude !== null &&
              selected.longitude !== null && (
                <p>
                  {vi ? "Khoảng cách" : "Distance"}:{" "}
                  {Math.round(
                    distanceM(gps.fix, {
                      latitude: selected.latitude,
                      longitude: selected.longitude,
                    }),
                  )}{" "}
                  m{` (±${Math.round(gps.fix.accuracy)} m)`}
                </p>
              )}
            {blocked && (
              <p role="status">
                {vi
                  ? "Chạm Nghe thuyết minh để bắt đầu."
                  : "Tap Listen to narration to start."}
              </p>
            )}
            <p className="address">
              <MapPin size={14} />
              {selected.address}
            </p>
            <p className="map-description">
              {selected.short_description || narration?.text.slice(0, 180)}
            </p>
            {language ? (
              <>
                <label className="map-language">
                  {vi ? "Ngôn ngữ thuyết minh" : "Narration language"}
                  <select
                    aria-label={
                      vi ? "Ngôn ngữ thuyết minh" : "Narration language"
                    }
                    value={language.code}
                    onChange={(event) => {
                      setAutoPoi("");
                      setAutoRequest(0);
                      setNarrationLocale(event.target.value);
                    }}
                  >
                    {available.map((item) => (
                      <option value={item.code} key={item.code}>
                        {item.native_name}
                      </option>
                    ))}
                  </select>
                </label>
                <SpeechPlayer
                  key={`${selected.id}-${language.code}`}
                  text={narration?.text ?? ""}
                  speechLocale={language.speech_locale}
                  uiLocale={vi ? "vi" : "en"}
                  autoRequest={
                    gps.enabled && autoPoi === selected.id ? autoRequest : 0
                  }
                  onAutoBlocked={() => setBlocked(true)}
                  onStarted={() => {
                    recordEngagement(selected.id, "listen");
                    setBlocked(false);
                    gps.started(selected.id);
                  }}
                />
                {!narration?.tts_ready && (
                  <p role="status">
                    {vi
                      ? "Chưa có thuyết minh cho ngôn ngữ này."
                      : "No published narration in this language."}
                  </p>
                )}
              </>
            ) : (
              <p>{vi ? "Chưa có thuyết minh." : "No narration available."}</p>
            )}
            <button className="button" onClick={() => onDetail(selected)}>
              {vi ? "Xem chi tiết" : "View details"}
            </button>
            <SourceAttribution
              source={selected.source}
              vi={vi}
              imageUsed={!selected.image_id}
            />
          </section>
        )}
      </div>
    </>
  );
}

const gpsMessages: Record<string, Record<string, string>> = {
  vi: {
    idle: "Chưa bật định vị.",
    locating: "Đang lấy vị trí…",
    ready: "GPS sẵn sàng.",
    unsupported: "Trình duyệt không hỗ trợ định vị.",
    insecure: "Định vị cần HTTPS hoặc localhost.",
    denied:
      "Bạn chưa cấp quyền vị trí. Cho phép trong cài đặt trình duyệt rồi thử lại.",
    unavailable: "Chưa xác định được vị trí.",
    timeout: "Lấy vị trí quá thời gian. Hãy thử lại.",
    stale: "Cần vị trí mới để tự phát.",
    accuracy: "GPS chưa đủ chính xác; chưa tự phát thuyết minh.",
  },
  en: {
    idle: "Location is off.",
    locating: "Finding your location…",
    ready: "GPS ready.",
    unsupported: "Geolocation is unavailable in this browser.",
    insecure: "Location requires HTTPS or localhost.",
    denied:
      "Location permission denied. Allow it in browser settings and retry.",
    unavailable: "Location is unavailable.",
    timeout: "Location request timed out. Try again.",
    stale: "A fresh location is required for automatic narration.",
    accuracy: "GPS accuracy is too low for automatic narration.",
  },
};
