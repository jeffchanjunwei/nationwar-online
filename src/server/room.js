// ============================================================
// Room:大厅 → 开局 → 60Hz 模拟 → 快照广播 → 结束/重开
// ============================================================
import { createGame } from "../shared/sim.js";
import { encodeFull, encodeDelta, buildCache } from "../shared/snapshot.js";

const FIXED_DT = 1 / 60;
const STEP_MS = 1000 / 60;
const SNAP_EVERY_TICKS = 6;      // 10Hz 快照
const KEYFRAME_EVERY_SEQ = 10;   // 每 1 秒全量关键帧
const RECONNECT_MS = 60000;      // 断线席位保留时长
const CHAT_PER_S = 3;

export class Room {
  constructor(code) {
    this.code = code;
    this.slots = [null, null];   // 席位 0=房主(橙/左),1=客方(紫/右);青(上)为 AI
    this.difficulty = "normal";
    this.phase = "lobby";        // lobby | playing | ended
    this.sim = null;
    this.acc = 0; this.lastAt = 0;
    this.tickCount = 0; this.seq = 0;
    this.endedSent = false;
    this.emptySince = Date.now();
  }

  // ---------- 工具 ----------
  send(slot, obj) {
    if (slot && slot.ws && slot.connected) {
      try { slot.ws.send(JSON.stringify(obj)); } catch { /* 下次 onClose 处理 */ }
    }
  }
  broadcast(obj, except) {
    for (const s of this.slots) if (s && s !== except) this.send(s, obj);
  }
  occupied() { return this.slots.filter(Boolean).length; }
  connectedCount() { return this.slots.filter(s => s && s.connected).length; }
  hostSlot() { return this.slots[0]; }
  slotOfWs(ws) { return this.slots.find(s => s && s.ws === ws) || null; }
  slotOfToken(token) { return this.slots.find(s => s && s.token === token) || null; }

  lobbyPayload() {
    return {
      t: "lobby", room: this.code, host: 0, difficulty: this.difficulty,
      players: this.slots.map(s => s ? { name: s.name, team: s.team, ready: s.ready, connected: s.connected } : null),
    };
  }
  pushLobby() { this.broadcast(this.lobbyPayload()); }

  // ---------- 加入/离开 ----------
  makeSlot(ws, name, team) {
    return {
      ws, name: String(name).slice(0, 12), team, token: crypto.randomUUID(),
      ready: false, connected: true,
      deadline: 0, timedOut: false,
      snapCache: null, lastSeq: 0,
      chatTimes: [], msgTimes: [],
    };
  }
  join(ws, name) {
    let idx = this.slots.findIndex(s => !s);
    if (idx === -1) return { error: "room_full" };
    if (this.phase !== "lobby" && this.phase !== "ended") return { error: "in_play" };
    const slot = this.makeSlot(ws, name, idx);
    this.slots[idx] = slot;
    this.emptySince = Date.now();
    this.pushLobby();
    return { slot };
  }
  create(ws, name) {
    if (this.slots[0]) return { error: "room_full" };
    const slot = this.makeSlot(ws, name, 0);
    this.slots[0] = slot;
    this.emptySince = Date.now();
    this.pushLobby();
    return { slot };
  }
  rejoin(ws, token) {
    const slot = this.slotOfToken(token);
    if (!slot) return { error: "no_such_room" };
    if (slot.timedOut) return { error: "no_such_room" };
    slot.ws = ws;
    slot.connected = true;
    slot.deadline = 0;
    slot.chatTimes = []; slot.msgTimes = [];
    slot.snapCache = null;             // 重连后强制全量
    this.pushLobby();
    if (this.phase === "playing" || this.phase === "ended") {
      this.send(slot, { t: "start", yourTeam: slot.team, difficulty: this.difficulty });
      this.broadcast({ t: "peer", who: slot.team, state: "reconnected", name: slot.name }, slot);
    }
    return { slot };
  }
  disconnect(slot, fromWs) {
    // 席位已被新连接接管时,旧连接的 close 不算掉线
    if (fromWs && slot.ws !== fromWs) return;
    slot.connected = false;
    slot.deadline = Date.now() + RECONNECT_MS;
    slot.snapCache = null;
    this.broadcast({ t: "peer", who: slot.team, state: "left", name: slot.name });
    if (this.phase === "lobby") this.pushLobby();
  }
  leave(slot) {
    const idx = this.slots.indexOf(slot);
    if (idx !== -1) this.slots[idx] = null;
    this.broadcast({ t: "peer", who: slot.team, state: "left", name: slot.name });
    if (this.phase === "lobby") {
      // 大厅阶段离开直接腾位;房主移交给剩余玩家
      this.pushLobby();
    }
  }

