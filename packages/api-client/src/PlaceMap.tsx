import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import type { Poi } from "@quan1/contracts";
import { api, uiMessage } from "./index";
import "leaflet/dist/leaflet.css";
import "./map.css";
declare const __MAP_TILE_URL__: string;

type Point = {
  latitude: number | null;
  longitude: number | null;
  trigger_radius_m?: number;
  auto_narration_enabled?: boolean;
};
const center: L.LatLngTuple = [10.7769, 106.7009];
const valid = (
  p: Point,
): p is Point & { latitude: number; longitude: number } =>
  p.latitude !== null &&
  p.longitude !== null &&
  Number.isFinite(p.latitude) &&
  Number.isFinite(p.longitude) &&
  Math.abs(p.latitude) <= 90 &&
  Math.abs(p.longitude) <= 180;
const icon = () =>
  L.divIcon({
    className: "place-pin",
    html: '<span aria-hidden="true">●</span>',
    iconSize: [32, 40],
    iconAnchor: [16, 40],
  });

export function PlaceMap({
  places,
  onSelect,
  position,
  onChange,
  disabled = false,
  vi = true,
  userPosition,
  recenter = 0,
  viewport,
  onViewportChange,
}: {
  places?: Poi[];
  onSelect?: (poi: Poi) => void;
  position?: Point;
  onChange?: (point: { latitude: number; longitude: number }) => void;
  disabled?: boolean;
  vi?: boolean;
  userPosition?: {
    latitude: number;
    longitude: number;
    accuracy: number;
  } | null;
  recenter?: number;
  viewport?: { latitude: number; longitude: number; zoom: number };
  onViewportChange?: (view: { latitude: number; longitude: number; zoom: number }) => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.LayerGroup | null>(null);
  const userLayers = useRef<L.LayerGroup | null>(null);
  const centered = useRef(0);
  const fitted = useRef(false);
  const latest = useRef({ onSelect, onChange, disabled, onViewportChange });
  latest.current = { onSelect, onChange, disabled, onViewportChange };
  const [tileError, setTileError] = useState(false);
  useEffect(() => {
    if (!node.current) return;
    const restored = viewport && valid(viewport) && Number.isFinite(viewport.zoom);
    fitted.current = !!restored;
    const instance = L.map(node.current, { scrollWheelZoom: false }).setView(
      restored ? [viewport.latitude, viewport.longitude] : center,
      restored ? viewport.zoom : 14,
    );
    instance.on("moveend", () => {
      const point = instance.getCenter();
      latest.current.onViewportChange?.({ latitude: point.lat, longitude: point.lng, zoom: instance.getZoom() });
    });
    map.current = instance;
    L.tileLayer(__MAP_TILE_URL__, {
      maxZoom: 19,
      referrerPolicy: "strict-origin-when-cross-origin",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    })
      .on("tileerror", () => setTileError(true))
      .addTo(instance);
    layers.current = L.layerGroup().addTo(instance);
    userLayers.current = L.layerGroup().addTo(instance);
    instance.on("click", (event: L.LeafletMouseEvent) => {
      if (!latest.current.disabled)
        latest.current.onChange?.({
          latitude: Number(event.latlng.lat.toFixed(6)),
          longitude: Number(event.latlng.wrap().lng.toFixed(6)),
        });
    });
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(node.current);
    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
      layers.current = null;
      userLayers.current = null;
    };
  }, []);
  useEffect(() => {
    if (!map.current || !layers.current) return;
    const instance = map.current,
      group = layers.current;
    group.clearLayers();
    if (position) {
      if (valid(position)) {
        L.circle([position.latitude, position.longitude], {
          radius: position.trigger_radius_m ?? 100,
          color: position.auto_narration_enabled ? "#147566" : "#777",
          fillOpacity: 0.1,
        }).addTo(group);
        const pin = L.marker([position.latitude, position.longitude], {
          icon: icon(),
          draggable: !disabled,
          title: vi ? "Kéo ghim để đổi vị trí" : "Drag to move location",
        }).addTo(group);
        pin.on("dragend", () => {
          const point = pin.getLatLng().wrap();
          latest.current.onChange?.({
            latitude: Number(point.lat.toFixed(6)),
            longitude: Number(point.lng.toFixed(6)),
          });
        });
        instance.setView(
          [position.latitude, position.longitude],
          Math.max(instance.getZoom(), 16),
        );
      }
    } else {
      const points: L.LatLngTuple[] = [];
      for (const poi of places ?? []) {
        if (!valid(poi)) continue;
        const point: L.LatLngTuple = [poi.latitude, poi.longitude];
        points.push(point);
        L.marker(point, { icon: icon(), title: poi.name, alt: poi.name })
          .addTo(group)
          .on("click", () => latest.current.onSelect?.(poi));
      }
      if (points.length && !fitted.current) {
        fitted.current = true;
        instance.fitBounds(L.latLngBounds(points), {
          padding: [45, 45],
          maxZoom: 16,
        });
      }
    }
  }, [
    places,
    position?.latitude,
    position?.longitude,
    position?.trigger_radius_m,
    position?.auto_narration_enabled,
    disabled,
    vi,
  ]);
  useEffect(() => {
    userLayers.current?.clearLayers();
    if (
      !map.current ||
      !userLayers.current ||
      !userPosition ||
      !valid(userPosition) ||
      !Number.isFinite(userPosition.accuracy) || userPosition.accuracy < 0
    )
      return;
    const point: L.LatLngTuple = [
      userPosition.latitude,
      userPosition.longitude,
    ];
    L.circle(point, {
      radius: userPosition.accuracy,
      color: "#246bc1",
      fillOpacity: 0.12,
    }).addTo(userLayers.current);
    L.circleMarker(point, {
      radius: 7,
      color: "white",
      fillColor: "#246bc1",
      fillOpacity: 1,
    })
      .bindTooltip(vi ? "Vị trí của bạn" : "Your location")
      .addTo(userLayers.current);
    if (recenter > centered.current) {
      centered.current = recenter;
      map.current.setView(point, Math.max(16, map.current.getZoom()));
    }
  }, [userPosition, recenter, vi]);
  return (
    <div className="place-map-wrap">
      <div
        className="place-map"
        ref={node}
        role="region"
        aria-label={vi ? "Bản đồ địa điểm" : "Places map"}
      />
      {tileError && (
        <p className="map-message" role="status">
          {vi
            ? "Chưa tải được nền bản đồ. Bạn vẫn có thể chọn ghim hoặc nhập tọa độ."
            : "Map tiles are unavailable. You can still select pins or enter coordinates."}
        </p>
      )}
    </div>
  );
}

