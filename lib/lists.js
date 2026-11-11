'use strict';
/* Resmî yaptırım listelerinin indirilmesi, normalleştirilmesi, önbelleğe alınması ve günlük anlık-görüntü farkı.
 * Kaynaklar: OFAC SDN (CSV+ALT), UK Sanctions List (XML), BM Konsolide Liste (XML), AB FSF Konsolide Liste (CSV). */
const fs = require('fs');
const store = require('./store');
const U = require('./util');
const M = require('./match');

const DEFS = {
  ofac: { label: 'OFAC SDN', long: 'ABD OFAC – Specially Designated Nationals', url: 'https://sanctionslistservice.ofac.treas.gov/api/download/SDN.CSV', page: 'https://sanctionssearch.ofac.treas.gov/' },
  uk: { label: 'UK Sanctions List', long: 'Birleşik Krallık – UK Sanctions List (FCDO/OFSI)', url: 'https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml', page: 'https://search-uk-sanctions-list.service.gov.uk/' },
  un: { label: 'BM Konsolide Liste', long: 'BM Güvenlik Konseyi Konsolide Yaptırım Listesi', url: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml', page: 'https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list' },
  eu: { label: 'AB Konsolide Liste', long: 'AB Finansal Yaptırımlar Dosyası (FSF) Konsolide Listesi', url: 'https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw', page: 'https://www.sanctionsmap.eu/' },
};
Object.assign(DEFS, {
  ofacc: { label: 'OFAC Consolidated (non-SDN)', long: 'ABD OFAC – Konsolide (SDN dışı) listeler: SSI, NS-MBS, CMIC, PLC, FSE vb.', url: 'https://sanctionslistservice.ofac.treas.gov/api/download/CONS_PRIM.CSV', page: 'https://ofac.treasury.gov/consolidated-sanctions-list-non-sdn-lists' },
  csl: { label: 'BIS / ABD Ticaret CSL', long: 'ABD Konsolide Tarama Listesi (trade.gov): BIS Entity List, Denied Persons, Unverified, MEU; Dışişleri ITAR/ACN', url: process.env.UM_CSL_URL || 'https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.csv', page: 'https://www.trade.gov/consolidated-screening-list' },
  ca: { label: 'Kanada SEMA', long: 'Kanada – Özel Ekonomik Tedbirler Yasası (SEMA) yaptırım listesi', url: 'https://www.international.gc.ca/world-monde/assets/office_docs/international_relations-relations_internationales/sanctions/sema-lmes.xml', page: 'https://www.international.gc.ca/world-monde/international_relations-relations_internationales/sanctions/consolidated-consolide.aspx?lang=eng' },
  ch: { label: 'İsviçre SECO', long: 'İsviçre – SECO SESAM yaptırım listesi (bütün liste)', url: 'https://www.sesam.search.admin.ch/sesam-search-web/pages/downloadXmlGesamtliste.xhtml?lang=en&action=downloadXmlGesamtlisteAction', page: 'https://www.sesam.search.admin.ch/sesam-search-web/pages/search.xhtml' },
});
/* OpenSanctions “tr_fcib” = MASAK 6415/7262 mal varlığı dondurma listelerinin yapılandırılmış yansısı.
 * Ticari kullanım OpenSanctions lisansı gerektirir (toplu veri yalnızca ticari olmayan kullanım için ücretsizdir). VARSAYILAN KAPALI (lisans gerekir); resmî MASAK CSV/API alınamazsa yedek olarak yalnızca UM_OPENSANCTIONS_TR=1 ile kullanılır. */
DEFS.tr = { native: true, regional: true, label: 'MASAK (Türkiye)', long: 'Türkiye MASAK – 6415 md.5/6/7 ve 7262 mal varlığı dondurma listeleri (resmî herkese açık arama uç noktası; yedek: OpenSanctions tr_fcib)', url: 'https://masak.hmb.gov.tr/portal/v2/masak/mvd/malvarligi-dondurulanlar', page: 'https://masak.hmb.gov.tr/bkk-ile-malvarliklari-dondurulanlar', min: 100, ...(process.env.UM_OPENSANCTIONS_TR === '1' ? { fallbackOs: 'tr_fcib', lic: 'os' } : {}) };
/* Bölgesel resmî listeler. Avustralya DFAT ve Japonya MOF için ÖNCE resmî xlsx indirilir (lib/regional.js); alınamazsa OpenSanctions yansısına düşülür.
 * BAE Yerel Terör Listesi, Katar NCTC ve Suudi Arabistan Ulusal Terör Listesi için makine-okunur resmî dosya yoktur → OpenSanctions yansısı.
 * Bahreyn: makine-okunur kamu dosyası bulunmadığından izleme sayfası olarak izlenir (data/watch.json), listeye alınmaz.
 * Varsayılan KAPALI: OpenSanctions yansıları (BAE/Katar/Suudi ve DFAT/MOF yedekleri) ticari lisans gerektirir; yalnızca UM_OPENSANCTIONS_REGIONAL=1 ile açılır. OpenSanctions verisi ticari kullanımda lisans gerektirir (yalnızca ticari olmayan kullanım ücretsiz). */
const OS_ON = process.env.UM_OPENSANCTIONS_REGIONAL === '1';
const REGIONAL = true;   // yerel (resmî) ayrıştırıcılar her zaman etkin; OpenSanctions yansıları OS_ON ile
const osUrl = d => `https://data.opensanctions.org/datasets/latest/${d}/targets.simple.csv`;
if (REGIONAL) {
  if (OS_ON) DEFS.ae = { os: true, lic: 'os', regional: true, label: 'BAE Yerel Terör Listesi (OpenSanctions)', long: 'BAE – Yerel Terör Listesi (Kabine/EOCN), OpenSanctions yansısı', url: osUrl('ae_local_terrorists'), page: 'https://www.uaeiec.gov.ae/en-us/un-page', min: 5 };
  if (OS_ON) DEFS.qa = { os: true, lic: 'os', regional: true, label: 'Katar NCTC (OpenSanctions)', long: 'Katar – Ulusal Terörle Mücadele Komitesi birleşik yaptırım kaydı, OpenSanctions yansısı', url: osUrl('qa_nctc_sanctions'), page: 'https://www.nctc.gov.qa/', min: 5 };
  if (OS_ON) DEFS.sa = { os: true, lic: 'os', regional: true, label: 'Suudi Ulusal Terör Listesi (OpenSanctions)', long: 'Suudi Arabistan – Ulusal Terör Listesi (BMGK 1373), OpenSanctions yansısı', url: osUrl('sa_pcct_terrorism_list'), page: 'https://www.sama.gov.sa/', min: 5 };
  DEFS.au = { native: true, regional: true, label: 'Avustralya DFAT', long: 'Avustralya – DFAT Konsolide Yaptırım Listesi (resmî xlsx; yedek: OpenSanctions au_dfat_sanctions)', url: process.env.UM_DFAT_URL || 'https://www.dfat.gov.au/sites/default/files/Australian_Sanctions_Consolidated_List.xlsx', page: 'https://www.dfat.gov.au/international-relations/security/sanctions/consolidated-list', ...(OS_ON ? { fallbackOs: 'au_dfat_sanctions', lic: 'os' } : {}) };
  DEFS.jp = { native: true, regional: true, label: 'Japonya MOF', long: 'Japonya – Maliye Bakanlığı (MOF) varlık dondurma listesi (resmî xlsx; yedek: OpenSanctions jp_mof_sanctions)', url: process.env.UM_MOF_URL || 'https://www.mof.go.jp/policy/international_policy/gaitame_kawase/gaitame/economic_sanctions/list.html', page: 'https://www.mof.go.jp/policy/international_policy/gaitame_kawase/gaitame/economic_sanctions/list.html', ...(OS_ON ? { fallbackOs: 'jp_mof_sanctions', lic: 'os' } : {}) };
}
/* Kurum içi PEP seçeneği (varsayılan KAPALI; büyük dosya ~180 MB): UM_OPENSANCTIONS_PEP=1. PEP kayıtları yaptırım değil “PEP” olarak etiketlenir. Lisans gerektirir. */
if (process.env.UM_OPENSANCTIONS_PEP === '1') DEFS.pep = { os: true, lic: 'os', pep: true, label: 'PEP (OpenSanctions)', long: 'Siyasi Nüfuz Sahibi Kişiler (PEP) — OpenSanctions “peps” (lisans gerektirir; yaptırım listesi DEĞİLDİR)', url: osUrl('peps'), page: 'https://www.opensanctions.org/datasets/peps/', min: 1000 };
/* OpenSanctions toplayıcı (isteğe bağlı, varsayılan KAPALI): UM_OPENSANCTIONS_DATASETS="ae_local_terrorists,au_dfat_sanctions,jp_mof_sanctions,..."
 * Her veri kümesi ayrı bir liste olur (anahtar: os_<ad>). Ticari kullanım OpenSanctions lisansı gerektirir. */
for (const ds of (process.env.UM_OPENSANCTIONS_DATASETS || '').split(',').map(x => x.trim()).filter(x => /^[a-z0-9_]+$/.test(x))) {
  DEFS['os_' + ds] = { lic: 'os', label: 'OpenSanctions · ' + ds, long: 'OpenSanctions veri kümesi: ' + ds + ' (toplayıcı; lisans gerektirir)', url: `https://data.opensanctions.org/datasets/latest/${ds}/targets.simple.csv`, page: `https://www.opensanctions.org/datasets/${ds}/`, os: ds };
}
/* Yedek (failover) — yalnızca UM_FALLBACK_OPENSANCTIONS=1 ise ve birincil kaynak UM_FALLBACK_AFTER_HOURS (vars. 36) saatten uzun süredir alınamıyorsa kullanılır.
 * OpenSanctions toplu verisi ticari kullanımda lisans gerektirir; bu yüzden varsayılan KAPALI. Yedek veri yalnızca eşleştirme içindir (birincil önbelleğin yerine geçmez, varlık deposuna yazılmaz). */
Object.assign(DEFS.ofac, { fallback: 'us_ofac_sdn' }); Object.assign(DEFS.ofacc, { fallback: 'us_ofac_cons' }); Object.assign(DEFS.uk, { fallback: 'gb_fcdo_sanctions' }); Object.assign(DEFS.eu, { fallback: 'eu_fsf' }); Object.assign(DEFS.un, { fallback: 'un_sc_sanctions' });
Object.assign(DEFS.ca, { fallback: 'ca_dfatd_sema_sanctions' }); Object.assign(DEFS.ch, { fallback: 'ch_seco_sanctions' }); Object.assign(DEFS.csl, { fallback: 'us_trade_csl' });
const state = { running: false, progress: {}, index: null, indexBuiltAt: null };

const ofacPage = id => 'https://sanctionssearch.ofac.treas.gov/Details.aspx?id=' + id;
const imoOf = s => M.extractIMO(s);

const SEC = require('./secondary');
function parseOFAC(sdnCsv, altCsv, srcKey = 'ofac') {
  const rows = U.parseCSV(sdnCsv, ',');
  const alts = new Map();
  if (altCsv) for (const r of U.parseCSV(altCsv, ',')) { if (r.length < 4) continue; const k = r[0].trim(); const n = (r[3] || '').trim(); if (!n || n === '-0-') continue; if (!alts.has(k)) alts.set(k, []); alts.get(k).push(n); }
  const out = [];
  for (const r of rows) {
    if (r.length < 11) continue;
    const id = r[0].trim(); if (!/^\d+$/.test(id)) continue;
    const nz = x => { x = (x || '').trim(); return x === '-0-' ? '' : x; };
    const type = nz(r[2]).toLowerCase();
    const remarks = nz(r[11]);
    const imo = imoOf(remarks);
    const t = type === 'individual' ? 'p' : type === 'vessel' ? 'v' : type === 'aircraft' ? 'a' : 'e';
    const e = { s: srcKey, id, n: [r[1].trim(), ...(alts.get(id) || [])], t, c: nz(r[3]), cty: nz(r[9]) };
    if (imo.length) e.imo = imo;
    { const sx = SEC.parseRemarks(remarks); if (sx.dobs.length) e.dobs = sx.dobs; if (sx.ids.length) e.ids = sx.ids; if (sx.wallets.length) e.wallets = sx.wallets; if (sx.nat.length) e.nat = sx.nat.join('; '); }
    if (t === 'v') e.v = { flag: nz(r[9]), type: nz(r[6]), owner: nz(r[10]), grt: nz(r[8]) };
    out.push(e);
  }
  return out;
}

function parseUK(xml) {
  const out = [];
  const blocks = xml.split('<Designation>').slice(1);
  const g = (b, tag) => { const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>').exec(b); return m ? U.decodeEntities(m[1]).trim() : ''; };
  for (const raw of blocks) {
    const b = raw.slice(0, raw.indexOf('</Designation>'));
    const id = g(b, 'UniqueID'); if (!id) continue;
    const names = [];
    for (const nm of b.matchAll(/<Name>([\s\S]*?)<\/Name>/g)) {
      const parts = []; for (let i = 1; i <= 6; i++) { const v = g(nm[1], 'Name' + i); if (v) parts.push(v); }
      const full = parts.join(' ').replace(/\s+/g, ' ').trim(); if (full) names.push(full);
    }
    const kind = g(b, 'IndividualEntityShip');
    const imos = [...b.matchAll(/<IMONumber>\s*(?:IMO)?\s*(\d{7})\s*<\/IMONumber>/g)].map(m => m[1]);
    const e = { s: 'uk', id, n: names, t: kind === 'Individual' ? 'p' : kind === 'Ship' ? 'v' : 'e', c: g(b, 'RegimeName').replace(/^The /, '').replace(/ \(Sanctions\).*$/, '').replace(/\(EU Exit\).*$/, '').trim(),
      d: U.dmyToISO(g(b, 'DateDesignated')), u: U.dmyToISO(g(b, 'LastUpdated')), grp: g(b, 'OFSIGroupID'), un: g(b, 'UNReferenceNumber'), imp: g(b, 'SanctionsImposed').slice(0, 120) };
    if (imos.length) e.imo = imos;
    out.push(e);
  }
  return out;
}

function parseUN(xml) {
  const out = [];
  const g = (b, tag) => { const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>').exec(b); return m ? U.decodeEntities(m[1]).trim() : ''; };
  for (const [kind, tag] of [['p', 'INDIVIDUAL'], ['e', 'ENTITY']]) {
    const re = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'g'); let m;
    while ((m = re.exec(xml))) {
      const b = m[1];
      const nameParts = ['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME', 'FOURTH_NAME'].map(t => g(b, t)).filter(Boolean);
      const names = [nameParts.join(' ')];
      for (const a of b.matchAll(/<ALIAS_NAME>([\s\S]*?)<\/ALIAS_NAME>/g)) { const v = U.decodeEntities(a[1]).trim(); if (v) names.push(v); }
      const lu = [...b.matchAll(/<LAST_DAY_UPDATED>\s*<VALUE>([^<]*)<\/VALUE>/g)].map(x => x[1]).sort().pop() || '';
      out.push({ s: 'un', id: g(b, 'DATAID'), n: names.filter(Boolean), t: kind, c: g(b, 'UN_LIST_TYPE'), ref: g(b, 'REFERENCE_NUMBER'), d: g(b, 'LISTED_ON').slice(0, 10), u: lu.slice(0, 10), ver: g(b, 'VERSIONNUM') });
    }
  }
  return out;
}

function parseEU(csv) {
  const rows = U.parseCSV(csv, ';');
  const h = rows[0]; const ix = {}; h.forEach((c, i) => ix[c] = i);
  const map = new Map();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; if (row.length < 10) continue;
    const id = row[ix.Entity_LogicalId]; if (!id) continue;
    let e = map.get(id);
    if (!e) {
      const st = (row[ix.Entity_SubjectType_ClassificationCode] || '').toLowerCase();
      e = { s: 'eu', id, n: [], t: st === 'person' ? 'p' : st === 'enterprise' || st === 'entity' ? 'e' : (st.includes('vessel') || st.includes('ship') ? 'v' : 'e'), c: row[ix.Entity_Regulation_Programme] || '', ref: row[ix.Entity_EU_ReferenceNumber] || '',
        d: (row[ix.Entity_DesignationDate] || row[ix.Entity_Regulation_EntryIntoForceDate] || '').slice(0, 10), pub: (row[ix.Entity_Regulation_PublicationDate] || '').slice(0, 10), reg: row[ix.Entity_Regulation_NumberTitle] || '', url: row[ix.Entity_Regulation_PublicationUrl] || '', u: '' };
      map.set(id, e);
    }
    const nm = (row[ix.NameAlias_WholeName] || '').trim();
    if (nm && !e.n.includes(nm)) e.n.push(nm);
    const idn = row[ix.Identification_Number] || ''; const idt = (row[ix.Identification_TypeDescription] || '');
    if (/imo/i.test(idt) && /^\d{7}$/.test(idn.trim())) (e.imo = e.imo || []).includes(idn.trim()) || e.imo.push(idn.trim());
    const rm = row[ix.Entity_Remark] || ''; if (rm) for (const i of imoOf(rm)) (e.imo = e.imo || []).includes(i) || e.imo.push(i);
  }
  for (const e of map.values()) if (e.imo?.length && e.t !== 'v') e.t = 'v';
  return [...map.values()];
}


function parseCSL(csv) {
  const rows = U.parseCSV(csv, ','); const h = rows[0].map(x => x.trim()); const ix = {}; h.forEach((c, i) => ix[c] = i); const out = []; const used = new Set();
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; const src = r[ix.source] || ''; if (!src || /Treasury/i.test(src)) continue;      // OFAC listeleri ayrı kaynaklardan gelir
    const code = (/\(([A-Z]{2,5})(?: List)?\)/.exec(src) || [])[1] || src.slice(0, 8); const ty = (r[ix.type] || '').toLowerCase();
    const t = ty === 'individual' ? 'p' : ty === 'vessel' ? 'v' : ty === 'aircraft' ? 'a' : 'e';
    const names = [r[ix.name], ...(r[ix.alt_names] || '').split(';').map(x => x.trim())].filter(Boolean); if (!names.length) continue;
    let id = U.sha256(code + '|' + names[0] + '|' + (r[ix.addresses] || '').slice(0, 60)).slice(0, 16); while (used.has(id)) id += 'x'; used.add(id);
    const e = { s: 'csl', id, n: names, t, c: code, d: (r[ix.start_date] || '').slice(0, 10), fr: r[ix.federal_register_notice] || '', lic: (r[ix.license_requirement] || '').slice(0, 160), cty: (r[ix.addresses] || '').split(';')[0].split(',').pop().trim().slice(0, 3), ref: src.replace(/ - .*$/, '') };
    const imo = imoOf((r[ix.remarks] || '') + ' ' + (r[ix.vessel_owner] || '')); if (imo.length) e.imo = imo;
    out.push(e);
  }
  return out;
}
function parseSEMA(xml) {
  const out = []; const g = (b, tag) => { const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>').exec(b); return m ? U.decodeEntities(m[1]).trim() : ''; };
  for (const m of xml.matchAll(/<record>([\s\S]*?)<\/record>/g)) {
    const b = m[1]; const country = g(b, 'Country-Pays').split('/')[0].trim(); const item = g(b, 'Item-NumeroDarticle'); const sch = g(b, 'Schedule-Annexe');
    const ent = g(b, 'EntityOrShip-EntiteOuNavire'); const given = g(b, 'GivenName-Prenom'); const last = g(b, 'LastName-NomDeFamille'); const imoRaw = g(b, 'ShipIMONumber-NumeroOMIDuNavire');
    const name = ent || [given, last].filter(Boolean).join(' '); if (!name) continue;
    const al = g(b, 'Aliases-Alias').split(/[;]/).map(x => x.trim()).filter(Boolean);
    const imo = (imoRaw.match(/\d{7}/g) || []);
    out.push({ s: 'ca', id: `${country}-${sch}-${item}`.replace(/\s+/g, ''), n: [name, ...al], t: imo.length ? 'v' : ent ? 'e' : 'p', c: country, d: g(b, 'DateOfListing-DateDinscription').slice(0, 10), imo: imo.length ? imo : undefined, ref: sch ? `Schedule ${sch}, item ${item}` : '' });
  }
  return out;
}
function parseSECO(xml) {
  const out = []; const prog = new Map(); const byId = new Map();
  for (const pm of xml.matchAll(/<sanctions-program [^>]*>([\s\S]*?)<\/sanctions-program>/g)) {
    const key = (/<program-key lang="eng">([^<]*)/.exec(pm[1]) || [])[1] || '';
    for (const sm of pm[1].matchAll(/<sanctions-set ssid="(\d+)"/g)) prog.set(sm[1], U.decodeEntities(key));
  }
  const tgt = /<target ssid="(\d+)">([\s\S]*?)<\/target>/g; let m;
  while ((m = tgt.exec(xml))) {
    const b = m[2]; const mods = [...b.matchAll(/<modification modification-type="([a-z-]+)"[^>]*enactment-date="([^"]*)"/g)];
    if (mods.length && mods[mods.length - 1][1] === 'de-listed') continue;
    const kind = /<individual>/.test(b) ? 'p' : /<object object-type="vessel"/.test(b) ? 'v' : /<object object-type="aircraft"/.test(b) ? 'a' : 'e';
    const names = [];
    for (const nm of b.matchAll(/<name [^>]*>([\s\S]*?)<\/name>/g)) { const vals = [...nm[1].matchAll(/<value>([^<]*)<\/value>/g)].map(x => U.decodeEntities(x[1]).trim()).filter(Boolean); const full = vals.join(' ').trim(); if (full && !names.includes(full)) names.push(full); }
    if (!names.length) continue;
    const set = (/<sanctions-set-id>(\d+)/.exec(b) || [])[1]; const imo = [...b.matchAll(/IMO\s*(?:Number|No\.?)?:?\s*(\d{7})/gi)].map(x => x[1]);
    const first = mods.find(x => x[1] === 'listed'); const last = mods[mods.length - 1];
    const e = { s: 'ch', id: m[1], n: names, t: kind, c: prog.get(set) || 'SECO', d: first ? first[2] : '', u: last ? last[2] : '' };
    if (imo.length) e.imo = [...new Set(imo)];
    const prev = byId.get(e.id);
    if (prev) { for (const n of e.n) if (!prev.n.includes(n)) prev.n.push(n); if (prev.t === 'e' && e.t !== 'e') prev.t = e.t; if (!prev.d || (e.d && e.d < prev.d)) prev.d = e.d || prev.d; if (e.u > prev.u) prev.u = e.u; if (e.imo) prev.imo = [...new Set([...(prev.imo || []), ...e.imo])]; if (prev.c === 'SECO' && e.c !== 'SECO') prev.c = e.c; continue; }
    byId.set(e.id, e); out.push(e);
  }
  return out;
}

const NOCHANGE = Symbol('nochange');
function parseTR(csv, srcKey = 'tr') {
  const rows = U.parseCSV(csv, ','); const h = rows[0].map(x => x.trim()); const ix = k => h.indexOf(k); const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]; const name = r[ix('name')]; if (!name) continue; const al = (r[ix('aliases')] || '').split(';').map(x => x.trim()).filter(Boolean); const sch = r[ix('schema')];
    const san = r[ix('sanctions')] || ''; const art = (/Article\s+(\w+)[^.]*?Law No\.?\s*(\d+)/i.exec(san) || []);
    out.push({ s: srcKey, id: r[ix('id')], n: [name, ...al], t: sch === 'Person' ? 'p' : sch === 'Vessel' ? 'v' : 'e', c: srcKey === 'tr' ? (art[2] ? `${art[2]} md.${art[1]}` : 'MASAK') : (r[ix('program_ids')] || r[ix('dataset')] || srcKey), d: (r[ix('first_seen')] || '').slice(0, 10), u: (r[ix('last_change')] || '').slice(0, 10), ref: r[ix('identifiers')] || '' });
  }
  return out;
}
const FETCH = {
  async ofac(force) {
    let r, alt = '';
    try { r = await U.fetchCond(DEFS.ofac.url, 'list-ofac', { timeout: 120000, force }); if (!r.changed) return NOCHANGE; alt = await U.fetchText('https://sanctionslistservice.ofac.treas.gov/api/download/ALT.CSV', { timeout: 120000, api: true }).catch(() => ''); }
    catch (e) {   // yansı (mirror): Hazine eski indirme adresi — aynı sütun düzeni
      r = await U.fetchCond('https://www.treasury.gov/ofac/downloads/sdn.csv', 'list-ofac-mirror', { timeout: 120000, force: true }).catch(() => { throw e; });
      alt = await U.fetchText('https://www.treasury.gov/ofac/downloads/alt.csv', { timeout: 120000, api: true }).catch(() => '');
    }
    return parseOFAC(r.text, alt);
  },
  async uk(force) {
    let r;
    try { r = await U.fetchCond(DEFS.uk.url, 'list-uk', { timeout: 180000, force }); }
    catch (e) {   // CDN bazen koşullu/yinelenen isteğe 405/403/5xx döner: koşulsuz, önbellek-kırıcı ikinci deneme (aynı resmî dosya)
      if (!e.status || e.status === 404) throw e;
      r = await U.fetchCond(DEFS.uk.url + '?_=' + Date.now().toString(36), 'list-uk-retry', { timeout: 180000, force: true, headers: { Accept: 'application/xml,text/xml,*/*', 'Cache-Control': 'no-cache' } });
    }
    return r.changed ? parseUK(r.text) : NOCHANGE;
  },

  async ofacc(force) {
    const r = await U.fetchCond(DEFS.ofacc.url, 'list-ofacc', { timeout: 120000, force }); if (!r.changed) return NOCHANGE;
    const alt = await U.fetchText('https://sanctionslistservice.ofac.treas.gov/api/download/CONS_ALT.CSV', { timeout: 120000, api: true }).catch(() => '');
    return parseOFAC(r.text, alt, 'ofacc');
  },
  async csl(force) { const r = await U.fetchCond(DEFS.csl.url, 'list-csl', { timeout: 240000, force }); return r.changed ? parseCSL(r.text) : NOCHANGE; },
  async ca(force) { const r = await U.fetchCond(DEFS.ca.url, 'list-ca', { timeout: 120000, force }); return r.changed ? parseSEMA(r.text) : NOCHANGE; },
  async ch(force) { const r = await U.fetchCond(DEFS.ch.url, 'list-ch', { timeout: 300000, force }); return r.changed ? parseSECO(r.text) : NOCHANGE; },
  async un(force) { const r = await U.fetchCond(DEFS.un.url, 'list-un', { timeout: 120000, force }); return r.changed ? parseUN(r.text) : NOCHANGE; },
  async eu(force) { const r = await U.fetchCond(DEFS.eu.url, 'list-eu', { timeout: 240000, force }); return r.changed ? parseEU(r.text) : NOCHANGE; },
};

