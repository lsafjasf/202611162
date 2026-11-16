import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const port = Number(process.env.PORT) || 4173;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".wav": "audio/wav",
  ".svg": "image/svg+xml"
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const target = resolve(root, `.${decoded === "/" ? "/index.html" : decoded}`);
  return target === root || target.startsWith(root + sep) ? target : null;
}

createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url || "/", "http://localhost").pathname;
    let target = safePath(pathname);
    if (!target) throw new Error("Forbidden");
    const info = await stat(target);
    if (info.isDirectory()) target = resolve(target, "index.html");
    const body = await readFile(target);
    response.writeHead(200, {
      "Content-Type": types[extname(target)] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    response.end(body);
  } catch (error) {
    console.error(request.url, error);
    response.writeHead(error.code === "ENOENT" ? 404 : 500, {
      "Content-Type": "text/plain; charset=utf-8"
    });
    response.end(error.code === "ENOENT" ? "Not found" : "Server error");
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`Doppler Rail running at http://localhost:${port}`);
});
