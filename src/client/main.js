// ============================================================
// 总装配:主菜单 → 单机/联机;主循环;胜负处理
// ============================================================
import { CFG, DIFFICULTY, WORLD_W, WORLD_H } from "/src/shared/cfg.js";
import { dom, screen, ui, cam, toast } from "./state.js";
import { WorldView } from "./view.js";
import { render, genGrass } from "./render.js";
import { wireInput, initInput, selUnitObjs, selBldgObj, updateCamera, clampCam } from "./input.js";
import { initUI, updateHUD, difficultyMarkup, wireDiff } from "./ui.js";
import { createLocalHost } from "./hostLocal.js";
import { sfx } from "./sfx.js";

let host = null, view = null;
let last = performance.now();

// ---------- 尺寸 ----------
function resize() {
  screen.DPR = Math.min(window.devicePixelRatio || 1, 2);
  screen.W = window.innerWidth; screen.H = window.innerHeight;
  dom.cv.width = screen.W * screen.DPR; dom.cv.height = screen.H * screen.DPR;
  dom.cv.style.width = screen.W + "px"; dom.cv.style.height = screen.H + "px";
  clampCam();
}
window.addEventListener("resize", resize);

// ---------- 菜单 ----------
function showMenu() {
  ui.gameState = "menu";
  dom.overlay.classList.remove("hide");
  dom.overlay.innerHTML = menuMarkup();
  const slot = dom.overlay.querySelector("#diff-slot");
  if (slot) { slot.innerHTML = difficultyMarkup(); wireDiff(dom.overlay, null); }
  // 模式按钮
  const btns = dom.overlay.querySelectorAll(".mode-btn");
  const pick = (m) => {
    ui.mode = m;
    btns.forEach(x => x.classList.toggle("active", x.dataset.mode === m));
    dom.overlay.querySelector("#diff-slot").style.display = m === "single" ? "block" : "none";
    dom.overlay.querySelector("#start-btn").textContent = m === "single" ? "开始争霸" : "进入联机大厅";
  };
  btns.forEach(b => b.onclick = () => pick(b.dataset.mode));
  pick(ui.mode);
  dom.overlay.querySelector("#start-btn").onclick = () => {
    if (ui.mode === "single") startSingle();
    else openLobby();
  };
}
function menuMarkup() {
  return `
    <h1>🔥 部落纪元</h1>
    <h2>上古争霸 · 双人对战版</h2>
    <p>蛮荒大地之上,三部争霸,神兽横行。采集、繁衍、铸兵、降兽,焚毁所有敌方营火者,统御天下。<br>与好友各据一方,加一部 AI 混战;亦可单机挑战双 AI。</p>
    <div class="how">
      <div>🍖 选村民 → 右键 <b>浆果/树/石</b> 采集资源</div>
      <div>🛖 选村民 → 右下 <b>建筑按钮</b> → 选地放置(村民自动搭建)</div>
      <div>⚔️ 兵营造战士、猎屋造猎人 → 框选军队 → 右键 <b>进攻敌方</b></div>
      <div>🔮 祭坛造<b>巫师</b>(营火旁治疗伤兵);<b>野外击败神兽</b>可驯服,祭坛花食物召唤更多</div>
      <div>🖱️ <b>左键拖拽</b>框选 · <b>WASD</b>移视口 · <b>空格</b>暂停(单机) · 小地图红点=野生神兽</div>
      <div>🏆 摧毁<b>全部</b>敌方营火获胜;己方营火被毁则失败</div>
    </div>
    <div class="mode-row">
      <button class="mode-btn" data-mode="single">🎮 单机 · 打双 AI</button>
      <button class="mode-btn" data-mode="net">🌐 网上对战 · 1v1+AI</button>
    </div>
    <div id="diff-slot"></div>
    <button id="start-btn">开始争霸</button>`;
}

// ---------- 单机开局 ----------
function startSingle() {
  host = createLocalHost(ui.difficulty);
  view = new WorldView(0);
  view.attachLocal(host.sim);
  beginPlay();
}
function beginPlay() {
  initInput(view, host);
  initUI(view, host);
  ui.gameState = "play";
  ui.paused = false;
  ui.spectating = false;
  ui.selUnits = []; ui.selBldg = null; ui.buildMode = null;
  ui.cmdDirty = true;
  camPending = true;                       // 联机时实体随首包快照到达,相机延迟对准
  dom.game.classList.remove("building");
  dom.paused.style.display = "none";
  dom.overlay.classList.add("hide");
  dom.lobby.style.display = "none";
  dom["r-net"].style.display = host.mode === "net" ? "flex" : "none";   // 顶栏联机状态格
  // 相机对准己方营火(单机立即可用;联机等首包快照)
  centerOnCamp();
  cam.scale = 1; clampCam();
  setTimeout(() => toast("提示:选中单位后,左键点浆果/树/敌人即可下令,无需右键"), 400);
}
let camPending = false;
function centerOnCamp() {
  const camp = view.bldgs.find(b => b.team === host.myTeam && b.btype === "campfire" && !b.dead);
  if (camp) { cam.x = camp.x; cam.y = camp.y; camPending = false; }
}

