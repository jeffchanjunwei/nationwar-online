// 无头 soak 测试:跑两个 sim 实例(单机/联机配置)10 分钟模拟时间,
// 校验:无 NaN、id 唯一、资源有限、无崩溃、单步耗时;并验证多实例无串扰。
import { createGame } from "../src/shared/sim.js";
import { WORLD_W, WORLD_H } from "../src/shared/cfg.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIXED_DT = 1 / 60;
const SIM_MINUTES = Number(process.argv[2] || 10);

function checkInvariants(G, label) {
  const seen = new Set();
  const all = [].concat(G.state.units, G.state.bldgs, G.state.resources, G.state.animals);
  for (const e of all) {
    if (seen.has(e.id)) throw new Error(label + " id 重复: " + e.id);
    seen.add(e.id);
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) throw new Error(label + " 坐标 NaN: #" + e.id);
    if (e.hp !== undefined && !Number.isFinite(e.hp)) throw new Error(label + " hp NaN: #" + e.id);
    if (e.x < 0 || e.x > WORLD_W || e.y < 0 || e.y > WORLD_H) throw new Error(label + " 越界: #" + e.id);
  }
  for (const t of G.state.teams) {
    for (const k of ["food", "wood", "stone"]) {
      if (!Number.isFinite(t[k])) throw new Error(label + " 资源 NaN: " + k);
      if (t[k] < -1e-6) throw new Error(label + " 资源为负: " + k + "=" + t[k]);
    }
  }
  return all.length;
}

// 模拟一个「乱点玩家」:随机选己方单位随机下令
function randomCommand(G, team, R) {
  const mine = G.state.units.filter(u => u.team === team);
  if (!mine.length) return null;
  const u = mine[Math.floor(R() * mine.length)];
  const roll = R();
  if (roll < 0.5) return { c: "order", ids: [u.id], order: { type: "ground", x: R() * WORLD_W, y: R() * WORLD_H } };
  if (roll < 0.6) {
    const b = G.state.bldgs.filter(b => b.team === team && !b.constructing);
    if (b.length) { const bb = b[Math.floor(R() * b.length)]; const t = { campfire: "villager", barracks: "warrior", lodge: "hunter", altar: "shaman" }[bb.btype]; return { c: "train", id: bb.id, utype: t }; }
  }
  if (roll < 0.7) return { c: "stance", ids: [u.id], stance: R() < 0.5 ? "hold" : "aggressive" };
  if (roll < 0.8) {
    const e = [].concat(G.state.units, G.state.bldgs).filter(x => x.team !== team);
    if (e.length) { const t = e[Math.floor(R() * e.length)]; return { c: "order", ids: [u.id], order: { type: "attack", target: t.id } }; }
  }
  return null;
}

function run(label, opts, seed, minutes) {
  const R = mulberry32(seed);
  const G = createGame({ ...opts, rng: R });
  const total = Math.floor(minutes * 60 / FIXED_DT);
  let cmdCount = 0, maxStepMs = 0, sumStepMs = 0;
  const t0 = performance.now();
  for (let i = 0; i < total; i++) {
    const s = performance.now();
    G.step(FIXED_DT);
    const ms = performance.now() - s;
    sumStepMs += ms; if (ms > maxStepMs) maxStepMs = ms;
    if (i % 30 === 0) {                       // 每半秒一个随机操作
      for (const h of G.humans) {
        const cmd = randomCommand(G, h, R);
        if (cmd) { G.applyCommand(h, cmd); cmdCount++; }
      }
    }
    G.collectEvents();                        // 排空事件(模拟服务器消费)
    if (i % 1800 === 0) checkInvariants(G, label);
    if (G.state.isOver) break;
  }
  const ents = checkInvariants(G, label);
  const wall = performance.now() - t0;
  console.log(
    `[${label}] 模拟 ${ (G.state.tick * FIXED_DT / 60).toFixed(1) } 分 | 实体 ${ents} | 命令 ${cmdCount}` +
    ` | 平均步 ${(sumStepMs / G.state.tick).toFixed(3)}ms | 最长步 ${maxStepMs.toFixed(2)}ms | 墙钟 ${(wall / 1000).toFixed(1)}s` +
    ` | 结束=${G.state.isOver} 胜者=${G.state.winner}`
  );
  return G;
}

console.log("soak 测试开始(" + SIM_MINUTES + " 分钟模拟/实例)…");
const g1 = run("单机(1人类+2AI)", { humans: [0], aiTeams: [1, 2], difficulty: "normal" }, 1337, SIM_MINUTES);
const g2 = run("联机(2人类+1AI)", { humans: [0, 1], aiTeams: [2], difficulty: "hard" }, 99991, SIM_MINUTES);

// 串扰检查:两个实例的团队资源不应相同(不同种子 → 不同世界)
const same = g1.state.teams.every((t, i) => t.food === g2.state.teams[i].food && t.wood === g2.state.teams[i].wood);
if (same) throw new Error("多实例疑似串扰:两局资源完全一致");

// 双实例同种子确定性:同配置同种子 → tick 数一致且任意实体坐标一致(可复现性,便于回归)
const a = createGame({ humans: [0], aiTeams: [1, 2], rng: mulberry32(42) });
const b = createGame({ humans: [0], aiTeams: [1, 2], rng: mulberry32(42) });
for (let i = 0; i < 3600; i++) { a.step(FIXED_DT); b.step(FIXED_DT); }
const ea = a.state.units[0], eb = b.state.units[0];
if (a.state.tick !== b.state.tick || Math.abs(ea.x - eb.x) > 1e-9) throw new Error("同种子不可复现");
console.log("确定性/串扰检查通过 ✓");
console.log("soak 测试全部通过 ✓");
