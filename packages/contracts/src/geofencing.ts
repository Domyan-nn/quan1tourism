// Device-only state: never persisted or sent to an API.
export const GPS = {
  dwellMs: 5000,
  cooldownMs: 600000,
  maxAccuracyM: 50,
  staleMs: 15000,
};
export interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}
interface Target {
  id: string;
  latitude: number | null;
  longitude: number | null;
  auto_narration_enabled?: boolean;
  trigger_radius_m?: number;
  translations: Record<string, { text: string; tts_ready: boolean }>;
}
export function distanceM(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const radians = (n: number) => (n * Math.PI) / 180;
  const lat = radians(b.latitude - a.latitude),
    lng = radians(b.longitude - a.longitude);
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(lng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function fixProblem(fix: Fix, now: number) {
  if (
    ![fix.latitude, fix.longitude, fix.accuracy, fix.timestamp].every(
      Number.isFinite,
    ) ||
    Math.abs(fix.latitude) > 90 ||
    Math.abs(fix.longitude) > 180 ||
    fix.accuracy < 0
  )
    return "unavailable";
  if (now - fix.timestamp > GPS.staleMs || fix.timestamp > now + 1000)
    return "stale";
  if (fix.accuracy > GPS.maxAccuracyM) return "accuracy";
  return "ready";
}
export class Geofence {
  private pending: { id: string; since: number; sample: number } | null = null;
  private inside = new Set<string>();
  private played = new Map<string, number>();
  reset() {
    this.pending = null;
  }
  started(id: string, now: number) {
    this.played.set(id, now);
  }
  offer(
    fix: Fix,
    targets: Target[],
    locale: string,
    now: number,
    busy: boolean,
  ): string | null {
    if (fixProblem(fix, now) !== "ready") {
      this.reset();
      return null;
    }
    const candidates = [];
    for (const target of targets) {
      if (
        !target.auto_narration_enabled ||
        target.latitude === null ||
        target.longitude === null ||
        !target.translations[locale]?.tts_ready ||
        !target.translations[locale]?.text.trim()
      )
        continue;
      const distance = distanceM(fix, {
        latitude: target.latitude,
        longitude: target.longitude,
      });
      const radius = target.trigger_radius_m ?? 100;
      if (distance > radius + Math.max(20, radius * 0.2))
        this.inside.delete(target.id);
      if (
        distance <= radius &&
        fix.accuracy <= Math.min(GPS.maxAccuracyM, radius / 2) &&
        !this.inside.has(target.id) &&
        now - (this.played.get(target.id) ?? -Infinity) >= GPS.cooldownMs
      )
        candidates.push({ id: target.id, distance });
    }
    candidates.sort(
      (a, b) => a.distance - b.distance || a.id.localeCompare(b.id),
    );
    const nearest = candidates[0];
    if (!nearest || busy) {
      this.reset();
      return null;
    }
    if (
      !this.pending ||
      this.pending.id !== nearest.id ||
      fix.timestamp - this.pending.sample > GPS.staleMs
    ) {
      this.pending = {
        id: nearest.id,
        since: fix.timestamp,
        sample: fix.timestamp,
      };
      return null;
    }
    if (fix.timestamp <= this.pending.sample) return null;
    this.pending.sample = fix.timestamp;
    if (fix.timestamp - this.pending.since < GPS.dwellMs) return null;
    this.inside.add(nearest.id);
    this.reset();
    return nearest.id;
  }
}
