'use strict';
/* Tüm müşteri tabanının resmî listelere (OFAC/UK/AB/BM) karşı toptan taranması. */
const store = require('./store');
const L = require('./lists');
const M = require('./match');
const bus = require('./bus');
let running = false;

function runFull(threshold) {
  const s = store.settings(); threshold = threshold || s.matchThreshold; const orgId = store.orgId();
  const cust = store.customers();
  if (!cust.rows.length) return null;
  if (running) return store.matchRun();
  running = true;
  try {
    const t0 = Date.now(); const ix = L.orgIndex(); const hits = []; let screened = 0, fpDropped = 0; const lt = store.settings().listThresholds || {}; const gg = store.settings().goodGuys || [];
    for (const c of cust.rows) {
      screened++;
      const cids = SEC.idsOf(c);
      const found = ix.search(c.name, { threshold, imo: c.imo ? [c.imo] : undefined, ids: cids.length ? cids : undefined, limit: 8 });
      let extra = [];
      for (const a of c.aliases || []) extra.push(...ix.search(a, { threshold, limit: 3 }));
      const all = [...found, ...extra]; const seen = new Map();
      for (const h of all) { const k = h.entry.s + h.entry.id; if (!seen.has(k) || seen.get(k).score < h.score) seen.set(k, h); }
      const adj = SEC.adjust(c, [...seen.values()], { thresholdOf: src => lt[src] ?? threshold, goodGuys: gg }); fpDropped += adj.dropped.length;
      const list = adj.hits.slice(0, 6);
      if (list.length) hits.push({ customer: { id: c.id, name: c.name, type: c.type, imo: c.imo, country: c.country }, matches: list.map(h => ({ score: h.score, reasons: h.reasons, via: h.via, how: h.type, entry: L.present(h.entry) })) });
    }
    hits.sort((a, b) => b.matches[0].score - a.matches[0].score);
    const prev = store.matchRun();
    const run = { at: new Date().toISOString(), ms: Date.now() - t0, threshold, screened, hitCount: hits.length, suppressed: fpDropped, customersSha: cust.meta?.sha, lists: L.meta(), hits, sample: !!cust.meta?.sample };
    store.saveMatchRun(run);
    bus.emit('match', { hitCount: run.hitCount, screened, at: run.at, changed: !prev || prev.hitCount !== run.hitCount }, { orgId });
    if (screening.onRun) { try { screening.onRun(run, prev); } catch (e) { console.error(e); } }
    return run;
  } finally { running = false; }
}
const SEC = require('./secondary');
const screening = { runFull, onRun: null };
function runAllOrgs() { for (const o of store.orgs()) store.runAs(o.id, () => { try { runFull(); } catch (e) { console.error('screen', o.id, e.message); } }); }
screening.runAllOrgs = runAllOrgs;
module.exports = screening;
