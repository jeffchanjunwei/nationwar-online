// ============================================================
// WebSocket 连接封装:地址解析、连接、心跳
// ============================================================
export function wsUrl() {
  const q = new URLSearchParams(location.search).get("server");
  const host = q || location.host;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return proto + "//" + host + "/ws";
}

export function connect({ onMessage, onOpen, onClose }) {
  const ws = new WebSocket(wsUrl());
  const conn = {
    ws,
    isOpen() { return ws.readyState === WebSocket.OPEN; },
    send(obj) { if (this.isOpen()) ws.send(JSON.stringify(obj)); },
    close() { try { ws.close(); } catch {} },
  };
  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }          // 坏包丢弃
    try { onMessage && onMessage(m); }
    catch (e) { console.error("[net] 消息处理异常", e); }        // 绝不静默吞异常
  };
  ws.onopen = () => onOpen && onOpen();
  ws.onclose = () => onClose && onClose();
  ws.onerror = () => { /* onclose 会跟随 */ };
  return conn;
}
