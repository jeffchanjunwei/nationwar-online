// 端到端联机回路测试:两个 WebSocket 客户端走完整流程
// 创建/加入/准备/开局/快照/命令/断线重连,并统计带宽。
// 用法:node test/net.mjs(自动拉起临时服务器进程)
import { spawn } from "node:child_process";
import { once } from "node:events";

const PORT = 8901;
const URL = `ws://127.0.0.1:${PORT}/ws`;

function connect() {
  const ws = new WebSocket(URL);
  const handlers = [];
  ws.onmessage = (ev) => { for (const h of handlers) h(JSON.parse(ev.data)); };
  return {
    ws, handlers,
    send(obj) { ws.send(JSON.stringify(obj)); },
    on(fn) { handlers.push(fn); },
    wait(pred, timeout = 8000) {
      return new Promise((resolve, reject) => {
        const h = (m) => { if (pred(m)) { cleanup(); resolve(m); } };
        const cleanup = () => { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1); };
        handlers.push(h);
        setTimeout(() => { cleanup(); reject(new Error("等待消息超时: " + pred)); }, timeout);
      });
    },
  };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const assert = (cond, msg) => { if (!cond) throw new Error("断言失败: " + msg); console.log("  ✓ " + msg); };

// ---------- 拉起服务器 ----------
const server = spawn("node", ["server.js"], { env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
server.stdout.on("data", () => {});
server.stderr.on("data", d => console.error("[server-err]", String(d).trim()));
await sleep(800);

let bytesA = 0, bytesB = 0, snapsA = 0, snapsB = 0, deltaA = 0, fullA = 0;
let seqA = 0, baseOkA = true;
let room = null, tokenB = null;

try {
  const A = connect(), B = connect();
  await Promise.all([once(A.ws, "open"), once(B.ws, "open")]);
  console.log("两个客户端已连接");

  // A 建房
  A.send({ t: "create_room", name: "阿里" });
  const created = await A.wait(m => m.t === "room_created");
  room = created.room;
  console.log("房间已创建:", room);
  assert(/^[A-Z0-9]{4}$/.test(room), "房间码为 4 位:" + room);

  // B 加入(先注册 A 的大厅等待,避免竞态)
  const lobbyPromise = A.wait(m => m.t === "lobby" && m.players[0] && m.players[1]);
  B.send({ t: "join_room", room, name: "北条" });
  const joined = await B.wait(m => m.t === "joined");
  tokenB = joined.token;
  const lobbyA = await lobbyPromise;
  assert(lobbyA.players[0].name === "阿里" && lobbyA.players[1].name === "北条", "大厅双席位正确");

  // 非法消息被丢弃(不崩溃)
  B.send({ t: "create_room", name: "x" });
  B.send("not json");
  B.send({ t: "cmd", cmds: [{ c: "hack", ids: [1] }] });

  // 准备 + 开局
  const bothReady = A.wait(m => m.t === "lobby" && m.players[0].ready && m.players[1].ready);
  A.send({ t: "ready", ready: true });
  B.send({ t: "ready", ready: true });
  await bothReady;
  A.send({ t: "start" });

  const startA = await A.wait(m => m.t === "start");
  const startB = await B.wait(m => m.t === "start");
  assert(startA.yourTeam === 0 && startB.yourTeam === 1, "队伍分配:房主=0 客方=1");

  // 快照统计与结构
  A.on(m => { if (m.t === "snap") { snapsA++; bytesA += JSON.stringify(m).length; if (m.full) fullA++; else deltaA++; if (!m.full && m.base !== seqA) baseOkA = false; if (m.full || m.base === seqA) seqA = m.seq; } });
  B.on(m => { if (m.t === "snap") { snapsB++; bytesB += JSON.stringify(m).length; } });
  const firstSnap = await A.wait(m => m.t === "snap" && m.full);
  assert(firstSnap.u.length === 12 + 1, "开局单位 13(12 村民+1 野生神兽),实际 " + firstSnap.u.length);
  assert(firstSnap.b.filter(b => b[1] === 0).length === 3, "开局建筑含 3 营火(共 " + firstSnap.b.length + " 座,AI 即刻开工)");
  assert(firstSnap.r.length > 50, "开局资源点 " + firstSnap.r.length + " 个");
  assert(firstSnap.res.length === 3 && firstSnap.pop.length === 3, "表头含 3 队资源/人口");

  // A 下令:全部村民去某地
  const myUnits0 = firstSnap.u.filter(u => u[2] === 0);
  const ids0 = myUnits0.map(u => u[0]);
  A.send({ t: "cmd", cmds: [{ c: "order", ids: ids0, order: { type: "ground", x: 400, y: 800 } }] });
  // 非法命令(动 B 的单位)应被模拟层拒绝
  const bUnits = firstSnap.u.filter(u => u[2] === 1).map(u => u[0]);
  A.send({ t: "cmd", cmds: [{ c: "order", ids: bUnits.slice(0, 1), order: { type: "ground", x: 1, y: 1 } }] });

  await sleep(3000);
  const lateSnap = await A.wait(m => m.t === "snap" && m.full);
  const moved = lateSnap.u.filter(u => u[2] === 0).every(u => Math.abs(u[3] - 400) < 350);
  assert(moved, "A 的村民收到移动命令并移动(向目标靠近)");

  // 服务器继续跑
  await sleep(3000);
  assert(snapsA > 30, "10Hz 快照持续到达(" + snapsA + " 包)");
  assert(baseOkA, "增量基线连续无断裂");
  assert(deltaA > fullA, "增量为主、关键帧为辅(delta=" + deltaA + " full=" + fullA + ")");

  // 聊天
  B.send({ t: "chat", msg: "你好" });
  const chat = await A.wait(m => m.t === "chat");
  assert(chat.msg === "你好" && chat.name === "北条", "聊天中继正常");

  // 断线重连:B 断开 → 重连恢复
  const leftPromise = A.wait(m => m.t === "peer" && m.state === "left");
  B.ws.close();
  const peerLeft = await leftPromise;
  assert(peerLeft.who === 1, "服务器广播对手掉线");
  await sleep(1500);
  const B2 = connect();
  await once(B2.ws, "open");
  const backPromise = A.wait(m => m.t === "peer" && m.state === "reconnected");
  B2.send({ t: "rejoin", room, token: tokenB });
  const restartSnap = await B2.wait(m => m.t === "snap" && m.full, 10000);
  assert(restartSnap.u.length > 0, "重连后收到全量快照恢复对局");
  const peerBack = await backPromise;
  assert(peerBack.who === 1, "服务器广播对手重连");
  B2.ws.close();

  // 带宽报告
  const sec = 6.5;
  console.log(`\n带宽估算:A ${Math.round(bytesA / sec / 1024)}KB/s(${(bytesA / sec * 8 / 1024).toFixed(0)}kbps),B ${Math.round(bytesB / sec / 1024)}KB/s`);
  console.log("联机回路测试全部通过 ✓");
} finally {
  server.kill();
}
