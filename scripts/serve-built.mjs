// Loopback-only artifact server for QA. No Vite compilation or external upstreams.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";

const root = resolve("apps/web/dist");
const admin = process.argv.includes("--admin");
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png" };
await stat(resolve(root, "index.html"));
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname.startsWith("/api/")) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const upstream = await fetch(`http://127.0.0.1:8010${url.pathname}${url.search}`, {
        method: request.method, headers: request.headers, redirect: "manual",
        body: ["GET", "HEAD"].includes(request.method) ? undefined : Buffer.concat(chunks),
      });
      response.writeHead(upstream.status, {
        ...Object.fromEntries([...upstream.headers].filter(([key]) => !["set-cookie", "content-encoding", "content-length"].includes(key))),
        "set-cookie": upstream.headers.getSetCookie(),
      });
      response.end(Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    // Existing admin scenarios enter at / on their dedicated QA port.
    if (admin && url.pathname === "/") {
      response.writeHead(302, { Location: "/admin/" }); response.end(); return;
    }
    let file = resolve(root, "." + decodeURIComponent(url.pathname));
    if (file !== root && !file.startsWith(root + sep)) throw new Error("path");
    if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    const body = await readFile(file);
    response.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
    response.end(body);
  } catch { response.writeHead(404); response.end("Not found"); }
}).listen(port, "127.0.0.1");
