'use strict';
/* Canlı tarama durumu: kaynak başına öğeler, iş kuralları, müşteri tabanı kontrolü, yeni öğe bildirimleri. */
const store = require('./store');
const U = require('./util');
const S = require('./sources');
const L = require('./lists');
const C = require('./customers');
const bus = require('./bus');
const P = require('./platform');
const { B } = S;

const RULE = { ADD: 'check_base', UPD: 'no_extra', DEL: 'vessel_warn', GL: 'flag_gl', ENF: 'info_enf', INFO: 'info' };
const LISTS_EXTRA = { ofacc: p => 'OFAC Consolidated (non-SDN) – ' + (p || 'list'), csl: p => 'US Consolidated Screening List (BIS/State) – ' + (p || 'list'), ca: p => 'Canada SEMA – ' + (p || 'list'), ch: p => 'Switzerland SECO – ' + (p || 'programme'), tr: p => 'MASAK freeze list – ' + (p || 'list') };
for (const k of Object.keys(L.DEFS)) if (L.DEFS[k].os || L.DEFS[k].native) LISTS_EXTRA[k] = p => L.DEFS[k].label + ' – ' + (p || 'list');
const ORDER = ['ofac', 'uk', 'eu', 'un', 'fatf', 'fr', 'rg', ...Object.keys(LISTS_EXTRA).filter(k => L.DEFS[k]), 'watch'];
let live = null;
const status = {};   // anahtar -> durum bilgisi (bellekte + live içinde saklanır)

function window_(days) {
  const end = U.todayISO(P.tz); const n = days || P.scanDays; return { end, start: U.addDays(end, -(n - 1)), days: n };
}
function orgWindow() { let d = 5; try { d = store.settings().lookbackDays; } catch { } return window_(d); }
function loadLive() {
  const w = window_();
  if (live && live.date === w.end && live.lookback === w.days) return live;
  const saved = store.scan(w.end);
  if (saved && saved.lookback === w.days) live = saved;
  else live = { date: w.end, lookback: w.days, start: w.start, createdAt: new Date().toISOString(), sources: {} };
  return live;
}
function save() { live.updatedAt = new Date().toISOString(); store.saveScan(live.date, live); }

function enrich(item, threshold) {
  item.rule = RULE[item.type] || 'info';
  if (item.type === 'DEL') item.vesselWarning = !!(item.hasVessel || (item.entities || []).some(e => e.type === 'vessel' || (e.imo && e.imo.length)));
  if ((item.type === 'ADD' || item.type === 'DEL') && item.entities && item.entities.length) {
    if (!C.has()) item.baseCheck = { state: 'unavailable', matches: [] };
    else {
      const all = [];
      for (const e of item.entities) all.push(...C.checkEntity(e, threshold));
      const seen = new Map(); for (const m of all) { const k = m.customerId + '|' + m.entity; if (!seen.has(k) || seen.get(k).score < m.score) seen.set(k, m); }
      const matches = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 12);
      item.baseCheck = { state: matches.length ? 'possible' : 'none', matches, checkedAt: new Date().toISOString(), customersSha: store.customers().meta?.sha || '' };
    }
  }
  return item;
}

function titleUK(prog, op) { return 'UK Sanctions List – ' + (prog || 'regime'); }
function titleUN(prog) { return 'UN Security Council Consolidated List – ' + (prog || 'list'); }
function titleEU(prog) { return 'EU Consolidated Financial Sanctions List – ' + (prog || 'programme'); }

async function runParts(key, win) {
  const parts = {}; let items = [];
  const run = async (name, fn) => {
    const t0 = Date.now();
    try { const r = await fn(); parts[name] = { ok: true, note: r.note, ms: Date.now() - t0, degraded: !!r.degraded, count: r.count ?? (r.items || []).length, error: r.error || null }; items.push(...(r.items || [])); }
    catch (e) { parts[name] = { ok: false, error: e.message, blocked: !!e.blocked, ms: Date.now() - t0 }; }
  };
  if (key === 'ofac') await run('news', () => S.fetchOFAC(win));
  if (key === 'uk') {
    await run('news', () => S.fetchUKGov(win));
    await run('list', async () => S.listChanges(win, 'uk', 'UK/OFSI', titleUK, () => 'https://search-uk-sanctions-list.service.gov.uk/'));
  }
  if (key === 'eu') {
    await run('news', () => S.fetchEUROJ(win));
    await run('list', async () => S.listChanges(win, 'eu', 'AB', titleEU, (p, l) => l[0]?.url || 'https://www.sanctionsmap.eu/'));
  }
  if (key === 'un') {
    await run('news', () => S.fetchUNPress(win));
    await run('list', async () => S.listChanges(win, 'un', 'BM', titleUN, () => 'https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list'));
  }
  if (key === 'fatf') await run('news', () => S.fetchFATF(win));
  if (key === 'fr') await run('news', () => S.fetchFederalRegister(win));
  if (key === 'rg') await run('news', () => S.fetchResmiGazete(win));
  if (key === 'watch') await run('news', () => S.fetchWatch(win));
  if (LISTS_EXTRA[key] && L.DEFS[key]) await run('list', async () => S.listChanges(win, key, S.SRC[key]?.code || key, LISTS_EXTRA[key], () => L.entryUrl({ s: key, id: '' }) || L.DEFS[key].page));
  return { parts, items };
}

