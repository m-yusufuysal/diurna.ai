/* Tarayıcı motoru çekirdeği (build-static-demo.js, lib/*.js saf modüllerinin sonuna ekler).
 * Node bağımlılıklarını (fs, path, crypto, fetcher, store, lists, platform) taklit eder; sunucu mantığı AYNEN çalışır. */
const ENG = {
  base: '', files: {}, listMeta: {}, entries: [], index: null, ready: null,
  settings: { matchThreshold: 85, fourEyes: true, policyReviewMonths: 12, boardListMaxAgeMonths: 12, shareholdingMaxAgeMonths: 12, listsEnabled: [] },
  dd: null, customers: { meta: null, rows: [] }, blocklist: [],
};
function hex(s, n) { let out = ''; for (let k = 0; out.length < n; k++) { let h = 0x811c9dc5 ^ (k * 0x9e3779b1); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } out += (h >>> 0).toString(16).padStart(8, '0'); } return out.slice(0, n); }
const SRC_LABEL = { internal: 'Kurum içi liste', ofac: 'OFAC SDN', uk: 'UK Sanctions List', un: 'BM Konsolide', eu: 'AB Konsolide', tr: 'MASAK (OpenSanctions)', ofacc: 'OFAC Consolidated (non-SDN)', csl: 'BIS / ABD Ticaret CSL', ca: 'Kanada SEMA', ch: 'İsviçre SECO' };
const PAGE = { ofacc: 'https://ofac.treasury.gov/consolidated-sanctions-list-non-sdn-lists', csl: 'https://www.trade.gov/consolidated-screening-list', ca: 'https://www.international.gc.ca/world-monde/international_relations-relations_internationales/sanctions/consolidated-consolide.aspx?lang=eng', ch: 'https://www.sesam.search.admin.ch/sesam-search-web/pages/search.xhtml' };
const TYPE_LABEL = { p: 'Kişi', e: 'Kuruluş', v: 'Gemi', a: 'Hava aracı' };
function entryUrl(e) {
  if (e.s === 'ofac') return 'https://sanctionssearch.ofac.treas.gov/Details.aspx?id=' + e.id;
  if (e.s === 'uk') return 'https://search-uk-sanctions-list.service.gov.uk/';
  if (e.s === 'un') return 'https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list';
  if (e.s === 'eu') return e.url || 'https://www.sanctionsmap.eu/';
  return PAGE[e.s] || '';
}
function present(e) { return { src: e.s, srcLabel: SRC_LABEL[e.s] || e.s, id: e.id, name: e.n[0], aliases: e.n.slice(1, 6), type: TYPE_LABEL[e.t], program: e.c, listed: e.d || '', updated: e.u || '', imo: e.imo || [], url: entryUrl(e), vessel: e.v || null, ref: e.ref || e.un || '' }; }
const L = {
  DEFS: {}, SRC_LABEL, TYPE_LABEL, present, entryUrl,
  meta: () => ENG.listMeta,
  findByImo(imo) { imo = String(imo); return ENG.entries.filter(e => e.imo && e.imo.includes(imo)).map(present); },
  orgIndex() {
    const en = new Set(ENG.settings.listsEnabled && ENG.settings.listsEnabled.length ? ENG.settings.listsEnabled : Object.keys(ENG.listMeta));
    return { search(name, opts = {}) { const limit = opts.limit ?? 8; return ENG.index.search(name, { ...opts, limit: limit * 3 }).filter(h => en.has(h.entry.s)).slice(0, limit); } };
  },
  totalCount: () => ENG.entries.length,
};
const stubs = {
  fs: { readFileSync(p) { const b = String(p).split('/').pop(); if (b in ENG.files) return ENG.files[b]; const e = new Error('ENOENT ' + p); e.code = 'ENOENT'; throw e; }, existsSync: p => String(p).split('/').pop() in ENG.files },
  path: { join: (...a) => a.join('/').replace(/\/+/g, '/'), basename: p => String(p).split('/').pop(), resolve: (...a) => a.join('/') },
  crypto: {
    createHash() { let s = ''; return { update(x) { s += typeof x === 'string' ? x : ''; return this; }, digest() { return hex(s, 64); } }; },
    randomBytes(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return { toString: () => [...a].map(b => b.toString(16).padStart(2, '0')).join('') }; },
  },
  fetcher: { UA: () => 'Diurna-demo', text() { throw new Error('demo'); }, request() { throw new Error('demo'); } },
  platform: { tz: 'Europe/Istanbul' },
  lists: L,
  store: {
    settings: () => ENG.settings, dd: () => ENG.dd, saveDD: d => { ENG.dd = d; }, customers: () => ENG.customers, saveCustomers: c => { ENG.customers = c; },
    orgId: () => 'demo', blocklist: () => ENG.blocklist, runAs: (id, fn) => fn(),
  },
};
const cache = {};
function req(name) {
  name = String(name).replace(/^\.\//, '');
  if (stubs[name]) return stubs[name];
  if (cache[name]) return cache[name].exports;
  if (!defs[name]) throw new Error('demo: modül yok: ' + name);
  const m = { exports: {} }; cache[name] = m; defs[name](m, m.exports, req, '/lib'); return m.exports;
}
const tick = () => new Promise(r => setTimeout(r, 0));
/* Veri dosyaları + liste indeksi (ilk taramada tembel yüklenir) */
async function init(base, onProgress) {
  if (ENG.ready) return ENG.ready;
  ENG.ready = (async () => {
    ENG.base = base; const get = async (f, txt) => { const r = await fetch(base + f); if (!r.ok) throw new Error(f + ' ' + r.status); return txt ? r.text() : r.json(); };
    const idx = await get('lists/index.json'); ENG.listMeta = idx.meta || {};
    for (const f of ['hs-dataset.json', 'border-gates.json', 'fatf.json', 'eu-vessels.json', 'jurisdictions.json', 'sample-customers.csv']) { try { ENG.files[f] = await get(f, true); } catch { } }
    const M = req('match'); ENG.index = new M.NameIndex(); const srcs = Object.keys(idx.counts); let done = 0;
    const lists = await Promise.all(srcs.map(s => get('lists/' + s + '.json')));
    const total = srcs.reduce((a, s) => a + idx.counts[s], 0);
    for (const l of lists) { let n = 0; for (const e of l.entries) { ENG.entries.push(e); ENG.index.add(e); if (++n % 1500 === 0) { done += 1500; onProgress && onProgress(Math.min(1, done / total)); await tick(); } } }
    onProgress && onProgress(1);
    return ENG;
  })();
  return ENG.ready;
}
window.DemoEngine = { ENG, req, init, L, present };
