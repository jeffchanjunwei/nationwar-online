// ============================================================
// 部落纪元 · 共享配置与纯工具(Node 服务器与浏览器共用,无 DOM/无 Node API)
// 从原单文件 nationwar.html 抽取,数值保持一致。
// ============================================================

// ---------- 配置 ----------
export const CFG = {
  world: { w: 2200, h: 1600 },
  startRes: { food: 90, wood: 110, stone: 30 },
  costs: {
    villager: { food: 50 },
    warrior:  { food: 60, wood: 20 },
    hunter:   { food: 40, wood: 25 },
    shaman:   { food: 70, stone: 20 },
    hut:      { wood: 60 },
    barracks: { wood: 95 },
    lodge:    { wood: 70, stone: 25 },
    altar:    { wood: 80, stone: 40 },
  },
  times: { // 生产/建造 秒
    villager: 7, warrior: 9, hunter: 8, shaman: 12,
    hut: 10, barracks: 14, lodge: 12, altar: 14,
  },
  units: {
    villager: { hp: 40,  atk: 4,  range: 20,  atkCd: 0.9, speed: 62, carry: 8, gather: 0.8, radius: 9,  sight: 120, glyph: "民" },
    warrior:  { hp: 135, atk: 16, range: 26,  atkCd: 0.9, speed: 50, radius: 11, sight: 130, glyph: "战" },
    hunter:   { hp: 55,  atk: 21, range: 150, atkCd: 1.2, speed: 56, radius: 9,  sight: 175, glyph: "猎", ranged: true },
    shaman:   { hp: 70,  atk: 6,  range: 24,  atkCd: 1.1, speed: 52, carry: 8, gather: 0.8, radius: 9,  sight: 130, glyph: "巫",
                healRadius: 85, healAmount: 14, healInterval: 0.9, campRadius: 190 },
  },
  bldgs: {
    campfire: { hp: 1500, radius: 30, pop: 5 },
    hut:      { hp: 320,  radius: 17, pop: 5 },
    barracks: { hp: 560,  radius: 21 },
    lodge:    { hp: 480,  radius: 20 },
    altar:    { hp: 520,  radius: 22 },
  },
  res: { berry: { amount: 240, radius: 15 }, tree: { amount: 520, radius: 14 }, stone: { amount: 380, radius: 16 } },
  hunt: { deerFood: 25 },
  wolf: { hp: 70, atk: 11, range: 24, atkCd: 1.0, speed: 60, sight: 160, radius: 10 },
  deer: { hp: 30, speed: 42, radius: 11 },
  ai: { grace: 12, villagerTarget: 8, attackBase: 3, attackGrow: 24, checkInterval: 1.0, defendRadius: 380, recoverTime: 12 },
  playerRecover: 12,     // 玩家村民全灭且无法自救时,每隔这么多秒免费征召一名村民(防卡死)
  cam: { speed: 760, edge: 34, minScale: 0.55, maxScale: 1.8 },
  beastMax: 4,           // 每方场上神兽上限
  wildBeastMax: 2,       // 野外同时存在的神兽数量
  beastRespawn: 90,      // 野外神兽补充间隔(秒)—— 出现更稀少
};

// 神兽:攻击力约等于 7~8 个战士(战士16 → 约112~130)
export const BEASTS = {
  bear:    { name:"巨熊", hp:1400, atk:120, range:34,  atkCd:1.0, speed:46, radius:18, sight:150, ranged:false, food:200, color:"#7a4a22", desc:"高血近战霸主" },
  phoenix: { name:"火凤", hp:700,  atk:130, range:170, atkCd:1.1, speed:74, radius:15, sight:210, ranged:true,  food:220, color:"#ff6a1a", desc:"远程烈焰,极速脆皮" },
  thunder: { name:"雷狼", hp:900,  atk:115, range:32,  atkCd:0.8, speed:90, radius:16, sight:180, ranged:false, food:200, color:"#29b6f6", desc:"闪电突袭,极快" },
  rock:    { name:"岩兽", hp:1900, atk:110, range:36,  atkCd:1.2, speed:34, radius:20, sight:130, ranged:false, food:240, color:"#8d9aa0", desc:"移动堡垒,肉盾之王" },
  serpent: { name:"毒蛟", hp:820,  atk:125, range:160, atkCd:1.0, speed:60, radius:16, sight:200, ranged:true,  food:210, color:"#7cb342", desc:"远程毒息" },
};
export function beastName(k) { return BEASTS[k] ? BEASTS[k].name : k; }

