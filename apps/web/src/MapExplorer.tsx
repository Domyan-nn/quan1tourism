import { useState } from "react";
import { MapPin, X } from "lucide-react";
import {
  mediaUrl,
  PlaceMap,
  recordEngagement,
  SourceAttribution,
  SpeechPlayer,
} from "@quan1/api-client";
import type { Language, Poi } from "@quan1/contracts";

export function MapExplorer({
  places,
  languages,
  locale,
  onDetail,
}: {
  places: Poi[];
  languages: Language[];
  locale: string;
  onDetail: (poi: Poi) => void;
}) {
  const [selected, setSelected] = useState<Poi | null>(null);
  const [narrationLocale, setNarrationLocale] = useState(locale);
  const vi = locale === "vi";
  const available = languages.filter(
    (language) => selected?.translations[language.code]?.tts_ready,
  );
  const language =
    available.find((item) => item.code === narrationLocale) ?? available[0];
  const narration = language && selected?.translations[language.code];
  function select(poi: Poi) {
    setSelected(poi);
    setNarrationLocale(locale);
    recordEngagement(poi.id, "view");
  }
  return (
    <div className="map-explorer">
      <PlaceMap places={places} onSelect={select} vi={vi} />
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
          <p className="address">
            <MapPin size={14} />
            {selected.address}
          </p>
          <p className="map-description">
            {selected.short_description || narration?.text.slice(0, 180)}
          </p>
          {available.length ? (
            <>
              <label className="map-language">
                {vi ? "Ngôn ngữ thuyết minh" : "Narration language"}
                <select
                  aria-label={
                    vi ? "Ngôn ngữ thuyết minh" : "Narration language"
                  }
                  value={language.code}
                  onChange={(event) => setNarrationLocale(event.target.value)}
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
                onStarted={() => recordEngagement(selected.id, "listen")}
              />
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
  );
}