// ---------- 联机流程(委托 hostNet) ----------
function openLobby() {
  ui.gameState = "lobby";
  dom.overlay.classList.add("hide");
  setupNetHost();
}
// hostNet 通过回调驱动这些入口
function netStart(info) {
  host = currentNetHost;
  view = new WorldView(info.yourTeam);
  view.mode = "net";
  currentNetHost.attachView(view);
  beginPlay();
}
function netStop() { host = null; view = null; showMenu(); }

// ---------- 胜负/事件 ----------
function handleUiEvents() {
  for (const e of view.takeUiEvents()) {
    if (e.e === "toast") { toast(e.msg); ui.cmdDirty = true; sfx.forMsg(e.msg); }
    else if (e.e === "defeat" && e.team === host.myTeam) {
      if (host.mode === "local") endGame(false, "你的营火被焚毁,部落消散于荒野。");
      else showEndOverlay(false, "你的营火被焚毁。可继续观战。", true);
    }
    else if (e.e === "ended") {
      if (ui.gameState !== "play") continue;               // 已定的个人胜负优先(与原版判定顺序一致)
      if (e.winner === -1) endGame(false, "同归于尽,平局。");
      else {
        const win = e.winner === host.myTeam;
        const name = (host.winnerNameOf && host.winnerNameOf(e.winner)) || "";
        const loseMsg = name ? name + " 焚尽了其余营火,天下归一。" : "你的营火被焚毁,部落消散于荒野。";
        endGame(win, win ? "敌方营火已熄灭,大地尽归你手。" : loseMsg);
      }
    }
  }
}
function endGame(win, msg) {
  ui.gameState = win ? "win" : "lose";
  ui.paused = false; dom.paused.style.display = "none";
  if (win) sfx.victory(); else sfx.defeat();
  showEndOverlay(win, msg, false);
}
function showEndOverlay(win, msg, spectate) {
  dom.overlay.classList.remove("hide");
  const time = Math.floor(view.time);
  const isNet = host && host.mode === "net";
  dom.overlay.innerHTML =
    "<h1>🔥 部落纪元</h1>" +
    "<h2 class='" + (win ? "win" : "lose") + "'>" + (win ? "🏆 胜利!天下归一" : "💀 部落覆灭") + "</h2>" +
    "<p>" + msg + "</p>" +
    "<p>坚持时间 " + Math.floor(time / 60) + " 分 " + (time % 60) + " 秒</p>" +
    (ui.mode === "single" ? difficultyMarkup() : "") +
    "<div class='row-btns'>" +
    (spectate ? "<button id='spec-btn'>👁 继续观战</button>" : "") +
    (isNet && !spectate
      ? (isNetHost() ? "<button id='again-btn'>🔁 再来一局</button>" : "<p class='wait'>等待房主开始下一局…</p>")
      : "<button id='again-btn'>🔁 再来一局</button>") +
    "<button id='menu-btn'>🏠 返回菜单</button>" +
    "</div>";
  if (spectate) dom.overlay.querySelector("#spec-btn").onclick = () => { ui.spectating = true; dom.overlay.classList.add("hide"); };
  const again = dom.overlay.querySelector("#again-btn");
  if (again) again.onclick = () => {
    if (ui.mode === "single") startSingle();
    else if (currentNetHost) currentNetHost.restart();   // 等 start 消息再进局(房间缺人时无响应,可返回菜单)
  };
  dom.overlay.querySelector("#menu-btn").onclick = () => {
    teardownNet();
    showMenu();
  };
  if (ui.mode === "single") wireDiff(dom.overlay, null);
}
function isNetHost() { return currentNetHost && currentNetHost.isHost; }