export const WORLD_W = CFG.world.w, WORLD_H = CFG.world.h;
export const TEAM_PLAYER = 0, TEAM_ENEMY = 1, TEAM_ENEMY2 = 2;
export const ALL_TEAMS = [TEAM_PLAYER, TEAM_ENEMY, TEAM_ENEMY2];
export const TEAM_COLOR   = ["#e8743b", "#8e5fd6", "#2ea886"];   // 玩家橙 / 敌方紫 / 敌方青
export const TEAM_COLOR_D = ["#9a3f12", "#5a3a8a", "#1c6b58"];
export const TEAM_NAME    = ["我方", "紫部", "青部"];             // 联机时由客户端按 viewer 重映射

// ---------- 难度 ----------
export const DIFFICULTY = {
  easy:   { grace: 24, villagerTarget: 5, attackBase: 4, attackGrow: 38, checkInterval: 1.6, defendRadius: 240, recoverTime: 18, income: 0.7, pAtk: 1.3, eAtk: 0.75, label: "🌱 简单",
            desc: "我方士兵更强、敌方发展缓慢进攻稀少,适合熟悉操作" },
  normal: { grace: 18, villagerTarget: 6, attackBase: 5, attackGrow: 30, checkInterval: 1.2, defendRadius: 320, recoverTime: 14, income: 1.0, pAtk: 1.0, eAtk: 1.0, label: "⚔️ 正常",
            desc: "势均力敌的标准对抗" },
  hard:   { grace: 10, villagerTarget: 9, attackBase: 3, attackGrow: 20, checkInterval: 0.9, defendRadius: 420, recoverTime: 10, income: 1.15, pAtk: 0.9, eAtk: 1.2, label: "🔥 困难",
            desc: "我方士兵偏弱、敌方经济迅猛进攻凶猛,适合老手" },
};

// ---------- 几何 ----------
export const TAU = Math.PI * 2;
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
export function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
export function rand(a, b) { return a + Math.random() * (b - a); }

// ---------- 纯工具(sim 与客户端共用) ----------
// 劳作型:村民 + 巫师(用村民行为,可移动/采集/建造)
export function isWorker(u) { return u && (u.utype === "villager" || u.utype === "shaman"); }
export function isEnemyOrHostile(e, team) {
  if (e.kind === "unit" || e.kind === "bldg") return e.team !== team && (e.team >= 0 || e.wild);   // 野生神兽也算敌对
  if (e.kind === "animal") return e.atype === "wolf";
  return false;
}
export function resKind(rtype) { return rtype === "berry" ? "food" : rtype === "tree" ? "wood" : "stone"; }
export function carryIcon(k) { return k === "food" ? "🍖" : k === "wood" ? "🪵" : "🪨"; }

// 资源判定/扣减(r 为该队的资源对象 {food,wood,stone})
export function canAfford(r, cost) {
  if (!r) return false;
  if (cost.food && r.food < cost.food) return false;
  if (cost.wood && r.wood < cost.wood) return false;
  if (cost.stone && r.stone < cost.stone) return false;
  return true;
}
export function spend(r, cost) {
  if (cost.food) r.food -= cost.food;
  if (cost.wood) r.wood -= cost.wood;
  if (cost.stone) r.stone -= cost.stone;
}
export function overlapsBldgList(bldgs, x, y, r) {
  for (const b of bldgs) if (!b.dead && dist(x, y, b.x, b.y) < r + b.radius + 8) return true;
  return false;
}

// ---------- 名称(客户端 UI 用,sim 不用) ----------
export function unitName(k) { return k === "villager" ? "村民" : k === "warrior" ? "战士" : k === "hunter" ? "猎人" : k === "shaman" ? "巫师" : k === "beast" ? "神兽" : k; }
export function bldgName(k) { return ({ campfire: "营火", hut: "茅屋", barracks: "兵营", lodge: "猎屋", altar: "祭坛" })[k]; }
export function costStr(c) {
  if (!c) return "";
  const p = [];
  if (c.food) p.push(c.food + "🍖"); if (c.wood) p.push(c.wood + "🪵"); if (c.stone) p.push(c.stone + "🪨");
  return p.join(" ");
}
