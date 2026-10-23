import { onRequest } from "../functions/api/[[path]]";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  RENDER_API_ORIGIN?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/api" || path.startsWith("/api/")) {
      return onRequest({ request, env });
    }
    return env.ASSETS.fetch(request);
  },
};
