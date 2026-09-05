// ============================================================
// 输入层:鼠标/键盘/小地图、框选(id 空间)、下令解析、建造放置
// 玩家意图在这里解析为「命令对象」,统一交给 host.submit。
// ============================================================
import { CFG, WORLD_W, WORLD_H, clamp, dist2, isWorker, isEnemyOrHostile, canAfford, dist } from "/src/shared/cfg.js";
import { cv, mini, dom, cam, screen, keys, mouse, ui, screenToWorld, toast } from "./state.js";
import { sfx } from "./sfx.js";

let view = null, host = null;

export function initInput(v, h) {
  view = v; host = h;
}

// ---------- 选中(id 空间,自动剔除死亡/失效) ----------
export function selUnitObjs() {
  const out = [];
  for (const id of ui.selUnits) {
    const u = view.byId(id);
    if (u && !u.dead && u.kind === "unit") out.push(u);
  }
  ui.selUnits = out.map(u => u.id);
  return out;
}
export function selBldgObj() {
  if (ui.selBldg == null) return null;
  const b = view.byId(ui.selBldg);
  if (!b || b.dead || b.kind !== "bldg") { ui.selBldg = null; return null; }
  return b;
}
export function clearSel() { ui.selUnits = []; ui.selBldg = null; ui.cmdDirty = true; }

// ---------- 拾取光标下实体 ----------
function pickAt(wx, wy, filter) {
  let best = null, bd = 28 * 28;
  const all = [].concat(view.units, view.bldgs, view.animals, view.resources);
  for (const e of all) {
    if (e.dead || (filter && !filter(e))) continue;
    const rr = (e.radius || 8) + 8;
    const dd = dist2(wx, wy, e.x, e.y);
    if (dd < rr * rr && dd < bd) { bd = dd; best = e; }
  }
  return best;
}

// ---------- 下令:复刻原 issueOrder 决策树,产出命令 ----------
function issueOrder(wx, wy) {
  const my = host.myTeam;
  if (ui.selBldg != null && ui.selUnits.length === 0) {
    host.submit({ c: "rally", id: ui.selBldg, x: wx, y: wy });
    toast("集结点已设定");
    return;
  }
  const sel = selUnitObjs();
  if (!sel.length) return;
  const ids = sel.map(u => u.id);
  const hasMil = sel.some(u => !isWorker(u));
  const enemy = pickAt(wx, wy, (e) => isEnemyOrHostile(e, my));
  if (enemy) {
    host.submit({ c: "order", ids, order: { type: "attack", target: enemy.id } });
    view.ping(wx, wy, "#ff5252");
    sfx.attack();
    return;
  }
  const res = pickAt(wx, wy, (e) => e.kind === "res");
  if (res) {
    host.submit({ c: "order", ids, order: { type: "gather", target: res.id } });
    view.ping(res.x, res.y, "#7bd88f");
    hasMil ? sfx.ackMilitary() : sfx.ackWorker();
    return;
  }
  const fb = pickAt(wx, wy, (e) => e.kind === "bldg" && e.team === my && e.constructing);
  if (fb) {
    host.submit({ c: "order", ids, order: { type: "build", target: fb.id } });
    view.ping(fb.x, fb.y, "#ffd54f");
    sfx.ackWorker();
    return;
  }
  host.submit({ c: "order", ids, order: { type: "ground", x: wx, y: wy } });
  view.ping(wx, wy, "#cfe8ff");
  hasMil ? sfx.ackMilitary() : sfx.ackWorker();
}

// ---------- 放置建筑 ----------
export function startBuild(id) { ui.buildMode = id; dom.game.classList.add("building"); ui.cmdDirty = true; toast("选择放置位置"); }
function overlapsViewBldg(x, y, r) {
  for (const b of view.bldgs) if (dist(x, y, b.x, b.y) < r + b.radius + 8) return true;
  return false;
}
function tryPlace(x, y) {
  const id = ui.buildMode; if (!id) return;
  const r = CFG.bldgs[id].radius;
  // 本地预检(仅 UX;服务器/模拟器会权威重验)
  if (!canAfford(view.myRes(), CFG.costs[id])) { toast("资源不足"); return; }
  if (overlapsViewBldg(x, y, r) || x < r || x > WORLD_W - r || y < r || y > WORLD_H - r) { toast("此处无法放置"); return; }
  const sel = selUnitObjs();
  host.submit({ c: "build", btype: id, x, y, ids: sel.filter(isWorker).map(u => u.id) });
  sfx.buildPlace();
  ui.cmdDirty = true;
  if (!keys["shift"]) { ui.buildMode = null; dom.game.classList.remove("building"); }
}

