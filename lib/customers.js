'use strict';
/* Müşteri tabanı: CSV içe aktarma ve yerel indeks. Veri yalnızca bu bilgisayarda (data/state/customers.json) tutulur. */
const fs = require('fs'), path = require('path');
const store = require('./store');
const U = require('./util');
const M = require('./match');

const COL = {
  id: ['musteri_no', 'musteri no', 'müşteri no', 'customer_id', 'customer id', 'id', 'cif', 'no'],
  name: ['ad_unvan', 'ad unvan', 'ad/unvan', 'unvan', 'ünvan', 'ad', 'isim', 'name', 'full_name', 'customer_name', 'ad soyad'],
  type: ['tur', 'tür', 'type', 'musteri_turu', 'segment'],
  imo: ['imo', 'imo_no', 'imo no', 'imo numarasi'],
  country: ['ulke', 'ülke', 'country', 'uyruk'],
  taxId: ['kimlik_no', 'kimlik no', 'vkn', 'tckn', 'tax_id', 'id_number', 'vergi no'],
  yob: ['dogum_yili', 'doğum yılı', 'dogum yili', 'yob', 'birth_year'],
  owners: ['ortaklar', 'ortak', 'sahipler', 'ubo', 'owners', 'beneficial_owners', 'gercek_faydalanici'],
  branch: ['sube', 'şube', 'branch', 'sube_kodu'],
  aliases: ['diger_adlar', 'diğer adlar', 'alias', 'aliases', 'takma_ad', 'aka'],
};
let cache = { idx: null, stamp: null };

