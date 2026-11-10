'use strict';
/* Birleşik varlık deposu (çekirdek): tüm resmî listelerdeki kişi/kuruluş/gemi/hava aracı kayıtlarının normalleştirilmiş, kaynak izli,
 * değişiklik geçmişli hâli. Kayıt = (kaynak, kimlik). Her kayıt: adlar+takma adlar, tür, program, tanımlayıcılar (IMO, BM ref.), liste menşei,
 * ilk görülme / son görülme / çıkarılma tarihi. Her senkronizasyonda fark çıkarılır ve değişiklik günlüğüne eklenir.
 * Kayıtlar kaynaklar arası "aynı varlık" kümelerine IMO, BM referansı veya katlanmış ad+tür ile bağlanır. */
const store = require('./store');
const U = require('./util');
const M = require('./match');
const L = require('./lists');
const P = require('./platform');

const FILE = 'entity-store.json', CH = 'entity-changes.json', CAP = 30000;
let mem = null, changes = null, nfIndex = null;

function load() {
  if (mem) return mem;
  mem = store.readCache(FILE, null) || { version: 1, recs: {}, sources: {} };
  changes = store.readCache(CH, []);
  return mem;
}
function save() { store.writeCache(FILE, mem); store.writeCache(CH, changes.slice(0, CAP)); }
const today = () => U.todayISO(P.tz);
const fpOf = e => U.sha256([e.n.join('|'), e.c || '', e.u || '', e.ver || '', (e.imo || []).join(','), e.ref || e.un || ''].join('#')).slice(0, 12);
function toRec(e, date, baseline) {
  const r = { k: e.s + ':' + e.id, s: e.s, id: e.id, n: e.n.slice(0, 10), t: e.t, c: e.c || '', d: e.d || '', u: e.u || '', fs: baseline && e.d ? e.d : date, ls: date, rm: null, fp: fpOf(e) };
  if (e.imo?.length) r.imo = e.imo; const ref = e.ref || e.un; if (ref) r.ref = String(ref).slice(0, 60); if (e.cty) r.cty = e.cty;
  return r;
}
function diffFields(a, b) { const f = []; if (a.n.join('|') !== b.n.join('|')) f.push('names'); if (a.c !== b.c) f.push('programme'); if ((a.imo || []).join() !== (b.imo || []).join()) f.push('imo'); if (a.u !== b.u) f.push('updated'); if ((a.ref || '') !== (b.ref || '')) f.push('ref'); return f.length ? f : ['details']; }

/* Bir kaynağın önbellekteki listesini depoya işle. İlk işleme temel çizgidir (değişiklik günlüğüne yazılmaz). */
function ingest(src) {
  const st = load(); const l = L.load(src); if (!l) return { skipped: true };
  const date = today(); const now = new Date().toISOString(); const first = !st.sources[src];
  const seen = new Set(); let added = 0, updated = 0, removed = 0, readded = 0;
  for (const e of l.entries) {
    const k = e.s + ':' + e.id; seen.add(k); const old = st.recs[k];
    if (!old) { st.recs[k] = toRec(e, date, first); if (!first) { added++; changes.unshift({ ts: now, k, s: src, name: e.n[0], t: e.t, c: e.c || '', kind: 'added' }); } continue; }
    const fp = fpOf(e);
    if (old.rm) { const r = toRec(e, date, false); r.fs = old.fs; st.recs[k] = r; readded++; changes.unshift({ ts: now, k, s: src, name: e.n[0], t: e.t, c: e.c || '', kind: 'readded' }); continue; }
    old.ls = date;
    if (old.fp !== fp) { const nr = toRec(e, date, false); const f = diffFields(old, nr); nr.fs = old.fs; st.recs[k] = nr; updated++; changes.unshift({ ts: now, k, s: src, name: e.n[0], t: e.t, c: e.c || '', kind: 'updated', f }); }
  }
  for (const k of Object.keys(st.recs)) { const r = st.recs[k]; if (r.s === src && !r.rm && !seen.has(k)) { r.rm = date; removed++; changes.unshift({ ts: now, k, s: src, name: r.n[0], t: r.t, c: r.c, kind: 'removed' }); } }
  st.sources[src] = { ingestedAt: now, baselineAt: first ? now : st.sources[src].baselineAt, count: l.entries.length, fetchedAt: l.fetchedAt };
  if (changes.length > CAP) changes.length = CAP;
  nfIndex = null; save();
  return { src, first, added, updated, removed, readded, total: l.entries.length };
}
function ingestAll() { const out = []; for (const s of Object.keys(L.DEFS)) { const st = load(); const l = L.load(s); if (!l) continue; if (!st.sources[s] || st.sources[s].fetchedAt !== l.fetchedAt) out.push(ingest(s)); } return out; }

