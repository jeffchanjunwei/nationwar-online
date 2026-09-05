// ============================================================
// 联机宿主:大厅流程(创建/加入/重连/聊天)+ 命令上行 + 快照下行
// 该对象同时充当 main.js 的 host(mode="net")
// ============================================================
import { DIFFICULTY } from "/src/shared/cfg.js";
import { connect } from "./net.js";

const REJOIN_WINDOW_MS = 60000;     // 断线重连窗口(与服务器一致)
const RETRY_MS = 2000;

export function createNetHostFlow(cb) {
  const { dom, ui, toast, onStart, onBackToMenu } = cb;
  let conn = null;
  let room = null, token = null, isHost = false, myTeam = 0;
  let inRoom = false, playing = false, alive = true;
  let view = null;
  let names = ["", "", "青部 AI"];   // 按队伍
  let lobbyState = null;
  let cmdQueue = [];
  let rtt = null, lastPingAt = 0;
  let reconnectTimer = null, disconnectedAt = 0;
  let myName = localStorage.getItem("nw_name") || ("酋长" + Math.floor(100 + Math.random() * 900));
  let needFullAt = 0;

  // ---------- 连接 ----------
  function ensureConn() {
    if (conn && (conn.isOpen() || conn.ws.readyState === WebSocket.CONNECTING)) return;
    conn = connect({
      onOpen: () => {
        if (window.__nwDebug) console.log("[nwdbg] ws open");
        const saved = readSaved();
        if (saved) tryRejoin(saved.room, saved.token, true);   // 有存档就自动恢复席位
        pingLoop();
      },
      onMessage: handle,
      onClose: () => {
        if (window.__nwDebug) console.log("[nwdbg] ws close");
        if (!alive) return;
        if (playing) startReconnect();
        else if (inRoom) { setStatus("⚠️ 连接断开,重连中…"); scheduleReconnect(); }
        else ensureConn();   // 大厅阶段断开:立即重建连接
      },
    });
  }
  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { if (alive) { ensureConn(); } }, RETRY_MS);
  }
  function startReconnect() {
    if (reconnecting) return;
    reconnecting = true;
    disconnectedAt = Date.now();
    toast("⚠️ 连接断开,尝试重连…");
    dom["r-net"] && (dom["r-net"].textContent = "⚡ 重连中…");
    scheduleReconnect();
  }
  let reconnecting = false;
  function stopReconnect() { reconnecting = false; clearTimeout(reconnectTimer); }

  function readSaved() { try { return JSON.parse(localStorage.getItem("nw_room") || "null"); } catch { return null; } }
  function save() { if (room && token) localStorage.setItem("nw_room", JSON.stringify({ room, token })); }
  function clearSaved() { localStorage.removeItem("nw_room"); }

  function pingLoop() {
    if (!alive || !conn) return;
    if (conn.isOpen() && Date.now() - lastPingAt > 2000) {
      lastPingAt = Date.now();
      conn.send({ t: "ping", ts: Date.now() });
    }
    setTimeout(pingLoop, 1000);
  }

  // ---------- 服务器消息 ----------
  function handle(m) {
    switch (m.t) {
      case "room_created":
        room = m.room; token = m.token; isHost = true; inRoom = true;
        save(); renderLobby();
        break;
      case "joined":
        room = m.room; token = m.token; isHost = false; inRoom = true;
        save(); renderLobby();
        break;
      case "lobby":
        lobbyState = m;
        for (const p of m.players) if (p) names[p.team] = p.name;
        renderLobby();
        break;
      case "start":
        playing = true; myTeam = m.yourTeam; stopReconnect();
        onStart({ yourTeam: m.yourTeam, difficulty: m.difficulty });
        break;
      case "snap":
        if (view) {
          view.applySnapshot(m);
          if (view.needFull && Date.now() - needFullAt > 500) {
            needFullAt = Date.now();
            conn.send({ t: "need_full" });
          }
          if (window.__nwDebug) window.__nwDebug.snaps = (window.__nwDebug.snaps || 0) + 1;
        } else if (window.__nwDebug) { window.__nwDebug.orphanSnaps = (window.__nwDebug.orphanSnaps || 0) + 1; }
        break;
      case "ended":
        if (view) view.pushUiEvent({ e: "ended", winner: m.winner });
        playing = false;
        break;
      case "peer":
        if (m.state === "left") toast("👋 " + (m.name || "对手") + " 掉线了(60 秒内可重连)");
        else if (m.state === "reconnected") toast("✅ " + (m.name || "对手") + " 已重新连接");
        else if (m.state === "timedout") toast("☠️ " + (m.name || "对手") + " 掉线超时,不再回来");
        else if (m.state === "quit") toast("🚪 " + (m.name || "对手") + " 退出了对局(判负)");
        break;
      case "chat":
        appendChat((m.name || "?") + ":" + m.msg);
        break;
      case "pong":
        rtt = Date.now() - m.ts;
        break;
      case "error":
        toast("❌ " + (m.msg || m.code || "未知错误"));
        if (m.code === "no_such_room" || m.code === "room_full" || m.code === "in_play") { clearSaved(); renderLobby(); }
        break;
    }
  }

  // ---------- 大厅 UI ----------
  function setStatus(s) {
    const el = dom.lobby.querySelector("#lobby-status");
    if (el) el.textContent = s || "";
  }
  let chatLines = [];
  function appendChat(line) {
    chatLines.push(line);
    if (chatLines.length > 60) chatLines.shift();
    const log = dom.lobby.querySelector("#chat-log");
    if (!log) return;
    const div = document.createElement("div");
    div.textContent = line;
    log.appendChild(div);
    while (log.children.length > 60) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }
  function openLobby() {
    dom.lobby.style.display = "flex";
    ensureConn();
    renderLobby();
    const saved = readSaved();
    if (saved) setStatus("检测到上局 " + saved.room + " 未结束,点「重连对局」恢复");
  }
  function renderLobby() {
    if (!alive) return;
    dom.lobby.style.display = "flex";
    if (!inRoom || !lobbyState) {
      dom.lobby.innerHTML = `
        <h2>🌐 联机大厅</h2>
        <div class="lb-form">
          <div class="lb-row"><span>昵称</span><input id="lb-name" maxlength="12" value="${escapeHtml(myName)}"></div>
          <div class="lb-btns">
            <button id="lb-create">🏠 创建房间</button>
          </div>
          <div class="lb-row"><span>房间码</span><input id="lb-code" maxlength="4" placeholder="4 位" style="text-transform:uppercase"></div>
          <div class="lb-btns">
            <button id="lb-join">➡️ 加入房间</button>
            <button id="lb-rejoin" class="minor">🔌 重连对局</button>
          </div>
        </div>
        <div id="lobby-status" class="lb-status"></div>
        <button id="lb-back" class="minor">← 返回菜单</button>`;
      dom.lobby.querySelector("#lb-create").onclick = () => { saveName(); conn && conn.send({ t: "create_room", name: myName }); };
      dom.lobby.querySelector("#lb-join").onclick = () => {
        saveName();
        const code = dom.lobby.querySelector("#lb-code").value.trim().toUpperCase();
        if (code.length !== 4) { setStatus("请输入 4 位房间码"); return; }
        conn && conn.send({ t: "join_room", room: code, name: myName });
      };
      dom.lobby.querySelector("#lb-rejoin").onclick = () => {
        saveName();
        const saved = readSaved();
        if (!saved) { setStatus("没有可恢复的对局"); return; }
        tryRejoin(saved.room, saved.token, false);
      };
      dom.lobby.querySelector("#lb-back").onclick = () => { leave(); onBackToMenu(); };
      return;
    }
    // 房间内
    const L = lobbyState;
    const meTeam = isHost ? 0 : 1;
    const myReady = L.players[meTeam] && L.players[meTeam].ready;
    const bothReady = L.players[0] && L.players[1] && L.players[0].ready && L.players[1].ready;
    dom.lobby.innerHTML = `
      <h2>房间 <span class="lb-code">${L.room}</span></h2>
      <p class="lb-hint">把房间码发给好友,在对方「联机大厅 → 加入房间」输入即可</p>
      <div class="lb-players">
        ${slotHtml(L.players[0], "橙方 · 左")}
        <div class="lb-vs">VS</div>
        ${slotHtml(L.players[1], "紫方 · 右")}
        <div class="lb-vs">+</div>
        ${slotHtml(null, "青部 · AI(上)")}
      </div>
      ${isHost ? `
        <div class="lb-diff">
          <span>AI 难度(只作用于 AI 部落,双方玩家完全公平)</span>
          <div class="diff-row">
            ${["easy", "normal", "hard"].map(d => `<button class="diff-btn ${L.difficulty === d ? "active" : ""}" data-diff="${d}">${DIFFICULTY[d].label}</button>`).join("")}
          </div>
        </div>` : `<p class="lb-hint">房主选择 AI 难度:${DIFFICULTY[L.difficulty].label}</p>`}
      <div class="lb-btns">
        <button id="lb-ready" class="${myReady ? "on" : ""}">${myReady ? "✅ 已准备(点击取消)" : "🎮 准备"}</button>
        ${isHost ? `<button id="lb-start" ${bothReady ? "" : "disabled"}>⚔️ 开始对战</button>` : `<span class="lb-hint">${bothReady ? "等待房主开始…" : "双方准备后房主开始"}</span>`}
      </div>
      <div class="lb-chat">
        <div id="chat-log"></div>
        <div class="lb-chat-row"><input id="chat-in" maxlength="120" placeholder="聊天…"><button id="chat-send">发送</button></div>
      </div>
      <div id="lobby-status" class="lb-status"></div>
      <button id="lb-leave" class="minor">← 退出房间</button>`;
    // 聊天记录回放
    for (const l of chatLines) appendChat(l);
    dom.lobby.querySelector("#lb-ready").onclick = () => conn && conn.send({ t: "ready", ready: !myReady });
    const st = dom.lobby.querySelector("#lb-start");
    if (st) st.onclick = () => conn && conn.send({ t: "start" });
    for (const b of dom.lobby.querySelectorAll(".diff-btn")) {
      b.onclick = () => conn && conn.send({ t: "set_diff", diff: b.dataset.diff });
    }
    dom.lobby.querySelector("#chat-send").onclick = sendChat;
    dom.lobby.querySelector("#chat-in").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); e.stopPropagation(); });
    dom.lobby.querySelector("#lb-leave").onclick = () => { leave(); onBackToMenu(); };
  }
  function sendChat() {
    const inp = dom.lobby.querySelector("#chat-in");
    const msg = (inp.value || "").trim().slice(0, 120);
    if (!msg) return;
    conn && conn.send({ t: "chat", msg });
    inp.value = "";
  }
  function slotHtml(p, label) {
    if (p) return `<div class="lb-slot ${p.connected ? "" : "off"}"><b>${escapeHtml(p.name || "?")}</b><span>${label}${p.ready ? " · ✅准备" : ""}${p.connected ? "" : " · ⚡掉线"}</span></div>`;
    return `<div class="lb-slot empty"><b>空位</b><span>${label} · 等待加入…</span></div>`;
  }
  function saveName() {
    const el = dom.lobby.querySelector("#lb-name");
    if (el && el.value.trim()) { myName = el.value.trim().slice(0, 12); localStorage.setItem("nw_name", myName); }
  }
  function tryRejoin(r, tk, silent) {
    conn && conn.send({ t: "rejoin", room: r, token: tk });
    if (!silent) setStatus("重连中…");
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  // ---------- host 接口 ----------
  const hostFlow = {
    mode: "net",
    get myTeam() { return myTeam; },
    get isHost() { return isHost; },
    get netDifficulty() { return lobbyState ? lobbyState.difficulty : "normal"; },
    attachView(v) { view = v; },
    winnerNameOf(team) {
      if (team === 2) return "青部(AI)";
      if (team === myTeam) return "你";
      return names[team] || "对手";
    },
    submit(cmd) { cmdQueue.push(cmd); },
    flush() {
      if (!cmdQueue.length || !conn || !conn.isOpen()) return;
      const cmds = cmdQueue.splice(0, 64);
      conn.send({ t: "cmd", cmds });
    },
    showStatus() {
      toast(`房间 ${room || "?"} · 延迟 ${rtt == null ? "?" : rtt + "ms"} · 对手:${names[1 - myTeam] || "?"}`);
    },
    restart() { conn && conn.send({ t: "restart" }); },
    leave() {
      if (conn && conn.isOpen() && room) conn.send({ t: "leave" });
      inRoom = false; playing = false; lobbyState = null; room = null; token = null;
      clearSaved();
      dom.lobby.style.display = "none";
    },
    openLobby,
    debugConn() {
      if (!conn) return "none";
      if (!conn.ws) return "nows";
      return ["connecting", "open", "closing", "closed"][conn.ws.readyState] || String(conn.ws.readyState);
    },
    // 自动化测试钩子:自动加入指定房间并准备
    autoJoinForTest(code) {
      let readied = false;
      const tryJoin = () => {
        if (!alive) return;
        if (conn && conn.isOpen()) {
          if (window.__nwDebug) console.log("[nwdbg] sending join_room " + code);
          conn.send({ t: "join_room", room: String(code).toUpperCase(), name: myName });
        }
        else setTimeout(tryJoin, 300);
      };
      tryJoin();
      const iv = setInterval(() => {
        if (!alive || playing) { clearInterval(iv); return; }
        if (!readied && inRoom && lobbyState && lobbyState.players[1] && !lobbyState.players[1].ready) {
          readied = true;
          conn.send({ t: "ready", ready: true });
        }
      }, 400);
    },
    destroy() {
      alive = false;
      stopReconnect();
      // 稍延迟再关,确保已排队的 leave 等消息先发出去
      if (conn) setTimeout(() => { try { conn.close(); } catch {} }, 150);
    },
    // 联机状态条(主循环调用)
    netStatus() {
      if (!playing) return "";
      const opp = names[1 - myTeam] || "?";
      return `🏠 ${room} · ⚡${rtt == null ? "?" : rtt + "ms"}`;
    },
  };
  return hostFlow;
}
