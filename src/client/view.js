// ============================================================
// WorldView:双模式实体视图
//  - local:直接引用 sim 活数组(零延迟,单机)
//  - net:快照缓冲 + 插值 + 事件按时钟回放(联机)
// render/ui/input 只读本视图,不感知模式。
// ============================================================
import { CFG, BEASTS, TEAM_COLOR, clamp } from "/src/shared/cfg.js";

const INTERP_MS = 120;          // 渲染落后最新快照的毫秒数(可调)
const STARVE_MS = 350;          // 超过此时长无新快照 → 冻结
const BUF_KEEP_MS = 2500;       // 插值帧保留时长

const UNIT_KEYS = ["villager", "warrior", "hunter", "shaman", "beast"];
const BLDG_KEYS = ["campfire", "hut", "barracks", "lodge", "altar"];
const RES_KEYS = ["berry", "tree", "stone"];
const ANIMAL_KEYS = ["deer", "wolf"];
const BEAST_KEYS = Object.keys(BEASTS);
const CARRY_KEYS = [null, "food", "wood", "stone"];

export class WorldView {
  constructor(myTeam) {
    this.myTeam = myTeam;
    this.mode = "local";
    this.sim = null;
    // 实体集合(render/input 直接迭代)
    this.units = []; this.bldgs = []; this.resources = []; this.animals = [];
    this.teamRes = [{ food: 0, wood: 0, stone: 0 }, { food: 0, wood: 0, stone: 0 }, { food: 0, wood: 0, stone: 0 }];
    this.pop = [0, 0, 0]; this.popCap = [0, 0, 0];
    this.beasts = [{}, {}, {}];          // 各队已驯服神兽表
    this.time = 0;
    // 瞬态视觉(本地播放)
    this.fx = []; this.proj = [];
    // 供 UI 消费的事件(toast/defeat/ended)
    this._uiEvents = [];
    this._pendingEv = [];                // net:带时间戳等待回放的事件
    // net 插值状态
    this._frames = [];                   // [{time, pos:Map(id→[x,y,face])}]
    this._rows = null;                   // 最新合并行 {u:Map,b:Map,r:Map,a:Map}
    this._dispU = new Map(); this._dispB = new Map(); this._dispR = new Map(); this._dispA = new Map();
    this._rt = 0;                        // 播放时钟(秒)
    this._lastSnapAt = 0;                // performance.now
    this._haveSnap = false;
  }

  // ---------- 单机:挂载 sim ----------
  attachLocal(sim) {
    this.mode = "local";
    this.sim = sim;
    this._syncLocal();
  }
  _syncLocal() {
    const s = this.sim.state;
    this.units = s.units; this.bldgs = s.bldgs; this.resources = s.resources; this.animals = s.animals;
    this.teamRes = s.teams;
    this.time = s.time;
    this.pop = [0, 1, 2].map(() => 0);
    this._recountPop();
  }
  _recountPop() {
    // 单机从 sim 数组现算(与 sim 内部一致)
    if (!this.sim) return;
    const pop = [0, 0, 0], cap = [0, 0, 0];
    for (const u of this.sim.state.units) if (!u.dead && u.utype !== "beast") pop[u.team]++;
    for (const b of this.sim.state.bldgs) if (!b.dead && (b.btype === "campfire" || b.btype === "hut")) cap[b.team] += CFG.bldgs[b.btype].pop;
    this.pop = pop; this.popCap = cap;
    this.beasts = this.sim.state.teams.map(t => t.beasts || {});
  }

  byId(id) {
    if (this.mode === "local") return this.sim.byId.get(id) || null;
    return this._dispU.get(id) || this._dispB.get(id) || this._dispR.get(id) || this._dispA.get(id) || null;
  }
  myRes() { return this.teamRes[this.myTeam] || { food: 0, wood: 0, stone: 0 }; }
  unlockedBeasts(team) { return this.beasts[team] || {}; }
  countBeasts(team) { let n = 0; for (const u of this.units) if (u.team === team && u.utype === "beast" && !u.dead) n++; return n; }

  // ---------- 事件 ----------
  pushEvents(evs) {
    for (const e of evs || []) this._consume(e);
  }
  _consume(e) {
    if (e.e === "fx") {
      this.fx.push(e.ring ? { x: e.x, y: e.y, life: e.life || 0.5, t: 0, ring: true, color: e.color || "#fff" }
                          : { x: e.x, y: e.y, vy: e.vy || -20, life: e.life || 0.6, t: 0, text: e.text || "", color: e.color || "#fff" });
    } else if (e.e === "shot") {
      this.proj.push({ x: e.x, y: e.y, tx: e.tx, ty: e.ty, t: 0, dur: 0.16, color: TEAM_COLOR[e.team] || "#fff" });
    } else if (e.e === "toast") {
      if (e.team === this.myTeam) this._uiEvents.push(e);
    } else if (e.e === "defeat" || e.e === "ended") {
      this._uiEvents.push(e);
    }
  }
  takeUiEvents() { if (!this._uiEvents.length) return []; return this._uiEvents.splice(0, this._uiEvents.length); }
  pushUiEvent(e) { this._uiEvents.push(e); }   // 供联机控制消息注入(ended 等)
  ping(x, y, color) { this.fx.push({ x, y, life: 0.4, t: 0, ring: true, color }); }

