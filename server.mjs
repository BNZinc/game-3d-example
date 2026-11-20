// Tiny static server for the built game (no dependencies).
//   PORT=3000 node server.mjs   → serves dist/ on 0.0.0.0:$PORT
//   GET /health                  → 200 "ok" (for the hosting health check)
import { createReadStream, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "dist");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "::"; // every address, IPv4 and IPv6

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".wasm": "application/wasm",
  ".ktx2": "image/ktx2",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};
// Worth compressing on the fly (results are cached in memory; the game is small).
const COMPRESSIBLE = new Set([".html", ".js", ".mjs", ".css", ".json", ".map", ".txt", ".md", ".svg", ".glb", ".gltf", ".bin", ".wasm"]);
const gzCache = new Map();

/** Resolves a URL path inside ROOT, or null if it tries to leave it. */
function safePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const full = normalize(join(ROOT, decoded));
  return full === ROOT || full.startsWith(ROOT + sep) ? full : null;
}

function fileAt(p) {
  try {
    const st = statSync(p);
    if (st.isFile()) return { path: p, size: st.size, mtime: st.mtime };
    if (st.isDirectory()) return fileAt(join(p, "index.html"));
  } catch {
    /* not found */
  }
  return null;
}

async function send(req, res, file, status = 200) {
  const ext = extname(file.path).toLowerCase();
  const headers = {
    "Content-Type": TYPES[ext] || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    // Vite puts a content hash in built file names, so those can be cached for good.
    "Cache-Control": ext === ".html" ? "no-cache" : /[-.][A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(file.path) ? "public, max-age=31536000, immutable" : "public, max-age=3600",
    "Last-Modified": file.mtime.toUTCString(),
  };
  const wantsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] || "");
  if (wantsGzip && COMPRESSIBLE.has(ext) && file.size > 1024) {
    const key = `${file.path}:${file.mtime.getTime()}`;
    let gz = gzCache.get(key);
    if (!gz) {
      gz = gzipSync(await readFile(file.path), { level: 9 });
      gzCache.set(key, gz);
    }
    res.writeHead(status, { ...headers, "Content-Encoding": "gzip", "Content-Length": gz.length, Vary: "Accept-Encoding" });
    res.end(req.method === "HEAD" ? undefined : gz);
    return;
  }
  res.writeHead(status, { ...headers, "Content-Length": file.size, Vary: "Accept-Encoding" });
  if (req.method === "HEAD") return res.end();
  createReadStream(file.path).on("error", () => res.destroy()).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      return res.end("ok");
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      return res.end();
    }
    const target = safePath(url.pathname);
    if (!target) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("bad request");
    }
    const file = fileAt(target);
    if (file) return await send(req, res, file);
    // Paths without a file extension fall back to the game page (single-page app).
    if (!extname(url.pathname)) {
      const index = fileAt(join(ROOT, "index.html"));
      if (index) return await send(req, res, index);
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("not found");
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

server.listen(PORT, HOST, () => console.log(`노을여우: http://${HOST}:${PORT}`));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
