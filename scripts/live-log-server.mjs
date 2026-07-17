import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, extname, isAbsolute } from "node:path";

const host = "127.0.0.1";
const port = Number(process.env.WCL_LIVE_PORT || 3001);
const allowedOrigin = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (origin && !allowedOrigin.test(origin)) return false;
  if (origin) response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Vary", "Origin");
  response.setHeader(
    "Access-Control-Expose-Headers",
    "X-File-Size, X-File-Name, X-Log-Rotated",
  );
  return true;
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function resolveLogPath(rawPath) {
  if (!rawPath || !isAbsolute(rawPath)) {
    throw new Error("请输入日志文件的绝对路径");
  }
  const resolved = await realpath(rawPath);
  const extension = extname(resolved).toLowerCase();
  if (extension !== ".txt" && extension !== ".log") {
    throw new Error("实时读取仅允许 .txt 或 .log 文件");
  }
  if (!/^WoWCombatLog.*\.(txt|log)$/i.test(basename(resolved))) {
    throw new Error("实时读取仅允许 WoWCombatLog*.txt/.log 文件");
  }
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error("所选路径不是文件");
  return { resolved, info };
}

const server = createServer(async (request, response) => {
  if (!applyCors(request, response)) {
    sendJson(response, 403, { error: "只允许 localhost 页面访问" });
    return;
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    response.end();
    return;
  }

  const url = new URL(request.url || "/", `http://${host}:${port}`);
  if (url.pathname === "/health") {
    sendJson(response, 200, { ok: true, mode: "local-read-only" });
    return;
  }
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const { resolved, info } = await resolveLogPath(url.searchParams.get("path"));
    response.setHeader("X-File-Size", String(info.size));
    response.setHeader(
      "X-File-Name",
      encodeURIComponent(basename(resolved)),
    );
    response.setHeader("Cache-Control", "no-store");

    if (url.pathname === "/stat") {
      sendJson(response, 200, {
        name: basename(resolved),
        size: info.size,
        modifiedAt: info.mtimeMs,
      });
      return;
    }

    if (url.pathname === "/file") {
      response.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Length": info.size,
      });
      createReadStream(resolved).pipe(response);
      return;
    }

    if (url.pathname === "/range") {
      const requestedOffset = Math.max(
        0,
        Number(url.searchParams.get("offset")) || 0,
      );
      const rotated = requestedOffset > info.size;
      const offset = rotated ? 0 : requestedOffset;
      response.setHeader("X-Log-Rotated", rotated ? "1" : "0");
      if (offset === info.size) {
        response.writeHead(204);
        response.end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": info.size - offset,
      });
      createReadStream(resolved, { start: offset }).pipe(response);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (reason) {
    sendJson(response, 400, {
      error: reason instanceof Error ? reason.message : "无法读取日志文件",
    });
  }
});

server.listen(port, host, () => {
  process.stdout.write(
    `实时日志只读助手：http://${host}:${port}（仅允许 localhost）\n`,
  );
});
