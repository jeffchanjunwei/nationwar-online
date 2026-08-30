// ============================================================
// 渲染层:全部 draw*(从原 nationwar.html 原样迁移)
// 数据源为 WorldView;动画时钟用 ui.viewTime。
// ============================================================
import { CFG, BEASTS, TAU, clamp, canAfford, dist } from "/src/shared/cfg.js";
import { ctx, mctx, mini, cam, screen, mouse, ui, screenToWorld } from "./state.js";

let grassDots = [];
export function genGrass(WORLD_W, WORLD_H) {
  grassDots = [];
  for (let i = 0; i < 1600; i++) {
    grassDots.push({ x: Math.random() * WORLD_W, y: Math.random() * WORLD_H, r: 1 + Math.random() * 1.6, c: Math.random() < 0.5 ? "#466b29" : "#5d8a39" });
  }
}

export function render(view, selUnits, selBldg) {
  const { W, H, DPR } = screen;
  const t = ui.viewTime;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.fillStyle = "#3a2a1a";
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.scale(cam.scale, cam.scale);
  ctx.translate(-cam.x, -cam.y);

  drawGround();
  for (const r of view.resources) drawResource(r);
  for (const a of view.animals) drawAnimal(a);
  for (const b of view.bldgs) drawBldg(b, t);
  for (const u of view.units) drawUnit(u, t);
  for (const p of view.proj) drawProj(p);
  for (const f of view.fx) drawFx(f);

  for (const u of selUnits) if (!u.dead) drawSelRing(u.x, u.y, u.radius + 4, "#cfe8ff");
  if (selBldg && !selBldg.dead) drawSelRect(selBldg);
  if (ui.buildMode) drawGhost(view);

  ctx.restore();

  if (mouse.dragging && mouse.dragStart) {
    const x = Math.min(mouse.dragStart.sx, mouse.sx), y = Math.min(mouse.dragStart.sy, mouse.sy);
    const w = Math.abs(mouse.sx - mouse.dragStart.sx), h = Math.abs(mouse.sy - mouse.dragStart.sy);
    ctx.strokeStyle = "#cfe8ff"; ctx.fillStyle = "rgba(207,232,255,0.12)";
    ctx.lineWidth = 1.5; ctx.fillRect(x, y, w, h); ctx.strokeRect(x, y, w, h);
  }
}
function drawGround() {
  const WORLD_W = CFG.world.w, WORLD_H = CFG.world.h;
  ctx.fillStyle = "#3a2a1a"; ctx.fillRect(-300, -300, WORLD_W + 600, WORLD_H + 600);
  ctx.fillStyle = "#4f7a30"; ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  for (const d of grassDots) { ctx.fillStyle = d.c; ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill(); }
  ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = 6; ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
}
function drawResource(r) {
  const ratio = clamp(r.amount / r.max, 0, 1);
  if (r.rtype === "berry") {
    ctx.fillStyle = "#2e7a2e"; ctx.beginPath(); ctx.arc(r.x, r.y, r.radius, 0, TAU); ctx.fill();
    const n = Math.max(3, Math.round(8 * ratio));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, rr = r.radius * 0.55;
      ctx.fillStyle = "#c0392b"; ctx.beginPath(); ctx.arc(r.x + Math.cos(a) * rr, r.y + Math.sin(a) * rr, 3.2, 0, TAU); ctx.fill();
    }
  } else if (r.rtype === "tree") {
    ctx.fillStyle = "#5a3d22"; ctx.fillRect(r.x - 2.5, r.y, 5, 9);
    ctx.fillStyle = ratio > 0.33 ? "#27632a" : "#3a5a2a";
    ctx.beginPath(); ctx.arc(r.x, r.y - 3, r.radius, 0, TAU); ctx.fill();
  } else {
    ctx.fillStyle = "#8d9aa0";
    ctx.beginPath();
    ctx.arc(r.x - 4, r.y, r.radius * 0.7, 0, TAU);
    ctx.arc(r.x + 5, r.y + 2, r.radius * 0.6, 0, TAU);
    ctx.arc(r.x, r.y - 5, r.radius * 0.5, 0, TAU);
    ctx.fill();
  }
}
function drawAnimal(a) {
  if (a.atype === "deer") drawDeer(a);
  else drawWolf(a);
  hpBarMaybe(a);
}
// 鹿:身体/背/肚、四腿、脖颈头、鹿角、白尾、眼睛(朝行进方向)
function drawDeer(a) {
  const r = a.radius;
  const dir = a.vx !== 0 ? a.vx : Math.cos(a.wand);
  const left = dir < 0;
  ctx.save(); ctx.translate(a.x, a.y); if (left) ctx.scale(-1, 1);
  ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.beginPath(); ctx.ellipse(0, r * 1.0, r * 1.25, r * 0.4, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = "#6b4226"; ctx.lineWidth = r * 0.22; ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-r * 0.8, r * 0.25); ctx.lineTo(-r * 0.85, r * 1.05);
  ctx.moveTo(-r * 0.3, r * 0.3); ctx.lineTo(-r * 0.32, r * 1.05);
  ctx.moveTo(r * 0.3, r * 0.3); ctx.lineTo(r * 0.32, r * 1.05);
  ctx.moveTo(r * 0.8, r * 0.25); ctx.lineTo(r * 0.85, r * 1.05);
  ctx.stroke();
  ctx.fillStyle = "#a9754a"; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.12, r * 0.68, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = "#7c4f29"; ctx.beginPath(); ctx.ellipse(0, -r * 0.22, r * 0.98, r * 0.34, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = "#e0bd91"; ctx.beginPath(); ctx.ellipse(0, r * 0.32, r * 0.78, r * 0.2, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(-r * 1.02, -r * 0.05, r * 0.17, 0, TAU); ctx.fill();
  ctx.fillStyle = "#9a6638";
  ctx.beginPath(); ctx.moveTo(r * 0.85, -r * 0.05); ctx.lineTo(r * 1.35, -r * 0.7); ctx.lineTo(r * 1.62, -r * 0.55); ctx.lineTo(r * 1.0, r * 0.18); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.ellipse(r * 1.55, -r * 0.72, r * 0.4, r * 0.3, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = "#3a2410"; ctx.lineWidth = r * 0.15; ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(r * 1.42, -r * 0.98); ctx.lineTo(r * 1.38, -r * 1.55);
  ctx.moveTo(r * 1.5, -r * 0.98); ctx.lineTo(r * 1.62, -r * 1.5);
  ctx.moveTo(r * 1.46, -r * 1.2); ctx.lineTo(r * 1.28, -r * 1.42);
  ctx.stroke();
  ctx.fillStyle = "#1a1208"; ctx.beginPath(); ctx.arc(r * 1.68, -r * 0.78, r * 0.08, 0, TAU); ctx.fill();
  ctx.restore();
}
// 狼:身体/背、四腿、垂尾、头/吻、立耳、獠牙、凶光眼
function drawWolf(a) {
  const r = a.radius;
  const dir = a.vx !== 0 ? a.vx : Math.cos(a.face || a.wand);
  const left = dir < 0;
  ctx.save(); ctx.translate(a.x, a.y); if (left) ctx.scale(-1, 1);
  ctx.fillStyle = "rgba(0,0,0,0.24)"; ctx.beginPath(); ctx.ellipse(0, r * 0.9, r * 1.2, r * 0.36, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = "#333"; ctx.lineWidth = r * 0.2; ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-r * 0.65, r * 0.25); ctx.lineTo(-r * 0.7, r * 0.85);
  ctx.moveTo(-r * 0.2, r * 0.3); ctx.lineTo(-r * 0.22, r * 0.85);
  ctx.moveTo(r * 0.28, r * 0.3); ctx.lineTo(r * 0.3, r * 0.85);
  ctx.moveTo(r * 0.68, r * 0.25); ctx.lineTo(r * 0.72, r * 0.85);
  ctx.stroke();
  ctx.strokeStyle = "#4a4a4a"; ctx.lineWidth = r * 0.3; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-r * 0.95, -r * 0.05); ctx.quadraticCurveTo(-r * 1.45, -r * 0.45, -r * 1.28, -r * 0.72); ctx.stroke();
  ctx.fillStyle = "#646464"; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.02, r * 0.58, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = "#424242"; ctx.beginPath(); ctx.ellipse(0, -r * 0.22, r * 0.88, r * 0.3, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = "#6e6e6e"; ctx.beginPath(); ctx.ellipse(r * 0.92, -r * 0.22, r * 0.5, r * 0.42, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(r * 1.32, -r * 0.08, r * 0.28, r * 0.2, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = "#3c3c3c";
  ctx.beginPath(); ctx.moveTo(r * 0.72, -r * 0.5); ctx.lineTo(r * 0.66, -r * 0.92); ctx.lineTo(r * 0.92, -r * 0.52); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(r * 1.04, -r * 0.52); ctx.lineTo(r * 1.12, -r * 0.92); ctx.lineTo(r * 1.22, -r * 0.48); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#ffd34d"; ctx.beginPath(); ctx.arc(r * 1.04, -r * 0.26, r * 0.09, 0, TAU); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(r * 1.46, -r * 0.02); ctx.lineTo(r * 1.54, r * 0.12); ctx.lineTo(r * 1.4, r * 0.06); ctx.closePath(); ctx.fill();
  ctx.restore();
}
function drawBldg(b, t) {
  const TEAM_COLOR = ["#e8743b", "#8e5fd6", "#2ea886"];
  const TEAM_COLOR_D = ["#9a3f12", "#5a3a8a", "#1c6b58"];
  const col = TEAM_COLOR[b.team] || "#888", cold = TEAM_COLOR_D[b.team] || "#555";
  ctx.globalAlpha = b.constructing ? 0.6 : 1;
  ctx.fillStyle = cold; ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, TAU); ctx.fill();
  ctx.fillStyle = "#6b4a2a"; ctx.beginPath(); ctx.arc(b.x, b.y, b.radius - 4, 0, TAU); ctx.fill();

  if (b.btype === "campfire") {
    const fl = 1 + Math.sin(t * 12) * 0.18;
    ctx.fillStyle = "#ffb347"; ctx.beginPath();
    ctx.moveTo(b.x, b.y - 16 * fl); ctx.lineTo(b.x - 8, b.y + 6); ctx.lineTo(b.x + 8, b.y + 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ff5722"; ctx.beginPath();
    ctx.moveTo(b.x, b.y - 10 * fl); ctx.lineTo(b.x - 5, b.y + 4); ctx.lineTo(b.x + 5, b.y + 4); ctx.closePath(); ctx.fill();
  } else if (b.btype === "hut") {
    ctx.fillStyle = "#8a5a2a";
    ctx.beginPath(); ctx.moveTo(b.x - 11, b.y + 7); ctx.lineTo(b.x, b.y - 11); ctx.lineTo(b.x + 11, b.y + 7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = cold; ctx.fillRect(b.x - 4, b.y, 8, 7);
  } else if (b.btype === "altar") {
    // 祭坛:层叠石台 + 发光符文圆 + 悬浮晶石
    ctx.fillStyle = "#7a6a5a"; ctx.beginPath(); ctx.moveTo(b.x - 16, b.y + 8); ctx.lineTo(b.x + 16, b.y + 8); ctx.lineTo(b.x + 11, b.y + 2); ctx.lineTo(b.x - 11, b.y + 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#9a8a76"; ctx.fillRect(b.x - 12, b.y - 4, 24, 6);
    const pulse = 0.6 + Math.sin(t * 4) * 0.4;
    ctx.strokeStyle = "rgba(122,90,200," + pulse.toFixed(2) + ")"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(b.x, b.y - 2, 11, 4, 0, 0, TAU); ctx.stroke();
    const fy = b.y - 12 + Math.sin(t * 3) * 2;
    ctx.fillStyle = "rgba(150,110,230,0.35)"; ctx.beginPath(); ctx.arc(b.x, fy, 9, 0, TAU); ctx.fill();
    ctx.fillStyle = "#b388ff"; ctx.beginPath(); ctx.moveTo(b.x, fy - 8); ctx.lineTo(b.x + 5, fy); ctx.lineTo(b.x, fy + 8); ctx.lineTo(b.x - 5, fy); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(b.x - 1, fy - 2, 1.6, 0, TAU); ctx.fill();
  } else {
    ctx.fillStyle = col;
    ctx.fillRect(b.x - 12, b.y - 10, 24, 20);
    ctx.fillStyle = "#fff"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(b.btype === "barracks" ? "⚔" : "🏹", b.x, b.y);
  }
  ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.globalAlpha = b.constructing ? 0.6 : 1;
  ctx.beginPath(); ctx.arc(b.x, b.y, b.radius, 0, TAU); ctx.stroke();
  ctx.globalAlpha = 1;

  if (b.queue && b.queue.length) {
    ctx.fillStyle = "#ffe9c4"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("•".repeat(Math.min(b.queue.length, 5)), b.x, b.y - b.radius - 10);
  }
  if (b.constructing) barAt(b.x, b.y - b.radius - 8, 30, 4, b.prog / (b.need || 1), "#ffd54f");
  else hpBarMaybe(b);
}
// 神兽绘制(5 种外观,驯化带队伍色环,野生带虚线边)
function drawBeast(u, t) {
  const TEAM_COLOR = ["#e8743b", "#8e5fd6", "#2ea886"];
  const d = BEASTS[u.beastType], r = u.radius, base = d.color, wild = u.wild;
  const side = Math.cos(u.face || 0) >= 0 ? 1 : -1;
  ctx.fillStyle = "rgba(0,0,0,0.28)"; ctx.beginPath(); ctx.ellipse(u.x, u.y + r * 0.9, r * 1.25, r * 0.45, 0, 0, TAU); ctx.fill();
  ctx.save(); ctx.translate(u.x, u.y); if (side < 0) ctx.scale(-1, 1);
  if (u.beastType === "bear") drawBearBeast(r, base);
  else if (u.beastType === "phoenix") drawPhoenixBeast(r, base, wild, t);
  else if (u.beastType === "thunder") drawThunderBeast(r, base);
  else if (u.beastType === "rock") drawRockBeast(r, base);
  else drawSerpentBeast(r, base);
  ctx.restore();
  if (!wild) { ctx.strokeStyle = TEAM_COLOR[u.team] || "#888"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(u.x, u.y, r + 2, 0, TAU); ctx.stroke(); }
  else { ctx.strokeStyle = "rgba(200,40,40,0.7)"; ctx.setLineDash([4, 3]); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(u.x, u.y, r + 2, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
  ctx.fillStyle = wild ? "#ffb4b4" : "#ffe9c4"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
  ctx.fillText(d.name, u.x, u.y - r - 9);
}
function drawBearBeast(r, c) {
  ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.0, r * 0.78, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = "#5a3414"; ctx.beginPath(); ctx.ellipse(0, -r * 0.2, r * 0.85, r * 0.3, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = "#4a2a10"; [-0.6, -0.2, 0.3, 0.65].forEach(dx => ctx.fillRect(r * dx, r * 0.4, r * 0.22, r * 0.55));
  ctx.fillStyle = c; ctx.beginPath(); ctx.arc(r * 0.85, -r * 0.35, r * 0.42, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(r * 0.7, -r * 0.7, r * 0.16, 0, TAU); ctx.arc(r * 1.0, -r * 0.7, r * 0.16, 0, TAU); ctx.fill();
  ctx.fillStyle = "#1a1208"; ctx.beginPath(); ctx.arc(r * 1.0, -r * 0.4, r * 0.07, 0, TAU); ctx.fill();
}
function drawPhoenixBeast(r, c, wild, t) {
  ctx.fillStyle = wild ? "#b23b14" : "#ff8a3b"; ctx.beginPath();
  ctx.moveTo(-r * 0.2, -r * 0.1); ctx.lineTo(-r * 1.3, -r * 0.5); ctx.lineTo(-r * 1.0, r * 0.2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(0, 0, r * 0.7, r * 0.6, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(r * 0.6, -r * 0.3, r * 0.34, 0, TAU); ctx.fill();
  ctx.fillStyle = "#ffd54f"; ctx.beginPath(); ctx.moveTo(r * 0.85, -r * 0.3); ctx.lineTo(r * 1.15, -r * 0.2); ctx.lineTo(r * 0.85, -r * 0.12); ctx.closePath(); ctx.fill();
  const fl = 0.8 + Math.sin(t * 10) * 0.2;
  ctx.fillStyle = "#ffb347"; ctx.beginPath(); ctx.moveTo(-r * 0.5, 0); ctx.lineTo(-r * 1.0 * fl, -r * 0.2); ctx.lineTo(-r * 0.9, r * 0.3); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#ff5722"; ctx.beginPath(); ctx.arc(r * 0.6, -r * 0.6, r * 0.12 * fl, 0, TAU); ctx.fill();
  ctx.fillStyle = "#1a1208"; ctx.beginPath(); ctx.arc(r * 0.72, -r * 0.35, r * 0.06, 0, TAU); ctx.fill();
}
function drawThunderBeast(r, c) {
  ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(0, 0, r * 0.95, r * 0.6, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = "#1e88e5"; ctx.beginPath(); ctx.ellipse(0, -r * 0.2, r * 0.8, r * 0.28, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = "#0d47a1"; [-0.55, -0.15, 0.25, 0.6].forEach(dx => ctx.fillRect(r * dx, r * 0.35, r * 0.2, r * 0.55));
  ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(r * 0.85, -r * 0.2, r * 0.42, r * 0.36, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(r * 1.2, -r * 0.05, r * 0.2, r * 0.15, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = "#0d47a1"; ctx.beginPath(); ctx.moveTo(r * 0.7, -r * 0.5); ctx.lineTo(r * 0.65, -r * 0.95); ctx.lineTo(r * 0.95, -r * 0.5); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "#e3f2fd"; ctx.lineWidth = r * 0.14; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-r * 0.3, -r * 0.8); ctx.lineTo(-r * 0.1, -r * 0.4); ctx.lineTo(-r * 0.35, -r * 0.3); ctx.lineTo(-r * 0.15, 0); ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(r * 1.0, -r * 0.2, r * 0.07, 0, TAU); ctx.fill();
}
function drawRockBeast(r, c) {
  ctx.fillStyle = "#4a4a4a"; [-0.5, 0.5].forEach(dx => ctx.fillRect(r * dx, r * 0.4, r * 0.3, r * 0.55));
  ctx.fillStyle = c; ctx.beginPath();
  ctx.moveTo(-r * 1.0, -r * 0.1); ctx.lineTo(-r * 0.7, -r * 0.8); ctx.lineTo(-r * 0.1, -r * 1.0); ctx.lineTo(r * 0.6, -r * 0.75); ctx.lineTo(r * 1.0, -r * 0.1);
  ctx.lineTo(r * 0.7, r * 0.6); ctx.lineTo(-r * 0.7, r * 0.6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#6a7a80"; ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.4, r * 0.18, 0, TAU); ctx.arc(r * 0.4, r * 0.1, r * 0.14, 0, TAU); ctx.fill();
  ctx.fillStyle = "#c0392b"; ctx.beginPath(); ctx.arc(r * 0.6, -r * 0.3, r * 0.1, 0, TAU); ctx.arc(r * 0.42, -r * 0.12, r * 0.08, 0, TAU); ctx.fill();
}
function drawSerpentBeast(r, c) {
  ctx.strokeStyle = c; ctx.lineWidth = r * 0.5; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-r * 0.9, r * 0.5); ctx.quadraticCurveTo(-r * 0.3, -r * 0.5, r * 0.4, r * 0.2); ctx.stroke();
  ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(r * 0.55, -r * 0.05, r * 0.4, r * 0.32, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = "#ffd54f"; ctx.beginPath(); ctx.moveTo(r * 0.85, -r * 0.05); ctx.lineTo(r * 1.15, -r * 0.12); ctx.lineTo(r * 0.85, r * 0.08); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#c0392b"; ctx.beginPath(); ctx.arc(r * 0.6, -r * 0.14, r * 0.08, 0, TAU); ctx.fill();
  ctx.fillStyle = "#9ccc65"; ctx.beginPath(); ctx.arc(-r * 0.4, -r * 0.2, r * 0.12, 0, TAU); ctx.arc(0, r * 0.1, r * 0.1, 0, TAU); ctx.fill();
}
function drawUnit(u, t) {
  const TEAM_COLOR = ["#e8743b", "#8e5fd6", "#2ea886"];
  const TEAM_COLOR_D = ["#9a3f12", "#5a3a8a", "#1c6b58"];
  if (u.utype === "beast") { drawBeast(u, t); hpBarMaybe(u); return; }
  const col = TEAM_COLOR[u.team] || "#888", cold = TEAM_COLOR_D[u.team] || "#555";
  const r = u.radius;
  const side = Math.cos(u.face) >= 0 ? 1 : -1;            // 朝向(武器在哪侧)
  ctx.save(); ctx.translate(u.x, u.y); if (side < 0) ctx.scale(-1, 1);

  drawPersonBody(r, col, cold);
  const hy = -r * 0.62;                                    // 头心 y(局部)

  if (u.utype === "villager") {
    // 棕色小帽 + 麻布披风感
    ctx.fillStyle = "#7a4a22"; ctx.beginPath(); ctx.arc(0, hy, r * 0.45, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = "#5a3414"; ctx.fillRect(-r * 0.46, hy - r * 0.04, r * 0.92, r * 0.1);
    // 手持木杖
    ctx.strokeStyle = "#6b4226"; ctx.lineWidth = r * 0.16; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(r * 0.55, -r * 0.1); ctx.lineTo(r * 0.95, r * 0.7); ctx.stroke();
    ctx.fillStyle = "#8a5a2a"; ctx.beginPath(); ctx.arc(r * 0.95, r * 0.7, r * 0.16, 0, TAU); ctx.fill();
  } else if (u.utype === "warrior") {
    // 金属头盔 + 队色顶羽
    ctx.fillStyle = "#b9c0c6"; ctx.beginPath(); ctx.arc(0, hy, r * 0.5, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = "#8a929a"; ctx.fillRect(-r * 0.5, hy - r * 0.04, r, r * 0.12);
    ctx.fillStyle = col; ctx.fillRect(-r * 0.07, hy - r * 0.62, r * 0.14, r * 0.34);
    // 肩甲
    ctx.fillStyle = "rgba(255,255,255,0.16)"; ctx.beginPath(); ctx.arc(-r * 0.6, -r * 0.28, r * 0.26, 0, TAU); ctx.fill();
    // 石锤武器
    ctx.strokeStyle = "#5a3d1a"; ctx.lineWidth = r * 0.18; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(r * 0.55, -r * 0.15); ctx.lineTo(r * 1.0, r * 0.55); ctx.stroke();
    ctx.fillStyle = "#9aa0a6"; ctx.beginPath(); ctx.ellipse(r * 1.02, r * 0.5, r * 0.24, r * 0.3, 0.6, 0, TAU); ctx.fill();
    // 小圆盾(另一侧)
    ctx.fillStyle = cold; ctx.beginPath(); ctx.arc(-r * 0.75, -r * 0.05, r * 0.28, 0, TAU); ctx.fill();
    ctx.strokeStyle = "#2a1a0e"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(-r * 0.75, -r * 0.05, r * 0.16, 0, TAU); ctx.stroke();
  } else if (u.utype === "hunter") { // hunter
    // 兜帽(队色)
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, hy, r * 0.52, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = cold; ctx.beginPath(); ctx.moveTo(-r * 0.5, hy - r * 0.02); ctx.lineTo(-r * 0.8, r * 0.2); ctx.lineTo(-r * 0.42, hy + r * 0.1); ctx.closePath(); ctx.fill();
    // 弓
    const bx = r * 0.85, by = -r * 0.05, br = r * 0.8;
    ctx.strokeStyle = "#4a3014"; ctx.lineWidth = r * 0.16; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(bx, by, br, -1.0, 1.0, false); ctx.stroke();
    ctx.strokeStyle = "rgba(240,230,200,0.85)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bx + Math.cos(-1.0) * br, by + Math.sin(-1.0) * br); ctx.lineTo(bx + Math.cos(1.0) * br, by + Math.sin(1.0) * br); ctx.stroke();
  } else if (u.utype === "shaman") { // 巫师:神秘斗篷 + 兜帽 + 法杖晶石
    ctx.fillStyle = "#5e3a9c"; ctx.beginPath();
    ctx.moveTo(-r * 0.82, -r * 0.28); ctx.lineTo(r * 0.82, -r * 0.28);
    ctx.lineTo(r * 0.6, r * 0.62); ctx.lineTo(-r * 0.6, r * 0.62); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#3a2466"; ctx.fillRect(-r * 0.62, r * 0.18, r * 1.24, r * 0.12);
    ctx.fillStyle = col; ctx.fillRect(-r * 0.1, -r * 0.24, r * 0.2, r * 0.5);   // 队色中缝
    ctx.fillStyle = "#3a2466"; ctx.beginPath(); ctx.arc(0, hy, r * 0.54, Math.PI, TAU); ctx.fill();   // 兜帽
    // 法杖
    ctx.strokeStyle = "#6b4226"; ctx.lineWidth = r * 0.16; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(r * 0.5, -r * 0.1); ctx.lineTo(r * 0.9, -r * 0.95); ctx.stroke();
    const pulse = 0.55 + Math.sin(t * 6) * 0.45;
    ctx.fillStyle = "rgba(150,110,230," + pulse.toFixed(2) + ")"; ctx.beginPath(); ctx.arc(r * 0.9, -r * 0.98, r * 0.34, 0, TAU); ctx.fill();
    ctx.fillStyle = "#c9a3ff"; ctx.beginPath(); ctx.arc(r * 0.9, -r * 0.98, r * 0.16, 0, TAU); ctx.fill();
  }

  // 头(皮肤)——盖在帽子/头盔下沿之上
  ctx.fillStyle = "#e8b98e"; ctx.beginPath(); ctx.arc(0, hy, r * 0.4, 0, TAU); ctx.fill();
  ctx.strokeStyle = "rgba(80,40,15,0.4)"; ctx.lineWidth = 1; ctx.stroke();
  // 朝向侧的小眼睛
  ctx.fillStyle = "#2a1a0e"; ctx.beginPath(); ctx.arc(r * 0.14, hy, r * 0.07, 0, TAU); ctx.fill();

  // 背包(采集物)
  if (u.carry > 0) {
    const cc = u.carryType === "food" ? "#d24b3e" : u.carryType === "wood" ? "#9a6a32" : "#9aa0a6";
    ctx.fillStyle = cc; ctx.beginPath(); ctx.arc(r * 0.5, -r * 0.5, r * 0.26, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.beginPath(); ctx.arc(r * 0.44, -r * 0.56, r * 0.09, 0, TAU); ctx.fill();
  }
  ctx.restore();
  hpBarMaybe(u);
}
// 人形身体:影子、腿、外衣、腰带、高光
function drawPersonBody(r, col, cold) {
  ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.beginPath(); ctx.ellipse(0, r * 0.95, r * 1.05, r * 0.4, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = "#3b2a18"; ctx.fillRect(-r * 0.46, r * 0.22, r * 0.32, r * 0.68); ctx.fillRect(r * 0.14, r * 0.22, r * 0.32, r * 0.68);
  ctx.fillStyle = "#241709"; ctx.fillRect(-r * 0.5, r * 0.82, r * 0.42, r * 0.18); ctx.fillRect(r * 0.08, r * 0.82, r * 0.42, r * 0.18);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(-r * 0.78, -r * 0.3);
  ctx.quadraticCurveTo(-r * 0.96, r * 0.12, -r * 0.6, r * 0.5);
  ctx.lineTo(r * 0.6, r * 0.5);
  ctx.quadraticCurveTo(r * 0.96, r * 0.12, r * 0.78, -r * 0.3);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = cold; ctx.lineWidth = Math.max(1, r * 0.16); ctx.stroke();
  ctx.fillStyle = "#2a1a0e"; ctx.fillRect(-r * 0.62, r * 0.22, r * 1.24, r * 0.16);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath(); ctx.moveTo(-r * 0.22, -r * 0.26); ctx.lineTo(r * 0.1, -r * 0.26); ctx.lineTo(0, r * 0.2); ctx.closePath(); ctx.fill();
}
function drawProj(p) {
  const k = p.t / p.dur;
  const x = p.x + (p.tx - p.x) * k, y = p.y + (p.ty - p.y) * k;
  ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.beginPath();
  ctx.moveTo(x - (p.tx - p.x) * 0.02, y - (p.ty - p.y) * 0.02); ctx.lineTo(x, y); ctx.stroke();
}
function drawFx(f) {
  const k = f.t / f.life;
  if (f.ring) {
    ctx.globalAlpha = 1 - k; ctx.strokeStyle = f.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(f.x, f.y, 4 + k * 16, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1; return;
  }
  ctx.globalAlpha = 1 - k; ctx.fillStyle = f.color;
  ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center";
  ctx.fillText(f.text || "", f.x, f.y); ctx.globalAlpha = 1;
}
function hpBarMaybe(e) {
  if (e.hp === undefined || e.hp >= e.maxHp || e.hp <= 0) return;
  barAt(e.x, e.y - e.radius - 6, e.radius * 2.2, 3.5, e.hp / e.maxHp, hpColor(e.hp / e.maxHp));
}
function barAt(x, y, w, h, ratio, color) {
  ratio = clamp(ratio, 0, 1);
  ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = "#444"; ctx.fillRect(x - w / 2, y, w, h);
  ctx.fillStyle = color; ctx.fillRect(x - w / 2, y, w * ratio, h);
}
function hpColor(r) { return r > 0.5 ? "#7bd88f" : r > 0.25 ? "#ffd54f" : "#e85a3b"; }
function drawSelRing(x, y, r, col) {
  ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
}
function drawSelRect(b) {
  ctx.strokeStyle = "#cfe8ff"; ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(b.x, b.y, b.radius + 4, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
  if (b.rally) {
    ctx.strokeStyle = "rgba(207,232,255,0.6)"; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.rally.x, b.rally.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#cfe8ff"; ctx.beginPath(); ctx.arc(b.rally.x, b.rally.y, 4, 0, TAU); ctx.fill();
  }
}
function drawGhost(view) {
  const w = screenToWorld(mouse.sx, mouse.sy);
  const r = CFG.bldgs[ui.buildMode].radius;
  const ok = canAfford(view.myRes(), CFG.costs[ui.buildMode]) && !overlapsBldgOf(view, w.x, w.y, r)
             && w.x > r && w.x < CFG.world.w - r && w.y > r && w.y < CFG.world.h - r;
  ctx.globalAlpha = 0.5; ctx.fillStyle = ok ? "#7bd88f" : "#e85a3b";
  ctx.beginPath(); ctx.arc(w.x, w.y, r, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1; ctx.strokeStyle = ok ? "#cfe8ff" : "#fff"; ctx.lineWidth = 2; ctx.stroke();
}
function overlapsBldgOf(view, x, y, r) {
  for (const b of view.bldgs) if (dist(x, y, b.x, b.y) < r + b.radius + 8) return true;
  return false;
}

// ---------- 小地图 ----------
export function renderMini(view) {
  const mw = mini.width, mh = mini.height;
  const { W, H } = screen;
  const TEAM_COLOR = ["#e8743b", "#8e5fd6", "#2ea886"];
  const sx = mw / CFG.world.w, sy = mh / CFG.world.h;
  mctx.fillStyle = "#2a3a1c"; mctx.fillRect(0, 0, mw, mh);
  for (const r of view.resources) if (!r.dead) { mctx.fillStyle = r.rtype === "berry" ? "#7a2a2a" : r.rtype === "tree" ? "#1e3a1a" : "#555"; mctx.fillRect(r.x * sx - 1, r.y * sy - 1, 2, 2); }
  for (const b of view.bldgs) if (!b.dead) { mctx.fillStyle = TEAM_COLOR[b.team] || "#888"; mctx.fillRect(b.x * sx - 2, b.y * sy - 2, 4, 4); }
  for (const u of view.units) if (!u.dead) {
    if (u.utype === "beast") { mctx.fillStyle = u.wild ? "#ff3030" : (TEAM_COLOR[u.team] || "#888"); mctx.fillRect(u.x * sx - 2, u.y * sy - 2, 4, 4); }
    else { mctx.fillStyle = TEAM_COLOR[u.team] || "#888"; mctx.fillRect(u.x * sx - 1, u.y * sy - 1, 2, 2); }
  }
  mctx.strokeStyle = "#ffe9c4"; mctx.lineWidth = 1;
  const vx = (cam.x - W / 2 / cam.scale) * sx, vy = (cam.y - H / 2 / cam.scale) * sy;
  const vw = (W / cam.scale) * sx, vh = (H / cam.scale) * sy;
  mctx.strokeRect(vx, vy, vw, vh);
}
