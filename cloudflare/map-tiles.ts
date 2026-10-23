// Only proxy visible map tiles from the fixed provider, never arbitrary URLs.
export async function mapTile(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const match = /^\/map-tiles\/(\d{1,2})\/(\d+)\/(\d+)\.png$/.exec(url.pathname);
  if (!match) return new Response("Not found", { status: 404 });
  const [z, x, y] = match.slice(1).map(Number);
  if (z > 19 || x >= 2 ** z || y >= 2 ** z) return new Response("Not found", { status: 404 });
  try {
    const upstream = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
      headers: {
        "User-Agent": `Quan1Tourism/1.0 (+${url.origin})`,
        "Referer": request.headers.get("Referer") || `${url.origin}/`,
        "Accept": "image/png",
      },
      // Cloudflare honors the provider's cache lifetime; do not forward browser no-cache headers.
      cf: { cacheEverything: true },
      signal: AbortSignal.timeout(10000),
    } as RequestInit);
    if (!upstream.ok) return new Response("Map tiles unavailable", { status: 502 });
    const headers = new Headers(upstream.headers);
    headers.set("Content-Type", "image/png");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.delete("Set-Cookie");
    if (!headers.has("Cache-Control")) headers.set("Cache-Control", "public, max-age=604800");
    return new Response(upstream.body, { headers });
  } catch {
    return new Response("Map tiles unavailable", { status: 502 });
  }
}
