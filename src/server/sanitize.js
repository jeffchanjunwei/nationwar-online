// ============================================================
// 入站消息校验:类型/白名单/长度;不合法返回 null(丢弃)
// 命令的权威校验在 sim.applyCommand,这里只保证形状安全(防崩溃)
// ============================================================
import { DIFFICULTY, BEASTS } from "../shared/cfg.js";

const ROOM_RE = /^[A-Z0-9]{4}$/;
const CMD_TYPES = new Set(["order", "rally", "build", "train", "stance", "summon", "camp_return"]);
const ORDER_TYPES = new Set(["attack", "gather", "build", "ground"]);

function str(v, max) { return typeof v === "string" && v.length <= max ? v : null; }

function sanitizeCmd(c) {
  if (!c || typeof c !== "object" || !CMD_TYPES.has(c.c)) return null;
  const intId = v => Number.isInteger(v) && v > 0 && v < 1e9 ? v : null;
  const ids = a => Array.isArray(a) && a.length <= 64 && a.every(v => Number.isInteger(v) && v > 0 && v < 1e9) ? a : null;
  const coord = v => typeof v === "number" && isFinite(v) ? v : null;
  switch (c.c) {
    case "order": {
      if (!ids(c.ids)) return null;
      const o = c.order;
      if (!o || typeof o !== "object" || !ORDER_TYPES.has(o.type)) return null;
      if ((o.type === "attack" || o.type === "gather" || o.type === "build") && intId(o.target) == null) return null;
      if (o.type === "ground" && (coord(o.x) == null || coord(o.y) == null)) return null;
      return c;
    }
    case "rally":
      if (intId(c.id) == null || coord(c.x) == null || coord(c.y) == null) return null;
      if (c.target != null && intId(c.target) == null) return null;
      return c;
    case "build":
      if (!["hut", "barracks", "lodge", "altar"].includes(c.btype)) return null;
      if (coord(c.x) == null || coord(c.y) == null || !ids(c.ids || [])) return null;
      return c;
    case "train":
      if (intId(c.id) == null || !["villager", "warrior", "hunter", "shaman"].includes(c.utype)) return null;
      return c;
    case "stance":
      if (!ids(c.ids) || !["aggressive", "hold"].includes(c.stance)) return null;
      return c;
    case "summon":
      if (typeof c.beast !== "string" || !(c.beast in BEASTS)) return null;
      return c;
    case "camp_return":
      if (!ids(c.ids || [])) return null;
      return c;
  }
  return null;
}

export function sanitize(raw) {
  let m;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m.t !== "string") return null;
  switch (m.t) {
    case "create_room": {
      const name = str(m.name, 12);
      if (!name) return null;
      return { t: m.t, name };
    }
    case "join_room": {
      const room = typeof m.room === "string" ? m.room.toUpperCase() : "";
      const name = str(m.name, 12);
      if (!ROOM_RE.test(room) || !name) return null;
      return { t: m.t, room, name };
    }
    case "rejoin": {
      const room = typeof m.room === "string" ? m.room.toUpperCase() : "";
      const token = str(m.token, 64);
      if (!ROOM_RE.test(room) || !token) return null;
      return { t: m.t, room, token };
    }
    case "ready": return { t: m.t, ready: !!m.ready };
    case "set_diff":
      if (!DIFFICULTY[m.diff]) return null;
      return { t: m.t, diff: m.diff };
    case "start": case "restart": case "leave": case "need_full":
      return { t: m.t };
    case "cmd": {
      if (!Array.isArray(m.cmds) || m.cmds.length === 0 || m.cmds.length > 64) return null;
      const cmds = m.cmds.map(sanitizeCmd).filter(Boolean);
      if (!cmds.length) return null;
      return { t: m.t, cmds };
    }
    case "chat": {
      const msg = str(m.msg, 120);
      if (!msg || !msg.trim()) return null;
      return { t: m.t, msg: msg.trim() };
    }
    case "ping":
      return { t: m.t, ts: typeof m.ts === "number" ? m.ts : Date.now() };
    default: return null;
  }
}
