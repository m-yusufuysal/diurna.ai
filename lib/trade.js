'use strict';
const fs = require('fs'), path = require('path');
const L = require('./lists');
const M = require('./match');
const I = require('./i18n');
const store = require('./store');
const U = require('./util');

const data = n => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', n), 'utf8'));
let HS, VES, FATF, GATES, COUNTRIES;
function load() { if (!HS) { HS = data('hs-dataset.json'); VES = data('eu-vessels.json'); FATF = data('fatf.json'); GATES = data('border-gates.json'); } }
function countries() {
  if (COUNTRIES) return COUNTRIES;
  const tr = new Intl.DisplayNames(['tr'], { type: 'region' }), en = new Intl.DisplayNames(['en'], { type: 'region' });
  COUNTRIES = [];
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const c = String.fromCharCode(a, b); let e; try { e = en.of(c); } catch { continue; }
    if (!e || e === c || /Unknown Region/i.test(e)) continue;
    COUNTRIES.push({ iso: c, en: e, tr: tr.of(c) });
  }
  return COUNTRIES;
}
function findCountry(q) {
  q = (q || '').trim(); if (!q) return null; const f = M.fold(q).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const list = countries();
  const alias = { 'kuzey kore': 'KP', 'north korea': 'KP', dprk: 'KP', 'laos': 'LA', 'rusya': 'RU', 'russia': 'RU', 'iran': 'IR', 'suriye': 'SY', 'vietnam': 'VN', 'viet nam': 'VN', 'turkey': 'TR', 'turkiye': 'TR', 'birlesik arap emirlikleri': 'AE', 'uae': 'AE', 'bae': 'AE', 'abd': 'US', 'usa': 'US', 'ingiltere': 'GB', 'uk': 'GB', 'burma': 'MM', 'myanmar': 'MM' };
  if (alias[f]) return list.find(c => c.iso === alias[f]);
  let hit = list.find(c => c.iso.toLowerCase() === f) || list.find(c => M.fold(c.tr) === f || M.fold(c.en) === f);
  if (!hit && f.length >= 3) hit = list.find(c => M.fold(c.tr).startsWith(f) || M.fold(c.en).startsWith(f));
  return hit || null;
}
function fatfStatus(iso) {
  load(); if (FATF.black.some(c => c.iso === iso)) return 'black'; if (FATF.grey.some(c => c.iso === iso)) return 'grey'; return 'none';
}
function gatesFor(c) {
  load(); const tr = M.fold(c.tr).replace(/[^a-z]/g, '');
  const map = { irak: 'irak', iran: 'iran', suriye: 'suriye', gurcistan: 'gurcistan', bulgaristan: 'bulgaristan', yunanistan: 'yunanistan', nahcivan: 'nahcivan' };
  return GATES.gates.filter(g => M.fold(g.neighbour).replace(/[^a-z]/g, '') === tr || (c.iso === 'AZ' && /nahcivan/i.test(M.fold(g.neighbour))));
}

function checkHS(raw) {
  load();
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 2) return { input: raw, error: 'short' };
  const h4 = digits.slice(0, 4); const matches = [];
  for (const it of HS.items) {
    let rel = false, exact = false;
    if (it.chapter) { rel = digits.startsWith(it.digits); exact = false; }
    else if (it.h4 === h4) {
      rel = true;
      if (digits.length > 4 && it.digits.length > 4) { const n = Math.min(digits.length, it.digits.length); exact = digits.slice(0, n) === it.digits.slice(0, n); }
      else if (it.digits.length === 4) exact = true;     // başlığın tamamı kapsamda (ex yoksa)
    }
    if (rel) matches.push({ annex: it.annex, article: it.article, part: it.part, code: it.code, ex: it.ex, desc: it.desc, exact, chapter: it.chapter, level: it.digits.length });
  }
  // eklere göre grupla
  const g = new Map();
  for (const m of matches) { if (!g.has(m.annex)) g.set(m.annex, []); g.get(m.annex).push(m); }
  const groups = [...g.entries()].map(([annex, list]) => {
    const meta = HS.annexes[annex];
    const strong = list.some(x => x.exact && !(x.ex && x.level === 4));
    return { annex, article: meta.art, labelTr: meta.tr, kind: meta.kind, quote: meta.quote, items: list.slice(0, 30), total: list.length, strength: strong ? 'strong' : 'heading' };
  });
  return {
    input: raw, digits, h4, groups, hit: groups.length > 0, strongest: groups.some(x => x.strength === 'strong') ? 'strong' : groups.length ? 'heading' : 'none',
    links: { taric: `https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en&Taric=${encodeURIComponent((digits + '0000000000').slice(0, 10))}`, reg833: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A${HS.celex}`, reg428: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32022R0428', dualuse: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A02021R0821-20241108' },
  };
}

function checkIMO(raw) {
  load();
  const imo = String(raw || '').replace(/\D/g, '').slice(0, 7);
  if (imo.length !== 7) return { input: raw, error: 'format' };
  const eu = VES.vessels.filter(v => v.imo === imo);
  const lists = L.findByImo(imo);
  return {
    input: raw, imo, checksumOk: M.imoValid(imo), eu: eu.map(v => ({ ...v, annex: 'XLII', article: '3s', celex: VES.celex })), lists,
    listed: eu.length > 0 || lists.length > 0,
    listsReady: Object.keys(L.meta()).length > 0,
    links: { vesselfinder: `https://www.vesselfinder.com/tr/vessels/details/${imo}`, seasearcher: 'https://www.seasearcher.com/vessels/', ofacSearch: 'https://sanctionssearch.ofac.treas.gov/', ukSearch: 'https://search-uk-sanctions-list.service.gov.uk/', reg833: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A${VES.celex}` },
  };
}
function checkCountry(raw) {
  load();
  const c = findCountry(raw); if (!c) return { input: raw, error: 'unknown' };
  const st = fatfStatus(c.iso);
  return { input: raw, country: c, fatf: st, fatfDate: FATF.statementDateISO, gates: gatesFor(c), link: FATF.verifiedFrom };
}