const REG = require('./regional');
async function nativeOrOs(k, parse, getBuf, force) {
  try { const r = await getBuf(force); if (r === NOCHANGE) return NOCHANGE; const out = parse(r); if (out.length < 20) throw new Error('beklenenden az kayıt (' + out.length + ')'); return out; }
  catch (e) {
    if (!DEFS[k].fallbackOs) throw e;
    const r = await U.fetchCond(osUrl(DEFS[k].fallbackOs), 'list-' + k + '-os', { timeout: 180000, force: true });
    const o = parseTR(r.text, k).map(x => ({ ...x, fb: true, via: 'OpenSanctions (resmî dosya alınamadı: ' + String(e.message).slice(0, 80) + ')' })); if (!o.length) throw e; return o;
  }
}
const F = require('./fetcher');
const masakApi = async () => {
  const base = DEFS.tr.url.replace(/\/malvarligi-dondurulanlar$/, ''); const hd = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const lr = await F.request(base + '/yaptirim', { headers: { Accept: 'application/json' }, timeout: 60000 }); if (!lr.ok) throw Object.assign(new Error('HTTP ' + lr.status), { status: lr.status });
  const types = (await lr.json()).data.map(x => x.yaptirim_turu).filter(Boolean); if (types.length < 3) throw new Error('MASAK yaptırım türleri beklenenden az');
  const resps = []; for (const t of types) { const r = await F.request(DEFS.tr.url, { method: 'POST', headers: hd, body: JSON.stringify({ ad: '', uyruk: '', orgut: '', yaptirim: t }), timeout: 120000 }); if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status }); const j = await r.json(); if (!Array.isArray(j.data)) throw new Error('MASAK yanıtı beklenen biçimde değil'); resps.push(j); }
  const raw = JSON.stringify(resps); const h = U.sha256(raw); const c = store.readCache('http-cache.json', {}); const prev = c['list-tr-masak']?.hash; c['list-tr-masak'] = { hash: h, checkedAt: new Date().toISOString(), changedAt: prev === h ? c['list-tr-masak']?.changedAt : new Date().toISOString() }; store.writeCache('http-cache.json', c);
  return resps;
};
/* 1) Resmî CSV'ler (sayfa JSON → bağlantı → koşullu GET; cp1254) — kimlik/doğum/anne-baba alanlarıyla birlikte; 2) arama API'si; 3) (yalnızca etkinse) OpenSanctions */
const MASAK_PAGE = 'https://masak.hmb.gov.tr/portal/v2/pages?slug=';
async function masakCsv(force) {
  const files = []; const recon = {}; let anyChanged = !!force; const meta = store.readCache('masak-recon.json', {});
  for (const k of Object.keys(REG.MASAK_SECT)) {
    const pr = await F.request(MASAK_PAGE + REG.MASAK_SECT[k].slug, { headers: { Accept: 'application/json' }, timeout: 60000 }); if (!pr.ok) throw Object.assign(new Error('MASAK sayfa JSON HTTP ' + pr.status), { status: pr.status });
    const pj = await pr.json(); const href = REG.masakCsvHref(pj, k); if (!href) throw new Error(`MASAK ${k}: sayfada CSV bağlantısı yok`);
    const key = 'masak-csv-' + k; const probe = await U.fetchCond(href, key, { timeout: 120000, force });
    if (probe.changed !== false) anyChanged = true;
    files.push({ k, href, modified: pj[0]?.modified || '', probe });
  }
  if (!anyChanged) return NOCHANGE;
  const out = []; const now = new Date().toISOString();
  for (const f of files) {
    const buf = f.probe.changed === false ? (await U.fetchCond(f.href, 'masak-csv-' + f.k + '-force', { timeout: 120000, force: true })).buf : f.probe.buf;
    const ents = REG.parseMASAKcsv(buf, f.k); out.push(...ents);
    const prev = meta[f.k] || {}; recon[f.k] = { label: REG.MASAK_SECT[f.k].label, file: f.href.split('/').pop(), pageModified: f.modified, officialRows: ents.official, parsed: ents.length, match: ents.official === ents.length, sha: U.sha256(buf).slice(0, 16), previous: prev.parsed ?? null, delta: prev.parsed != null ? ents.length - prev.parsed : null, checkedAt: now, changedAt: prev.sha === U.sha256(buf).slice(0, 16) ? prev.changedAt : now };
  }
  store.writeCache('masak-recon.json', recon);
  return { csv: out };
}
FETCH.tr = force => nativeOrOs('tr', r => r.csv || REG.parseMASAK(r), async f => {
  try { return await masakCsv(f); }
  catch (e) {
    if (e === NOCHANGE) return NOCHANGE;
    const resps = await masakApi(); const h = U.sha256(JSON.stringify(resps)); const c = store.readCache('http-cache.json', {}); const prev = c['list-tr-masak']?.hash; c['list-tr-masak'] = { hash: h, checkedAt: new Date().toISOString() }; store.writeCache('http-cache.json', c);
    return (prev === h && !f) ? NOCHANGE : resps;
  }
}, force);
if (DEFS.au) FETCH.au = force => nativeOrOs('au', REG.parseDFAT, async f => { const r = await U.fetchCond(DEFS.au.url, 'list-au', { timeout: 180000, force: f }); return r.changed ? r.buf : NOCHANGE; }, force);
if (DEFS.jp) FETCH.jp = force => nativeOrOs('jp', REG.parseMOF, async f => {
  let url = DEFS.jp.url;
  if (/\.html?$/.test(url)) { const pg = await U.fetchText(url, { timeout: 60000 }); const m = /href="([^"]*shisantouketsu\d+\.xlsx)"/.exec(pg); if (!m) throw new Error('MOF sayfasında xlsx bağlantısı bulunamadı'); url = new URL(m[1], url).href; }
  const r = await U.fetchCond(url, 'list-jp', { timeout: 240000, force: f }); return r.changed ? r.buf : NOCHANGE;
}, force);
for (const k of Object.keys(DEFS)) if (DEFS[k].os && !FETCH[k]) FETCH[k] = async force => { const r = await U.fetchCond(DEFS[k].url, 'list-' + k, { timeout: 180000, force }); return r.changed ? parseTR(r.text, k) : NOCHANGE; };
function meta() { return store.readCache('lists-meta.json', {}); }
function load(src) { return store.readCache(`list-${src}.json`, null); }
/* Eşleştirme için etkin liste: birincil önbellek; birincil uzun süredir alınamıyorsa (ve yedek açıksa) yedek veri */
function loadEffective(src) { return meta()[src]?.usingFallback ? (store.readCache(`list-${src}.fb.json`, null) || load(src)) : load(src); }

