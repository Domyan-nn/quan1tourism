import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Location from "expo-location";
import type { Poi } from "@quan1/contracts";
import { Geofence, GPS, type Fix } from "../../../packages/contracts/src/geofencing.ts";

export function useGps(places: Poi[], locale: string, busy: () => boolean, onAuto: (poi: Poi) => void, stopAudio: () => void) {
  const [enabled, setEnabled] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const [status, setStatus] = useState("idle");
  const [active, setActive] = useState(AppState.currentState === "active");
  const watch = useRef<Location.LocationSubscription | null>(null);
  const generation = useRef(0);
  const permissionGeneration = useRef(0);
  const fence = useRef(new Geofence());
  const latest = useRef({ places, locale, busy, onAuto, stopAudio });
  latest.current = { places, locale, busy, onAuto, stopAudio };
  const clear = () => {
    generation.current++;
    watch.current?.remove();
    watch.current = null;
    fence.current.reset();
  };
  useEffect(() => {
    const subscription = AppState.addEventListener("change", state => {
      setActive(state === "active");
      if (state !== "active") {
        // iOS permission dialogs can briefly be inactive. Cancel an opt-in only
        // when the app actually backgrounds, rather than when its dialog opens.
        if (state === "background") permissionGeneration.current++;
        clear();
        setFix(null);
        setStatus("background");
        latest.current.stopAudio();
      }
    });
    return () => { permissionGeneration.current++; subscription.remove(); clear(); };
  }, []);
  useEffect(() => { fence.current.reset(); }, [locale]);
  useEffect(() => {
    clear();
    if (!enabled || !active) return;
    const token = generation.current;
    setStatus("locating");
    let received = false;
    const timeout = setTimeout(() => { if (!received && token === generation.current) setStatus("unavailable"); }, 15000);
    const receive = (location: Location.LocationObject) => {
      if (token !== generation.current || AppState.currentState !== "active") return;
      received = true;
      const point = {
        latitude: location.coords.latitude, longitude: location.coords.longitude,
        accuracy: location.coords.accuracy ?? Infinity, timestamp: location.timestamp,
      };
      setFix(point);
      const current = latest.current;
      const now = Date.now(), playing = current.busy();
      const id = fence.current.offer(point, current.places, current.locale, now, playing);
      setStatus(id ? "ready" : fence.current.diagnose(point, current.places, current.locale, now, playing));
      const poi = current.places.find(p => p.id === id);
      if (poi) current.onAuto(poi);
    };
    void (async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (token !== generation.current) return;
      if (!permission.granted) { setEnabled(false); setStatus("denied"); return; }
      const subscription = await Location.watchPositionAsync({
        // Dwell requires fresh samples even while the visitor stands still.
        accuracy: Location.Accuracy.High, timeInterval: 1500, distanceInterval: 0,
      }, receive, () => { if (token === generation.current) setStatus("unavailable"); });
      if (token !== generation.current) subscription.remove();
      else watch.current = subscription;
    })().catch(() => { if (token === generation.current) setStatus("unavailable"); });
    const timer = setInterval(() => setFix(current => {
      if (current && Date.now() - current.timestamp > GPS.staleMs) {
        fence.current.reset(); setStatus("stale");
      }
      return current;
    }), 1500);
    return () => { clear(); clearTimeout(timeout); clearInterval(timer); };
  }, [enabled, active]);
  async function toggle() {
    if (enabled) {
      permissionGeneration.current++;
      clear(); setEnabled(false); setFix(null); setStatus("idle"); latest.current.stopAudio();
      return;
    }
    // Permission is requested exclusively following this explicit button press.
    const token = ++permissionGeneration.current;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (token !== permissionGeneration.current || AppState.currentState === "background") return;
      if (!permission.granted) { setStatus("denied"); return; }
      setEnabled(true);
    } catch { setStatus("unavailable"); }
  }
  return { enabled, fix, status, toggle, started: (id: string) => fence.current.started(id, Date.now()) };
}
