import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 4318);
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".wav": "audio/wav",
  ".png": "image/png",
};

const server = http.createServer(async (request, response) => {
  try {
    const requestPath = decodeURIComponent((request.url || "/").split("?")[0]);
    const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
    const absolutePath = path.resolve(root, relativePath);
    if (!absolutePath.startsWith(root + path.sep)) throw new Error("Invalid path");
    const body = await fs.readFile(absolutePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(absolutePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Signal Trace: http://127.0.0.1:${port}/`);
});