function fingerprint(e) { return U.sha256([e.n.join('|'), e.c || '', e.u || '', e.ver || '', (e.imo || []).join(',')].join('#')).slice(0, 10); }

async function syncOne(src, force) {
  const t0 = Date.now();
  state.progress[src] = { status: 'running', started: new Date().toISOString() };
  try {
    const have = !!load(src);
    const entries = await FETCH[src](force || !have);
    if (entries === NOCHANGE) {
      const m0 = meta(); m0[src] = { ...(m0[src] || {}), ok: true, checkedAt: new Date().toISOString(), error: null, lastError: null, usingFallback: false }; store.writeCache('lists-meta.json', m0);
      state.progress[src] = { status: 'ok' };
      return { ...m0[src], changed: false };
    }
    if (entries.length < (DEFS[src].min ?? 20)) throw new Error('Beklenenden az kayıt ayrıştırıldı (' + entries.length + ')');
    store.writeCache(`list-${src}.json`, { fetchedAt: new Date().toISOString(), entries });
    const m = meta(); m[src] = { ok: true, fetchedAt: new Date().toISOString(), checkedAt: new Date().toISOString(), changedAt: new Date().toISOString(), count: entries.length, ms: Date.now() - t0, url: DEFS[src].url, error: null };
    store.writeCache('lists-meta.json', m);
    state.progress[src] = { status: 'ok' };
    state.index = null;
    return { ...m[src], changed: true };
  } catch (e) {
    const m = meta(); m[src] = { ...(m[src] || {}), ok: false, lastError: e.message, lastTry: new Date().toISOString(), url: DEFS[src].url, usingCache: !!(m[src] && m[src].count), retryAfterMs: e.retryAfterMs || 0 };
    const ageH = m[src].fetchedAt ? (Date.now() - Date.parse(m[src].fetchedAt)) / 36e5 : Infinity;
    if (DEFS[src].fallback && process.env.UM_FALLBACK_OPENSANCTIONS === '1' && ageH > (+process.env.UM_FALLBACK_AFTER_HOURS || 36)) {
      try {
        const r = await U.fetchCond(`https://data.opensanctions.org/datasets/latest/${DEFS[src].fallback}/targets.simple.csv`, 'list-' + src + '-fb', { timeout: 240000, force: true });
        const fbE = parseTR(r.text, src).map(x => ({ ...x, fb: true }));
        if (fbE.length >= 20) { store.writeCache(`list-${src}.fb.json`, { fetchedAt: new Date().toISOString(), entries: fbE }); m[src] = { ...m[src], usingFallback: true, fallbackAt: new Date().toISOString(), fallbackCount: fbE.length, fallbackDataset: DEFS[src].fallback }; state.index = null; }
      } catch (e2) { m[src].fallbackError = e2.message; }
    }
    store.writeCache('lists-meta.json', m);
    state.progress[src] = { status: 'error', error: e.message };
  }
  return { ...meta()[src], changed: false, failed: true };
}