// ---------- 事件 ----------
function relMouse(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

export function wireInput() {
  cv.addEventListener("contextmenu", e => e.preventDefault());

  cv.addEventListener("mousedown", (e) => {
    if (ui.gameState !== "play" || ui.paused) return;
    const p = relMouse(e);
    mouse.sx = p.x; mouse.sy = p.y;
    const w = screenToWorld(p.x, p.y); mouse.wx = w.x; mouse.wy = w.y;
    if (e.button === 2) { issueOrder(w.x, w.y); return; }
    if (e.button !== 0) return;
    if (ui.buildMode) { tryPlace(w.x, w.y); return; }
    mouse.down = true; mouse.dragging = false; mouse.dragStart = { sx: p.x, sy: p.y };
  });
  window.addEventListener("mousemove", (e) => {
    const p = relMouse(e);
    mouse.sx = p.x; mouse.sy = p.y;
    const w = screenToWorld(p.x, p.y); mouse.wx = w.x; mouse.wy = w.y;
    if (mouse.down && mouse.dragStart) {
      if (Math.abs(p.x - mouse.dragStart.sx) > 5 || Math.abs(p.y - mouse.dragStart.sy) > 5) mouse.dragging = true;
    }
  });
  window.addEventListener("mouseup", (e) => {
    if (e.button !== 0 || !mouse.down) { if (e.button !== 0) mouse.down = false; return; }
    mouse.down = false;
    if (ui.gameState !== "play" || ui.paused) { mouse.dragging = false; mouse.dragStart = null; return; }
    if (mouse.dragging && mouse.dragStart) {
      const a = screenToWorld(mouse.dragStart.sx, mouse.dragStart.sy);
      const b = screenToWorld(mouse.sx, mouse.sy);
      const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
      const inBox = view.units.filter(u => !u.dead && u.team === host.myTeam && u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1);
      const mil = inBox.filter(u => !isWorker(u));   // 框里有军队就只选军队,否则选全部(含村民/巫师)
      ui.selUnits = (mil.length ? mil : inBox).map(u => u.id);
      ui.selBldg = null; ui.cmdDirty = true;
    } else {
      const w = screenToWorld(mouse.sx, mouse.sy);
      // 左键也能下令(为无鼠标/触控板用户):
      //   点中己方单位/建筑 → 切换选中;
      //   已有选中单位时点别处 → 直接下令(攻击/采集/移动,等同右键),并保留选中。
      const fu = pickAt(w.x, w.y, (e2) => e2.kind === "unit" && e2.team === host.myTeam);
      const fb = pickAt(w.x, w.y, (e2) => e2.kind === "bldg" && e2.team === host.myTeam);
      const hasVill = selUnitObjs().some(u => isWorker(u));
      if (fu) { ui.selUnits = [fu.id]; ui.selBldg = null; }
      else if (fb && fb.constructing && hasVill) {   // 选中村民/巫师 + 点"在建"建筑 → 继续建造
        host.submit({ c: "order", ids: ui.selUnits, order: { type: "build", target: fb.id } });
        view.ping(fb.x, fb.y, "#ffd54f"); toast("前往建造");
      }
      else if (fb) { ui.selBldg = fb.id; ui.selUnits = []; }
      else if (ui.selUnits.length) { issueOrder(w.x, w.y); }       // 左键下令
      else if (ui.selBldg != null) { host.submit({ c: "rally", id: ui.selBldg, x: w.x, y: w.y }); toast("集结点已设定"); } // 左键设集结点
      else clearSel();
      ui.cmdDirty = true;
    }
    mouse.dragging = false; mouse.dragStart = null;
  });

  mini.addEventListener("mousedown", (e) => {
    const r = mini.getBoundingClientRect();
    cam.x = (e.clientX - r.left) / mini.width * WORLD_W;
    cam.y = (e.clientY - r.top) / mini.height * WORLD_H;
    clampCam();
  });

  window.addEventListener("keydown", (e) => {
    // 在输入框里打字(昵称/房间码/聊天)时不触发游戏按键
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    const k = e.key.toLowerCase();
    keys[k] = true;
    if (k === "m") { sfx.toggleMute(); if (dom.snd) dom.snd.textContent = sfx.isMuted() ? "🔇" : "🔊"; return; }
    if (e.key === " ") {
      e.preventDefault();
      if (host && host.mode === "local" && ui.gameState === "play") { ui.paused = !ui.paused; dom.paused.style.display = ui.paused ? "block" : "none"; }
      else if (host && host.mode === "net" && ui.gameState === "play" && host.showStatus) host.showStatus();   // 联机空格显示状态
    }
    if (e.key === "Escape") {
      if (ui.buildMode) { ui.buildMode = null; dom.game.classList.remove("building"); ui.cmdDirty = true; }
      else clearSel();
    }
    if (selUnitObjs().some(u => u.utype === "villager")) {
      if (k === "1") startBuild("hut");
      if (k === "2") startBuild("barracks");
      if (k === "3") startBuild("lodge");
      if (k === "4") startBuild("altar");
    }
  });
  window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

  window.addEventListener("wheel", (e) => {
    if (ui.gameState !== "play") return;
    cam.scale = clamp(cam.scale * (e.deltaY > 0 ? 0.9 : 1.1), CFG.cam.minScale, CFG.cam.maxScale);
    clampCam();
  }, { passive: true });
}

// ---------- 相机 ----------
export function clampCam() {
  const halfW = (screen.W / 2) / cam.scale, halfH = (screen.H / 2) / cam.scale;
  if (WORLD_W > halfW * 2) cam.x = clamp(cam.x, halfW, WORLD_W - halfW); else cam.x = WORLD_W / 2;
  if (WORLD_H > halfH * 2) cam.y = clamp(cam.y, halfH, WORLD_H - halfH); else cam.y = WORLD_H / 2;
}
export function updateCamera(dt) {
  let dx = 0, dy = 0;
  if (keys["w"] || keys["arrowup"]) dy -= 1;
  if (keys["s"] || keys["arrowdown"]) dy += 1;
  if (keys["a"] || keys["arrowleft"]) dx -= 1;
  if (keys["d"] || keys["arrowright"]) dx += 1;
  const E = CFG.cam.edge;
  if (mouse.sx > 0 && mouse.sx < E) dx -= 1;
  if (mouse.sx > screen.W - E && mouse.sx < screen.W) dx += 1;
  if (mouse.sy > 0 && mouse.sy < E) dy -= 1;
  if (mouse.sy > screen.H - E && mouse.sy < screen.H) dy += 1;
  if (dx || dy) {
    const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    cam.x += dx * CFG.cam.speed * dt / cam.scale;
    cam.y += dy * CFG.cam.speed * dt / cam.scale;
    clampCam();
  }
}
