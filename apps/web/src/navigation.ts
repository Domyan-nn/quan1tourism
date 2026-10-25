import { useEffect, useRef, useState } from "react";

type View = "list" | "map";
export type MapViewport = { latitude: number; longitude: number; zoom: number };
type Context = { scroll: number; map?: MapViewport; fromList?: boolean };
const readRoute = () => {
  const params = new URLSearchParams(location.search);
  return {
    poi: params.get("poi") || "",
    query: params.get("q") || "",
    view: (params.get("view") === "map" ? "map" : "list") as View,
  };
};

// Keep ordinary shareable URLs and the browser's native history stack.
export function useVisitorNavigation(loading: boolean) {
  const [route, setRoute] = useState(readRoute);
  const context = useRef<Context>(history.state?.visitor || { scroll: 0 });
  const restore = useRef(!route.poi);
  const mapViewport = useRef(context.current.map);
  function write(next: typeof route, push = false) {
    const url = new URL(location.href);
    for (const [key, value] of Object.entries({
      poi: next.poi,
      q: next.query,
      view: next.view === "map" ? "map" : "",
    })) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    history[push ? "pushState" : "replaceState"](
      { ...history.state, visitor: context.current }, "", url,
    );
    setRoute(next);
  }
  useEffect(() => {
    const previous = history.scrollRestoration;
    history.scrollRestoration = "manual";
    const pop = () => {
      context.current = history.state?.visitor || { scroll: 0 };
      mapViewport.current = context.current.map;
      restore.current = true;
      setRoute(readRoute());
    };
    window.addEventListener("popstate", pop);
    return () => {
      history.scrollRestoration = previous;
      window.removeEventListener("popstate", pop);
    };
  }, []);
  useEffect(() => {
    if (loading || !restore.current) return;
    const frame = requestAnimationFrame(() => {
      window.scrollTo(0, route.poi ? 0 : context.current.scroll);
      restore.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [route, loading]);
  return {
    ...route,
    mapViewport,
    rememberMap: (value: MapViewport) => {
      mapViewport.current = value;
      context.current = { ...context.current, map: value };
      history.replaceState({ ...history.state, visitor: context.current }, "");
    },
    setQuery: (query: string) => write({ ...route, query }),
    setView: (view: View) => write({ ...route, view }),
    open: (poi: string) => {
      context.current = { scroll: window.scrollY, map: mapViewport.current };
      history.replaceState({ ...history.state, visitor: context.current }, "");
      context.current = { ...context.current, fromList: true };
      write({ ...route, poi }, true);
      window.scrollTo(0, 0);
    },
    back: () => {
      if (history.state?.visitor?.fromList) history.back();
      else {
        restore.current = true;
        write({ ...route, poi: "" });
      }
    },
  };
}