async function syncAll(which) {
  if (state.running) return { already: true };
  state.running = true;
  try {
    await Promise.all((which || Object.keys(DEFS)).map(s => syncOne(s)));
    state.index = null;
    takeSnapshot();
  } finally { state.running = false; }
  return meta();
}

function snapPath(d) { return require('path').join(store.snapshotDir(), d + '.json'); }
function takeSnapshot() {
  const today = U.todayISO(require('./platform').tz);
  fs.mkdirSync(store.snapshotDir(), { recursive: true });
  const p = snapPath(today);
  if (fs.existsSync(p)) return;       // gün içinde ilk anlık görüntü referans kalır
  const snap = { date: today, createdAt: new Date().toISOString(), src: {} };
  for (const s of Object.keys(DEFS)) {
    const l = load(s); if (!l) continue;
    const o = {}; for (const e of l.entries) o[e.id] = fingerprint(e);
    snap.src[s] = o;
  }
  require('fs').writeFileSync(p, JSON.stringify(snap));
}
function previousSnapshot(before) {
  try {
    const files = fs.readdirSync(store.snapshotDir()).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).filter(d => d < before).sort();
    if (!files.length) return null;
    return JSON.parse(fs.readFileSync(snapPath(files[files.length - 1]), 'utf8'));
  } catch { return null; }
}
/* Gerçek kimlik farkı: önceki günün anlık görüntüsüne göre eklenen/güncellenen/silinen kayıtlar */
function diffVsPrevious(today) {
  const prev = previousSnapshot(today); if (!prev) return null;
  const res = { baseDate: prev.date, added: [], updated: [], removed: [] };
  for (const s of Object.keys(DEFS)) {
    const l = load(s); const old = prev.src[s]; if (!l || !old) continue;
    const seen = new Set();
    for (const e of l.entries) {
      seen.add(e.id);
      if (!(e.id in old)) res.added.push(e); else if (old[e.id] !== fingerprint(e)) res.updated.push(e);
    }
    for (const id of Object.keys(old)) if (!seen.has(id)) res.removed.push({ s, id, n: ['(kayıt listeden çıkarıldı – ID ' + id + ')'], t: 'e', removed: true });
  }
  return res;
}