/* Tek ekran ön risk özeti + analist notu taslağı */
function assess(body, lang) {
  load(); lang = lang || 'tr'; const T = I.dict(lang);
  const hs = (body.hs || []).filter(Boolean).map(checkHS);
  const imos = (body.imo || []).filter(Boolean).map(checkIMO);
  const ctrs = (body.countries || []).filter(Boolean).map(checkCountry);
  const names = (body.parties || []).filter(Boolean);
  const partyHits = names.map(n => ({ name: n, hits: L.orgIndex().search(n, { threshold: store.settings().matchThreshold, limit: 4 }).map(h => ({ score: h.score, reasons: h.reasons, entry: L.present(h.entry) })) }));
  let pts = 0; const flags = [];
  for (const h of hs) if (h.hit) { const strong = h.strongest === 'strong'; pts += strong ? 3 : 2; flags.push({ k: strong ? 'hs_strong' : 'hs_heading', input: h.input, annexes: h.groups.map(g => 'Ek ' + g.annex + ' (Md. ' + g.article + ')') }); }
  for (const v of imos) if (!v.error) { if (v.eu.length) { pts += 5; flags.push({ k: 'imo_eu', input: v.imo }); } if (v.lists.length) { pts += 5; flags.push({ k: 'imo_list', input: v.imo, lists: [...new Set(v.lists.map(x => x.srcLabel))] }); } if (!v.checksumOk) { pts += 1; flags.push({ k: 'imo_checksum', input: v.imo }); } }
  for (const c of ctrs) if (!c.error) { if (c.fatf === 'black') { pts += 5; flags.push({ k: 'fatf_black', input: c.country.en }); } else if (c.fatf === 'grey') { pts += 2; flags.push({ k: 'fatf_grey', input: c.country.en }); } }
  for (const p of partyHits) if (p.hits.length) { pts += 5; flags.push({ k: 'party', input: p.name, score: p.hits[0].score }); }
  const level = pts >= 5 ? 'critical' : pts >= 4 ? 'high' : pts >= 2 ? 'medium' : 'low';
  const note = draftNote({ hs, imos, ctrs, partyHits, flags, level }, lang, body);
  return { level, points: pts, flags, hs, imos, countries: ctrs, parties: partyHits, note, generatedAt: new Date().toISOString(), lang };
}
function draftNote(r, lang, body) {
  const tr = lang === 'tr'; const T = I.dict(lang); const L_ = [];
  L_.push(`${T.tradeNoteTitle} – ${U.trDateShort(U.todayISO(require('./platform').tz))}`);
  if (body.ref) L_.push(`${tr ? 'Referans / işlem' : 'Reference / transaction'}: ${body.ref}`);
  L_.push(`${tr ? 'Genel ön risk seviyesi' : 'Overall pre-risk level'}: ${T.riskLevels[r.level]}`);
  L_.push('');
  for (const h of r.hs) {
    if (h.error) continue;
    if (!h.hit) L_.push(tr ? `• GTİP/HS ${h.input} (ilk 4 hane ${h.h4}): AB Reg. 833/2014 ekleri taranan veri setinde eşleşme bulunmadı.` : `• HS ${h.input} (first 4 digits ${h.h4}): no match in the scanned Reg. 833/2014 annex dataset.`);
    else L_.push((tr ? `• GTİP/HS ${h.input} (ilk 4 hane ${h.h4}): ` : `• HS ${h.input} (first 4 digits ${h.h4}): `) + h.groups.map(g => `${tr ? 'Ek' : 'Annex'} ${g.annex} (${tr ? 'Md.' : 'Art.'} ${g.article}, ${g.strength === 'strong' ? (tr ? 'kod düzeyinde eşleşme' : 'code-level match') : (tr ? 'başlık düzeyinde, kısmi kapsam olabilir' : 'heading-level, partial coverage possible')})`).join('; ') + (tr ? '. Kesin tespit için CN/TARIC 8 hane ve ek metni doğrulanmalıdır.' : '. Confirm at CN/TARIC 8-digit level against the annex text.'));
  }
  for (const v of r.imos) {
    if (v.error) { L_.push(tr ? `• IMO ${v.input}: geçersiz biçim.` : `• IMO ${v.input}: invalid format.`); continue; }
    const hits = [];
    if (v.eu.length) hits.push(`AB Reg. 833/2014 ${tr ? 'Ek' : 'Annex'} XLII (${tr ? 'Md.' : 'Art.'} 3s) – ${v.eu[0].name}`);
    for (const l of v.lists) hits.push(`${l.srcLabel}: ${l.name}`);
    L_.push(hits.length ? `• IMO ${v.imo}: ${tr ? 'yaptırım listelerinde kayıt bulundu' : 'found on sanctions lists'} – ${hits.join('; ')}.` : (tr ? `• IMO ${v.imo}: indirilen resmî listelerde (OFAC/UK/AB Ek XLII) kayıt bulunmadı; VesselFinder/Seasearcher ile bayrak, sahip ve rota geçmişi ayrıca doğrulanmalıdır.` : `• IMO ${v.imo}: no entry in the downloaded official lists (OFAC/UK/EU Annex XLII); verify flag, ownership and voyage history with VesselFinder/Seasearcher.`));
  }
  for (const c of r.ctrs) {
    if (c.error) { L_.push(tr ? `• Ülke “${c.input}” tanınamadı.` : `• Country “${c.input}” not recognised.`); continue; }
    const nm = tr ? c.country.tr : c.country.en;
    L_.push(`• ${nm}: ` + (c.fatf === 'black' ? (tr ? 'FATF yüksek riskli yargı alanı (karşı tedbir çağrısı).' : 'FATF high-risk jurisdiction (call for action).') : c.fatf === 'grey' ? (tr ? 'FATF artırılmış izleme listesinde (gri liste).' : 'FATF increased-monitoring list (grey list).') : (tr ? 'FATF listelerinde yer almıyor.' : 'not on FATF lists.')) + ` (${tr ? 'FATF açıklama tarihi' : 'FATF statement'} ${c.fatfDate})`);
  }
  for (const p of r.partyHits) L_.push(p.hits.length ? `• ${tr ? 'Taraf' : 'Party'} “${p.name}”: ${tr ? 'olası liste eşleşmesi' : 'possible list match'} – ${p.hits[0].entry.srcLabel}: ${p.hits[0].entry.name} (${tr ? 'skor' : 'score'} ${p.hits[0].score}).` : `• ${tr ? 'Taraf' : 'Party'} “${p.name}”: ${tr ? 'OFAC/UK/AB/BM listelerinde eşleşme yok (World-Check ayrıca kontrol edilmelidir).' : 'no match on OFAC/UK/EU/UN lists (check World-Check separately).'}`);
  L_.push('');
  L_.push(tr ? 'Gerekçe: Yukarıdaki bulgular otomatik ön tarama sonucudur; nihai değerlendirme ve karar analisttedir.' : 'Rationale: the findings above are the result of an automated pre-screen; the final assessment and decision rest with the analyst.');
  return L_.join('\n');
}
function searchHS(q) {
  load(); const digits = String(q || '').replace(/\D/g, ''); const text = M.fold(q || '');
  const out = [];
  for (const it of HS.items) {
    if (digits.length >= 2 ? (it.digits.startsWith(digits) || digits.startsWith(it.digits.slice(0, 4))) : (text.length > 2 && M.fold(it.desc).includes(text))) out.push(it);
    if (out.length >= 80) break;
  }
  return out;
}
function meta() { load(); return { celex: HS.celex, generatedAt: HS.generatedAt, source: HS.source, itemCount: HS.items.length, annexes: Object.entries(HS.annexes).map(([k, v]) => ({ annex: k, article: v.art, tr: v.tr, kind: v.kind, count: HS.items.filter(i => i.annex === k).length })), vessels: VES.vessels.length }; }
module.exports = { checkHS, checkIMO, checkCountry, assess, searchHS, meta, fatf: () => { load(); return FATF; }, gates: () => { load(); return GATES; }, countries, findCountry, fatfStatus };
