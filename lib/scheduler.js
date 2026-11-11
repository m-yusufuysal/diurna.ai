'use strict';
/* Arka plan zamanlayıcı: her kaynağı uygun aralıkta yoklar (koşullu istek, jitter, üstel geri çekilme).
 * Manuel yenileme yoktur; her şey kendiliğinden güncellenir ve SSE ile arayüze itilir. */
const store = require('./store');
const U = require('./util');
const L = require('./lists');
const scan = require('./scan');
const S = require('./sources');
const bus = require('./bus');
const screening = require('./screening');

const MIN = 60 * 1000;
const jobs = {};
let timer = null; let running = 0; let lastDay = null;
const PERSIST = 'scheduler.json';

function defs(s) {
  const nm = s.pollNewsMinutes * MIN;      // haber/basın sayfaları: en az 5 dk
  const lm = s.pollListsMinutes * MIN;    // tam liste dosyaları: en az 30 dk
  return [
    { id: 'news:ofac', kind: 'news', key: 'ofac', every: nm, label: 'OFAC Recent Actions', run: runOfac },
    { id: 'news:uk', kind: 'news', key: 'uk', every: nm, label: 'UK Sanctions List (GOV.UK duyuruları)', run: () => scan.refreshSource('uk') },
    { id: 'news:eu', kind: 'news', key: 'eu', every: Math.round(nm * 1.5), label: 'EUR-Lex OJ (L)', run: () => scan.refreshSource('eu') },
    { id: 'news:un', kind: 'news', key: 'un', every: nm, label: 'BM Güvenlik Konseyi', run: () => scan.refreshSource('un') },
    { id: 'news:fatf', kind: 'news', key: 'fatf', every: 6 * 60 * MIN, label: 'FATF', run: () => scan.refreshSource('fatf') },
    { id: 'list:ofac', kind: 'list', key: 'ofac', every: lm, label: 'OFAC SDN (CSV)', run: () => runList('ofac') },
    { id: 'list:uk', kind: 'list', key: 'uk', every: lm, label: 'UK Sanctions List (XML)', run: () => runList('uk') },
    { id: 'list:un', kind: 'list', key: 'un', every: lm, label: 'BM Konsolide (XML)', run: () => runList('un') },
    { id: 'list:eu', kind: 'list', key: 'eu', every: lm, label: 'AB Konsolide (CSV)', run: () => runList('eu') },
    { id: 'news:fr', kind: 'news', key: 'fr', every: Math.max(nm * 3, 20 * MIN), label: 'Federal Register (OFAC, BIS)', run: () => scan.refreshSource('fr') },
    { id: 'news:rg', kind: 'news', key: 'rg', every: Math.max(nm * 3, 30 * MIN), label: 'Resmî Gazete günlük dizin', run: () => scan.refreshSource('rg') },
    { id: 'news:watch', kind: 'news', key: 'watch', every: Math.max(nm * 6, 60 * MIN), label: 'İzlenen sayfalar (EOCN, MASAK, SAMA, QCB, CBB, DFAT, MOF)', run: () => scan.refreshSource('watch') },
    ...Object.keys(L.DEFS).filter(k => !['ofac', 'uk', 'un', 'eu'].includes(k)).map(k => ({ id: 'list:' + k, kind: 'list', key: k, every: Math.max(lm, (k === 'tr' || L.DEFS[k].os) ? 3 * 60 * MIN : lm), label: L.DEFS[k].label + ' (liste)', run: () => runList(k) })),
  ];
}

async function runOfac() {
  // listeleme sayfası değişmediyse ve veri varsa ağır işi atla (koşullu istek)
  const lv = scan.loadLive(); const have = lv.sources.ofac;
  const r = await U.fetchCond(S.SRC.ofac.page, 'ofac-recent-page', { api: false });
  if (!r.changed && have && have.status !== 'error') return { changed: false, note: 'not-modified' };
  await scan.refreshSource('ofac'); return { changed: true };
}
async function runList(src) {
  const r = await L.syncOne(src);
  if (r.failed) throw new Error(r.lastError || 'list sync failed');
  if (r.changed) {
    global.__listDiff = L.diffVsPrevious(scan.window().end);
    bus.emit('lists', { src, count: r.count, at: new Date().toISOString() });
    for (const k of (['uk', 'eu', 'un'].includes(src) ? [src] : scan.ORDER.includes(src) ? [src] : [])) await scan.refreshSource(k).catch(() => { });
    try { require('./entities').ingest(src); } catch (e) { console.error('entities', e.message); }
    setTimeout(() => { try { screening.runAllOrgs(); } catch (e) { console.error('screening', e.message); } }, 50);
  }
  return r;
}

