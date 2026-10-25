import { useEffect, useRef, useState } from "react";
import { GPS, fixProblem, Geofence, type Fix } from "./geofencing";
import type { Poi } from "@quan1/contracts";
import { isSpeechBusy } from "@quan1/api-client";

export function useLocation(
  places: Poi[],
  locale: string,
  onAuto: (poi: Poi) => void,
) {
  const [enabled, setEnabled] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const [status, setStatus] = useState("idle");
  const [retry, setRetry] = useState(0);
  const watch = useRef<number | null>(null);
  const generation = useRef(0);
  const fence = useRef(new Geofence());
  const latest = useRef({ places, locale, onAuto, enabled });
  latest.current = { places, locale, onAuto, enabled };
  useEffect(() => {
    fence.current.reset();
  }, [locale]);
  const visibleAt = useRef(0);
  const ready = () => {
    if (!window.isSecureContext) {
      setStatus("insecure");
      return false;
    }
    if (!navigator.geolocation) {
      setStatus("unsupported");
      return false;
    }
    return true;
  };
  const clear = () => {
    generation.current++;
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    fence.current.reset();
  };
  const failure = (error: GeolocationPositionError) => {
    fence.current.reset();
    setStatus(
      error.code === 1
        ? "denied"
        : error.code === 3
          ? "timeout"
          : "unavailable",
    );
  };
  const receive = (position: GeolocationPosition, automatic: boolean) => {
    const point: Fix = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: position.timestamp,
    };
    const problem = fixProblem(point, Date.now());
    if (problem !== "unavailable") setFix(point);
    if (document.hidden || point.timestamp < visibleAt.current) {
      fence.current.reset();
      if (latest.current.enabled) setStatus("stale");
      return;
    }
    setStatus(problem);
    if (automatic && latest.current.enabled) {
      const current = latest.current;
      const id = fence.current.offer(
        point,
        current.places,
        current.locale,
        Date.now(),
        isSpeechBusy(),
      );
      const poi = current.places.find((p) => p.id === id);
      if (poi) current.onAuto(poi);
      else if (problem === "ready") {
        const diagnosis = fence.current.diagnose(point, current.places, current.locale, Date.now(), isSpeechBusy());
        setStatus(diagnosis === "no-nearby" ? "nearby" : diagnosis === "missing-content" ? "missing" : diagnosis);
      }
    }
  };
  function locate() {
    if (!ready()) return;
    if (latest.current.enabled) {
      setRetry((value) => value + 1);
      return;
    }
    setStatus("locating");
    const token = ++generation.current;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (token === generation.current) receive(p, false);
      },
      (e) => {
        if (token === generation.current) failure(e);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }
  useEffect(() => {
    clear();
    if (!enabled || !ready()) return;
    setStatus("locating");
    const token = generation.current;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (token === generation.current) receive(p, true);
      },
      (e) => {
        if (token === generation.current) failure(e);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        if (token === generation.current) receive(p, true);
      },
      (e) => {
        if (token === generation.current) failure(e);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
    return clear;
  }, [enabled, retry]);
  useEffect(() => {
    const visibility = () => {
      visibleAt.current = Date.now();
      fence.current.reset();
      if (latest.current.enabled) setStatus("stale");
    };
    document.addEventListener("visibilitychange", visibility);
    const timer = setInterval(() => {
      if (latest.current.enabled && fix && Date.now() - fix.timestamp > GPS.staleMs) {
        fence.current.reset();
        setStatus("stale");
      }
    }, 1000);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      clearInterval(timer);
    };
  }, [fix]);
  useEffect(
    () => () => {
      clear();
      window.dispatchEvent(new Event("quan1-speech-stop-auto"));
    },
    [],
  );
  return {
    fix,
    status,
    enabled,
    locate,
    started: (id: string) => fence.current.started(id, Date.now()),
    toggle: () => {
      if (!enabled && !ready()) return;
      if (enabled) {
        latest.current.enabled = false;
        clear();
        window.dispatchEvent(new Event("quan1-speech-stop-auto"));
        setStatus("idle");
      }
      setEnabled(!enabled);
    },
  };
}