  // ---------- 联机:快照 ----------
  applySnapshot(snap) {
    if (snap.full) {
      this.needFull = false;
      this._rows = { u: new Map(), b: new Map(), r: new Map(), a: new Map() };   // 全量:重建行集
    } else if (!this._rows || !this._haveSnap || (snap.base !== undefined && snap.base !== this._seq)) {
      // 基线失配:丢弃本包,请求全量
      this.needFull = true;
      return;
    }
    this._seq = snap.seq;
    const rows = this._rows;
    if (snap.full) {
      for (const row of snap.u) rows.u.set(row[0], row.slice());
      for (const row of snap.b) rows.b.set(row[0], row.slice());
      for (const row of snap.r) rows.r.set(row[0], row.slice());
      for (const row of snap.a) rows.a.set(row[0], row.slice());
    } else {
      for (const id of snap.del || []) { rows.u.delete(id); rows.b.delete(id); rows.r.delete(id); rows.a.delete(id); }
      for (const row of snap.u || []) rows.u.set(row[0], row.slice());
      for (const row of snap.b || []) rows.b.set(row[0], row.slice());
      for (const row of snap.r || []) rows.r.set(row[0], row.slice());
      for (const row of snap.a || []) rows.a.set(row[0], row.slice());
    }
    // 表头
    for (let t = 0; t < 3; t++) {
      const r = snap.res[t] || [0, 0, 0];
      this.teamRes[t] = { food: r[0], wood: r[1], stone: r[2] };
      const p = snap.pop[t] || [0, 0];
      this.pop[t] = p[0]; this.popCap[t] = p[1];
      const bt = {};
      for (const k of (snap.beasts && snap.beasts[t]) || []) bt[k] = true;
      this.beasts[t] = bt;
    }
    this.time = snap.time;
    // 显示对象同步(离散字段取最新)
    this._syncDisplay();
    // 插值帧(仅位置)
    const pos = new Map();
    for (const [id, row] of rows.u) pos.set(id, [row[3], row[4], row[6]]);
    for (const [id, row] of rows.a) pos.set(id, [row[2], row[3], row[5]]);
    this._frames.push({ time: snap.time, pos });
    while (this._frames.length && this._frames[0].time < snap.time - BUF_KEEP_MS / 1000) this._frames.shift();
    // 事件挂到该快照时间点
    for (const e of snap.ev || []) this._pendingEv.push({ at: snap.time, e });
    if (!this._haveSnap) { this._rt = snap.time; this._haveSnap = true; }
    this._lastSnapAt = performance.now();
  }

  _syncDisplay() {
    const rows = this._rows;
    const sync = (map, list, make, update) => {
      const seen = new Set();
      for (const [id, row] of map) {
        seen.add(id);
        let o = list.get(id);
        if (!o) { o = make(row); list.set(id, o); }
        update(o, row);
      }
      for (const id of list.keys()) if (!seen.has(id)) list.delete(id);
    };
    sync(rows.u, this._dispU,
      (row) => ({ id: row[0], kind: "unit", x: 0, y: 0 }),
      (o, row) => {
        const utype = UNIT_KEYS[row[1]];
        o.utype = utype; o.team = row[2]; o.hp = row[5]; o.face = row[6]; o.carry = row[7];
        o.carryType = CARRY_KEYS[row[8]]; o.wild = !!row[9];
        const d = utype === "beast" ? BEASTS[BEAST_KEYS[row[10]]] : CFG.units[utype];
        if (utype === "beast") o.beastType = BEAST_KEYS[row[10]];
        o.maxHp = d.hp; o.radius = d.radius; o.ranged = !!d.ranged;
        o.stance = row[11] === 1 ? "hold" : "aggressive";
      });
    sync(rows.b, this._dispB,
      (row) => ({ id: row[0], kind: "bldg", x: row[3], y: row[4] }),
      (o, row) => {
        o.btype = BLDG_KEYS[row[1]]; o.team = row[2]; o.x = row[3]; o.y = row[4]; o.hp = row[5];
        o.constructing = !!row[6]; o.prog = row[7] || 0;
        o.queue = new Array(row[8] || 0);
        const rl = row[9];
        o.rally = rl ? { x: rl[0], y: rl[1] } : null;
        const d = CFG.bldgs[o.btype];
        o.maxHp = d.hp; o.radius = d.radius; o.need = CFG.times[o.btype];
      });
    sync(rows.r, this._dispR,
      (row) => ({ id: row[0], kind: "res", x: row[2], y: row[3] }),
      (o, row) => {
        o.rtype = RES_KEYS[row[1]]; o.x = row[2]; o.y = row[3]; o.amount = row[4];
        const d = CFG.res[o.rtype];
        o.max = d.amount; o.radius = d.radius;
      });
    sync(rows.a, this._dispA,
      (row) => ({ id: row[0], kind: "animal", x: row[2], y: row[3] }),
      (o, row) => {
        o.atype = ANIMAL_KEYS[row[1]]; o.x = row[2]; o.y = row[3]; o.hp = row[4]; o.dir = row[5];
        const d = CFG[o.atype];
        o.maxHp = d.hp; o.radius = d.radius; o.vx = row[5]; o.wand = row[5]; o.face = row[5];
      });
    this.units = [...this._dispU.values()];
    this.bldgs = [...this._dispB.values()];
    this.resources = [...this._dispR.values()];
    this.animals = [...this._dispA.values()];
  }