function index() {
  if (nfIndex) return nfIndex; const st = load(); const nf = [], imo = new Map(), ref = new Map(), name = new Map();
  for (const r of Object.values(st.recs)) {
    const f = r.n.map(M.fold).join(' | '); nf.push([f, r]);
    for (const i of r.imo || []) { if (!imo.has(i)) imo.set(i, []); imo.get(i).push(r); }
    if (r.ref && /^[A-Z]{2,4}[.\w-]*\d/i.test(r.ref)) { const x = r.ref.toUpperCase(); if (!ref.has(x)) ref.set(x, []); ref.get(x).push(r); }
    const pn = M.fold(r.n[0]) + '#' + r.t; if (pn.length > 8) { if (!name.has(pn)) name.set(pn, []); name.get(pn).push(r); }
  }
  nfIndex = { nf, imo, ref, name }; return nfIndex;
}
function cluster(r) {
  const ix = index(); const out = new Map([[r.k, r]]);
  for (const i of r.imo || []) for (const x of ix.imo.get(i) || []) out.set(x.k, x);
  if (r.ref) for (const x of ix.ref.get(r.ref.toUpperCase()) || []) out.set(x.k, x);
  for (const x of ix.name.get(M.fold(r.n[0]) + '#' + r.t) || []) out.set(x.k, x);
  return [...out.values()];
}
const view = r => ({ key: r.k, src: r.s, srcLabel: L.SRC_LABEL[r.s], id: r.id, name: r.n[0], aliases: r.n.slice(1, 8), type: r.t, typeLabel: L.TYPE_LABEL[r.t], programme: r.c, listed: r.d, updated: r.u, imo: r.imo || [], ref: r.ref || '', country: r.cty || '', firstSeen: r.fs, lastSeen: r.ls, removed: r.rm, url: L.entryUrl({ s: r.s, id: r.id }) });
function search({ q = '', src = '', type = '', status = '', programme = '', limit = 50, offset = 0 } = {}) {
  load(); const ix = index(); const f = M.fold(q).trim(); let rows = ix.nf;
  if (f) { const toks = f.split(/\s+/).filter(Boolean); rows = rows.filter(([n]) => toks.every(t => n.includes(t))); }
  rows = rows.map(x => x[1]);
  if (src) rows = rows.filter(r => r.s === src); if (type) rows = rows.filter(r => r.t === type);
  if (status === 'active') rows = rows.filter(r => !r.rm); else if (status === 'removed') rows = rows.filter(r => r.rm);
  if (programme) rows = rows.filter(r => (r.c || '').toLowerCase().includes(programme.toLowerCase()));
  rows.sort((a, b) => (b.ls > a.ls ? 1 : -1) || (b.fs > a.fs ? 1 : -1));
  return { total: rows.length, items: rows.slice(offset, offset + limit).map(view) };
}
function get(key) {
  const st = load(); const r = st.recs[key]; if (!r) return null; const rel = cluster(r); const keys = new Set(rel.map(x => x.k));
  return { entity: view(r), aliases: r.n, related: rel.filter(x => x.k !== r.k).map(view), history: changes.filter(c => keys.has(c.k)).slice(0, 100) };
}
function feed({ since = '', src = '', kind = '', limit = 100 } = {}) { load(); let c = changes; if (since) c = c.filter(x => x.ts >= since); if (src) c = c.filter(x => x.s === src); if (kind) c = c.filter(x => x.kind === kind); return c.slice(0, limit); }
function stats() {
  const st = load(); const per = {}; let total = 0, active = 0;
  for (const r of Object.values(st.recs)) { const p = per[r.s] = per[r.s] || { src: r.s, label: L.SRC_LABEL[r.s], records: 0, active: 0, removed: 0, p: 0, e: 0, v: 0, a: 0 }; p.records++; r.rm ? p.removed++ : p.active++; p[r.t] = (p[r.t] || 0) + 1; total++; if (!r.rm) active++; }
  for (const s of Object.keys(per)) Object.assign(per[s], { ingestedAt: st.sources[s]?.ingestedAt, baselineAt: st.sources[s]?.baselineAt, lastChange: (changes.find(c => c.s === s) || {}).ts || null });
  const since = new Date(Date.now() - 30 * 864e5).toISOString(); const k30 = { added: 0, updated: 0, removed: 0, readded: 0 }; for (const c of changes) if (c.ts >= since) k30[c.kind]++;
  return { total, active, removed: total - active, sources: Object.values(per), changes30d: k30, changeLogSize: changes.length };
}
module.exports = { ingest, ingestAll, search, get, feed, stats, cluster };
