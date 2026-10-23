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
      result.headers.set("X-Release-SHA", env.RELEASE_SHA || "local");
      return result;
    }
    return response;
  },
};
