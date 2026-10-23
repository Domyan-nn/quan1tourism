// Cloudflare Pages: keep auth cookies and API requests on the frontend origin.
interface Env { RENDER_API_ORIGIN?: string }
export const onRequest = async (context: {request: Request; env: Env}): Promise<Response> => {
  const origin = new URL(context.env.RENDER_API_ORIGIN || "https://quan1-tourism-api.onrender.com");
  if (origin.protocol !== "https:" || origin.username || origin.password) {
    return new Response("Invalid API configuration", {status: 503});
  }
  const target = new URL(context.request.url);
  target.protocol = origin.protocol;
  target.host = origin.host;
  const request = new Request(target, context.request);
  request.headers.delete("host");
  const upstream = await fetch(request, {redirect: "manual"});
  const response = new Response(upstream.body, upstream);
  response.headers.set("Cache-Control", "no-store");
  return response;
};
