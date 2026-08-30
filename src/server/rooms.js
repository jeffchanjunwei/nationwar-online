// ============================================================
// RoomManager:房间码生成、路由、回收
// ============================================================
import { Room } from "./room.js";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // 去掉易混淆的 0/O/1/I/L

export class RoomManager {
  constructor() {
    this.rooms = new Map();
  }
  genCode() {
    for (let tries = 0; tries < 50; tries++) {
      let code = "";
      for (let i = 0; i < 4; i++) code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    return "R" + Date.now().toString(36).slice(-4).toUpperCase();
  }
  create(ws, name) {
    const code = this.genCode();
    const room = new Room(code);
    const r = room.create(ws, name);
    if (r.error) return r;
    this.rooms.set(code, room);
    return { room, slot: r.slot };
  }
  join(code, ws, name) {
    const room = this.rooms.get(code);
    if (!room) return { error: "no_such_room" };
    const r = room.join(ws, name);
    if (r.error) return r;
    return { room, slot: r.slot };
  }
  rejoin(code, ws, token) {
    const room = this.rooms.get(code);
    if (!room) return { error: "no_such_room" };
    const r = room.rejoin(ws, token);
    if (r.error) return r;
    return { room, slot: r.slot };
  }
  tick(now) {
    for (const room of this.rooms.values()) {
      room.tick(now);
      room.noteEmpty(now);
    }
    for (const [code, room] of this.rooms) {
      if (room.isEmptyForGc(now)) this.rooms.delete(code);
    }
  }
}