async function refreshSource(key) {
  const lv = loadLive(); const win = window_();
  const prev = lv.sources[key];
  const prevIds = new Set((prev?.items || []).map(i => i.id));
  const prevFirst = new Map((prev?.items || []).map(i => [i.id, i.firstSeen]));
  const t0 = Date.now();
  const { parts, items } = await runParts(key, win);
  const vals = Object.values(parts);
  const okAll = vals.every(p => p.ok), okAny = vals.some(p => p.ok);
  const degraded = vals.some(p => p.degraded) || (!okAll && okAny);
  const now = new Date().toISOString();
  // aynı id'li yinelemeleri ele
  const uniq = new Map(); for (const it of items) uniq.set(it.id, it);
  const out = [...uniq.values()].map(it => { it.firstSeen = prevFirst.get(it.id) || now; return rule(it); });
  const newItems = prev ? out.filter(i => !prevIds.has(i.id)) : [];
  // tüm parçalar başarısızsa eski öğeleri koru
  const keep = !okAny && prev;
  lv.sources[key] = {
    key, status: !okAny ? 'error' : degraded ? 'degraded' : 'ok', parts,
    lastRun: now, lastOk: okAny ? now : (prev?.lastOk || null), lastChange: (newItems.length || !prev) ? now : (prev?.lastChange || now),
    ms: Date.now() - t0, items: keep ? prev.items : out,
  };
  save();
  if (okAny) setImmediate(() => { try { require('./reader').prefetch(lv.sources[key].items).catch(() => { }); } catch { } });   // tam metni arka planda önbelleğe al (nazik hız sınırıyla)
  bus.emit('scan', { source: key, status: lv.sources[key].status, count: lv.sources[key].items.length, newCount: newItems.length, at: now });
  if (newItems.length && hooks.onNewItems) { try { hooks.onNewItems(newItems, key); } catch (e) { console.error('onNewItems', e); } }
  return { newItems };
}

const hooks = {};
function rule(item) {
  item.rule = RULE[item.type] || 'info';
  if (item.type === 'DEL') item.vesselWarning = !!(item.hasVessel || (item.entities || []).some(e => e.type === 'vessel' || (e.imo && e.imo.length)));
  return item;
}
const baseCache = new Map();
/* Müşteri tabanı kontrolü kiracıya özeldir: yalnızca istek anında, ilgili kuruluşun verisiyle hesaplanır */
function withBase(it) {
  if (!['ADD', 'DEL'].includes(it.type) || !(it.entities || []).length) return it;
  let thr = 85, sha = '', has = false;
  try { thr = store.settings().matchThreshold; const c = store.customers(); sha = c.meta?.sha || ''; has = c.rows.length > 0; } catch { return it; }
  if (!has) return { ...it, baseCheck: { state: 'unavailable', matches: [] } };
  const key = store.orgId() + '|' + sha + '|' + thr + '|' + it.id;
  let bc = baseCache.get(key);
  if (!bc) {
    const all = []; for (const e of it.entities) all.push(...C.checkEntity(e, thr));
    const seen = new Map(); for (const m of all) { const k = m.customerId + '|' + m.entity; if (!seen.has(k) || seen.get(k).score < m.score) seen.set(k, m); }
    const matches = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 12);
    bc = { state: matches.length ? 'possible' : 'none', matches, checkedAt: new Date().toISOString(), customersSha: sha };
    if (baseCache.size > 20000) baseCache.clear(); baseCache.set(key, bc);
  }
  return { ...it, baseCheck: bc };
}
function reenrichAll() { bus.emit('scan', { source: '*', reenriched: true, at: new Date().toISOString() }, { orgId: store.orgId() }); }

function rawItems() { const lv = loadLive(); const out = []; for (const k of ORDER) for (const it of (lv.sources[k]?.items || [])) out.push(it); return out; }
function items(opts = {}) {
  const lv = loadLive(); let out = [];
  const w = opts.all ? null : orgWindow();
  for (const k of ORDER) for (const it of (lv.sources[k]?.items || [])) if (!w || it.date >= w.start) out.push(withBase(it));
  const typeRank = { ADD: 0, DEL: 1, UPD: 2, GL: 3, ENF: 4, INFO: 5 };
  out.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (typeRank[a.type] - typeRank[b.type]));
  return out;
}
function sourceStatuses() {
  const lv = loadLive(); const out = {};
  for (const k of ORDER) { const s = lv.sources[k]; out[k] = s ? { key: k, status: s.status, lastRun: s.lastRun, lastOk: s.lastOk, lastChange: s.lastChange, parts: s.parts, count: s.items.length, ms: s.ms } : { key: k, status: 'pending', parts: {}, count: 0 }; }
  return out;
}
module.exports = { LISTS_EXTRA, loadLive, refreshSource, items, rawItems, withBase, sourceStatuses, reenrichAll, window: window_, orgWindow, RULE, ORDER, hooks, rule };