function loadPersisted() { return store.readCache(PERSIST, {}); }
function persist() { const o = {}; for (const j of Object.values(jobs)) o[j.id] = { lastRun: j.lastRun, lastOk: j.lastOk, lastChange: j.lastChange, lastError: j.lastError, fails: j.fails, nextRun: j.nextRun }; store.writeCache(PERSIST, o); }

function init() {
  const P = require('./platform'); const s = P; const saved = loadPersisted();
  let stagger = 1500;
  for (const d of defs(s).sort((a, b) => (a.kind === 'list' ? 0 : 1) - (b.kind === 'list' ? 0 : 1))) {
    const p = saved[d.id] || {};
    jobs[d.id] = { ...d, lastRun: p.lastRun || null, lastOk: p.lastOk || null, lastChange: p.lastChange || null, lastError: p.lastError || null, fails: p.fails || 0, status: p.lastError ? 'error' : 'idle', nextRun: 0 };
    const missing = d.kind === 'list' && !require('fs').existsSync(store.cacheFile('list-' + d.key + '.json'));
    const scanBad = d.kind === 'news' && (() => { try { return scan.sourceStatuses()[d.key]?.status === 'error'; } catch { return false; } })();
    const due = (p.lastRun && !missing && !p.lastError && !scanBad) ? Math.max(Date.now() + 2000, new Date(p.lastRun).getTime() + d.every) : Date.now() + stagger;
    jobs[d.id].nextRun = due; stagger += 2500;
  }
  global.__listDiff = L.diffVsPrevious(scan.window().end);
  lastDay = scan.window().end;
  timer = setInterval(tick, 10000); timer.unref?.();
  setTimeout(tick, 500);
}
function applySettings() {
  const s = require('./platform');
  for (const d of defs(s)) if (jobs[d.id]) { jobs[d.id].every = d.every; }
  // geriye bakış değiştiyse haber işleri hemen çalışsın
  for (const j of Object.values(jobs)) if (j.kind === 'news') j.nextRun = Date.now() + 1500 + Math.random() * 5000;
  bus.emit('jobs', snapshot());
}
async function tick() {
  try { if (Date.now() - (tick.h || 0) > 60000) { tick.h = Date.now(); require('./health').evaluate(snapshot()); } } catch (e) { console.error('health', e.message); }
  const today = scan.window().end;
  if (today !== lastDay) { lastDay = today; global.__listDiff = L.diffVsPrevious(today); for (const j of Object.values(jobs)) j.nextRun = Date.now() + Math.random() * 20000; }
  const now = Date.now();
  for (const j of Object.values(jobs).sort((a, b) => a.nextRun - b.nextRun)) {
    if (running >= 2) break;
    if (j.status === 'running' || j.nextRun > now) continue;
    exec(j);
  }
}
async function exec(j) {
  running++; j.status = 'running'; j.lastRun = new Date().toISOString(); bus.emit('jobs', snapshot());
  try {
    const r = await Promise.race([j.run(), new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('Zaman aşımı: iş 10 dakikadan uzun sürdü'), { retryAfterMs: 0 })), 10 * 60e3).unref())]);
    j.lastOk = new Date().toISOString(); j.lastError = null; j.fails = 0; if (!r || r.changed !== false) j.lastChange = j.lastOk;
    j.status = 'ok'; try { require('./work').recordUptime(j.id, true); } catch { }
  } catch (e) {
    j.fails++; j.lastError = e.message; j.status = e.blocked ? 'blocked' : 'error'; j.retryAfterMs = e.retryAfterMs || 0; try { require('./work').recordUptime(j.id, false); } catch { }
  } finally {
    running--;
    const backoff = Math.min(8, Math.pow(2, Math.max(0, j.fails))) ;
    const jitter = 0.9 + Math.random() * 0.2;
    j.nextRun = Date.now() + Math.max(j.fails ? (j.retryAfterMs || 0) : 0, Math.round(j.every * (j.fails ? backoff : 1) * jitter)); j.retryAfterMs = 0;
    persist(); bus.emit('jobs', snapshot());
  }
}
function snapshot() {
  return Object.values(jobs).map(j => ({ id: j.id, kind: j.kind, key: j.key, label: j.label, status: j.status, everyMin: Math.round(j.every / MIN), lastRun: j.lastRun, lastOk: j.lastOk, lastChange: j.lastChange, lastError: j.lastError, fails: j.fails, nextRun: j.nextRun ? new Date(j.nextRun).toISOString() : null }));
}
module.exports = { init, snapshot, applySettings };
