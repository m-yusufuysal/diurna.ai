'use strict';
/* Sunucu→tarayıcı canlı itme (SSE). Her istemci bir kiracıya/kullanıcıya bağlıdır; olaylar hedefe göre süzülür. */
const clients = new Map(); let seq = 0;
function add(res, who) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 4000\n\n'); clients.set(res, who || {});
  res.on('close', () => clients.delete(res));
}
function emit(type, data, target) {
  seq++; const msg = `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
  for (const [c, who] of clients) {
    if (target?.orgId && who.orgId !== target.orgId) continue; if (target?.userId && who.userId !== target.userId) continue;
    try { c.write(msg); } catch { clients.delete(c); }
  }
}
setInterval(() => { for (const c of clients.keys()) { try { c.write(': ping\n\n'); } catch { clients.delete(c); } } }, 25000).unref();
module.exports = { add, emit, count: () => clients.size };