  // ---------- 消息 ----------
  onMessage(slot, m) {
    // 限频:令牌桶 32 msg/s(突發 64)
    const now = Date.now();
    slot.msgTimes = slot.msgTimes.filter(t => now - t < 1000);
    if (slot.msgTimes.length >= 64) return;
    slot.msgTimes.push(now);

    switch (m.t) {
      case "ping":
        this.send(slot, { t: "pong", ts: m.ts });
        return;
      case "ready":
        if (this.phase === "lobby") { slot.ready = !!m.ready; this.pushLobby(); }
        return;
      case "set_diff":
        if (this.phase === "lobby" && slot === this.hostSlot()) { this.difficulty = m.diff; this.pushLobby(); }
        return;
      case "start":
        if (slot === this.hostSlot()) this.startGame();
        return;
      case "restart":
        if (slot === this.hostSlot() && (this.phase === "playing" || this.phase === "ended")) this.startGame();
        return;
      case "cmd": {
        if (this.phase !== "playing" || !slot.connected) return;
        for (const c of m.cmds) this.sim.applyCommand(slot.team, c);
        return;
      }
      case "chat": {
        slot.chatTimes = slot.chatTimes.filter(t => now - t < 1000);
        if (slot.chatTimes.length >= CHAT_PER_S) return;
        slot.chatTimes.push(now);
        this.broadcast({ t: "chat", from: slot.team, name: slot.name, msg: m.msg });
        return;
      }
      case "need_full":
        slot.snapCache = null;
        return;
      case "leave":
        this.leave(slot);
        return;
    }
  }

  // ---------- 开局 ----------
  startGame() {
    if (!this.slots[0] || !this.slots[1]) return;
    this.sim = createGame({ humans: [0, 1], aiTeams: [2], difficulty: this.difficulty });
    this.phase = "playing";
    this.endedSent = false;
    this.acc = 0; this.lastAt = 0; this.tickCount = 0; this.seq = 0;
    for (const s of this.slots) if (s) { s.snapCache = null; s.ready = false; }
    for (const s of this.slots) if (s) this.send(s, { t: "start", yourTeam: s.team, difficulty: this.difficulty });
  }

  // ---------- 主循环节拍 ----------
  tick(now) {
    // 断线超时
    for (const s of this.slots) {
      if (s && !s.connected && s.deadline && now > s.deadline) {
        s.deadline = 0;
        s.timedOut = true;
        this.broadcast({ t: "peer", who: s.team, state: "timedout", name: s.name });
        if (this.phase === "lobby") { const idx = this.slots.indexOf(s); this.slots[idx] = null; this.pushLobby(); }
      }
    }

    if (this.phase !== "playing") return;

    if (!this.lastAt) this.lastAt = now;
    this.acc += now - this.lastAt;
    this.lastAt = now;

    let guard = 0;
    while (this.acc >= STEP_MS && guard < 5) {
      this.acc -= STEP_MS;
      guard++;
      this.sim.step(FIXED_DT);
      this.tickCount++;
      if (this.tickCount % SNAP_EVERY_TICKS === 0) this.sendSnapshots();
      if (this.sim.state.isOver) { this.finish(); return; }
    }
    if (guard >= 5) this.acc = 0;   // 严重落后:放弃追赶(双方同慢,时间膨胀)
  }

  sendSnapshots() {
    const ev = this.sim.collectEvents();
    this.seq++;
    const keyframe = this.seq % KEYFRAME_EVERY_SEQ === 0;
    for (const s of this.slots) {
      if (!s) continue;
      if (!s.connected || !s.ws) { s.snapCache = null; continue; }
      if (!s.snapCache || keyframe) {
        this.send(s, encodeFull(this.sim, this.seq, ev));
        s.snapCache = buildCache(this.sim);
      } else {
        this.send(s, encodeDelta(this.sim, this.seq, s.lastSeq, s.snapCache, ev));
      }
      s.lastSeq = this.seq;
    }
  }

  finish() {
    this.phase = "ended";
    // 收尾事件(可能还有最后一包 fx)随最终消息发
    const ev = this.sim.collectEvents();
    if (ev.length) {
      const fin = encodeFull(this.sim, this.seq, ev);
      for (const s of this.slots) if (s && s.connected) this.send(s, fin);
    }
    this.broadcast({ t: "ended", winner: this.sim.state.winner });
  }

  isEmptyForGc(now) {
    if (this.connectedCount() > 0) return false;
    return now - this.emptySince > 120000;   // 全员离开 2 分钟后回收
  }
  noteEmpty(now) { if (this.connectedCount() === 0 && !this._emptyMarked) { this._emptyMarked = true; this.emptySince = now; } else if (this.connectedCount() > 0) this._emptyMarked = false; }
}
