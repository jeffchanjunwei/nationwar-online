// ============================================================
// 客户端共享状态(DOM 引用 + 相机/输入/选中/UI 状态)
// ============================================================
import { WORLD_W, WORLD_H } from "/src/shared/cfg.js";

// ---------- DOM ----------
export const dom = {};
for (const id of ["game", "cv", "mini", "topbar", "r-food", "r-wood", "r-stone", "r-pop", "r-age", "r-diff", "r-net",
                  "selinfo", "cmd", "cmd-title", "cmd-grid", "toast", "paused", "overlay", "help", "snd",
                  "menu", "mode-slot", "diff-slot", "start-btn", "lobby", "chat-log", "chat-in", "chat-send"]) {
  dom[id] = document.getElementById(id);
}
export const cv = dom.cv, mini = dom.mini;
export const ctx = cv.getContext("2d");
export const mctx = mini.getContext("2d");

// ---------- 画布尺寸 ----------
export const screen = { W: 0, H: 0, DPR: 1 };

// ---------- 相机 ----------
export const cam = { x: WORLD_W / 2, y: WORLD_H / 2, scale: 1 };

// ---------- 输入 ----------
export const keys = {};
export const mouse = { sx: 0, sy: 0, wx: 0, wy: 0, down: false, dragStart: null, dragging: false };

// ---------- UI 状态 ----------
export const ui = {
  gameState: "menu",   // menu | lobby | play | win | lose
  paused: false,
  mode: "single",      // single | net
  difficulty: "easy",
  buildMode: null,     // 待放置建筑 btype
  selUnits: [],        // 选中单位 id 列表
  selBldg: null,       // 选中建筑 id
  cmdDirty: true,
  toastT: 0,
  viewTime: 0,         // 渲染时钟(单机=sim 时间;联机=插值时间)
};

// ---------- 坐标变换 ----------
export function screenToWorld(sx, sy) {
  return { x: (sx - screen.W / 2) / cam.scale + cam.x, y: (sy - screen.H / 2) / cam.scale + cam.y };
}

// ---------- 提示 ----------
export function toast(msg) { dom.toast.textContent = msg; dom.toast.classList.add("show"); ui.toastT = 1.6; }
