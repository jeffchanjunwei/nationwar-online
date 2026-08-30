// ============================================================
// 快照编码:全量/增量(Node 侧编码;行布局与 client/view.js 严格一致)
//   单位行 [id,u,team,x,y,hp,face,carry,cc,wild,beast,stance]
//   建筑行 [id,b,team,x,y,hp,ctor,prog,qlen,rally?]
//   资源行 [id,r,x,y,amount]
//   动物行 [id,a,x,y,hp,dir]
// 增量 = 与「上次已发各行」逐字段比较后的变化行(整行下发)+ 消失 id
// ============================================================
import { BEASTS } from "./cfg.js";

export const UNIT_KEYS = ["villager", "warrior", "hunter", "shaman", "beast"];
export const BLDG_KEYS = ["campfire", "hut", "barracks", "lodge", "altar"];
export const RES_KEYS = ["berry", "tree", "stone"];
export const ANIMAL_KEYS = ["deer", "wolf"];
export const BEAST_KEYS = Object.keys(BEASTS);
const CARRY_KEYS = [null, "food", "wood", "stone"];

const r0 = v => Math.round(v);
const r2 = v => Math.round(v * 100) / 100;

function unitRow(u) {
  const ucode = UNIT_KEYS.indexOf(u.utype);
  return [
    u.id, ucode, u.team, r0(u.x), r0(u.y), r0(u.hp), r2(u.face),
    r0(u.carry || 0), CARRY_KEYS.indexOf(u.carryType || null), u.wild ? 1 : 0,
    u.utype === "beast" ? BEAST_KEYS.indexOf(u.beastType) : -1,
    u.stance === "hold" ? 1 : 0,
  ];
}
function bldgRow(b) {
  const rl = b.rally ? [r0(b.rally.x), r0(b.rally.y)] : null;
  return [
    b.id, BLDG_KEYS.indexOf(b.btype), b.team, r0(b.x), r0(b.y), r0(b.hp),
    b.constructing ? 1 : 0, r2(b.prog || 0), b.queue.length, rl,
  ];
}
function resRow(r0_) {
  return [r0_.id, RES_KEYS.indexOf(r0_.rtype), r0(r0_.x), r0(r0_.y), r0(r0_.amount)];
}
function animalRow(a) {
  const dir = a.vx !== 0 ? a.vx : Math.cos(a.wand || 0);
  return [a.id, ANIMAL_KEYS.indexOf(a.atype), r0(a.x), r0(a.y), r0(a.hp), r2(dir)];
}

function header(G) {
  const S = G.state;
  const res = [], pop = [], beasts = [];
  for (let t = 0; t < 3; t++) {
    const r = S.teams[t] || { food: 0, wood: 0, stone: 0, beasts: {} };
    res.push([Math.floor(r.food), Math.floor(r.wood), Math.floor(r.stone)]);
    pop.push([G.teamPop(t), G.teamPopCap(t)]);
    beasts.push(Object.keys(r.beasts || {}));
  }
  return { res, pop, beasts };
}

export function encodeFull(G, seq, ev) {
  const S = G.state;
  const h = header(G);
  return {
    t: "snap", seq, tick: S.tick, time: r2(S.time), full: true, ...h,
    u: S.units.map(unitRow),
    b: S.bldgs.map(bldgRow),
    r: S.resources.map(resRow),
    a: S.animals.map(animalRow),
    ev: ev || [],
  };
}

// cache: {u:Map,b:Map,r:Map,a:Map}(上次已发)
export function encodeDelta(G, seq, base, cache, ev) {
  const S = G.state;
  const fresh = {
    u: new Map(S.units.map(e => [e.id, unitRow(e)])),
    b: new Map(S.bldgs.map(e => [e.id, bldgRow(e)])),
    r: new Map(S.resources.map(e => [e.id, resRow(e)])),
    a: new Map(S.animals.map(e => [e.id, animalRow(e)])),
  };
  const del = [];
  for (const key of ["u", "b", "r", "a"]) {
    for (const id of cache[key].keys()) if (!fresh[key].has(id)) del.push(id);
  }
  const out = { u: [], b: [], r: [], a: [] };
  for (const key of ["u", "b", "r", "a"]) {
    for (const [id, row] of fresh[key]) {
      const old = cache[key].get(id);
      if (!old || !rowsEqual(old, row)) out[key].push(row);
      cache[key].set(id, row);
    }
  }
  const h = header(G);
  return {
    t: "snap", seq, tick: S.tick, time: r2(S.time), full: false, base, ...h,
    del, u: out.u, b: out.b, r: out.r, a: out.a,
    ev: ev || [],
  };
}

function rowsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function buildCache(G) {
  const S = G.state;
  return {
    u: new Map(S.units.map(e => [e.id, unitRow(e)])),
    b: new Map(S.bldgs.map(e => [e.id, bldgRow(e)])),
    r: new Map(S.resources.map(e => [e.id, resRow(e)])),
    a: new Map(S.animals.map(e => [e.id, animalRow(e)])),
  };
}