// ---------- 主循环 ----------
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.1) dt = 0.1;
  if (ui.gameState === "play" && view && host) {
    if (host.mode === "local") {
      if (!ui.paused) {
        const evs = host.update(dt, true);
        view.pushEvents(evs);
      }
      updateCamera(dt);
    } else {
      host.flush && host.flush();
      if (!ui.spectating) updateCamera(dt);
    }
    view.frame(dt);
    ui.viewTime = view.time;
    if (camPending) centerOnCamp();
    handleUiEvents();
    if (host.mode === "net" && dom["r-net"]) dom["r-net"].textContent = host.netStatus();
    // 闲聊人声:平均每 ~30 秒随机冒一句(魔兽村民味)
    if (Math.random() < dt / 30) sfx.chatter();
    render(view, selUnitObjs(), selBldgObj());
    updateHUD();
  } else if (view) {
    // 菜单/结算页背后保持轻量渲染
    view.frame(dt);
  }
  if (ui.toastT > 0) { ui.toastT -= dt; if (ui.toastT <= 0) dom.toast.classList.remove("show"); }
}

// ---------- hostNet 装配(联机) ----------
let currentNetHost = null;
const AUTOTEST = new URLSearchParams(location.search).get("autotest");
// 统一拆除:发 leave → 销毁连接(杀僵尸定时器)→ 清状态
function teardownNet() {
  if (currentNetHost) { currentNetHost.leave(); currentNetHost.destroy(); currentNetHost = null; }
  host = null; view = null;
}
function setupNetHost() {
  if (currentNetHost) { currentNetHost.destroy(); currentNetHost = null; }
  import("./hostNet.js").then(({ createNetHostFlow }) => {
    currentNetHost = createNetHostFlow({
      dom, ui, toast,
      onStart: netStart,
      onStop: netStop,
      onBackToMenu: () => { teardownNet(); showMenu(); },
    });
    currentNetHost.openLobby();
    // 自动化测试钩子:?autotest=join&room=XXXX 自动加入并准备
    if (AUTOTEST === "join") {
      currentNetHost.autoJoinForTest(new URLSearchParams(location.search).get("room") || "TEST");
    }
  });
}

// ---------- 启动 ----------
genGrass(WORLD_W, WORLD_H);
resize();
wireInput();
showMenu();
// 音效:首次交互解锁 AudioContext;右上角按钮/M 键静音(见 input.js)
window.addEventListener("pointerdown", () => sfx.unlock(), { once: true });
if (dom.snd) {
  dom.snd.textContent = sfx.isMuted() ? "🔇" : "🔊";
  dom.snd.onclick = () => { sfx.toggleMute(); dom.snd.textContent = sfx.isMuted() ? "🔇" : "🔊"; };
}
// 自动化测试入口:?autotest=single 直接单机开局;?autotest=join&room=XXXX 自动联机(无头浏览器验证用)
if (AUTOTEST === "single") {
  ui.difficulty = "normal";
  startSingle();
} else if (AUTOTEST === "join") {
  openLobby();
}
requestAnimationFrame(frame);

// 调试/自动化测试句柄(浏览器 Console 与 E2E 测试用)
window.addEventListener("error", e => { (window.__nwErrors ||= []).push(String(e.message)); });
window.addEventListener("unhandledrejection", e => { (window.__nwErrors ||= []).push("rejection: " + String(e.reason)); });
window.__nw = { get ui() { return ui; }, get view() { return view; }, get host() { return host; } };
if (AUTOTEST) {
  window.__nwDebug = { snaps: 0 };
  let n = 0;
  // 每 2 秒把客户端状态上报给服务器(无头浏览器 E2E 用,真实时间)
  const rep = setInterval(() => {
    fetch("/__report", { method: "POST", body: JSON.stringify({
      at: n, state: ui.gameState, mode: host ? host.mode : "-",
      units: view ? view.units.length : -1, bldgs: view ? view.bldgs.length : -1,
      res: view ? view.myRes() : null, time: view ? Math.round(view.time * 10) / 10 : -1,
      snaps: window.__nwDebug.snaps || 0, orphan: window.__nwDebug.orphanSnaps || 0,
      conn: host && host.debugConn ? host.debugConn() : "-",
      errors: window.__nwErrors || [],
    }) }).catch(() => {});
    if (++n >= 10) clearInterval(rep);
  }, 2000);
  const iv = setInterval(() => {
    console.log("[nwdbg] state=" + ui.gameState + " units=" + (view ? view.units.length : -1) +
      " bldgs=" + (view ? view.bldgs.length : -1) +
      " res=" + (view ? JSON.stringify(view.myRes()) : "-") +
      " snaps=" + (window.__nwDebug.snaps || 0) + " orphan=" + (window.__nwDebug.orphanSnaps || 0) +
      " conn=" + (currentNetHost && currentNetHost.debugConn ? currentNetHost.debugConn() : (host && host.mode === "local" ? "local" : "-")) +
      " errors=" + JSON.stringify(window.__nwErrors || []));
    if (++n > 14) clearInterval(iv);
  }, 1000);
}
