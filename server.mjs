import http from "node:http";
import { copyFileSync, createWriteStream, existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const port = Number(process.env.PORT ?? 8765);
const root = fileURLToPath(new URL(".", import.meta.url));

const contentTypeByExt = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function syncUserAssets() {
  const cursorAssets = join(
    homedir(),
    ".cursor/projects/Users-albertsmacbookpro-Downloads-Vanta-Code/assets"
  );
  const cursorAssetsEsc = join(
    homedir(),
    ".cursor/projects/Users-albertsmacbookpro-Downloads-Vanta-Code-esp32-esc-test/assets"
  );
  const local = join(root, "assets");
  mkdirSync(local, { recursive: true });

  const logoSrc = join(cursorAssets, "Group_275-3122455e-346e-40ed-82d0-8067660dd5f7.png");
  if (existsSync(logoSrc)) {
    try {
      copyFileSync(logoSrc, join(local, "vanta-logo.png"));
    } catch (_) {}
  }

  const rovRef = join(cursorAssetsEsc, "____3_3-3b186032-f498-4790-891e-14aff4fa87f2.png");
  const rovLegacy = join(cursorAssets, "image-8fd34e0c-9b10-4f7a-95c5-cfe70289257f.png");
  const rovFrom = existsSync(rovRef) ? rovRef : existsSync(rovLegacy) ? rovLegacy : null;
  if (rovFrom) {
    try {
      copyFileSync(rovFrom, join(local, "rov-hero.png"));
    } catch (_) {}
  }
}

async function syncFigmaVidToolbarAssets() {
  const local = join(root, "assets");
  mkdirSync(local, { recursive: true });
  const remote = [
    ["https://www.figma.com/api/mcp/asset/ea8b4ca5-5d2d-4d86-b0c7-f3083170a807", "gauge-arc.png"],
    ["https://www.figma.com/api/mcp/asset/4e6c5a7d-7e93-4939-97d5-953833be55df", "vid-btn-camera.png"],
    ["https://www.figma.com/api/mcp/asset/b6fae352-6e46-4293-9a62-94372cc5f349", "vid-btn-record.png"],
    ["https://www.figma.com/api/mcp/asset/8a1c3e2b-70c8-44ab-9a3a-5fe20d24da86", "vid-btn-mic-off.png"],
    ["https://www.figma.com/api/mcp/asset/460d0896-cff8-4188-8746-af5f5585e94f", "sensor-icon-depth.svg"],
    ["https://www.figma.com/api/mcp/asset/a2877a1e-ab37-4f6c-8fc5-17cd3104a8a7", "sensor-icon-imu.svg"],
    ["https://www.figma.com/api/mcp/asset/1b7ddd2a-7a9d-4f2d-ad64-df91177b341b", "sensor-icon-esc.svg"],
    ["https://www.figma.com/api/mcp/asset/a93a512b-e86f-4804-825b-edbd21cff7d1", "sensor-icon-servo.svg"],
    ["https://www.figma.com/api/mcp/asset/eb9e2136-45bb-496b-b233-02c1cb50b172", "sensor-icon-camera.svg"],
  ];
  for (const [url, name] of remote) {
    const dest = join(local, name);
    if (existsSync(dest)) continue;
    try {
      const res = await fetch(url);
      if (!res.ok || !res.body) continue;
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
    } catch (_) {}
  }
}

syncUserAssets();
await syncFigmaVidToolbarAssets();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = join(root, decodeURIComponent(path));
    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": contentTypeByExt[ext] ?? "application/octet-stream" });
    res.end(data);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("404", req.url, err && err.message ? err.message : err);
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    // eslint-disable-next-line no-console
    console.error(
      `端口 ${port} 已被占用。关掉旧终端里的 node，或: lsof -ti :${port} | xargs kill`
    );
  } else {
    // eslint-disable-next-line no-console
    console.error(err);
  }
  process.exit(1);
});

server.listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${port}/`;
  // eslint-disable-next-line no-console
  console.log(`SERIAL_WEB_READY ${url}`);
  // eslint-disable-next-line no-console
  console.log(`控制页: ${url}`);
  // eslint-disable-next-line no-console
  console.log(`目录: ${root}`);
  // eslint-disable-next-line no-console
  console.log("保持本终端不关；Ctrl+C 停止服务");
});
