'use strict';
/* Günlük bülten kaynak toplayıcıları. Her fonksiyon { status, items, note, url } döndürür; hata olursa durum "hata" olur, uygulama çökmez. */
const U = require('./util');
const L = require('./lists');
const M = require('./match');
const store = require('./store');
const fs = require('fs');

const KEYWORDS = ['designation', 'designations', 'designated', 'sanction', 'sanctions', 'delisting', 'delisted', 'removal', 'removed', 'removes', 'entry', 'entries', 'added', 'adds', 'general license', 'general licence', 'penalty', 'settlement', 'amending', 'restrictive measures', 'asset freeze', 'terminat', 'mal varlığ', 'dondurul', 'yaptırım', 'güvenlik konseyi', 'terör', 'kara para'];
function kwHits(txt) { const t = (txt || '').toLowerCase(); return KEYWORDS.filter(k => t.includes(k)); }

const SRC = {
  ofac: { code: 'OFAC', name: 'OFAC (ABD Hazine)', page: 'https://ofac.treasury.gov/recent-actions' },
  uk: { code: 'UK/OFSI', name: 'UK / OFSI (HM Treasury)', page: 'https://www.gov.uk/search/all?organisations%5B%5D=hm-treasury&order=updated-newest&parent=hm-treasury' },
  eu: { code: 'AB', name: 'AB – EUR-Lex Resmî Gazete (L serisi)', page: 'https://eur-lex.europa.eu/oj/direct-access.html' },
  un: { code: 'BM', name: 'BM Güvenlik Konseyi', page: 'https://press.un.org/en/content/security-council' },
  fatf: { code: 'FATF', name: 'FATF', page: 'https://www.fatf-gafi.org/en/countries/black-and-grey-lists.html' },
  state: { code: 'ABD DB', name: 'ABD Dışişleri (yalnızca bilgi)', page: 'https://www.state.gov/press-releases/' },
};

Object.assign(SRC, {
  ofacc: { code: 'OFAC-NS', name: 'OFAC Konsolide (SDN dışı)', page: L.DEFS.ofacc.page },
  csl: { code: 'BIS/CSL', name: 'BIS Entity List ve ABD Konsolide Tarama Listesi', page: L.DEFS.csl.page },
  ca: { code: 'CA', name: 'Kanada SEMA', page: L.DEFS.ca.page },
  ch: { code: 'CH', name: 'İsviçre SECO', page: L.DEFS.ch.page },
  fr: { code: 'Fed. Reg.', name: 'Federal Register (OFAC, BIS)', page: 'https://www.federalregister.gov/agencies/foreign-assets-control-office' },
  rg: { code: 'RG', name: 'Resmî Gazete (günlük dizin)', page: 'https://www.resmigazete.gov.tr/' },
  watch: { code: 'İzleme', name: 'İzlenen resmî sayfalar (Körfez, Japonya, Avustralya, MASAK)', page: '' },
  tr: { code: 'MASAK', name: 'MASAK (OpenSanctions yansısı)', page: 'https://masak.hmb.gov.tr/bkk-ile-malvarliklari-dondurulanlar' },
});
for (const k of Object.keys(L.DEFS)) if (L.DEFS[k].os || L.DEFS[k].native) SRC[k] = { code: L.DEFS[k].os ? 'OS' : k.toUpperCase(), name: L.DEFS[k].label, page: L.DEFS[k].page };

const mk = (o) => ({ id: 'i' + U.sha256([o.source, o.type, o.title, o.date, (o.entities || []).map(e => e.name).join('|')].join('#')).slice(0, 10), keywords: kwHits(o.title + ' ' + (o.summary || '')), entities: [], ...o });
const TYPE_TR = { p: 'person', e: 'entity', v: 'vessel', a: 'aircraft' };

