// ============================================================
// 部落纪元 · 双人对战服务器
//   http:静态文件(/public、/src)   ws:/ws 房间路由 + 60Hz 全局循环
//   运行:node server.js(默认 :8080,可用 PORT 环境变量)
// ============================================================
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { RoomManager } from "./src/server/rooms.js";
import { sanitize } from "./src/server/sanitize.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

// ---------- 静态文件 ----------
const server = http.createServer(async (req, res) => {
  try {
    // 自动化测试上报端点
    if (req.url.startsWith("/__report")) {
      let body = "";
      for await (const chunk of req) body += chunk;
      console.log("[report]", body.slice(0, 500));
      res.writeHead(200).end("ok");
      return;
    }
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/") p = "/public/index.html";
    if (p === "/index.html") p = "/public/index.html";
    if (!p.startsWith("/public/") && !p.startsWith("/src/")) { res.writeHead(404).end("not found"); return; }
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
});

// ---------- WebSocket ----------
const manager = new RoomManager();
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname !== "/ws") { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
});

wss.on("connection", (ws) => {
  let joined = null;   // { room, slot }

  const reply = obj => { try { ws.send(JSON.stringify(obj)); } catch {} };

  ws.on("message", data => {
    if (typeof data !== "string") data = data.toString();
    const m = sanitize(data);
    if (!m) return;

    if (!joined) {
      if (m.t === "create_room") {
        const r = manager.create(ws, m.name);
        if (r.error) { reply({ t: "error", code: r.error, msg: "创建失败" }); return; }
        joined = r;
        reply({ t: "room_created", room: r.room.code, token: r.slot.token });
      } else if (m.t === "join_room") {
        const r = manager.join(m.room, ws, m.name);
        if (r.error) { reply({ t: "error", code: r.error, msg: r.error === "no_such_room" ? "房间不存在" : r.error === "room_full" ? "房间已满" : "对局进行中,无法加入" }); return; }
        joined = r;
        reply({ t: "joined", room: r.room.code, token: r.slot.token });
      } else if (m.t === "rejoin") {
        const r = manager.rejoin(m.room, ws, m.token);
        if (r.error) { reply({ t: "error", code: r.error, msg: "对局已失效" }); return; }
        joined = r;
      } else if (m.t === "ping") {
        reply({ t: "pong", ts: m.ts });
      }
      return;
    }

    // 主动退出:在连接层解绑,同一条连接之后仍可重新建房/加入
    if (m.t === "leave") {
      joined.room.leave(joined.slot);
      joined = null;
      return;
    }

    // 席位已被新连接接管时,忽略旧连接的残留消息
    if (joined.slot.ws !== ws) return;
    joined.room.onMessage(joined.slot, m);
  });

  ws.on("close", () => {
    if (joined) joined.room.disconnect(joined.slot, ws);
  });
  ws.on("error", () => { /* close 会跟随 */ });
});

// ---------- 全局循环 ----------
let lastReport = 0, tickN = 0;
setInterval(() => {
  const now = Date.now();
  manager.tick(now);
  tickN++;
  if (now - lastReport > 60000) {
    lastReport = now;
    console.log(`[room] ${manager.rooms.size} 个房间 | 循环 ${tickN}/min`);
    tickN = 0;
  }
}, 15);

server.listen(PORT, () => {
  console.log(`🔥 部落纪元·双人对战服务器已启动`);
  console.log(`   本机游玩    http://localhost:${PORT}/`);
  console.log(`   局域网好友  http://<你的局域网IP>:${PORT}/`);
});
