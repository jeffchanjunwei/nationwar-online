// ============================================================
// 程序化音效:Web Audio 合成,模仿魔兽人族风味的「咕哝人声」
//  - 人声:锯齿/方波基频 + 三个并联共振峰带通 + 颤音 + 滑音,
//    多音节连成一句(Animalese 手法),村民清亮 / 军兵低哑
//  - 敲击:滤波噪声脉冲;金属:失谐方波 + 高通噪声
//  - 零外部素材;M 键或右上角按钮静音(localStorage 记忆)
// ============================================================

let ctx = null, master = null;
let muted = localStorage.getItem("nw_muted") === "1";
const lastPlay = {};   // 节流表

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.42;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") { try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch {} }
  return ctx;
}
function throttle(key, gapMs) {
  const now = performance.now();
  if (lastPlay[key] && now - lastPlay[key] < gapMs) return false;
  lastPlay[key] = now;
  return true;
}

// ---------- 基元 ----------
// 一个「音节」:基频滑音 + 共振峰
function syllable(t0, dur, f0, f1, { harsh = false, vol = 0.5 } = {}) {
  const c = ctx;
  const osc = c.createOscillator();
  osc.type = harsh ? "square" : "sawtooth";
  osc.frequency.setValueAtTime(Math.max(55, f0), t0);
  osc.frequency.linearRampToValueAtTime(Math.max(55, f1), t0 + dur);
  const lfo = c.createOscillator(); lfo.frequency.value = 5.5 + Math.random() * 2.5;   // 颤音
  const lfoG = c.createGain(); lfoG.gain.value = f0 * 0.025;
  lfo.connect(lfoG); lfoG.connect(osc.frequency);
  const fm = harsh ? [500, 1350, 2350] : [640, 1700, 2550];
  const amps = [1, 0.5, 0.28];
  const mix = c.createGain(); mix.gain.value = 1;
  fm.forEach((f, i) => {
    const bp = c.createBiquadFilter(); bp.type = "bandpass";
    bp.frequency.value = f * (0.95 + Math.random() * 0.1); bp.Q.value = 7 + i * 4;
    const g = c.createGain(); g.gain.value = amps[i];
    osc.connect(bp); bp.connect(g); g.connect(mix);
  });
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(vol, t0 + 0.018);
  env.gain.setValueAtTime(vol * 0.85, t0 + dur * 0.55);
  env.gain.linearRampToValueAtTime(0.001, t0 + dur);
  mix.connect(env); env.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.03);
  lfo.start(t0); lfo.stop(t0 + dur + 0.03);
}
// 一句「话」:syls = [[音高倍率, 时长秒, 滑音], ...]
function speak(syls, base, opts = {}) {
  const c = ac(); if (!c || muted) return;
  let t = c.currentTime + 0.02;
  for (const [mult, dur, gl] of syls) {
    syllable(t, dur, base * mult, base * mult * (gl || 1.07), opts);
    t += dur + 0.016;
  }
}
// 噪声脉冲(敲击/箭/环境)
function noiseBurst(t0, dur, freq, q, vol, type = "bandpass") {
  const c = ctx;
  const n = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t0);
}
// 简单纯音(号角/旋律)
function tone(t0, dur, f0, f1, vol, type = "triangle") {
  const c = ctx;
  const o = c.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.linearRampToValueAtTime(f1, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.012);
  g.gain.linearRampToValueAtTime(0.001, t0 + dur);
  o.connect(g); g.connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

// ---------- 场景音效(魔兽人族味) ----------
const rnd = (a, b) => a + Math.random() * (b - a);

export const sfx = {
  unlock() { ac(); },

  // 村民应答:"More work?"(清亮,三音节起伏)
  ackWorker() {
    if (!throttle("ack", 1300)) return;
    speak([[1, 0.09], [1.18, 0.07], [0.9, 0.11, 0.97]], rnd(185, 215));
  },
  // 军队应答:"Yes, mi'lord?"(低哑,两音节)
  ackMilitary() {
    if (!throttle("ack", 1300)) return;
    speak([[0.95, 0.08], [1.22, 0.1, 1.02]], rnd(125, 150), { harsh: true });
  },
  // 下达攻击令:"To arms!"(吼叫下滑)+ 拔武器金属声
  attack() {
    if (!throttle("atk", 900)) return;
    const c = ac(); if (!c || muted) return;
    speak([[1.28, 0.07], [1.02, 0.09], [0.78, 0.13, 0.93]], rnd(140, 165), { harsh: true, vol: 0.58 });
    const t = c.currentTime + 0.16;
    noiseBurst(t, 0.09, 3200, 2, 0.2, "highpass");
    tone(t, 0.12, 2300, 1700, 0.1, "square");
    tone(t, 0.12, 3100, 2400, 0.07, "square");
  },
  // 放置建筑:三下敲击
  buildPlace() {
    if (!throttle("bp", 800)) return;
    const c = ac(); if (!c || muted) return;
    const t = c.currentTime + 0.02;
    for (let i = 0; i < 3; i++) {
      noiseBurst(t + i * 0.14, 0.06, 1700, 3, 0.3);
      tone(t + i * 0.14, 0.07, 175, 120, 0.22);
    }
  },
  // 建筑完成:"Job's done!"(愉快上扬)
  buildDone() {
    if (!throttle("bd", 1500)) return;
    speak([[0.9, 0.08], [1.12, 0.08], [1.38, 0.14, 1.02]], rnd(200, 235));
    const c = ctx;
    const t = c.currentTime + 0.1;
    tone(t, 0.1, 660, 660, 0.12); tone(t + 0.1, 0.16, 880, 880, 0.12);
  },
  // 报错(资源不足等):低沉两声"唔"
  error() {
    if (!throttle("err", 1200)) return;
    speak([[0.8, 0.1], [0.72, 0.13, 0.96]], 108, { harsh: true, vol: 0.42 });
  },
  // 单位训练完成:"Ready to work!"
  ready() {
    if (!throttle("rdy", 1500)) return;
    speak([[1, 0.08], [1.28, 0.1, 1.03]], rnd(190, 220));
  },
  // 驯服神兽:"By the Light!"(惊喜高音)
  capture() {
    const c = ac(); if (!c || muted) return;
    speak([[1.18, 0.06], [1.5, 0.07], [1.1, 0.12, 0.98]], rnd(225, 255));
    const t = c.currentTime + 0.1;
    tone(t, 0.22, 900, 1600, 0.1);
  },
  // 召唤神兽:神秘上行滑音 + 火花
  summon() {
    const c = ac(); if (!c || muted) return;
    const t = c.currentTime + 0.02;
    tone(t, 0.4, 220, 640, 0.14, "sine");
    tone(t + 0.08, 0.35, 330, 880, 0.09, "triangle");
    noiseBurst(t + 0.3, 0.15, 4200, 2, 0.12, "highpass");
  },
  // 随机闲聊(游戏中偶发):几句不同的村民咕哝
  chatter() {
    if (!throttle("cht", 8000)) return;
    const c = ac(); if (!c || muted) return;
    const lines = [
      [[1, 0.08], [1.1, 0.06], [0.95, 0.08], [1.05, 0.1]],
      [[0.9, 0.1], [1.25, 0.12, 1.03]],
      [[1.05, 0.06], [1.05, 0.06], [0.85, 0.12, 0.95]],
      [[1, 0.07], [1.3, 0.08], [1.15, 0.09], [0.9, 0.11]],
    ];
    speak(lines[Math.floor(Math.random() * lines.length)], rnd(150, 235), Math.random() < 0.3 ? { harsh: true } : {});
  },
  // 胜利小号角 / 失败低鸣
  victory() {
    const c = ac(); if (!c || muted) return;
    const t = c.currentTime + 0.05;
    [[523, 0], [659, 0.13], [784, 0.26], [1046, 0.42]].forEach(([f, dt]) => {
      tone(t + dt, 0.22, f, f, 0.16);
      tone(t + dt, 0.22, f / 2, f / 2, 0.08, "sine");
    });
  },
  defeat() {
    const c = ac(); if (!c || muted) return;
    const t = c.currentTime + 0.05;
    [[392, 0], [330, 0.22], [262, 0.44]].forEach(([f, dt]) => {
      tone(t + dt, 0.3, f, f * 0.985, 0.14, "sine");
    });
    noiseBurst(t + 0.5, 0.4, 220, 1, 0.06, "lowpass");
  },

  // 事件消息 → 音效映射(来源:sim 的 notify toast)
  forMsg(msg) {
    if (!msg) return;
    if (msg.includes("建筑完成")) this.buildDone();
    else if (msg.includes("资源不足") || msg.includes("人口已满") || msg.includes("无法放置")) this.error();
    else if (msg.includes("驯服")) this.capture();
    else if (msg.includes("召唤")) this.summon();
    else if (msg.includes("残部重整")) this.ready();
  },

  toggleMute() {
    muted = !muted;
    localStorage.setItem("nw_muted", muted ? "1" : "0");
    if (master) master.gain.value = muted ? 0 : 0.42;
  },
  isMuted() { return muted; },
};