function getIndex() {
  if (state.index) return state.index;
  const ix = new M.NameIndex();
  for (const s of Object.keys(DEFS)) {
    const l = loadEffective(s); if (!l) continue;
    for (const e of l.entries) ix.add(e);
  }
  state.index = ix; state.indexBuiltAt = new Date().toISOString();
  return ix;
}
/* Kuruma özel görünüm: açık/kapalı liste kapsamı (#14) + kurum içi engelleme listesi (#9). Genel indeks paylaşılır; süzme arama sonrasında yapılır. */
const blCache = new Map();
function orgIndex() {
  const base = getIndex(); const s = store.settings(); const en = new Set(s.listsEnabled && s.listsEnabled.length ? s.listsEnabled : Object.keys(DEFS));
  const bl = store.blocklist(); const key = store.orgId() + ':' + bl.length + ':' + (bl[bl.length - 1]?.id || '') + ':' + bl.map(x => x.name).join('|').length;
  let bix = null;
  if (bl.length) { bix = blCache.get(key); if (!bix) { bix = new M.NameIndex(); for (const b of bl) bix.add({ s: 'internal', id: b.id, n: [b.name, ...(b.aliases || [])], names: [b.name, ...(b.aliases || [])], t: b.type === 'person' ? 'p' : b.type === 'vessel' ? 'v' : 'e', c: b.note || 'Kurum içi liste', d: (b.addedAt || '').slice(0, 10), imo: b.imo ? [String(b.imo)] : undefined }); blCache.clear(); blCache.set(key, bix); } }
  return {
    search(name, opts = {}) {
      const limit = opts.limit ?? 8; const lt = s.listThresholds || {}; const dflt = opts.threshold ?? s.matchThreshold ?? 80; const lo = Math.min(dflt, ...Object.values(lt).map(Number).filter(Boolean));
      const all = base.search(name, { ...opts, threshold: lo, limit: limit * (lo < dflt ? 8 : 4) }).filter(h => en.has(h.entry.s) && h.score >= (lt[h.entry.s] ?? dflt));
      if (bix) all.push(...bix.search(name, opts));
      return all.sort((a, b) => b.score - a.score).slice(0, limit);
    },
  };
}
function totalCount() { const m = meta(); return Object.values(m).reduce((a, x) => a + (x.count || 0), 0); }

