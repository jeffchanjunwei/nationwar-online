// ============================================================
// 部落纪元 · 共享游戏模拟(从原单文件 nationwar.html 抽取)
// 服务器(联机)与浏览器(单机)跑同一份;不碰 DOM、不做渲染。
// fx/投射物等瞬态视觉以「事件」形式输出,由客户端本地播放。
// ============================================================
import {
  CFG, BEASTS, DIFFICULTY, WORLD_W, WORLD_H, TEAM_PLAYER, TEAM_ENEMY, TEAM_ENEMY2, ALL_TEAMS, TAU,
  clamp, dist2, dist, canAfford, spend, isWorker, resKind, overlapsBldgList,
} from "./cfg.js";

// opts: { humans:[0]|[0,1], aiTeams:[1,2]|[2], difficulty:"easy"|"normal"|"hard", rng?:()=>number }
export function createGame(opts = {}) {
  const humans = Array.isArray(opts.humans) && opts.humans.length ? opts.humans : [TEAM_PLAYER];
  const aiTeams = Array.isArray(opts.aiTeams) && opts.aiTeams.length ? opts.aiTeams : [TEAM_ENEMY, TEAM_ENEMY2];
  const difficulty = DIFFICULTY[opts.difficulty] ? opts.difficulty : "normal";
  const R = opts.rng || Math.random;
  const rand = (a, b) => a + R() * (b - a);
  const randInt = n => Math.floor(R() * n);

  // 每局私有配置深拷贝(难度会改写 cfg.ai,绝不共享可变模块状态)
  const cfg = JSON.parse(JSON.stringify(CFG));
  const d = DIFFICULTY[difficulty];
  cfg.ai.grace = d.grace; cfg.ai.villagerTarget = d.villagerTarget;
  cfg.ai.attackBase = d.attackBase; cfg.ai.attackGrow = d.attackGrow;
  cfg.ai.checkInterval = d.checkInterval; cfg.ai.defendRadius = d.defendRadius;
  cfg.ai.recoverTime = d.recoverTime;

  const isHuman = t => humans.includes(t);

  // 每队倍率:人类恒 1.0;AI 队按难度(原 playerDmg/enemyDmg 语义)
  const dmgMul = [1, 1, 1], incomeMul = [1, 1, 1];
  for (const t of aiTeams) { incomeMul[t] = d.income; dmgMul[t] = d.eAtk; }
  for (const t of humans) { dmgMul[t] = d.pAtk === undefined ? 1 : (humans.length > 1 ? 1 : d.pAtk); }
  // 说明:单机保留原作不对称难度(人类吃 pAtk);联机(humans>1)双方恒 1.0 保证公平。

  // ---------- 实例状态 ----------
  const S = {
    time: 0, tick: 0,
    nextId: 1,
    teams: [],
    units: [], bldgs: [], resources: [], animals: [],
    aiTimer: 0, wolfTimer: 0, beastTimer: 0,
    isOver: false, winner: null,
    defeated: {},          // team -> true(个人已失败)
  };
  const byId = new Map();
  const events = [];
  function pushEvent(e) { events.push(e); }
  function notify(team, msg) { pushEvent({ e: "toast", team, msg }); }

  function register(e) { byId.set(e.id, e); return e; }

  // ---------- 资源/人口 ----------
  function teamPop(t) { let n = 0; for (const u of S.units) if (u.team === t && !u.dead && u.utype !== "beast") n++; return n; }   // 神兽不占人口
  function teamPopCap(t) {
    let n = 0;
    for (const b of S.bldgs) if (b.team === t && !b.dead && (b.btype === "campfire" || b.btype === "hut")) n += cfg.bldgs[b.btype].pop;
    return n;
  }

  // ---------- 实体构造 ----------
  function makeUnit(type, team, x, y) {
    const du = cfg.units[type];
    return register({ id: S.nextId++, kind: "unit", utype: type, team, x, y, hp: du.hp, maxHp: du.hp,
      radius: du.radius, speed: du.speed, atk: du.atk, range: du.range, atkCd: du.atkCd, sight: du.sight,
      atkCdLeft: 0, target: null, order: null, stance: "aggressive",
      carry: 0, carryType: null, gatherT: 0, face: 0, vx: 0, vy: 0, ranged: !!du.ranged, wild: false, dead: false });
  }
  // 神兽构造(wild=true 为野外中立神兽,team=-3)
  function makeBeast(type, team, x, y, wild) {
    const du = BEASTS[type];
    return register({ id: S.nextId++, kind: "unit", utype: "beast", beastType: type, team, x, y, hp: du.hp, maxHp: du.hp,
      radius: du.radius, speed: du.speed, atk: du.atk, range: du.range, atkCd: du.atkCd, sight: du.sight,
      atkCdLeft: 0, target: null, order: null, stance: "aggressive",
      carry: 0, carryType: null, gatherT: 0, face: 0, vx: 0, vy: 0, ranged: !!du.ranged, wild: !!wild,
      wand: rand(0, TAU), wandT: rand(1, 4), dead: false });
  }
  function countBeasts(t) { let n = 0; for (const u of S.units) if (u.team === t && u.utype === "beast" && !u.dead) n++; return n; }
  function countWildBeasts() { let n = 0; for (const u of S.units) if (u.utype === "beast" && u.wild && !u.dead) n++; return n; }
  // 野外刷神兽(开局只刷 1 只,稀少)
  function spawnWildBeasts() {
    const types = Object.keys(BEASTS);
    const type = types[randInt(types.length)];
    const x = rand(WORLD_W * 0.3, WORLD_W * 0.7), y = rand(WORLD_H * 0.22, WORLD_H * 0.78);
    S.units.push(makeBeast(type, -3, x, y, true));
  }
  // 驯服神兽:在击败地点(x,y)生成一只驯化神兽并让它自行走回营地;同时解锁该种类
  function captureBeast(type, team, x, y) {
    if (!S.teams[team]) return;
    S.teams[team].beasts[type] = true;
    const tb = makeBeast(type, team, x, y, false);
    S.units.push(tb);
    const camp = teamCamp(team);
    if (camp) tb.order = { type: "move", x: camp.x + rand(-30, 30), y: camp.y + rand(-30, 30) };   // 收回部落圈养
    pushEvent({ e: "fx", x, y, life: 0.7, ring: true, color: isHuman(team) ? "#ffd54f" : "#aaa" });
    if (isHuman(team)) notify(team, "✨ 驯服 " + BEASTS[type].name + "!它正走回营地(选中可指挥)");
  }
  // 祭坛召唤神兽(圈养培育,消耗食物)
  function summonBeast(team, type) {
    const b = BEASTS[type];
    if (!b || !S.teams[team]) return false;
    if (countBeasts(team) >= cfg.beastMax) { notify(team, "神兽已达上限 " + cfg.beastMax); return false; }
    if (!canAfford(S.teams[team], { food: b.food })) { notify(team, "食物不足"); return false; }
    const camp = teamCamp(team);
    if (!camp) return false;
    spend(S.teams[team], { food: b.food });
    const tb = makeBeast(type, team, camp.x + rand(-30, 30), camp.y + rand(-30, 30), false);
    S.units.push(tb);
    notify(team, "召唤 " + b.name);
    return true;
  }
  function makeBldg(type, team, x, y, constructing) {
    const du = cfg.bldgs[type];
    return register({ id: S.nextId++, kind: "bldg", btype: type, team, x, y, radius: du.radius,
      hp: constructing ? du.hp * 0.5 : du.hp, maxHp: du.hp, queue: [], prodT: 0,
      constructing: !!constructing, prog: constructing ? 0 : 0, need: constructing ? cfg.times[type] : 0,
      rally: null, dead: false });
  }

  // ---------- 世界生成 ----------
  function addResource(type, x, y) {
    const du = cfg.res[type];
    S.resources.push(register({ id: S.nextId++, kind: "res", rtype: type, x, y, amount: du.amount, max: du.amount, radius: du.radius, dead: false }));
  }
  function spawnDeer(x, y) { const du = cfg.deer; S.animals.push(register({ id:S.nextId++, kind:"animal", atype:"deer", team:-1, x, y, hp:du.hp, maxHp:du.hp, radius:du.radius, speed:du.speed, atk:0, range:0, atkCd:0, sight:90, atkCdLeft:0, target:null, wand:rand(0,TAU), wandT:rand(1,3), vx:0, vy:0, face:0, dead:false })); }
  function spawnWolf(x, y) { const du=cfg.wolf; S.animals.push(register({ id:S.nextId++, kind:"animal", atype:"wolf", team:-2, x, y, hp:du.hp, maxHp:du.hp, radius:du.radius, speed:du.speed, atk:du.atk, range:du.range, atkCd:du.atkCd, sight:du.sight, atkCdLeft:0, target:null, wand:rand(0,TAU), wandT:rand(1,3), vx:0, vy:0, face:0, dead:false })); }

  function initWorld() {
    S.units = []; S.bldgs = []; S.resources = []; S.animals = [];
    S.time = 0; S.tick = 0; S.aiTimer = 0; S.wolfTimer = 0; S.beastTimer = 0;
    S.isOver = false; S.winner = null; S.defeated = {};
    S.teams = [];
    for (const t of ALL_TEAMS) S.teams.push({ food: cfg.startRes.food, wood: cfg.startRes.wood, stone: cfg.startRes.stone, beasts: {} });

    // 三角布局:玩家左、紫部右、青部上(三方混战)
    const camps = [
      { team: TEAM_PLAYER,  x: 300,        y: WORLD_H / 2 },
      { team: TEAM_ENEMY,   x: WORLD_W-300, y: WORLD_H / 2 },
      { team: TEAM_ENEMY2,  x: WORLD_W/2,   y: 240 },
    ];
    for (const c of camps) {
      const camp = makeBldg("campfire", c.team, c.x, c.y, false); S.bldgs.push(camp);
      for (let i = 0; i < 4; i++) S.units.push(makeUnit("villager", c.team, c.x + 40 + i * 18, c.y + 30));
      camp.rally = nearestRes(c.x, c.y, 700);
      seedCluster("berry", c.x + 150, c.y - 120, 2);
      seedCluster("tree",  c.x + 120, c.y + 160, 3);
      seedCluster("stone", c.x - 90,  c.y + 40,  1);
    }

    // 中部与散布资源
    for (let i = 0; i < 14; i++) seedCluster("tree",  rand(WORLD_W*0.25, WORLD_W*0.75), rand(150, WORLD_H-150), rand(2,4));
    for (let i = 0; i < 12; i++) seedCluster("berry", rand(WORLD_W*0.25, WORLD_W*0.75), rand(150, WORLD_H-150), rand(1,3));
    for (let i = 0; i < 8; i++)  seedCluster("stone", rand(WORLD_W*0.25, WORLD_W*0.75), rand(150, WORLD_H-150), rand(1,2));

    for (let i = 0; i < 8; i++) spawnDeer(rand(WORLD_W*0.3, WORLD_W*0.7), rand(200, WORLD_H-200));
    for (let i = 0; i < 4; i++) spawnWolf(rand(WORLD_W*0.35, WORLD_W*0.65), rand(250, WORLD_H-250));
    spawnWildBeasts();

    // 开局村民自动采集最近资源(首屏即有经济运转)
    for (const u of S.units) {
      if (u.utype === "villager" && !u.order) {
        const r = nearestRes(u.x, u.y, 99999);
        if (r) u.order = { type: "gather", target: r };
      }
    }
  }
  function seedCluster(type, cx, cy, n) {
    for (let i = 0; i < n; i++) addResource(type, cx + rand(-55, 55), cy + rand(-55, 55));
  }
  function nearestRes(x, y, maxR) {
    let best = null, bd = maxR ? maxR * maxR : Infinity;
    for (const r of S.resources) {
      if (r.dead || r.amount <= 0) continue;
      const dd = dist2(x, y, r.x, r.y);
      if (dd < bd) { bd = dd; best = r; }
    }
    return best;
  }

  // ---------- 生产/建造 ----------
  function queueTrain(b, type) {
    if (b.constructing || b.dead) return;
    const cost = cfg.costs[type];
    if (!canAfford(S.teams[b.team], cost)) { notify(b.team, "资源不足"); return; }
    if (teamPop(b.team) >= teamPopCap(b.team)) { notify(b.team, "人口已满,先造茅屋"); return; }
    spend(S.teams[b.team], cost);
    if (b.queue.length === 0) b.prodT = cfg.times[type];
    b.queue.push(type);
  }
  function spawnFromBldg(b, type) {
    const ang = rand(0, TAU);
    const x = b.x + Math.cos(ang) * (b.radius + 12);
    const y = b.y + Math.sin(ang) * (b.radius + 12);
    const u = makeUnit(type, b.team, clamp(x, 8, WORLD_W - 8), clamp(y, 8, WORLD_H - 8));
    S.units.push(u);
    if (type === "shaman") {
      // 巫师默认回营火旁待命(准备治疗);玩家可另点资源让它去采集
      const camp = S.bldgs.find(bb => bb.team === b.team && bb.btype === "campfire" && !bb.dead);
      u.order = camp ? { type: "move", x: camp.x + rand(-20, 20), y: camp.y + rand(-20, 20) } : null;
    } else if (type === "villager" && b.rally && b.rally.kind === "res") {
      u.order = { type: "gather", target: b.rally };
    } else if (b.rally) {
      u.order = (type === "villager") ? { type: "move", x: b.rally.x, y: b.rally.y }
                                      : { type: "amove", x: b.rally.x, y: b.rally.y };
    }
  }

  // ---------- 战斗 ----------
  function acquireTarget(u) {
    const sight2 = u.sight * u.sight;
    let best = null, bd = sight2;
    for (const e of S.units) {
      if (e.team === u.team || e.dead) continue;                  // 野生神兽(team<0)也可被锁定
      const dd = dist2(u.x, u.y, e.x, e.y); if (dd < bd) { bd = dd; best = e; }
    }
    for (const e of S.bldgs) {
      if (e.team === u.team || e.team < 0 || e.dead) continue;
      const dd = dist2(u.x, u.y, e.x, e.y); if (dd < bd) { bd = dd; best = e; }
    }
    for (const e of S.animals) {
      if (e.atype !== "wolf" || e.dead) continue;
      const dd = dist2(u.x, u.y, e.x, e.y); if (dd < bd) { bd = dd; best = e; }
    }
    return best;
  }
  function dealDamage(attacker, target, dmg) {
    if (!target || target.dead || target.hp === undefined) return;
    // 难度战斗力补偿:按队伍倍率(动物攻击按 1.0)
    const mul = (attacker && attacker.team >= 0) ? dmgMul[attacker.team] : 1;
    const real = dmg * mul;
    target.hp -= real;
    // 野生神兽记仇:被谁打就反击谁(平时被动,不主动咬人)
    if (target.utype === "beast" && target.wild && attacker && attacker.team >= 0) { target._hitBy = attacker.team; target._hitT = 0; }
    if (attacker) attacker.face = Math.atan2(target.y - attacker.y, target.x - attacker.x);
    pushEvent({ e: "fx", x: target.x, y: target.y - 4, vy: -22, life: 0.6, text: "-" + Math.round(real), color: "#ffd2d2" });
    if (target.hp <= 0) killEntity(target, attacker);
  }
  function killEntity(e, killer) {
    if (e.dead) return;
    e.dead = true;
    pushEvent({ e: "fx", x: e.x, y: e.y, life: 0.5, ring: true, color: e.kind === "bldg" ? "#ff8a3b" : "#c0392b" });
    if (e.kind === "animal" && e.atype === "deer" && killer && killer.team >= 0) {
      S.teams[killer.team].food += cfg.hunt.deerFood;
      pushEvent({ e: "fx", x: e.x, y: e.y - 10, vy: -20, life: 0.9, text: "+" + cfg.hunt.deerFood + "🍖", color: "#7bd88f" });
    }
    if (e.utype === "beast" && e.wild && killer && killer.team >= 0) captureBeast(e.beastType, killer.team, e.x, e.y);   // 击败野生神兽 → 原地驯服并走回营地
  }

  // ---------- 移动 ----------
  function moveToward(u, tx, ty, dt, stopR) {
    const dx = tx - u.x, dy = ty - u.y;
    const dd = Math.hypot(dx, dy);
    if (dd <= stopR) { u.vx = 0; u.vy = 0; return true; }
    const sp = u.speed;
    u.vx = (dx / dd) * sp; u.vy = (dy / dd) * sp;
    u.face = Math.atan2(dy, dx);
    return false;
  }

  // ---------- 单位 AI ----------
  function updateUnit(u, dt) {
    if (u.dead) return;
    u.vx = 0; u.vy = 0;
    if (u.atkCdLeft > 0) u.atkCdLeft -= dt;
    if (u.target && (u.target.dead || (u.target.hp !== undefined && u.target.hp <= 0))) u.target = null;

    if (u.utype === "beast") updateBeast(u, dt);                              // 神兽:野生领地 / 驯化按军队行为
    else if (u.utype === "shaman") { shamanHeal(u, dt); updateVillager(u, dt); }   // 巫师:营地内治疗 + 可像村民一样采集/移动
    else if (u.utype === "villager") updateVillager(u, dt);
    else updateMilitary(u, dt);
  }
  // 神兽行为
  function updateBeast(u, dt) {
    if (u.wild) { updateWildBeast(u, dt); return; }
    updateMilitary(u, dt);   // 驯化神兽:与战士同构(amove/attack/自动锁敌),用 u.ranged 判断投射
  }
  // 野生神兽:平时被动游荡;被攻击后会记仇反击该方约 8 秒
  function updateWildBeast(u, dt) {
    u._hitT = (u._hitT || 0) + dt;
    const angry = (u._hitBy !== undefined && u._hitBy >= 0 && u._hitT < 8);
    if (angry) {
      if (!u.target || u.target.dead || u.target.team !== u._hitBy) u.target = nearestUnitOfTeam(u, u._hitBy, u.sight * 1.6);
      if (u.target) {
        const dd = dist(u.x, u.y, u.target.x, u.target.y);
        if (dd > u.range) moveToward(u, u.target.x, u.target.y, dt, Math.max(2, u.range - 4));
        else tryAttack(u, u.target, dt);
        return;
      }
    } else {
      u.target = null;
    }
    u.wandT -= dt;
    if (u.wandT <= 0) { u.wand = rand(0, TAU); u.wandT = rand(2, 5); }
    const sp = u.speed * 0.4;
    u.vx = Math.cos(u.wand) * sp; u.vy = Math.sin(u.wand) * sp;
  }
  function nearestUnitOfTeam(a, team, r) {
    const r2 = r * r; let best = null, bd = r2;
    for (const u of S.units) {
      if (u === a || u.dead || u.team !== team || u.utype === "beast") continue;
      const dd = dist2(a.x, a.y, u.x, u.y);
      if (dd < bd) { bd = dd; best = u; }
    }
    return best;
  }

  function updateVillager(u, dt) {
    const o = u.order;
    if (!o) return;
    if (o.type === "move") {
      if (moveToward(u, o.x, o.y, dt, 4)) u.order = null;
      return;
    }
    if (o.type === "build") {
      const b = o.target;
      if (!b || b.dead || !b.constructing) { u.order = null; return; }
      if (moveToward(u, b.x, b.y, dt, b.radius + 6)) {
        b.prog += dt;
        if (b.prog >= b.need) { b.constructing = false; b.hp = b.maxHp; notify(b.team, "建筑完成 ✦"); }
      }
      return;
    }
    if (o.type === "gather") {
      let node = o.target;
      if (!node || node.dead || node.amount <= 0) {
        node = nearestRes(u.x, u.y, 99999);
        if (node) o.target = node; else { u.order = null; return; }
      }
      if (u.carry >= cfg.units.villager.carry) {
        const drop = nearestDropoff(u);
        if (!drop) { u.order = null; return; }
        if (moveToward(u, drop.x, drop.y, dt, drop.radius + 6)) {
          S.teams[u.team][u.carryType] += u.carry * (u.team >= 0 ? incomeMul[u.team] : 1);
          pushEvent({ e: "fx", x: drop.x, y: drop.y - 14, vy: -20, life: 0.7,
            text: "+" + u.carry + carryIconOf(u.carryType), color: "#ffe9c4" });
          u.carry = 0; u.carryType = null;
        }
        return;
      }
      if (moveToward(u, node.x, node.y, dt, node.radius + 6)) {
        u.gatherT += dt;
        if (u.gatherT >= cfg.units.villager.gather) {
          u.gatherT = 0;
          const take = Math.min(cfg.units.villager.carry, node.amount);
          node.amount -= take;
          u.carry = take;
          u.carryType = resKind(node.rtype);
          if (node.amount <= 0) node.dead = true;
        }
      }
      return;
    }
  }
  function nearestDropoff(u) {
    let best = null, bd = Infinity;
    for (const b of S.bldgs) {
      if (b.dead || b.team !== u.team || b.constructing) continue;
      if (b.btype === "campfire") { const dd = dist2(u.x, u.y, b.x, b.y); if (dd < bd) { bd = dd; best = b; } }
    }
    return best;
  }
  function teamCamp(team) { return S.bldgs.find(b => b.team === team && b.btype === "campfire" && !b.dead); }
  // 巫师治疗:仅在己方营地范围内,周期性治疗身边受伤的友军(村民/战士/猎人/巫师)
  function shamanHeal(u, dt) {
    const du = cfg.units.shaman;
    const camp = teamCamp(u.team);
    if (!camp) return;
    if (dist2(u.x, u.y, camp.x, camp.y) > du.campRadius * du.campRadius) return;   // 不在营地内不治疗
    u._healT = (u._healT || 0) + dt;
    if (u._healT < du.healInterval) return;
    u._healT = 0;
    const r2 = du.healRadius * du.healRadius;
    let any = false;
    for (const t of S.units) {
      if (t.team !== u.team || t.dead || t.hp === undefined) continue;
      if (t.hp > 0 && t.hp < t.maxHp && dist2(u.x, u.y, t.x, t.y) < r2) {
        t.hp = Math.min(t.maxHp, t.hp + du.healAmount);
        any = true;
        pushEvent({ e: "fx", x: t.x, y: t.y - 6, vy: -18, life: 0.6, text: "+" + du.healAmount, color: "#7bd88f" });
      }
    }
    if (any) pushEvent({ e: "fx", x: u.x, y: u.y, life: 0.5, ring: true, color: "#7bd88f" });   // 治疗光环
  }
  function carryIconOf(k) { return k === "food" ? "🍖" : k === "wood" ? "🪵" : "🪨"; }

  function updateMilitary(u, dt) {
    const o = u.order;
    const range = u.range;
    if (o && o.type === "attack") {
      const t = o.target;
      if (!t || t.dead) { u.order = null; }
      else {
        const dd = dist(u.x, u.y, t.x, t.y);
        if (dd > range) moveToward(u, t.x, t.y, dt, Math.max(2, range - 3));
        else tryAttack(u, t, dt);
        return;
      }
    }
    let engage = null;
    if (u.stance === "aggressive" || (o && o.type === "amove")) {
      const cand = (u.target && !u.target.dead) ? u.target : acquireTarget(u);
      if (cand && dist(u.x, u.y, cand.x, cand.y) <= u.sight) engage = cand;
    }
    if (engage) {
      u.target = engage;
      const dd = dist(u.x, u.y, engage.x, engage.y);
      if (dd > range) moveToward(u, engage.x, engage.y, dt, Math.max(2, range - 3));
      else tryAttack(u, engage, dt);
      return;
    }
    u.target = null;
    if (o && (o.type === "amove" || o.type === "move")) {
      if (moveToward(u, o.x, o.y, dt, 6)) u.order = null;
    }
  }
  function tryAttack(u, t, dt) {
    if (u.atkCdLeft > 0) return;
    u.atkCdLeft = u.atkCd;
    u.face = Math.atan2(t.y - u.y, t.x - u.x);
    u.vx = 0; u.vy = 0;
    if (u.ranged) {
      pushEvent({ e: "shot", x: u.x, y: u.y, tx: t.x, ty: t.y, team: u.team });
    }
    dealDamage(u, t, u.atk);
  }

  // ---------- 动物 AI ----------
  function updateAnimal(a, dt) {
    if (a.dead) return;
    a.vx = 0; a.vy = 0;
    if (a.atkCdLeft > 0) a.atkCdLeft -= dt;
    if (a.atype === "wolf") {
      if (!a.target || a.target.dead) a.target = nearestUnit(a, a.sight, true);
      if (a.target) {
        const dd = dist(a.x, a.y, a.target.x, a.target.y);
        if (dd > a.range) moveToward(a, a.target.x, a.target.y, dt, Math.max(2, a.range - 3));
        else if (a.atkCdLeft <= 0) { a.atkCdLeft = a.atkCd; dealDamage(a, a.target, a.atk); }
        return;
      }
    }
    a.wandT -= dt;
    if (a.wandT <= 0) { a.wand = rand(0, TAU); a.wandT = rand(1.5, 4); }
    const sp = a.speed * 0.5;
    a.vx = Math.cos(a.wand) * sp; a.vy = Math.sin(a.wand) * sp;
  }
  function nearestUnit(a, r, preferVillager) {
    const r2 = r * r; let best = null, bd = r2, bestV = null, bdV = r2;
    for (const u of S.units) {
      if (u.dead) continue;
      const dd = dist2(a.x, a.y, u.x, u.y);
      if (dd < r2) {
        if (dd < bd) { bd = dd; best = u; }
        if (preferVillager && u.utype === "villager" && dd < bdV) { bdV = dd; bestV = u; }
      }
    }
    return bestV || best;
  }

  // ---------- 分离(避免堆叠)+ 积分 ----------
  function integrate(dt) {
    for (const u of S.units) { u.x += u.vx * dt; u.y += u.vy * dt; u.x = clamp(u.x, 8, WORLD_W - 8); u.y = clamp(u.y, 8, WORLD_H - 8); }
    for (const a of S.animals) { a.x += a.vx * dt; a.y += a.vy * dt; a.x = clamp(a.x, 8, WORLD_W - 8); a.y = clamp(a.y, 8, WORLD_H - 8); }
    separate(S.units);
    separate(S.animals);
  }
  function separate(arr) {
    const n = arr.length;
    for (let i = 0; i < n; i++) {
      const a = arr[i]; if (a.dead) continue;
      for (let j = i + 1; j < n; j++) {
        const b = arr[j]; if (b.dead) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const min = a.radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 < min * min && d2 > 0.01) {
          const dd = Math.sqrt(d2);
          const push = (min - dd) * 0.5;
          const nx = dx / dd, ny = dy / dd;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
        }
      }
    }
  }

  // ---------- 建筑更新 ----------
  function updateBldg(b, dt) {
    if (b.dead || b.constructing) return;
    if (b.queue.length) {
      if (teamPop(b.team) >= teamPopCap(b.team)) return;
      b.prodT -= dt;
      if (b.prodT <= 0) {
        const type = b.queue.shift();
        spawnFromBldg(b, type);
        if (b.queue.length) b.prodT = cfg.times[b.queue[0]]; else b.prodT = 0;
      }
    }
  }

  // ---------- 村民恢复(玩家与敌方通用,防经济卡死)----------
  // 当某方一名村民都没有、且自己也无法训练村民(没钱或满人口)时,
  // 营火会在一段时间后紧急征召一名免费村民,避免游戏陷入死局。
  function canTrainVillager(t) {
    return canAfford(S.teams[t], cfg.costs.villager) && teamPop(t) < teamPopCap(t);
  }
  function updateRecovery(dt) {
    for (const t of ALL_TEAMS) {
      const camp = S.bldgs.find(b => b.team === t && b.btype === "campfire" && !b.dead);
      if (!camp) continue;
      const stuck = countUnits(t, "villager") === 0 && !canTrainVillager(t);
      if (stuck) {
        camp._recovT = (camp._recovT || 0) + dt;
        const wait = isHuman(t) ? cfg.playerRecover : cfg.ai.recoverTime;
        if (camp._recovT >= wait) {
          camp._recovT = 0;
          spawnFromBldg(camp, "villager");          // 部落残部重整(免费)
          if (isHuman(t)) notify(t, "部落残部重整:一名村民已加入");
        }
      } else {
        camp._recovT = 0;
      }
    }
  }

  // ---------- 敌方 AI 导演(每个 AI 部落各自运营,攻击最近的对手)----------
  function aiUpdate(dt) {
    // 闲置村民自动采集(每帧,所有 AI 部落)
    for (const u of S.units) {
      if (!aiTeams.includes(u.team) || u.utype !== "villager" || u.dead) continue;
      if (!u.order || u.order.type === "move") {
        const r = nearestRes(u.x, u.y, 99999);
        if (r) u.order = { type: "gather", target: r };
      }
    }

    S.aiTimer -= dt;
    if (S.aiTimer > 0) return;
    S.aiTimer = cfg.ai.checkInterval;

    for (const t of aiTeams) {
      const camp = S.bldgs.find(b => b.team === t && b.btype === "campfire" && !b.dead);
      if (!camp) continue;
      runTribeAI(t, camp);
    }
  }
  function runTribeAI(t, camp) {
    const villN = countUnits(t, "villager");
    const warN = countUnits(t, "warrior") + countUnits(t, "hunter") + countUnits(t, "beast");
    const hasBarracks = S.bldgs.some(b => b.team === t && b.btype === "barracks" && !b.dead);
    const hasLodge = S.bldgs.some(b => b.team === t && b.btype === "lodge" && !b.dead);

    if (teamPop(t) >= teamPopCap(t) - 1 && canAfford(S.teams[t], cfg.costs.hut)) aiBuild(t, "hut", camp);
    if (villN < cfg.ai.villagerTarget && teamPop(t) < teamPopCap(t) && canAfford(S.teams[t], cfg.costs.villager)) queueTrain(camp, "villager");
    if (!hasBarracks && canAfford(S.teams[t], cfg.costs.barracks)) aiBuild(t, "barracks", camp);
    else if (!hasLodge && canAfford(S.teams[t], cfg.costs.lodge)) aiBuild(t, "lodge", camp);

    const milBldgs = S.bldgs.filter(b => b.team === t && !b.constructing && !b.dead && (b.btype === "barracks" || b.btype === "lodge"));
    for (const mb of milBldgs) {
      if (teamPop(t) >= teamPopCap(t)) break;
      const type = mb.btype === "barracks" ? "warrior" : "hunter";
      if (canAfford(S.teams[t], cfg.costs[type])) queueTrain(mb, type);
    }

    // 防守:任一对手军队逼近我方营火 → 回防
    const threat = baseThreat(camp.x, camp.y, t);
    if (threat) {
      camp._attacking = false; camp._defending = true;
      for (const u of S.units) if (u.team === t && (u.utype === "warrior" || u.utype === "hunter" || u.utype === "beast") && !u.dead)
        u.order = { type: "amove", x: camp.x + rand(-40, 40), y: camp.y + rand(-40, 40) };
    } else {
      camp._defending = false;
      // 进攻:攒够兵力压向最近的对手营火
      if (S.time > cfg.ai.grace) {
        const threshold = cfg.ai.attackBase + Math.floor(S.time / cfg.ai.attackGrow);
        if (warN >= threshold && !camp._attacking) {
          camp._attacking = true;
          const tgt = nearestRivalCamp(t);
          if (tgt) for (const u of S.units) if (u.team === t && (u.utype === "warrior" || u.utype === "hunter" || u.utype === "beast") && !u.dead)
            u.order = { type: "amove", x: tgt.x, y: tgt.y };
        }
        if (camp._attacking && warN < 2) camp._attacking = false;
      }
    }
  }
  // 最近的对手营火(三方混战:可能打玩家,也可能打另一个部落)
  function nearestRivalCamp(t) {
    let best = null, bd = Infinity;
    for (const b of S.bldgs) {
      if (b.dead || b.team === t || b.btype !== "campfire") continue;
      const dd = dist2(b.x, b.y, ...campAnchor(t));
      if (dd < bd) { bd = dd; best = b; }
    }
    return best;
  }
  function campAnchor(t) { const c = S.bldgs.find(b => b.team === t && b.btype === "campfire" && !b.dead); return c ? [c.x, c.y] : [WORLD_W/2, WORLD_H/2]; }
  // 营火受威胁判定:defendRadius 内有对手军队,或 120 内有任何对手单位
  function baseThreat(x, y, forTeam) {
    const Rr = cfg.ai.defendRadius, R2 = Rr * Rr, T2 = 120 * 120;
    let mil = null, any = null, mbd = R2, abd = T2;
    for (const u of S.units) {
      if (u.dead || u.team === forTeam || u.team < 0) continue;   // 只看对手
      const dd = dist2(x, y, u.x, u.y);
      if (u.utype !== "villager" && dd < mbd) { mbd = dd; mil = u; }
      if (dd < abd) { abd = dd; any = u; }
    }
    return mil || any;
  }
  function countUnits(t, utype) { let n = 0; for (const u of S.units) if (u.team === t && u.utype === utype && !u.dead) n++; return n; }
  function aiBuild(t, type, camp) {
    if (!canAfford(S.teams[t], cfg.costs[type])) return;
    for (let tries = 0; tries < 14; tries++) {
      const ang = rand(0, TAU), rr = rand(70, 160);
      const x = clamp(camp.x + Math.cos(ang) * rr, 60, WORLD_W - 60);
      const y = clamp(camp.y + Math.sin(ang) * rr, 60, WORLD_H - 60);
      if (!overlapsBldgList(S.bldgs, x, y, cfg.bldgs[type].radius)) {
        spend(S.teams[t], cfg.costs[type]);
        const b = makeBldg(type, t, x, y, true);
        S.bldgs.push(b);
        let best = null, bd = Infinity;
        for (const u of S.units) if (u.team === t && u.utype === "villager" && !u.dead) {
          const dd = dist2(u.x, u.y, x, y); if (dd < bd) { bd = dd; best = u; }
        }
        if (best) best.order = { type: "build", target: b };
        return;
      }
    }
  }

  // ---------- 胜负 ----------
  // 通用化:每方以「营火」计生死;人类队营火被毁 = 个人失败事件;
  // 全场只剩 ≤1 个营火 = 对局结束。单机时退化为原版语义。
  function aliveCamps() {
    const set = new Set();
    for (const b of S.bldgs) if (!b.dead && b.btype === "campfire" && b.team >= 0) set.add(b.team);
    return set;
  }
  function checkEnd() {
    const alive = aliveCamps();
    for (const h of humans) {
      if (!alive.has(h) && !S.defeated[h]) {
        S.defeated[h] = true;
        pushEvent({ e: "defeat", team: h });
      }
    }
    if (!S.isOver && alive.size <= 1) {
      S.isOver = true;
      S.winner = alive.size ? alive.values().next().value : -1;
      pushEvent({ e: "ended", winner: S.winner });
    }
  }

  // ---------- 主步进 ----------
  function step(dt) {
    S.time += dt; S.tick++;
    S.wolfTimer += dt;
    const wolfN = S.animals.filter(a => a.atype === "wolf" && !a.dead).length;
    if (S.wolfTimer > 25 && wolfN < 4) { S.wolfTimer = 0; spawnWolf(rand(WORLD_W * 0.3, WORLD_W * 0.7), rand(250, WORLD_H - 250)); }
    // 野外神兽缓慢补充(供玩家继续探索捕获)
    S.beastTimer += dt;
    if (S.beastTimer > cfg.beastRespawn && countWildBeasts() < cfg.wildBeastMax) {
      S.beastTimer = 0;
      const types = Object.keys(BEASTS);
      S.units.push(makeBeast(types[randInt(types.length)], -3, rand(WORLD_W * 0.3, WORLD_W * 0.7), rand(WORLD_H * 0.22, WORLD_H * 0.78), true));
    }

    for (const u of S.units) updateUnit(u, dt);
    for (const a of S.animals) updateAnimal(a, dt);
    integrate(dt);
    for (const b of S.bldgs) updateBldg(b, dt);
    updateRecovery(dt);
    aiUpdate(dt);

    if (someDead(S.units) || someDead(S.bldgs) || someDead(S.resources) || someDead(S.animals)) {
      S.units = S.units.filter(u => { if (u.dead) { byId.delete(u.id); return false; } return true; });
      S.bldgs = S.bldgs.filter(b => { if (b.dead) { byId.delete(b.id); return false; } return true; });
      S.resources = S.resources.filter(r => { if (r.dead) { byId.delete(r.id); return false; } return true; });
      S.animals = S.animals.filter(a => { if (a.dead) { byId.delete(a.id); return false; } return true; });
    }
    checkEnd();
  }
  function someDead(arr) { for (const e of arr) if (e.dead) return true; return false; }

  // ---------- 玩家命令(权威入口,服务器与单机共用)----------
  function resolveUnits(team, ids) {
    if (!Array.isArray(ids)) return [];
    const out = [];
    const seen = new Set();
    for (const id of ids.slice(0, 64)) {
      if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) continue;
      const u = byId.get(id);
      if (!u || u.dead || u.kind !== "unit" || u.team !== team || seen.has(id)) continue;
      seen.add(id);
      out.push(u);
    }
    return out;
  }
  const num = (v, def) => (typeof v === "number" && isFinite(v) ? v : def);
  const cx = v => clamp(num(v, WORLD_W / 2), 8, WORLD_W - 8);
  const cy = v => clamp(num(v, WORLD_H / 2), 8, WORLD_H - 8);

  // order:{type:"attack"|"gather"|"build",target:id} | {type:"ground",x,y}
  function cmdOrder(team, ids, o) {
    const list = resolveUnits(team, ids);
    if (!list.length || !o || typeof o !== "object") return { ok: false, reason: "no-units" };
    if (o.type === "attack") {
      const t = byId.get(o.target);
      if (!t || t.dead || t.hp === undefined) return { ok: false, reason: "no-target" };
      if (t.team === team) return { ok: false, reason: "friendly" };
      for (const u of list) {
        if (isWorker(u)) u.order = { type: "move", x: t.x, y: t.y };
        else { u.order = { type: "attack", target: t }; u.target = t; }
      }
      return { ok: true };
    }
    if (o.type === "gather") {
      const t = byId.get(o.target);
      if (!t || t.dead || t.kind !== "res") return { ok: false, reason: "no-target" };
      for (const u of list) {
        if (isWorker(u)) { u.order = { type: "gather", target: t }; u.carry = 0; u.gatherT = 0; }
        else u.order = { type: "amove", x: t.x, y: t.y };
      }
      return { ok: true };
    }
    if (o.type === "build") {
      const t = byId.get(o.target);
      if (!t || t.dead || t.kind !== "bldg" || t.team !== team || !t.constructing) return { ok: false, reason: "no-target" };
      for (const u of list) if (isWorker(u)) u.order = { type: "build", target: t };
      return { ok: true };
    }
    if (o.type === "ground") {
      const x = cx(o.x), y = cy(o.y);
      for (const u of list) u.order = isWorker(u) ? { type: "move", x, y } : { type: "amove", x, y };
      return { ok: true };
    }
    return { ok: false, reason: "bad-order" };
  }
  function cmdRally(team, id, x, y, target) {
    const b = byId.get(id);
    if (!b || b.dead || b.kind !== "bldg" || b.team !== team) return { ok: false, reason: "no-bldg" };
    const res = (target != null) ? byId.get(target) : null;
    b.rally = (res && res.kind === "res" && !res.dead) ? res : { x: cx(x), y: cy(y) };
    return { ok: true };
  }
  const BUILDABLE = ["hut", "barracks", "lodge", "altar"];
  function cmdBuild(team, btype, x, y, ids) {
    if (!BUILDABLE.includes(btype)) return { ok: false, reason: "bad-type" };
    x = num(x, NaN); y = num(y, NaN);
    if (!isFinite(x) || !isFinite(y)) return { ok: false, reason: "bad-pos" };
    const r = cfg.bldgs[btype].radius;
    if (!canAfford(S.teams[team], cfg.costs[btype])) { notify(team, "资源不足"); return { ok: false, reason: "poor" }; }
    if (overlapsBldgList(S.bldgs, x, y, r) || x < r || x > WORLD_W - r || y < r || y > WORLD_H - r) { notify(team, "此处无法放置"); return { ok: false, reason: "blocked" }; }
    spend(S.teams[team], cfg.costs[btype]);
    const b = makeBldg(btype, team, x, y, true);
    S.bldgs.push(b);
    let assigned = 0;
    for (const u of resolveUnits(team, ids)) if (isWorker(u)) { u.order = { type: "build", target: b }; assigned++; }
    if (!assigned) notify(team, "选中的无村民/巫师,可另选后右键此建筑建造");
    return { ok: true };
  }
  const TRAIN_MAP = { campfire: "villager", barracks: "warrior", lodge: "hunter", altar: "shaman" };
  function cmdTrain(team, id, utype) {
    const b = byId.get(id);
    if (!b || b.dead || b.kind !== "bldg" || b.team !== team || b.constructing) return { ok: false, reason: "no-bldg" };
    if (TRAIN_MAP[b.btype] !== utype) return { ok: false, reason: "bad-type" };
    queueTrain(b, utype);
    return { ok: true };
  }
  function cmdStance(team, ids, stance) {
    const st = stance === "hold" ? "hold" : "aggressive";
    let any = false;
    for (const u of resolveUnits(team, ids)) {
      if (u.utype === "warrior" || u.utype === "hunter" || u.utype === "beast") { u.stance = st; any = true; }
    }
    return { ok: any, reason: any ? undefined : "no-units" };
  }
  function cmdSummon(team, beast) {
    if (!Object.prototype.hasOwnProperty.call(BEASTS, beast)) return { ok: false, reason: "bad-type" };
    return { ok: summonBeast(team, beast) };
  }
  function cmdCampReturn(team, ids) {
    const camp = teamCamp(team);
    let any = false;
    for (const u of resolveUnits(team, ids)) {
      if (u.utype === "shaman") { u.order = camp ? { type: "move", x: camp.x + rand(-20, 20), y: camp.y + rand(-20, 20) } : null; any = true; }
    }
    if (any) notify(team, "巫师返回营地");
    return { ok: any };
  }
  function applyCommand(team, cmd) {
    if (!cmd || typeof cmd !== "object") return { ok: false, reason: "bad-cmd" };
    if (!humans.includes(team)) return { ok: false, reason: "not-human" };
    if (S.isOver) return { ok: false, reason: "over" };
    switch (cmd.c) {
      case "order":       return cmdOrder(team, cmd.ids, cmd.order);
      case "rally":       return cmdRally(team, cmd.id, cmd.x, cmd.y, cmd.target);
      case "build":       return cmdBuild(team, cmd.btype, cmd.x, cmd.y, cmd.ids);
      case "train":       return cmdTrain(team, cmd.id, cmd.utype);
      case "stance":      return cmdStance(team, cmd.ids, cmd.stance);
      case "summon":      return cmdSummon(team, cmd.beast);
      case "camp_return": return cmdCampReturn(team, cmd.ids);
    }
    return { ok: false, reason: "unknown" };
  }

  // ---------- 事件 ----------
  function collectEvents() {
    if (!events.length) return [];
    const out = events.splice(0, events.length);
    return out;
  }

  // ---------- 启动 ----------
  initWorld();

  return {
    state: S,
    byId,
    cfg,
    humans, aiTeams, difficulty,
    step,
    applyCommand,
    collectEvents,
    aliveCamps,
    teamPop, teamPopCap,
    // 调试/测试辅助
    debug: { spawnWildBeasts, forceDestroy(team) { const c = teamCamp(team); if (c) killEntity(c, null); } },
  };
}
