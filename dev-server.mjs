// 로컬 확인용 서버: 정적 파일 + /api 함수. 데이터는 메모리에만 저장된다.
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.dirname(new URL(import.meta.url).pathname);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8" };
const port = Number(process.env.PORT || 3000);

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) {
      const mod = await import(path.join(root, "api", path.basename(url.pathname) + ".js"));
      return mod.default(req, res);
    }
    if (url.pathname === "/viewer") { res.writeHead(307, { Location: "/" }); return res.end(); }
    const file = path.join(root, url.pathname === "/" ? "index.html" : path.normalize(url.pathname));
    if (!file.startsWith(root) || file.includes("node_modules") || file.includes(`${path.sep}lib${path.sep}`)) throw new Error("404");
    const body = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
}).listen(port, () => console.log(`http://localhost:${port}`));
