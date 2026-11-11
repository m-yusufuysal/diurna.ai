'use strict';
/* Sayfa izleme: yapılandırılmış liste dosyası sunmayan resmî sayfalar (Körfez merkez bankaları, EOCN, MASAK, DFAT, MOF…).
 * Her sayfa koşullu istekle çekilir; metin parmak izi ve bağlantı kümesi önceki sürümle karşılaştırılır. Değişiklik geçmişi saklanır. */
const fs = require('fs'), path = require('path');
const U = require('./util');
const store = require('./store');
const FILE = 'watch-state.json';
const defs = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'watch.json'), 'utf8')).pages || []; } catch { return []; } };
const state = () => store.readCache(FILE, {});
function anchors(html, base) {
  const out = new Map();
  for (const m of html.matchAll(/<a\s[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const t = U.stripTags(m[2]).replace(/\s+/g, ' ').trim(); if (t.length < 6 || t.length > 220) continue;
    let href = m[1]; try { href = new URL(href, base).href; } catch { continue; }
    if (!out.has(t)) out.set(t, href);
  }
  return [...out.entries()].slice(0, 600);
}
const textHash = html => U.sha256(U.stripTags(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')).replace(/\s+/g, ' ').replace(/\d{1,2}[:.]\d{2}(:\d{2})?/g, '').trim());
/* Bir sayfayı denetle; { changed, added[], removed[] } döndürür. İlk çalıştırma temel çizgi olarak kaydedilir (değişiklik sayılmaz). */
async function checkOne(d) {
  const st = state(); const prev = st[d.id];
  let html, an;
  if (d.type === 'wpjson') {   // WordPress REST (ör. MASAK duyuruları): başlık → bağlantı
    const j = JSON.parse(await U.fetchText(d.url, { timeout: 45000, retries: 0 })); if (!Array.isArray(j)) throw new Error('Beklenen JSON dizisi alınamadı');
    an = j.map(p => [U.decodeEntities(U.stripTags(p.title?.rendered || '')).replace(/\s+/g, ' ').trim(), p.link]).filter(x => x[0] && x[1]); html = JSON.stringify(an);
  } else { html = await U.fetchText(d.url, { timeout: 45000, retries: 0 }); an = anchors(html, d.url); }
  const th = U.sha256(U.stripTags(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')).replace(/\s+/g, ' ').replace(/\d{1,2}[:.]\d{2}(:\d{2})?/g, '').trim()); const now = new Date().toISOString();
  const rec = prev || { history: [] };
  rec.checkedAt = now; rec.url = d.url; rec.size = html.length; rec.error = null;
  let res = { changed: false, baseline: !prev };
  if (!prev) { rec.hash = th; rec.anchors = an; rec.baselineAt = now; }
  else if (prev.hash !== th) {
    const old = new Map(prev.anchors || []); const cur = new Map(an);
    const added = an.filter(([t]) => !old.has(t)).slice(0, 12); const removed = (prev.anchors || []).filter(([t]) => !cur.has(t)).slice(0, 12);
    rec.hash = th; rec.anchors = an;
    if (added.length || removed.length) { rec.history.unshift({ ts: now, added, removed, size: html.length }); rec.history = rec.history.slice(0, 30); rec.changedAt = now; res = { changed: true, added, removed }; }
  }
  st[d.id] = rec; store.writeCache(FILE, st); return res;
}
async function checkAll() {
  const out = []; for (const d of defs()) { try { out.push({ id: d.id, ...(await checkOne(d)) }); } catch (e) { const st = state(); st[d.id] = { ...(st[d.id] || { history: [] }), checkedAt: new Date().toISOString(), error: e.message }; store.writeCache(FILE, st); out.push({ id: d.id, error: e.message }); } }
  return out;
}
/* Pencere içindeki değişiklikleri bülten öğesine çevirmek için */
function changesSince(startISO) {
  const st = state(); const out = [];
  for (const d of defs()) for (const h of (st[d.id]?.history || [])) if (h.ts.slice(0, 10) >= startISO) out.push({ def: d, ...h });
  return out;
}
function summary() { const st = state(); return defs().map(d => ({ ...d, checkedAt: st[d.id]?.checkedAt || null, changedAt: st[d.id]?.changedAt || null, error: st[d.id]?.error || null, baselineAt: st[d.id]?.baselineAt || null, changes: (st[d.id]?.history || []).length })); }
module.exports = { defs, checkOne, checkAll, changesSince, summary, anchors };
