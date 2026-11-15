import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const basePort = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function requestHandler(req, res) {
  (async () => {
    try {
      const url = new URL(req.url, "http://localhost");
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === "/") pathname = "/index.html";
      const file = normalize(join(root, pathname));
      if (!file.startsWith(root)) throw new Error("Forbidden");
      const info = await stat(file);
      if (!info.isFile()) throw new Error("Not found");
      res.writeHead(200, {
        "Content-Type": types[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  })();
}

function listen(port, attempt = 0) {
  const server = createServer(requestHandler);
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && attempt < 9) {
      listen(port + 1, attempt + 1);
      return;
    }
    throw error;
  });
  server.listen(port, () => {
    console.log(`Kiln Sequence → http://localhost:${port}`);
  });
}

listen(basePort);