const FIELDS = ['id', 'name', 'type', 'imo', 'country', 'taxId', 'yob', 'aliases', 'owners', 'branch'];
const TEMPLATE = 'musteri_no;ad_unvan;tur;imo;ulke;kimlik_no;dogum_yili;diger_adlar;ortaklar;sube\r\nORNEK-001;Örnek Ticaret A.Ş.;kurum;;TR;1234567890;;Ornek Trading;Ali Örnek|Veli Örnek;b-1\r\nORNEK-002;Ayşe Örnek;kisi;;TR;;1980;;;b-1\r\nORNEK-003;M/V ÖRNEK GEMİ;gemi;9999999;PA;;;;;\r\n';
function readRows(text) {
  text = String(text || '').replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0] || ''; const sep = [';', ',', '\t', '|'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  return { rows: U.parseCSV(text, sep), sep };
}
function guessMapping(headRow) {
  const head = headRow.map(h => M.fold(h).trim().replace(/\s+/g, ' ')); const map = {};
  for (const [f, keys] of Object.entries(COL)) { for (const k of keys) { const i = head.indexOf(M.fold(k)); if (i >= 0) { map[f] = i; break; } } if (!(f in map)) map[f] = -1; }
  return map;
}
/* Önizleme: başlıklar, ayraç, tahmin edilen eşleme ve ilk satırlar */
function preview(text) {
  const { rows, sep } = readRows(text); if (rows.length < 1) throw new Error('empty');
  return { delimiter: sep, headers: rows[0], mapping: guessMapping(rows[0]), sample: rows.slice(1, 6), total: Math.max(0, rows.length - 1) };
}
function parse(text, filename, isSample, mapping) {
  const { rows } = readRows(text);
  if (rows.length < 2) throw Object.assign(new Error('CSV boş veya başlık satırı yok'), { code: 'empty' });
  const ix = { ...guessMapping(rows[0]), ...(mapping || {}) };
  if (ix.name == null || ix.name < 0) throw Object.assign(new Error('“Ad / Unvan” sütunu seçilmedi'), { code: 'no_name', headers: rows[0] });
  const out = [], errors = [], warnings = []; const ids = new Set();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; if (row.every(c => !String(c).trim())) continue; const g = k => (ix[k] >= 0 && ix[k] != null ? (row[ix[k]] || '').trim() : '');
    const name = g('name'); if (!name) { errors.push({ row: r + 1, code: 'name_empty', value: '' }); continue; }
    if (name.length > 250) { errors.push({ row: r + 1, code: 'name_long', value: name.slice(0, 40) }); continue; }
    const t = M.fold(g('type')); const imo = g('imo').replace(/\D/g, '').slice(0, 7);
    if (g('imo') && !M.imoValid(imo)) warnings.push({ row: r + 1, code: 'imo_invalid', value: g('imo') });
    if (g('type') && !/gemi|vessel|ship|kurum|tuzel|entity|corp|sirket|company|org|kisi|gercek|person|individual/.test(t)) warnings.push({ row: r + 1, code: 'type_unknown', value: g('type') });
    let id = g('id') || 'R' + r; if (ids.has(id)) { warnings.push({ row: r + 1, code: 'id_dup', value: id }); id = id + '#' + r; } ids.add(id);
    const type = /gemi|vessel|ship/.test(t) ? 'vessel' : /kurum|tuzel|entity|corp|sirket|company|org/.test(t) ? 'entity' : /kisi|gercek|person|individual/.test(t) ? 'person' : (imo ? 'vessel' : '');
    out.push({ id, name, type, imo, country: g('country'), taxId: g('taxId'), yob: g('yob'), aliases: g('aliases') ? g('aliases').split(/[|,]/).map(s => s.trim()).filter(Boolean) : [], owners: g('owners') ? g('owners').split(/[|]/).map(s => s.replace(/%\s*\d+([.,]\d+)?/g, '').trim()).filter(Boolean).slice(0, 10) : [], branch: g('branch') });
  }
  return { meta: { filename: filename || 'musteri.csv', uploadedAt: new Date().toISOString(), count: out.length, sample: !!isSample, sha: U.sha256(text).slice(0, 12), skipped: errors.length, warned: warnings.length }, rows: out, errors: errors.slice(0, 200), warnings: warnings.slice(0, 200) };
}
function save(c) { store.saveCustomers({ meta: c.meta, rows: c.rows }); cache = { idx: null, stamp: null }; }
function loadSample() {
  const t = fs.readFileSync(path.join(__dirname, '..', 'data', 'sample-customers.csv'), 'utf8');
  const c = parse(t, 'ornek-musteriler.csv', true); save(c); return c;
}
function index() {
  const c = store.customers();
  if (cache.idx && cache.stamp === (c.meta && c.meta.uploadedAt)) return cache.idx;
  const ix = new M.NameIndex();
  for (const r of c.rows) { ix.add({ ...r, names: [r.name, ...r.aliases], imo: r.imo || undefined }); (r.owners || []).forEach((o, i) => ix.add({ id: r.id + '~o' + i, name: o, names: [o], type: r.type === 'vessel' ? 'vessel' : 'person', owner: true, parentId: r.id, parentName: r.name })); }
  cache = { idx: ix, stamp: c.meta && c.meta.uploadedAt };
  return ix;
}
function has() { return store.customers().rows.length > 0; }

/* Bir listeleme kaydını (isim + takma adlar + IMO) müşteri tabanıyla karşılaştır */
function checkEntity(ent, threshold) {
  const ix = index(); const res = new Map();
  const names = [ent.name, ...(ent.aliases || [])].filter(Boolean);
  const imo = (ent.imo || []).filter(Boolean);
  for (const n of names.length ? names : ['']) {
    for (const h of ix.search(n, { threshold, imo: imo.length ? imo : undefined, limit: 5 })) {
      const k = h.entry.id; const p = res.get(k);
      if (!p || h.score > p.score) res.set(k, { via: h.entry.owner ? 'owner' : undefined, ownerName: h.entry.owner ? h.entry.name : undefined, customerId: h.entry.parentId || h.entry.id, customerName: h.entry.parentName || h.entry.name, customerType: h.entry.type, customerImo: h.entry.imo, score: h.score, reasons: h.reasons, matchedOn: h.type === 'imo' ? ent.name : n, entity: ent.name });
    }
    if (imo.length && n !== names[0]) { /* IMO sadece bir kez aranır */ imo.length = 0; }
  }
  return [...res.values()].sort((a, b) => b.score - a.score);
}

module.exports = { preview, parse, TEMPLATE, FIELDS, save, loadSample, index, has, checkEntity };