export function LocationEditor({
  value,
  saved,
  onChange,
  disabled,
  vi,
}: {
  value: Point;
  saved: Point;
  onChange: (point: Point) => void;
  disabled: boolean;
  vi: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    { label: string; latitude: number; longitude: number }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function search() {
    const token = ++generation.current;
    setBusy(true);
    setError("");
    setResults([]);
    try {
      const result = await api<{ items: typeof results }>(
        `/admin/map-search?q=${encodeURIComponent(query.trim())}`,
      );
      if (token !== generation.current) return;
      setResults(result.items);
      if (!result.items.length)
        setError(
          vi
            ? "Không tìm thấy vị trí. Thử địa chỉ đầy đủ hơn."
            : "No location found. Try a fuller address.",
        );
    } catch (e) {
      if (token === generation.current) setError((e as Error).message);
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  return (
    <details
      className="location-details"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{vi ? "Chỉnh sửa nâng cao" : "Advanced editing"}</summary>
      {open && (
        <div className="location-editor">
          <label className="field-label">
            <span>
              <input
                type="checkbox"
                checked={value.auto_narration_enabled ?? false}
                disabled={disabled || (!valid(value) && !value.auto_narration_enabled)}
                onChange={(event) =>
                  onChange({
                    ...value,
                    auto_narration_enabled: event.target.checked,
                  })
                }
              />
              {vi
                ? "Cho phép thuyết minh theo vị trí"
                : "Enable location narration"}
            </span>
          </label>
          {!valid(value) && <p className="field-hint">{vi ? "Thêm tọa độ hợp lệ trước khi bật thuyết minh theo vị trí." : "Add valid coordinates before enabling location narration."}</p>}
          <label className="field-label">
            {vi ? "Bán kính kích hoạt (m)" : "Trigger radius (m)"}
            <input
              className="input"
              type="number"
              min={20}
              max={1000}
              step={1}
              disabled={disabled}
              value={value.trigger_radius_m ?? 100}
              onChange={(event) =>
                onChange({
                  ...value,
                  trigger_radius_m: Number(event.target.value),
                })
              }
            />
          </label>
          <p className="field-hint">
            {vi
              ? "Kéo ghim hoặc nhấp bản đồ. Vị trí chỉ được ghi khi lưu thay đổi; địa chỉ không tự đổi."
              : "Drag the pin or click the map. Save changes to store the location; the address stays as entered."}
          </p>
          <label className="field-label">
            {vi ? "Tìm vị trí" : "Find a location"}
            <input
              className="input"
              value={query}
              maxLength={300}
              disabled={disabled}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                vi ? "Tên địa điểm hoặc địa chỉ" : "Place name or address"
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (!disabled && !busy && query.trim().length >= 2)
                    void search();
                }
              }}
            />
          </label>
          <button
            type="button"
            className="button secondary"
            onClick={search}
            disabled={disabled || busy || query.trim().length < 2}
          >
            {busy
              ? vi
                ? "Đang tìm…"
                : "Searching…"
              : vi
                ? "Tìm trên bản đồ"
                : "Search map"}
          </button>
          {error && <p role="alert">{uiMessage(error, vi ? "vi" : "en")}</p>}
          <div className="map-results">
            {results.map((result, index) => (
              <button
                type="button"
                key={index}
                disabled={disabled}
                onClick={() => {
                  onChange({
                    latitude: result.latitude,
                    longitude: result.longitude,
                  });
                  setResults([]);
                }}
              >
                {result.label}
              </button>
            ))}
          </div>
          <PlaceMap
            position={value}
            onChange={onChange}
            disabled={disabled}
            vi={vi}
          />
          <div className="two-fields">
            {(["latitude", "longitude"] as const).map((key) => (
              <label className="field-label" key={key}>
                {key === "latitude"
                  ? vi
                    ? "Vĩ độ"
                    : "Latitude"
                  : vi
                    ? "Kinh độ"
                    : "Longitude"}
                <input
                  className="input"
                  type="number"
                  min={key === "latitude" ? -90 : -180}
                  max={key === "latitude" ? 90 : 180}
                  step="any"
                  disabled={disabled}
                  value={value[key] ?? ""}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      [key]:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                    })
                  }
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            className="button secondary"
            disabled={disabled}
            onClick={() =>
              onChange({
                latitude: saved.latitude,
                longitude: saved.longitude,
                trigger_radius_m: saved.trigger_radius_m ?? 100,
                auto_narration_enabled: saved.auto_narration_enabled ?? false,
              })
            }
          >
            {vi ? "Khôi phục vị trí" : "Restore saved location"}
          </button>
        </div>
      )}
    </details>
  );
}