// ───────────────────────── OFAC ─────────────────────────
function splitOFACEntries(text) {
  const parts = text.split(/(?<=\])(?:\s*\(Linked To:[^)]*\))?\.\s+(?=\S)/);
  return parts.map(s => s.trim()).filter(Boolean);
}
function guessName(entry, kind) {
  let s = entry.replace(/^\s*[-•]\s*/, '');
  s = s.split(/\s\(a\.k\.a\.|\s\(Arabic|\s\(Chinese|\s\(Cyrillic|\s\(Russian|\s\(Farsi|\s\(Korean|;/)[0];
  const segs = s.split(', ');
  let name = segs[0];
  const sfx = /^(LTD\.?|LIMITED|INC\.?|LLC\.?|L\.L\.C\.?|CO\.?|CORP\.?|S\.A\.?|SA|PLC|PTE|LLP|JSC|PJSC|FZE|FZCO|FZC|LP|AG|GMBH|S\.R\.L\.?)\b/i;
  if (kind === 'p') { if (segs[1] && !/\d/.test(segs[1]) && segs[1].length < 40) name = segs[0] + ', ' + segs[1]; }
  else { for (let i = 1; i < segs.length && sfx.test(segs[i]); i++) name += ', ' + segs[i]; }
  return name.replace(/\(individual\)|\(entity\)/g, '').trim().slice(0, 140);
}
function parseOFACEntry(raw, kind, program) {
  const aka = [...raw.matchAll(/a\.k\.a\.\s+"?([^;)"]+?)"?(?=[;)])/g)].map(m => m[1].trim()).slice(0, 8);
  const imo = M.extractIMO(raw);
  const prog = (raw.match(/\[([A-Z0-9\-,\s]+)\]/) || [])[1] || '';
  const linked = (raw.match(/Linked To:\s*([^)]+)\)/) || [])[1] || '';
  const t = imo.length ? 'v' : kind;
  return { name: guessName(raw, t), type: TYPE_TR[t] || 'entity', imo, program: prog.trim(), aliases: aka, linked, raw: raw.slice(0, 900) };
}
function parseOFACBody(bodyText) {
  // başlıklara göre bölümler
  const re = /The following (individuals?|entit(?:y|ies)|vessels?|aircraft|entries|entry|changes)[^:]*?(has|have|been)[^:]*?:/gi;
  const marks = []; let m;
  while ((m = re.exec(bodyText))) marks.push({ idx: m.index, end: re.lastIndex, what: m[1].toLowerCase(), head: m[0] });
  const sections = [];
  for (let i = 0; i < marks.length; i++) {
    const seg = bodyText.slice(marks[i].end, i + 1 < marks.length ? marks[i + 1].idx : undefined).split(/Unrelated Administrative List Changes|Additional OFAC Resources|Filter by Category/)[0].trim();
    const head = marks[i].head.toLowerCase();
    const op = /removed|deleted/.test(head) ? 'DEL' : /changes|updated|changed/.test(head) ? 'UPD' : 'ADD';
    const kind = /individual/.test(marks[i].what) ? 'p' : /vessel/.test(marks[i].what) ? 'v' : /aircraft/.test(marks[i].what) ? 'a' : 'e';
    if (!seg || /^none\.?$/i.test(seg)) continue;
    let entries = splitOFACEntries(seg);
    let ents;
    if (op === 'UPD') {
      ents = entries.map(e => { const [a, b] = e.split(/\s+-to-\s+/); const x = parseOFACEntry(a, kind); x.after = (b || '').slice(0, 500); return x; });
    } else ents = entries.map(e => parseOFACEntry(e, kind));
    sections.push({ op, kind, ents });
  }
  return sections;
}
const TYPE_NAMES = { person: ['kişi', 'individual(s)'], entity: ['kuruluş', 'entity/entities'], vessel: ['gemi', 'vessel(s)'], aircraft: ['uçak', 'aircraft'] };
function countsObj(ents) {
  const c = {}; for (const e of ents) c[e.type] = (c[e.type] || 0) + 1;
  const en = Object.entries(c);
  return { tr: en.map(([k, v]) => `${v} ${TYPE_NAMES[k][0]}`).join(', '), en: en.map(([k, v]) => `${v} ${TYPE_NAMES[k][1]}`).join(', ') };
}
const OPV = { ADD: ['eklendi', 'added'], UPD: ['güncellendi', 'updated'], DEL: ['listeden çıkarıldı', 'removed from the list'] };
function summaryFor(ents, op, suffix = {}) { const c = countsObj(ents); return { tr: `${c.tr} ${OPV[op][0]}.`, en: `${c.en} ${OPV[op][1]}.` }; }
const B = (tr, en) => ({ tr, en });
function countsText(ents) { return countsObj(ents).tr; }
async function fetchOFAC(win, log) {
  const html = await U.fetchText(SRC.ofac.page, { retries: 2 });
  const rows = [...html.matchAll(/<div class="margin-bottom-4 search-result views-row">([\s\S]*?)<\/div><\/div><\/div>/g)];
  const acts = [];
  for (const r of rows) {
    const a = /<a href="(\/recent-actions\/(\d{8}))"[^>]*>([^<]+)<\/a>/.exec(r[1]); if (!a) continue;
    const date = `${a[2].slice(0, 4)}-${a[2].slice(4, 6)}-${a[2].slice(6, 8)}`;
    const cat = (/<a href="\/recent-actions\/([a-z-]+)">([^<]+)<\/a>/.exec(r[1]) || [])[2] || '';
    acts.push({ date, path: a[1], title: U.decodeEntities(a[3]).trim(), cat });
  }
  if (!acts.length) throw new Error('Sayfada son işlem listesi ayrıştırılamadı (sayfa yapısı değişmiş olabilir)');
  const inWin = acts.filter(a => a.date >= win.start && a.date <= win.end);
  const items = [];
  for (const a of inWin) {
    const url = 'https://ofac.treasury.gov' + a.path;
    let body = '';
    try {
      const d = await U.fetchText(url, { retries: 1 });
      const i = d.indexOf('Recent Actions Body');
      const seg = i > 0 ? d.slice(i, i + 160000) : d;
      body = U.stripTags(seg.replace(/<\/p>/g, '\n').replace(/<\/li>/g, '\n')).replace(/\s+/g, ' ');
      body = body.replace(/^Recent Actions Body\s*/, '');
    } catch (e) { body = ''; }
    const baseSummary = body.slice(0, 380);
    const isGL = /general license/i.test(a.title) || /General Licenses/i.test(a.cat);
    const isEnf = /Enforcement/i.test(a.cat) || /enforcement|settlement|penalt/i.test(a.title);
    const sections = body ? parseOFACBody(body) : [];
    let any = false;
    for (const s of sections) {
      any = true;
      items.push(mk({ source: 'OFAC', srcKey: 'ofac', date: a.date, type: s.op, title: a.title, summary: summaryFor(s.ents, s.op), url, entities: s.ents, method: B('OFAC Recent Actions sayfası (resmî metin)', 'OFAC Recent Actions page (official text)'), hasVessel: s.ents.some(e => e.type === 'vessel') }));
    }
    if (isGL) items.push(mk({ source: 'OFAC', srcKey: 'ofac', date: a.date, type: 'GL', title: a.title, summary: baseSummary || 'Genel lisans işlemi.', url, method: B('OFAC Recent Actions sayfası', 'OFAC Recent Actions page') }));
    else if (isEnf) items.push(mk({ source: 'OFAC', srcKey: 'ofac', date: a.date, type: 'ENF', title: a.title, summary: baseSummary || 'Enforcement işlemi.', url, method: B('OFAC Recent Actions sayfası', 'OFAC Recent Actions page') }));
    else if (!any) items.push(mk({ source: 'OFAC', srcKey: 'ofac', date: a.date, type: 'INFO', title: a.title, summary: baseSummary, url, method: B('OFAC Recent Actions sayfası', 'OFAC Recent Actions page') }));
    else if (/general license/i.test(body.slice(0, 600)) && !isGL) { /* başlık dışı GL bilgisi */ }
  }
  return { items, note: B(`Son işlem listesi okundu (${acts.length} kayıt görüldü, ${inWin.length} tanesi pencerede).`, `Recent actions list read (${acts.length} records seen, ${inWin.length} inside the window).`), count: inWin.length };
}

// ───────────────────────── UK / OFSI ─────────────────────────
async function fetchUKGov(win) {
  const fields = 'fields=title&fields=link&fields=public_timestamp&fields=format&fields=description&fields=organisations';
  const urls = [
    `https://www.gov.uk/api/search.json?filter_organisations=office-of-financial-sanctions-implementation&order=-public_timestamp&count=40&${fields}`,
    `https://www.gov.uk/api/search.json?filter_organisations=hm-treasury&q=sanctions&order=-public_timestamp&count=30&${fields}`,
    `https://www.gov.uk/api/search.json?filter_organisations=foreign-commonwealth-development-office&q=%22sanctions+list%22&order=-public_timestamp&count=30&${fields}`,   // UK Sanctions List (FCDO) duyuruları — OFSI Konsolide Listesi 28 Ocak 2026'da kapandı
  ];
  const seen = new Map();
  let ok = 0;
  for (const u of urls) {
    try { const j = JSON.parse(await U.fetchText(u, { retries: 1, api: true })); ok++; for (const r of j.results || []) seen.set(r.link, r); } catch (e) { if (!ok && u === urls[urls.length - 1]) throw e; }
  }
  if (!ok) throw new Error('gov.uk Search API yanıt vermedi');
  const items = [];
  for (const r of seen.values()) {
    const date = (r.public_timestamp || '').slice(0, 10);
    if (date < win.start || date > win.end) continue;
    const t = r.title || '';
    const sanc = /sanction|ofsi|licen[cs]e|designation|asset freeze/i.test(t + ' ' + (r.description || '')) || (r.organisations || []).some(o => o.slug === 'office-of-financial-sanctions-implementation');
    if (!sanc) continue;
    let type = 'INFO';
    if (/general licen[cs]e|\bGL\b|INT\/20/i.test(t)) type = 'GL';
    else if (/penalt|enforcement|settlement|disclosure|breach/i.test(t + ' ' + (r.description || ''))) type = 'ENF';
    else if (/notice|designation|remov|delist|added/i.test(t)) type = 'UPD';
    items.push(mk({ source: 'UK/OFSI', srcKey: 'uk', date, type, title: t, summary: (r.description || '').slice(0, 400), url: 'https://www.gov.uk' + r.link, method: B('gov.uk Search API (HM Treasury / OFSI)', 'gov.uk Search API (HM Treasury / OFSI)') }));
  }
  return { items, note: B(`gov.uk Search API: ${seen.size} kayıt tarandı (OFSI + HM Treasury + FCDO “sanctions list”).`, `gov.uk Search API: ${seen.size} records scanned (OFSI + HM Treasury + FCDO “sanctions list”).`), count: items.length };
}

// ───────────────────────── Liste tabanlı (UK/UN/AB) değişiklikler ─────────────────────────
function entityRow(e) { return { name: e.n[0], type: TYPE_TR[e.t] || 'entity', imo: e.imo || [], program: e.c, aliases: (e.n || []).slice(1, 6), listUrl: L.present(e).url }; }
function groupListItems(src, srcKey, entries, op, date, methodTxt, titleFn, urlFn) {
  const groups = new Map();
  for (const e of entries) { const k = (e.c || '-') + '|' + (op === 'ADD' ? e.d : e.u || e.d || date); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const out = [];
  for (const [k, list] of groups) {
    const [prog, d] = k.split('|'); const ents = list.map(entityRow);
    out.push(mk({ source: src, srcKey, date: d || date, type: op, title: titleFn(prog, op, list), summary: summaryFor(ents, op), url: urlFn(prog, list), entities: ents, method: methodTxt, hasVessel: ents.some(e => e.type === 'vessel') }));
  }
  return out;
}
function listChanges(win, srcKey, src, titleFn, urlFn) {
  const l = L.load(srcKey); if (!l) return { items: [], note: B('Liste önbelleği yok (henüz senkronize edilmedi).', 'List cache missing (not synchronised yet).'), missing: true };
  const diff = global.__listDiff;
  const items = [];
  let method;
  if (diff) {
    const m = B(`Anlık görüntü farkı (${U.trDateShort(diff.baseDate)} → bugün)`, `Snapshot diff (${U.trDateShort(diff.baseDate)} → today)`);
    const pick = arr => arr.filter(e => e.s === srcKey);
    items.push(...groupListItems(src, srcKey, pick(diff.added), 'ADD', win.end, m, titleFn, urlFn));
    items.push(...groupListItems(src, srcKey, pick(diff.updated), 'UPD', win.end, m, titleFn, urlFn));
    items.push(...groupListItems(src, srcKey, pick(diff.removed), 'DEL', win.end, m, titleFn, urlFn));
    method = B(`anlık görüntü farkı (${U.trDateShort(diff.baseDate)} ↔ bugün)`, `snapshot diff (${U.trDateShort(diff.baseDate)} ↔ today)`);
  } else {
    const m = B('Liste tarih alanları (önceki gün görüntüsü henüz yok)', 'List date fields (no previous-day snapshot yet)');
    const added = l.entries.filter(e => e.d && e.d >= win.start && e.d <= win.end);
    const upd = l.entries.filter(e => e.u && e.u >= win.start && e.u <= win.end && !(e.d && e.d >= win.start && e.d <= win.end));
    items.push(...groupListItems(src, srcKey, added, 'ADD', win.end, m, titleFn, urlFn));
    items.push(...groupListItems(src, srcKey, upd, 'UPD', win.end, m, titleFn, urlFn));
    method = B('liste tarih alanları (LastUpdated/DateDesignated); önceki gün görüntüsü olmadığı için silme tespit edilemez', 'list date fields (LastUpdated/DateDesignated); removals cannot be detected until a previous-day snapshot exists');
  }
  const d0 = U.trDateShort(l.fetchedAt.slice(0, 10));
  return { items, note: B(`Liste: ${l.entries.length} kayıt, ${d0} indirildi. Yöntem: ${method.tr}.`, `List: ${l.entries.length} records, downloaded ${d0}. Method: ${method.en}.`), count: items.length };
}

// ───────────────────────── AB EUR-Lex ─────────────────────────
async function fetchEUROJ(win) {
  const items = []; const days = []; let fetched = 0; let errs = 0;
  for (let d = win.start; d <= win.end; d = U.addDays(d, 1)) days.push(d);
  const seenAll = new Set();
  for (const d of days) {
    const [y, m, dd] = d.split('-'); const q = `${dd}${m}${y}`;
    const url = `https://eur-lex.europa.eu/oj/daily-view/L-series/default.html?ojDate=${q}`;
    let html;
    try { html = await U.fetchText(url, { retries: 1 }); fetched++; } catch (e) { errs++; continue; }
    const seen = new Set();
    for (const a of html.matchAll(/<a[^>]+href="([^"]*uri=OJ:L_(\d{9})[^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const num = a[2]; if (seen.has(num) || seenAll.has(num)) continue;
      const title = U.stripTags(a[3]).replace(/\s+/g, ' ');
      if (!title || /corrigendum/i.test(title) && !/restrictive/i.test(title)) { continue; }
      seen.add(num); seenAll.add(num);
      const rel = /restrictive measures|sanction|269\/2014|2014\/269|833\/2014|2014\/833|CFSP|asset freeze|frozen|Belarus|Russia|Iran|Syria|Libya|Myanmar|North Korea|DPRK|Venezuela|terroris|Afghanistan|Yemen|Hamas|Chemical weapons|Cyber-attacks|human rights/i.test(title);
      if (!rel) continue;
      let type = 'UPD';
      if (/corrigendum/i.test(title)) type = 'INFO';
      else if (/delist|repealing|terminat|removing|removal of/i.test(title)) type = 'DEL';
      else if (/implementing regulation.*(amending|implementing).*(269\/2014|restrictive)|amending annex/i.test(title)) type = 'UPD';
      items.push(mk({ source: 'AB', srcKey: 'eu', date: d, type, title, summary: B('AB Resmî Gazete L serisinde yayımlanan yaptırım/kısıtlayıcı tedbir mevzuatı. Liste değişikliğinin ekleme/silme niteliği için metin (Ek) incelenmeli.', 'Sanctions / restrictive-measures legislation published in the OJ L series. Read the text (Annex) to establish whether entries were added or removed.'), url: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=OJ:L_${num}`, method: B('EUR-Lex OJ günlük görünüm (L serisi)', 'EUR-Lex OJ daily view (L series)'), ojRef: num }));
    }
  }
  if (!fetched) throw new Error('EUR-Lex OJ günlük görünüm sayfaları alınamadı');
  return { items, note: B(`EUR-Lex OJ L serisi: ${days.map(d => U.trDateShort(d)).join(', ')} tarihleri tarandı (${fetched} sayfa${errs ? ', ' + errs + ' hata' : ''}); yaptırımla ilgili başlıklar süzüldü.`, `EUR-Lex OJ L series: ${days.map(d => U.trDateShort(d)).join(', ')} scanned (${fetched} pages${errs ? ', ' + errs + ' errors' : ''}); sanctions-related titles filtered.`), count: items.length };
}

// ───────────────────────── BM ─────────────────────────
async function fetchUNPress(win) {
  let usedRss = false; let xml;
  const items = [];
  let rows = [];
  try {
    const html = await U.fetchText(SRC.un.page, { retries: 0 });
    for (const m of html.matchAll(/<a[^>]+href="(\/en\/\d{4}\/(sc\d+)\.doc\.htm)"[^>]*>([\s\S]*?)<\/a>/gi)) rows.push({ link: 'https://press.un.org' + m[1], title: U.stripTags(m[3]), date: '' });
  } catch (e) { /* RSS yedeği */ }
  if (!rows.length) {
    usedRss = true;
    const r = await U.fetchText('https://press.un.org/en/rss.xml', { retries: 1 }).catch(() => null);
    xml = r;
    if (!xml) {
      const buf = await U.fetchText('https://press.un.org/en/rss.xml', { retries: 0, headers: { 'Accept-Encoding': 'identity' } });
      xml = buf;
    }
    for (const it of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const g = t => U.decodeEntities((new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>').exec(it[1]) || [])[1] || '').trim();
      const dt = new Date(g('pubDate')); if (isNaN(dt)) continue;
      rows.push({ link: g('link'), title: g('title'), summary: U.stripTags(g('description')), date: U.isoDate(dt) });
    }
  }
  for (const r of rows) {
    const isSC = /\/sc\d+\.doc/i.test(r.link) || /security council/i.test(r.title + ' ' + (r.summary || ''));
    const kw = /sanction|entry|delist|remov|committee|1267|1718|2231|asset freeze|travel ban|arms embargo|listing|terror/i.test(r.title + ' ' + (r.summary || ''));
    if (!(isSC && kw)) continue;
    if (r.date && (r.date < win.start || r.date > win.end)) continue;
    const t = /delist|remov|terminat/i.test(r.title) ? 'DEL' : /sanction|entry|listing|designat/i.test(r.title) ? 'INFO' : 'INFO';
    items.push(mk({ source: 'BM', srcKey: 'un', date: r.date || win.end, type: t, title: r.title, summary: (r.summary || '').slice(0, 400), url: r.link, method: usedRss ? B('press.un.org RSS (SC sayfası bot koruması nedeniyle yedek)', 'press.un.org RSS (fallback: SC page is behind a bot challenge)') : B('press.un.org Security Council sayfası', 'press.un.org Security Council page') }));
  }
  return { items, note: usedRss ? B('BM Güvenlik Konseyi sayfası bot koruması (JS doğrulaması) ile engelli; yedek olarak press.un.org RSS akışı (yalnızca son birkaç kayıt) kullanıldı. Tam kapsam için sayfayı kontrol edin.', 'The UN Security Council page is behind a bot challenge; the press.un.org RSS feed (latest few items only) is used as a fallback. Check the page directly for full coverage.') : B('BM SC basın sayfası okundu.', 'UN SC press page read.'), count: items.length, degraded: usedRss };
}

// ───────────────────────── FATF ─────────────────────────
async function fetchFATF(win) {
  const snap = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'data', 'fatf.json'), 'utf8'));
  let live = null, err = null;
  try {
    const html = await U.fetchText(SRC.fatf.page, { retries: 0, timeout: 20000 });
    live = U.stripTags(html);
  } catch (e) { err = e.message; }
  if (!live) return { items: [], degraded: true, note: B(`FATF sitesi okunamadı (${err}). Gömülü anlık görüntü kullanılıyor: ${snap.statementTitle} (doğrulama: ${U.trDateShort(snap.verifiedOn)}).`, `FATF site could not be read (${err}). Using the embedded snapshot: statement of ${snap.statementDateISO} (verified ${snap.verifiedOn}).`), count: 0, error: err };
  const dm = /Jurisdictions under Increased Monitoring\s*[–-]\s*(\d{1,2} \w+ \d{4})/.exec(live);
  return { items: [], note: B(`FATF sayfası canlı okundu. Son “Increased Monitoring” başlığı: ${dm ? dm[1] : 'bulunamadı'}. Gömülü liste tarihi: ${snap.statementDateISO}.`, `FATF page read live. Latest “Increased Monitoring” heading: ${dm ? dm[1] : 'not found'}. Embedded list date: ${snap.statementDateISO}.`), count: 0, liveStatement: dm ? dm[1] : null };
}


// ───────────────────────── Federal Register (OFAC, BIS) ─────────────────────────
async function fetchFederalRegister(win) {
  const items = []; const errs = [];
  for (const [ag, code] of [['foreign-assets-control-office', 'OFAC'], ['industry-and-security-bureau', 'BIS']]) {
    const url = `https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=${ag}&conditions[publication_date][gte]=${win.start}&order=newest&per_page=40&fields[]=title&fields[]=type&fields[]=abstract&fields[]=publication_date&fields[]=html_url&fields[]=document_number`;
    try {
      const j = JSON.parse(await U.fetchText(url, { timeout: 30000, retries: 1, api: true }));
      for (const d of (j.results || [])) {
        const ti = d.title || ''; let type = 'INFO';
        if (/entity list/i.test(ti) && /addition|adding|revision/i.test(ti)) type = 'ADD'; else if (/entity list/i.test(ti) && /remov/i.test(ti)) type = 'DEL';
        else if (/penalt|settlement|enforcement|order denying|denial order/i.test(ti)) type = 'ENF'; else if (/general license/i.test(ti)) type = 'GL';
        else if (/sanctions action/i.test(ti)) type = 'ADD';
        items.push(mk({ source: 'Federal Register · ' + code, srcKey: 'fr', date: d.publication_date, type, title: ti, summary: (d.abstract || '').slice(0, 420), url: d.html_url, method: B('Federal Register API (resmî)', 'Federal Register API (official)') }));
      }
    } catch (e) { errs.push(code + ': ' + e.message); }
  }
  if (errs.length === 2) throw new Error(errs.join('; '));
  return { items, note: B(`Federal Register: OFAC ve BIS belgeleri ${U.trDateShort(win.start)} tarihinden itibaren tarandı${errs.length ? ' (kısmi hata: ' + errs[0] + ')' : ''}.`, `Federal Register: OFAC and BIS documents scanned since ${U.trDateShort(win.start)}${errs.length ? ' (partial error: ' + errs[0] + ')' : ''}.`), degraded: !!errs.length };
}

// ───────────────────────── Resmî Gazete günlük dizin ─────────────────────────
const RG_REL = /mal varlığ|dondurul|yaptırım|güvenlik konseyi|terör|kara para|aklanma|masak|ambargo|6415|7262|silahların yayılması|finansal suç|uluslararası kuruluş.*karar|kısıtlayıcı tedbir/i;
async function fetchResmiGazete(win) {
  const items = []; let fetched = 0, misses = 0; const seen = new Set();
  for (let d = win.end; d >= win.start; d = U.addDays(d, -1)) {
    const [y, m, dd] = d.split('-'); const url = d === win.end ? 'https://www.resmigazete.gov.tr/' : `https://www.resmigazete.gov.tr/eskiler/${y}/${m}/${y}${m}${dd}.htm`;
    let html; try { html = await U.fetchText(url, { timeout: 30000, retries: 0 }); fetched++; misses = 0; } catch (e) { if (e.robots || ++misses >= 2) { if (!fetched) throw e; break; } continue; }
    for (const a of html.matchAll(/<a[^>]+href="((?:https:\/\/www\.resmigazete\.gov\.tr)?\/eskiler\/(\d{4})\/(\d{2})\/(\d{8})-(\d+)\.(?:htm|pdf))"[^>]*>([\s\S]*?)<\/a>/g)) {
      const title = U.stripTags(a[6]).replace(/^[\s–-]+/, '').replace(/\s+/g, ' ').trim(); const href = a[1].startsWith('http') ? a[1] : 'https://www.resmigazete.gov.tr' + a[1];
      if (!title || seen.has(href) || !RG_REL.test(title)) continue; seen.add(href);
      const date = `${a[2]}-${a[3]}-${a[4].slice(6)}`; if (date < win.start || date > win.end) continue;
      const type = /dondurul|mal varlığ/i.test(title) ? 'ADD' : 'INFO';
      items.push(mk({ source: 'Resmî Gazete', srcKey: 'rg', date, type, title, summary: B('Resmî Gazete günlük dizininde yer alan, yaptırım/mal varlığı dondurma/kara para aklama ile ilgili olabilecek karar. Metin açılarak değerlendirilmelidir.', 'Item in the daily Official Gazette index that may relate to sanctions, asset freezing or AML. Open the text to assess.'), url: href, method: B('Resmî Gazete günlük dizin sayfası (anahtar sözcük süzgeci)', 'Official Gazette daily index page (keyword filter)') }));
    }
  }
  if (!fetched) throw new Error('Resmî Gazete sayfaları alınamadı');
  return { items, note: B(`Resmî Gazete günlük dizini ${fetched} gün için okundu; yaptırımla ilgili başlıklar süzüldü.`, `Official Gazette daily index read for ${fetched} day(s); sanctions-related headings filtered.`) };
}

// ───────────────────────── İzlenen sayfalar ─────────────────────────
async function fetchWatch(win) {
  const W = require('./watch'); const res = await W.checkAll(); const items = [];
  for (const c of W.changesSince(win.start)) {
    const added = c.added.map(([t]) => t); const date = c.ts.slice(0, 10);
    items.push(mk({ source: c.def.jur + ' · ' + c.def.label.split(':')[0].slice(0, 60), srcKey: 'watch', date, type: 'INFO', title: `${c.def.label.split(':')[0]}: ${added.length ? added.length + ' yeni bağlantı/başlık' : 'içerik değişti'}`, summary: added.length ? added.slice(0, 5).join(' · ') : B('Sayfada bağlantı/başlık çıkarıldı veya yeniden düzenlendi.', 'Links or headings were removed or rearranged.').tr, url: c.def.url, method: B('Sayfa izleme (parmak izi + bağlantı farkı)', 'Page watch (fingerprint + link diff)'), keywords: ['watch'] }));
  }
  const bad = res.filter(r => r.error);
  if (bad.length === res.length && res.length) throw new Error('Hiçbir sayfa okunamadı: ' + bad[0].error);
  return { items, degraded: bad.length > 0, note: B(`${res.length - bad.length}/${res.length} sayfa okundu${bad.length ? ' — okunamayan: ' + bad.map(b => b.id).join(', ') : ''}. Yapılandırma: data/watch.json.`, `${res.length - bad.length}/${res.length} pages read${bad.length ? ' — unreadable: ' + bad.map(b => b.id).join(', ') : ''}. Config: data/watch.json.`) };
}

module.exports = { fetchFederalRegister, fetchResmiGazete, fetchWatch, B, SRC, KEYWORDS, kwHits, fetchOFAC, fetchUKGov, fetchEUROJ, fetchUNPress, fetchFATF, listChanges, mk, TYPE_TR, parseOFACBody, countsText };
