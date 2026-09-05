// ============================================================
// 音效:英文语音(Web Speech API,魔兽人族风台词)+ Web Audio 合成音效
//  - 人声:浏览器内置 TTS 说英文(优先英式音色:"Work, work." /
//    "Job's done!" / "To arms!"……);无可用语音时回退到共振峰
//    合成的「咕哝人声」(锯齿/方波 + 三并联带通 + 颤音滑音)
//  - 敲击/金属/号角:滤波噪声、失谐方波、纯音,全程序化,零外部素材
//  - M 键或左上角按钮静音(localStorage 记忆)
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

// ---------- 英文语音(Web Speech API;无可用语音时回退到合成咕哝) ----------
let voices = [];
function loadVoices() {
  try { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; } catch { voices = []; }
}
if ("speechSynthesis" in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}
function pickVoice() {
  if (!voices.length) loadVoices();
  // 魔兽人族是英式腔:优先 en-GB,其次 en-US / 任意英文
  return voices.find(v => /en[-_]GB/i.test(v.lang))
      || voices.find(v => /en[-_]US/i.test(v.lang))
      || voices.find(v => /^en/i.test(v.lang))
      || null;
}
const hasTTS = () => "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
function say(text, { pitch = 1, rate = 1.05 } = {}, fallback) {
  if (muted) return;
  if (hasTTS()) {
    try {
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice(); if (v) u.voice = v;
      u.lang = (v && v.lang) || "en-US";
      u.pitch = pitch; u.rate = rate; u.volume = 1;
      speechSynthesis.speak(u);
      return;
    } catch { /* 落到回退 */ }
  }
  if (fallback) fallback();
}
function busySpeaking() {
  try { return hasTTS() && (speechSynthesis.speaking || speechSynthesis.pending); } catch { return false; }
}
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// ---------- 场景音效(魔兽人族味) ----------
const rnd = (a, b) => a + Math.random() * (b - a);

export const sfx = {
  unlock() { ac(); },

  // 村民应答:"Work, work." / "More work?"
  ackWorker() {
    if (!throttle("ack", 2500)) return;
    say(pick(["Work, work.", "More work?", "Right away.", "Yes, yes.", "On it!"]),
      { pitch: 1.15, rate: 1.1 },
      () => speak([[1, 0.09], [1.18, 0.07], [0.9, 0.11, 0.97]], rnd(185, 215)));
  },
  // 军队应答:"Yes, mi'lord?"(低沉)
  ackMilitary() {
    if (!throttle("ack", 2500)) return;
    say(pick(["Yes, mi'lord?", "Orders?", "At once.", "For the Alliance!"]),
      { pitch: 0.8, rate: 1.0 },
      () => speak([[0.95, 0.08], [1.22, 0.1, 1.02]], rnd(125, 150), { harsh: true }));
  },
  // 下达攻击令:"To arms!" + 拔武器金属声
  attack() {
    if (!throttle("atk", 1500)) return;
    const c = ac(); if (!c || muted) return;
    say(pick(["To arms!", "Attack!", "Charge!", "For glory!"]),
      { pitch: 0.75, rate: 1.1, },
      () => speak([[1.28, 0.07], [1.02, 0.09], [0.78, 0.13, 0.93]], rnd(140, 165), { harsh: true, vol: 0.58 }));
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
  // 建筑完成:"Job's done!"
  buildDone() {
    if (!throttle("bd", 2000)) return;
    say(pick(["Job's done!", "Construction complete!"]),
      { pitch: 1.1, rate: 1.05 },
      () => speak([[0.9, 0.08], [1.12, 0.08], [1.38, 0.14, 1.02]], rnd(200, 235)));
    const c = ctx;
    if (c && !muted) {
      const t = c.currentTime + 0.1;
      tone(t, 0.1, 660, 660, 0.12); tone(t + 0.1, 0.16, 880, 880, 0.12);
    }
  },
  // 报错(资源不足等):"We can't afford that."
  error() {
    if (!throttle("err", 1500)) return;
    say(pick(["We can't afford that.", "Not enough resources.", "We need more supplies."]),
      { pitch: 0.9, rate: 0.95 },
      () => speak([[0.8, 0.1], [0.72, 0.13, 0.96]], 108, { harsh: true, vol: 0.42 }));
  },
  // 单位训练完成:"Ready to work!"
  ready() {
    if (!throttle("rdy", 2000)) return;
    say(pick(["Ready to work!", "Reporting for duty."]),
      { pitch: 1.1, rate: 1.05 },
      () => speak([[1, 0.08], [1.28, 0.1, 1.03]], rnd(190, 220)));
  },
  // 驯服神兽:"By the Light!"
  capture() {
    const c = ac(); if (!c || muted) return;
    say(pick(["By the Light!", "A magnificent beast!"]),
      { pitch: 1.25, rate: 1.05 },
      () => speak([[1.18, 0.06], [1.5, 0.07], [1.1, 0.12, 0.98]], rnd(225, 255)));
    const t = c.currentTime + 0.1;
    tone(t, 0.22, 900, 1600, 0.1);
  },
  // 召唤神兽:神秘上行滑音 + 火花
  summon() {
    const c = ac(); if (!c || muted) return;
    say("Your beast awaits!", { pitch: 0.95, rate: 1.0 });
    const t = c.currentTime + 0.02;
    tone(t, 0.4, 220, 640, 0.14, "sine");
    tone(t + 0.08, 0.35, 330, 880, 0.09, "triangle");
    noiseBurst(t + 0.3, 0.15, 4200, 2, 0.12, "highpass");
  },
  // 随机闲聊(游戏中偶发,语音空闲才说)
  chatter() {
    if (!throttle("cht", 12000) || busySpeaking()) return;
    const c = ac(); if (!c || muted) return;
    say(pick([
        "It's quiet... too quiet.", "Lovely day, isn't it?",
        "The wolves are restless tonight.", "I need a break.",
        "Work, work.", "What's that over there?", "My axe is getting dull.",
      ]),
      { pitch: rnd(0.85, 1.2), rate: rnd(0.95, 1.1) },
      () => speak([[1, 0.08], [1.1, 0.06], [0.95, 0.08], [1.05, 0.1]], rnd(150, 235)));
  },
  // 胜利小号角 + "Victory!" / 失败低鸣 + "We are undone..."
  victory() {
    const c = ac(); if (!c || muted) return;
    say("Victory!", { pitch: 1.0, rate: 1.0 });
    const t = c.currentTime + 0.05;
    [[523, 0], [659, 0.13], [784, 0.26], [1046, 0.42]].forEach(([f, dt]) => {
      tone(t + dt, 0.22, f, f, 0.16);
      tone(t + dt, 0.22, f / 2, f / 2, 0.08, "sine");
    });
  },
  defeat() {
    const c = ac(); if (!c || muted) return;
    say("We are undone...", { pitch: 0.8, rate: 0.9 });
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
    if (muted && hasTTS()) { try { speechSynthesis.cancel(); } catch {} }
  },
  isMuted() { return muted; },
};
