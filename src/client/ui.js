// ============================================================
// UI 层:HUD、指挥台面板、遮罩、难度选择
// 面板动作统一产出命令交给 host.submit。
// ============================================================
import { CFG, BEASTS, DIFFICULTY, canAfford, costStr, unitName, bldgName, isWorker } from "/src/shared/cfg.js";
import { dom, ui, toast } from "./state.js";
import { renderMini } from "./render.js";
import { selUnitObjs, selBldgObj, startBuild } from "./input.js";

let view = null, host = null;
export function initUI(v, h) { view = v; host = h; }

// ---------- HUD ----------
export function updateHUD() {
  const r = view.myRes();
  dom["r-food"].textContent = Math.floor(r.food);
  dom["r-wood"].textContent = Math.floor(r.wood);
  dom["r-stone"].textContent = Math.floor(r.stone);
  dom["r-pop"].textContent = view.pop[host.myTeam] + "/" + view.popCap[host.myTeam];
  if (dom["r-diff"]) dom["r-diff"].textContent = ui.mode === "single"
    ? DIFFICULTY[ui.difficulty].label
    : "🌐 联机 · AI " + DIFFICULTY[host.netDifficulty || "normal"].label;
  const sel = selUnitObjs();
  const sb = selBldgObj();
  if (sel.length) {
    dom.selinfo.style.display = "block";
    const types = {};
    for (const u of sel) types[u.utype] = (types[u.utype] || 0) + 1;
    dom.selinfo.innerHTML = Object.keys(types).map(k => unitName(k) + " ×" + types[k]).join("<br>");
  } else if (sb) {
    dom.selinfo.style.display = "block";
    dom.selinfo.innerHTML = bldgName(sb.btype) + "<br><span style='color:#c9a36a'>HP " + Math.ceil(sb.hp) + "/" + sb.maxHp + "</span>";
  } else {
    dom.selinfo.style.display = "none";
  }
  if (ui.cmdDirty) { buildCmdPanel(sel, sb); ui.cmdDirty = false; }
  renderMini(view);
}

// ---------- 指挥台 ----------
function addBtn(label, ic, sub, onClick, enabled) {
  const b = document.createElement("button");
  b.className = "btn"; b.innerHTML = "<span class='ic'>" + ic + "</span>" + label + "<span class='sub'>" + (sub || "") + "</span>";
  b.disabled = !enabled;
  b.onclick = onClick;
  dom["cmd-grid"].appendChild(b);
}
function buildCmdPanel(sel, sb) {
  dom["cmd-grid"].innerHTML = "";
  dom["cmd-title"].textContent = "指挥台";
  if (ui.buildMode) {
    addBtn("取消建造", "✖", "Esc", () => { ui.buildMode = null; dom.game.classList.remove("building"); ui.cmdDirty = true; }, true);
    return;
  }
  const my = host.myTeam;
  if (sb && sb.team === my && sb.constructing) {
    dom["cmd-title"].textContent = bldgName(sb.btype) + " · 建造中";
    addBtn("继续建造", "🔨", "选村民后点此建筑", () => toast("先选中村民,再左键点此在建建筑"), false);
    return;
  }
  if (sb && sb.team === my && !sb.constructing) {
    const map = { campfire: "villager", barracks: "warrior", lodge: "hunter", altar: "shaman" };
    const t = map[sb.btype];
    dom["cmd-title"].textContent = bldgName(sb.btype);
    if (t) {
      const c = CFG.costs[t];
      const ic = t === "villager" ? "🧑" : t === "warrior" ? "⚔️" : t === "hunter" ? "🏹" : "🔮";
      addBtn("训练" + unitName(t), ic, costStr(c),
        () => host.submit({ c: "train", id: sb.id, utype: t }),
        canAfford(view.myRes(), c) && view.pop[my] < view.popCap[my]);
    }
    // 祭坛:已驯服的神兽可在此召唤(圈养培育,消耗食物)
    if (sb.btype === "altar") {
      const owned = Object.keys(view.unlockedBeasts(my));
      if (!owned.length) addBtn("尚未驯服神兽", "🐾", "野外击败神兽即可", () => toast("去野外击败游荡的神兽来驯服"), false);
      else for (const bt of owned) {
        const bb = BEASTS[bt];
        addBtn("召唤" + bb.name, "🐾", bb.food + "🍖", () => host.submit({ c: "summon", beast: bt }),
          canAfford(view.myRes(), { food: bb.food }) && view.countBeasts(my) < CFG.beastMax);
      }
    }
    return;
  }
  const hasVillager = sel.some(u => u.utype === "villager");
  const hasShaman = sel.some(u => u.utype === "shaman");
  const hasMilitary = sel.some(u => u.utype === "warrior" || u.utype === "hunter" || u.utype === "beast");
  if (hasVillager) {
    dom["cmd-title"].textContent = "建造 (需村民)";
    [["hut", "🛖"], ["barracks", "⚔️"], ["lodge", "🏹"], ["altar", "🔮"]].forEach(([id, ic], idx) => {
      const c = CFG.costs[id];
      addBtn(bldgName(id), ic, costStr(c) + " [" + (idx + 1) + "]", () => startBuild(id), canAfford(view.myRes(), c));
    });
  }
  if (hasShaman) {
    dom["cmd-title"].textContent = "巫师";
    addBtn("回营治疗", "✚", "返回营火旁治疗", () => host.submit({ c: "camp_return", ids: sel.map(u => u.id) }), true);
  }
  if (hasMilitary) {
    dom["cmd-title"].textContent = "军队";
    const aggressive = sel.every(u => u.utype === "villager" || u.stance === "aggressive");
    addBtn(aggressive ? "姿态:主动" : "姿态:驻守", aggressive ? "⚡" : "🛡️", "点击切换",
      () => host.submit({ c: "stance", ids: sel.map(u => u.id), stance: aggressive ? "hold" : "aggressive" }), true);
  }
}

// ---------- 难度选择(单机菜单/结算页共用) ----------
export function difficultyMarkup() {
  return '<div style="color:#ffb347;font-size:14px;margin-top:10px;font-weight:700">选择难度</div>'
    + '<div class="diff-row">'
    + '<button class="diff-btn" data-diff="easy">🌱 简单</button>'
    + '<button class="diff-btn" data-diff="normal">⚔️ 正常</button>'
    + '<button class="diff-btn" data-diff="hard">🔥 困难</button>'
    + '</div>'
    + '<div class="diff-desc" style="font-size:13px;color:#c9a36a;margin:0 0 6px;min-height:18px"></div>';
}
export function wireDiff(root, onPick) {
  const btns = root.querySelectorAll(".diff-btn");
  btns.forEach(b => {
    if (b.dataset.diff === ui.difficulty) b.classList.add("active");
    b.onclick = () => {
      ui.difficulty = b.dataset.diff;
      if (onPick) onPick(ui.difficulty);
      btns.forEach(x => x.classList.toggle("active", x === b));
      const el = root.querySelector(".diff-desc");
      if (el) el.textContent = DIFFICULTY[ui.difficulty].desc;
    };
  });
  const desc = root.querySelector(".diff-desc");
  if (desc) desc.textContent = DIFFICULTY[ui.difficulty].desc;
}
