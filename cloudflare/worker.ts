import { onRequest } from "../functions/api/[[path]]";
import { mapTile } from "./map-tiles";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  RENDER_API_ORIGIN?: string;
  RELEASE_SHA?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/map-tiles/")) return mapTile(request);
    if (path === "/api" || path.startsWith("/api/")) {
      return onRequest({ request, env });
    }
    const response = await env.ASSETS.fetch(request);
    if (path === "/release.json") {
      const result = new Response(response.body, response);
      result.headers.set("Cache-Control", "no-store");
      let release = env.RELEASE_SHA;
      if (!release) {
        // Workers Builds supplies the commit at build time; the assets belong to this Worker version.
        const metadata = await result.clone().json().catch(() => null) as { release?: string } | null;
        release = metadata?.release;
      }
      result.headers.set("X-Release-SHA", release && /^[a-f0-9]{40}$/.test(release) ? release : "local");
      return result;
    }
    return response;
  },
};