  // ---------- 每帧 ----------
  frame(dt) {
    if (this.mode === "local") {
      if (this.sim) { this.time = this.sim.state.time; this._recountPop(); }
    } else if (this._haveSnap) {
      this._advanceClock(dt);
      this._interp();
      // 到点的事件回放
      while (this._pendingEv.length && this._pendingEv[0].at <= this._rt + 0.02) {
        this._consume(this._pendingEv.shift().e);
      }
    }
    // 瞬态推进
    for (const f of this.fx) { f.t += dt; if (f.vy !== undefined) f.y += f.vy * dt; }
    this.fx = this.fx.filter(f => f.t < f.life);
    for (const p of this.proj) p.t += dt;
    this.proj = this.proj.filter(p => p.t < p.dur);
  }

  _advanceClock(dt) {
    const newest = this._frames[this._frames.length - 1];
    if (!newest) return;
    const target = newest.time - INTERP_MS / 1000;
    const starved = (performance.now() - this._lastSnapAt) > STARVE_MS;
    if (starved) {
      // 饥饿:冻结在最新,不外推
      this._rt = Math.min(this._rt + dt, newest.time);
      if (this._rt > newest.time - 0.005) this._rt = newest.time - 0.005;
      return;
    }
    // ±5% 变速追齐目标,防止漂移/快进
    let rate = 1;
    const diff = target - this._rt;
    if (diff > 0.05) rate = 1.05; else if (diff < -0.05) rate = 0.95;
    this._rt += dt * rate;
    if (this._rt > target) this._rt = target;
    if (this._rt < newest.time - BUF_KEEP_MS / 1000) this._rt = target;   // 落后太多直接追上
  }

  _interp() {
    const rt = this._rt;
    let f0 = null, f1 = null;
    for (let i = this._frames.length - 1; i >= 0; i--) {
      if (this._frames[i].time <= rt) { f0 = this._frames[i]; f1 = this._frames[i + 1] || null; break; }
    }
    if (!f0) { f0 = this._frames[0]; f1 = this._frames[1] || null; }
    if (!f1) { f1 = f0; }
    const span = f1.time - f0.time;
    const alpha = span > 1e-6 ? clamp((rt - f0.time) / span, 0, 1) : 1;
    const put = (o) => {
      const a = f0.pos.get(o.id), b = f1.pos.get(o.id);
      if (a && b) {
        o.x = a[0] + (b[0] - a[0]) * alpha;
        o.y = a[1] + (b[1] - a[1]) * alpha;
        let df = b[2] - a[2];
        if (df > Math.PI) df -= Math.PI * 2; else if (df < -Math.PI) df += Math.PI * 2;
        o.face = a[2] + df * alpha;
      } else if (a) { o.x = a[0]; o.y = a[1]; o.face = a[2]; }
      else if (b) { o.x = b[0]; o.y = b[1]; o.face = b[2]; }
    };
    for (const o of this._dispU.values()) put(o);
    for (const o of this._dispA.values()) {
      put(o);
      const a = f0.pos.get(o.id), b = f1.pos.get(o.id);
      const vx = (a && b) ? (b[0] - a[0]) / Math.max(1e-6, f1.time - f0.time) : 0;
      o.vx = vx; o.dir = vx !== 0 ? vx : Math.cos(o.face || o.wand || 0);
    }
    this.time = rt;
  }

  // 单机重开/联机重开时清空
  reset() {
    this.fx = []; this.proj = []; this._uiEvents = []; this._pendingEv = [];
    this._frames = []; this._rows = null; this._haveSnap = false; this._rt = 0;
    this._dispU.clear(); this._dispB.clear(); this._dispR.clear(); this._dispA.clear();
    this.units = []; this.bldgs = []; this.resources = []; this.animals = [];
  }
}
