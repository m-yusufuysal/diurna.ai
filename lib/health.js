'use strict';
/* Kaynak sağlığı: bayat veri ve art arda başarısızlık tespiti, yönetici uyarıları (uygulama içi + e-posta/giden kutusu), toparlanma bildirimi.
 * Olay başına tek uyarı (tekrarlamaz); toparlanınca kapanır. Eşikler: bayat = son başarılı çalışmadan bu yana max(3×aralık, liste:6 sa / haber:2 sa). */
const store = require('./store');
const L = require('./lists');
const bus = require('./bus');
const FILE = 'health.json';
const state = () => store.readCache(FILE, { open: {} });
function assess(jobs) {
  const now = Date.now(); const lm = L.meta(); const out = [];
  for (const j of jobs) {
    const every = (j.everyMin || 60) * 60e3; const lim = Math.max(3 * every, j.kind === 'list' ? 6 * 3600e3 : 2 * 3600e3);
    const lastOk = j.lastOk ? Date.parse(j.lastOk) : 0; const age = lastOk ? now - lastOk : null;
    const stale = lastOk ? age > lim : (j.fails >= 2); const failing = j.fails >= 3 || (j.status === 'blocked' && j.fails >= 2);
    const meta = j.kind === 'list' ? lm[j.key] : null;
    if (stale || failing) out.push({ id: j.id, label: j.label, kind: j.kind, reason: failing ? 'failing' : 'stale', fails: j.fails, lastOk: j.lastOk, ageHours: age != null ? Math.round(age / 360000) / 10 : null, error: j.lastError, usingFallback: !!meta?.usingFallback, usingCache: j.kind === 'list' ? !!(meta && meta.count) : false });
  }
  return out;
}
/* “Degraded” (amber): son çekim başarısız ama önbellekteki veri hâlâ kullanılıyor (henüz bayat/kritik eşik aşılmadı). */
function degradedOf(jobs, bad) {
  const lm = L.meta(); const badIds = new Set(bad.map(b => b.id)); const out = [];
  for (const j of jobs) { if (j.kind !== 'list' || badIds.has(j.id)) continue; const m = lm[j.key]; if (m && m.ok === false && m.lastError) out.push({ id: j.id, label: j.label, kind: j.kind, reason: 'degraded', error: m.lastError, lastOk: m.fetchedAt || j.lastOk || null, usingCache: !!m.count, usingFallback: !!m.usingFallback }); }
  return out;
}
const summary = jobs => { const bad = assess(jobs); const degraded = degradedOf(jobs, bad); return { ok: bad.length === 0, level: bad.length ? 'bad' : degraded.length ? 'degraded' : 'ok', bad, degraded, checkedAt: new Date().toISOString() }; };
function alertAdmins(kind, bad, extra) {
  const work = require('./work'); const mailer = require('./mailer');
  for (const o of store.orgs()) store.runAs(o.id, () => {
    for (const u of store.authUsers().filter(x => x.orgId === o.id && x.active && ['Admin', 'Uyum Yöneticisi'].includes(x.role))) {
      try { work.notify(u.id, kind === 'open' ? 'source_health' : 'source_recovered', { title: extra.title, body: extra.body, link: '#/kaynaklar/durum', refId: extra.ref }); } catch { }
      if (kind === 'open' && u.role === 'Admin') mailer.send({ to: u.email, subject: '[Diurna] ' + extra.title, text: extra.body + '\n\n' + extra.link, kind: 'health' }).catch(() => { });
    }
  });
}
/* Zamanlayıcıdan dakikada bir çağrılır */
function evaluate(jobs) {
  const bad = assess(jobs); const st = state(); const ids = new Set(bad.map(b => b.id)); let dirty = false;
  for (const b of bad) if (!st.open[b.id]) {
    st.open[b.id] = { since: new Date().toISOString(), reason: b.reason }; dirty = true;
    const why = b.reason === 'failing' ? `${b.fails} ardışık başarısız deneme` : `${b.ageHours} saattir güncellenemiyor`;
    try { alertAdmins('open', [b], { title: `Kaynak sorunu: ${b.label}`, body: `${b.label}: ${why}. Son hata: ${b.error || '—'}. ${b.usingFallback ? 'Yedek kaynak kullanılıyor.' : b.usingCache ? 'Son başarılı önbellek kullanılıyor; veri güncel olmayabilir.' : ''}`, ref: b.id + ':' + st.open[b.id].since, link: '#/kaynaklar/durum' }); } catch (e) { console.error('health alert', e.message); }
  }
  for (const id of Object.keys(st.open)) if (!ids.has(id)) {
    const job = jobs.find(j => j.id === id); const since = st.open[id].since; delete st.open[id]; dirty = true;
    try { alertAdmins('close', [], { title: `Kaynak toparlandı: ${job?.label || id}`, body: 'Kaynak yeniden başarıyla güncelleniyor.', ref: id + ':ok:' + Date.now(), link: '#/kaynaklar/durum' }); } catch { }
  }
  if (dirty) { store.writeCache(FILE, st); bus.emit('jobs', {}); }
  return bad;
}
module.exports = { assess, summary, evaluate };
