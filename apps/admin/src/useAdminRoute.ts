import { useEffect, useRef, useState } from "react";

export function editorId(hash: string): string | null {
  const match = /^#places\/(new|[^/]+)$/.exec(hash);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

// Keep the existing hash navigation, with an indexed history so a cancelled
// Back/Forward restores the actual entry rather than adding a duplicate entry.
export function useAdminRoute() {
  const [hash, setHash] = useState(location.hash || "#places");
  const guard = useRef<() => boolean>(() => true);
  const current = useRef(hash);
  const index = useRef<number>(history.state?.adminIndex ?? 0);
  const restoring = useRef(false);
  useEffect(() => {
    history.replaceState({ ...history.state, adminIndex: index.current }, "");
    const changed = () => {
      if (restoring.current) {
        if (location.hash === current.current) restoring.current = false;
        return;
      }
      const next = location.hash || "#places";
      if (next === current.current) return;
      const nextIndex = history.state?.adminIndex ?? index.current + 1;
      if (!guard.current()) {
        restoring.current = true;
        history.go(index.current - nextIndex);
        return;
      }
      index.current = nextIndex;
      history.replaceState({ ...history.state, adminIndex: nextIndex }, "");
      current.current = next;
      setHash(next);
    };
    window.addEventListener("popstate", changed);
    window.addEventListener("hashchange", changed);
    return () => {
      window.removeEventListener("popstate", changed);
      window.removeEventListener("hashchange", changed);
    };
  }, []);
  function go(next: string, replace = false, checked = false) {
    if (next === current.current) return true;
    if (!checked && !guard.current()) return false;
    if (!replace) index.current++;
    history[replace ? "replaceState" : "pushState"](
      { ...history.state, adminIndex: index.current },
      "",
      next,
    );
    current.current = next;
    setHash(next);
    return true;
  }
  return { hash, go, guard };
}