function entryUrl(e) {
  if (e.s === 'ofac') return ofacPage(e.id);
  if (e.s === 'ofacc') return DEFS.ofacc.page;
  if (e.s === 'uk') return 'https://search-uk-sanctions-list.service.gov.uk/';
  if (e.s === 'un') return 'https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list';
  if (e.s === 'eu') return e.url || 'https://www.sanctionsmap.eu/';
  if (e.s === 'tr') return e.fb ? `https://www.opensanctions.org/entities/${e.id}/` : 'https://masak.hmb.gov.tr/bkk-ile-malvarliklari-dondurulanlar';
  if (e.s === 'csl') return DEFS.csl.page;
  if (e.s === 'ca') return DEFS.ca.page;
  if (e.s === 'ch') return DEFS.ch.page;
  if (DEFS[e.s]?.native) return e.fb ? `https://www.opensanctions.org/entities/${e.id}/` : DEFS[e.s].page;
  if (DEFS[e.s]?.os) return `https://www.opensanctions.org/entities/${e.id}/`;
  return '';
}
const SRC_LABEL = new Proxy({ internal: 'Kurum içi liste', ofac: 'OFAC SDN', uk: 'UK Sanctions List', un: 'BM Konsolide', eu: 'AB Konsolide', tr: 'MASAK (OpenSanctions)' }, { get: (t, k) => t[k] || DEFS[k]?.label || String(k) });
const TYPE_LABEL = { p: 'Kişi', e: 'Kuruluş', v: 'Gemi', a: 'Hava aracı' };
function present(e) {
  return { src: e.s, srcLabel: SRC_LABEL[e.s], id: e.id, name: e.n[0], aliases: e.n.slice(1, 6), type: TYPE_LABEL[e.t], program: e.c, listed: e.d || '', updated: e.u || '', imo: e.imo || [], url: entryUrl(e), vessel: e.v || null, ref: e.ref || e.un || '', ids: (e.ids || (e.idno ? [e.idno] : [])).slice(0, 6), dob: (e.dobs || (e.dob ? [e.dob] : [])).slice(0, 3), nat: e.nat || '', wallets: (e.wallets || []).slice(0, 4), mother: e.mother || '', father: e.father || '', pob: e.pob || '', addr: e.addr || '', role: e.role || '', decision: e.dec || '' };
}
function findByImo(imo) {
  imo = String(imo); const out = [];
  for (const s of Object.keys(DEFS)) { const l = loadEffective(s); if (!l) continue; for (const e of l.entries) if (e.imo && e.imo.includes(imo)) out.push(present(e)); }
  return out;
}

module.exports = { REGIONAL, loadEffective, TYPE_LABEL, entryUrl, parseCSL, parseSEMA, parseSECO, parseTR, DEFS, state, meta, load, syncAll, syncOne, getIndex, orgIndex, diffVsPrevious, previousSnapshot, present, findByImo, totalCount, SRC_LABEL, fingerprint, takeSnapshot, parseOFAC, parseUK, parseUN, parseEU };
