import { useEffect } from "react";
import { api } from "@quan1/api-client";

export function useSitePresence(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    let pending = false;
    const heartbeat = async () => {
      if (
        document.visibilityState !== "visible" ||
        !navigator.onLine ||
        pending
      )
        return;
      pending = true;
      try {
        await api<void>("/events/presence", {
          method: "POST",
          signal: controller.signal,
        });
      } catch {
        // Activity reporting must not interrupt reading, listening, or navigation.
      } finally {
        pending = false;
      }
    };
    void heartbeat();
    const interval = window.setInterval(() => void heartbeat(), 30_000);
    document.addEventListener("visibilitychange", heartbeat);
    window.addEventListener("online", heartbeat);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", heartbeat);
      window.removeEventListener("online", heartbeat);
    };
  }, [ready]);
}
