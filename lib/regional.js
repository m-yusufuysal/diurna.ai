'use strict';
/* Bölgesel resmî listeler: Avustralya DFAT (xlsx) ve Japonya MOF (xlsx) ayrıştırıcıları. Bağımlılıksız (lib/xlsx.js).
 * DFAT sütun adları belgelenmiş "Consolidated List" biçimine göre başlık-adıyla eşlenir (sütun sırası değişse de çalışır);
 * MOF sayfaları “告示番号 + 英語表記” başlıklı satırlardan okunur. */
const X = require('./xlsx');
const clean = s => String(s == null ? '' : s).replace(/_x000D_/g, '').replace(/\r/g, '').trim();
const norm = s => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const latin = s => /[A-Za-z]{2}/.test(s);

function parseDFAT(buf) {
  const wb = X.read(buf); const out = []; const byRef = new Map();
  for (const sh of wb) {
    let hi = sh.rows.findIndex(r => r.some(c => norm(c) === 'reference') && r.some(c => /^name of individual/.test(norm(c))));
    if (hi < 0) continue; const H = sh.rows[hi].map(norm); const ix = re => H.findIndex(h => re.test(h));
    const iRef = ix(/^reference$/), iName = ix(/^name of individual/), iType = ix(/^type$/), iNT = ix(/^name type/), iCom = ix(/committee/), iCtl = ix(/control date/), iInfo = ix(/additional information|listing information/), iImo = ix(/^imo number/);
    for (const r of sh.rows.slice(hi + 1)) {
      const ref = clean(r[iRef]).replace(/(?<=\d)[a-z]+$/i, ''), name = clean(r[iName]).replace(/\s+/g, ' '); if (!ref || !name) continue;
      let e = byRef.get(ref);
      if (!e) { const ty = norm(r[iType]); e = { s: 'au', id: ref, n: [], t: /entity|organi/.test(ty) ? 'e' : /vessel|ship/.test(ty) ? 'v' : 'p', c: clean(r[iCom]).slice(0, 120) || 'Autonomous/UN sanctions', u: '' }; byRef.set(ref, e); out.push(e); }
      const nt = norm(r[iNT]); if (/primary/.test(nt) || !e.n.length) e.n.unshift(name); else if (!e.n.includes(name)) e.n.push(name);
      const cd = clean(r[iCtl]); if (cd) { const m = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/.exec(cd); if (m) e.u = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; else if (/^\d{4}-\d{2}-\d{2}/.test(cd)) e.u = cd.slice(0, 10); else if (/^\d{5}$/.test(cd)) e.u = new Date(Date.UTC(1899, 11, 30) + (+cd) * 864e5).toISOString().slice(0, 10); }
      if (iImo >= 0 && !e.imo) { const im = /(\d{7})/.exec(clean(r[iImo])); if (im) e.imo = [im[1]]; }
      if (iInfo >= 0 && !e.imo) { const im = /IMO\D{0,6}(\d{7})/i.exec(clean(r[iInfo])); if (im) e.imo = [im[1]]; }
    }
  }
  for (const e of out) e.n = [...new Set(e.n)];
  return out;
}

/* MOF (財務省) 資産凍結等対象者リスト: sayfa başına bir program; satır başına 告示番号. Silinmiş satırların (…削除) İngilizce adı boştur → atlanır. */
function parseMOF(buf) {
  const wb = X.read(buf); const out = [];
  wb.forEach((sh, si) => {
    const hi = sh.rows.findIndex(r => r.some(c => /告示番号/.test(c)) && r.some(c => /英語表記/.test(c))); if (hi < 0) return;
    const H = sh.rows[hi].map(c => clean(c)); const col = re => H.findIndex(h => re.test(h));
    const iNo = col(/告示番号/), iEn = col(/英語表記/), iJa = col(/日本語表記/), iAl = col(/別名|別称/), iOld = col(/旧称/), iDate = col(/告示日付/), iAddr = col(/住所|所在地/);
    const prog = clean(sh.rows[0][0]).split('\n')[0].replace(/[ァ-ヶー]{6,}$/, '').trim();
    const num = (sh.name.match(/^(\d+)\./) || [])[1] || String(si);
    const isPerson = /個人|テロリスト|タリバーン|ミロシェ|北朝鮮.*個人|スーダン|イラク前政権.*（Ⅰ/.test(sh.name + prog) && !/団体/.test(sh.name);
    for (const r of sh.rows.slice(hi + 1)) {
      const no = clean(r[iNo]); let en = clean(r[iEn]); if (!no) continue; if (!en) { en = clean(r[iJa]); if (!en) continue; }
      const names = [];
      const push = v => { v = v.replace(/^\(?[a-z]\)\s*/i, '').replace(/^[a-z]\.k\.a\.\s*:?\s*/i, '').replace(/\s+/g, ' ').trim(); if (v && !names.includes(v) && v.length > 1) names.push(v); };
      for (const ln of en.split('\n')) push(ln);      // İngilizce + (varsa) Arapça yazım
      for (const ci of [iAl, iOld]) if (ci >= 0) for (const ln of clean(r[ci]).split(/\n|;|、|\(\w\)(?=[A-Z])/)) { const v = ln.trim(); if (latin(v) && !/^不明$/.test(v)) push(v.replace(/[（(][^）)]*[）)]/g, m => /[A-Za-z]/.test(m) ? m.slice(1, -1) : '')); }
      const dm = /(\d{4})\.(\d{1,2})\.(\d{1,2})/.exec(clean(r[iDate]));
      const e = { s: 'jp', id: num + '-' + no.replace(/[^\w*()-]/g, ''), n: names, t: 'p', c: sh.name.replace(/^\d+\./, '').trim() || prog.slice(0, 100), d: dm ? `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}` : '', u: '' };
      if (/団体|グループ/.test(sh.name) || /Enterprise|Company|Group|Organi[sz]ation/i.test(en) || /\b(LLC|LTD|CO\.|COMPANY|BANK|CORP|ORGANI[SZ]ATION|FRONT|ARMY|GROUP|TRUST)\b/i.test(en)) e.t = 'e';
      const imo = /\bIMO\D{0,8}(\d{7})/i.exec(r.map(clean).join(' ')); if (imo) { e.imo = [imo[1]]; e.t = 'v'; }
      out.push(e);
    }
  });
  return out;
}

/* MASAK (Hazine ve Maliye Bakanlığı) malvarlığı dondurma listeleri: masak.hmb.gov.tr sitesinin kendi herkese açık arama uç noktası
 * (POST /portal/v2/masak/mvd/malvarligi-dondurulanlar). Dört tür: 6415 md.5 (BMGK), md.6 (yabancı ülke talebi), md.7 (iç dondurma), 7262 sayılı Kanun.
 * karar_sayisi = “Resmî Gazete tarihi / sayısı”. Dönüş: giriş başına {s:'tr', id, n, t, c, d (RG tarihi), ref (RG sayısı), nat, dob, prog, grp}. */
const MASAK_PROG = [[/7262/, '7262'], [/5\. ?Madde|md\.? ?5/i, '6415 md.5 (BMGK)'], [/6\. ?Madde|md\.? ?6/i, '6415 md.6 (yabancı ülke talebi)'], [/7\. ?Madde|md\.? ?7/i, '6415 md.7 (iç dondurma)']];
function parseMASAK(resps) {
  const out = []; const seen = new Set();
  for (const rs of resps) for (const r of (rs.data || rs)) {
    const name = clean(r.ad_soyad_unvan).replace(/\s+/g, ' '); if (!name) continue;
    const typ = clean(r.yaptirim_turu); const prog = (MASAK_PROG.find(([re]) => re.test(typ)) || [0, typ.slice(0, 40)])[1];
    const kar = clean(r.karar_sayisi); const km = /(\d{4}-\d{2}-\d{2})\s*\/\s*(\d+)/.exec(kar);
    const aliases = clean(r.diger_adlari).split(/\n|;|,|\s-\s|<[^>]*>|(?:^|(?<=[\d\s.)#]))[a-h]\)\s*/).map(x => x.replace(/\s+/g, ' ').replace(/[<>]/g, '').trim()).filter(x => x && x.length > 1 && !/^\(?.*İSMİNİN İLK HARFLERİ\)?$/i.test(x));
    const tc = clean(r.tckn_vkn); const dob = clean(r.dogum_tarihi);
    const person = !!(dob || clean(r.anne_adı) || clean(r.baba_adı) || /^\d{11}$/.test(tc)) || /GERÇEK KİŞİ/i.test(clean(r.orgutu)) && !/TÜZEL/i.test(clean(r.orgutu));
    const key = [prog, name, tc, dob, kar].join('|'); if (seen.has(key)) continue; seen.add(key);
    const id = 'M' + require('crypto').createHash('sha1').update(key).digest('hex').slice(0, 10);
    const e = { s: 'tr', id, n: [...new Set([name, ...aliases])], t: person ? 'p' : 'e', c: prog, d: km ? km[1] : '', u: km ? km[1] : '', ref: km ? 'RG ' + km[2] : kar, nat: clean(r.uyrugu), prog, grp: clean(r.orgutu) };
    if (dob) e.dob = dob; if (tc) e.idno = tc;
    out.push(e);
  }
  return out;
}

/* ---- MASAK resmî CSV (masak.hmb.gov.tr sayfa JSON'undaki bağlantılardan; Windows-1254, ';') ----
   A = 6415 md.5 (BMGK), B = md.6 (yabancı ülke talepleri), C = md.7 (iç dondurma), D = 7262 md.3A/3B (KİSYF). */
const MASAK_SECT = {
  A: { slug: '5-maddeye-iliskin-bakanlar-kurulu-kararlari', prog: '6415 md.5 (BMGK)', csv: /A-BIRLESMIS.*\.csv$/i, label: 'md.5 BMGK' },
  B: { slug: '6-maddeye-iliskin-bakanlar-kurulu-kararlari', prog: '6415 md.6 (yabancı ülke talebi)', csv: /B-YABANCI.*\.csv$/i, label: 'md.6 yabancı' },
  C: { slug: '7madde', prog: '6415 md.7 (iç dondurma)', csv: /C-IC-DONDURMA.*\.csv$/i, label: 'md.7 iç' },
  D: { slug: '3a3b', prog: '7262 md.3A/3B (KİSYF)', csv: /D-7262.*\.csv$/i, label: '7262 KİSYF' },
};
function csvRows(text) { // tırnaklı çok satırlı alanlar destekli ';' ayracı
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ';') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); } return rows;
}
const hnorm = s => clean(s).toLocaleLowerCase('tr').replace(/ı/g, 'i').replace(/[çÇ]/g, 'c').replace(/[şŞ]/g, 's').replace(/[ğĞ]/g, 'g').replace(/[üÜ]/g, 'u').replace(/[öÖ]/g, 'o').replace(/[^a-z0-9]+/g, ' ').trim();
const splitAl = v => clean(v).split(/\n|;|(?:^|(?<=[\d\s.)#]))[a-h]\)\s*|\s{3,}/).map(x => x.replace(/\s+/g, ' ').replace(/^[-–]\s*/, '').trim()).filter(x => x && x.length > 1 && !/^\(?.*İSMİNİN İLK HARFLERİ\)?$/i.test(x));
function parseMASAKcsv(buf, sect) {
  const S = MASAK_SECT[sect]; const text = Buffer.isBuffer(buf) ? new TextDecoder('windows-1254').decode(buf) : String(buf);
  const rows = csvRows(text); const hi = rows.findIndex(r => r.some(c => /^ad\b|ad soyad|gercek tuzel|adi soyadi/.test(hnorm(c)))); if (hi < 0) throw new Error('MASAK CSV başlığı bulunamadı');
  const head = rows[hi].map(hnorm); const col = (...re) => head.findIndex(h => re.some(r => r.test(h)));
  const C = { name: col(/^ad soyad|^adi soyadi|^gercek tuzel/), tit: col(/^unvani diger/), al: col(/kullandigi bilinen diger isim/), orig: col(/orijinal dilde/), id: col(/tckn|pasaport no|^pasaport/), nat: col(/^uyrugu$/), other: col(/diger uyruk/), type: col(/mvd yaptirim/), mom: col(/anne/), dad: col(/baba/), dob: col(/dogum tarihi/), pob: col(/dogum yeri/), org: col(/^orgutu|baglantili oldugu orgut/), dec: col(/karar (tarih|sayisi)/), rg: col(/resmi gazete tarih|r gazete tarih/), addr: col(/^adres/), role: col(/^gorevi/), listed: col(/listeye alinma/), old: col(/eski adi/) };
  const g = (r, k) => (C[k] >= 0 ? clean(r[C[k]]) : '');
  const out = []; let official = 0;
  for (const r of rows.slice(hi + 1)) {
    const name = g(r, 'name').replace(/\s+/g, ' '); if (!name || /^\d+$/.test(name)) continue; official++;
    const aliases = [...splitAl(g(r, 'al')), ...splitAl(g(r, 'orig')), ...splitAl(g(r, 'old'))];
    const idraw = g(r, 'id').replace(/\s+/g, ' '); const ids = [...new Set((idraw.match(/\b\d{10,11}\b|\b[A-Z]{1,2}\d{5,9}\b|(?<=\bPN:?\s?)[A-Z0-9]{5,}|(?<=pasaport numarası\s)[\w-]+/gi) || []))];
    const dobRaw = g(r, 'dob'); const dobs = [...new Set((dobRaw.match(/\d{1,2}\.\d{1,2}\.\d{4}|\b(?:19|20)\d{2}\b/g) || []).map(d => /\./.test(d) ? d.split('.').reverse().map((x, i) => i ? x.padStart(2, '0') : x).join('-') : d))];
    const rg = g(r, 'rg').replace(/\s+/g, ' '); const rm = /(\d{1,2}\.\d{1,2}\.\d{4})\s*[-/]\s*(\d+)/.exec(rg); const dec = g(r, 'dec').replace(/\s+/g, ' ');
    const dm = /(\d{1,2}\.\d{1,2}\.\d{4})/.exec(dec) || /(\d{1,2}\.\d{1,2}\.\d{4})/.exec(g(r, 'listed')); const iso = x => x ? x.split('.').reverse().map((y, i) => i ? y.padStart(2, '0') : y).join('-') : '';
    const typ = g(r, 'type'); const person = !!(dobs.length || g(r, 'mom') || g(r, 'dad') || /^\d{11}$/.test(ids[0] || '')) && !/TÜZEL|KURULUŞ/i.test(g(r, 'org') + ' ' + g(r, 'tit'));
    const key = [sect, name, idraw, dobRaw, rg, dec].join('|'); const id = 'M' + sect + require('crypto').createHash('sha1').update(key).digest('hex').slice(0, 9);
    const e = { s: 'tr', id, n: [...new Set([name, ...aliases])], t: person ? 'p' : 'e', c: S.prog, d: iso(dm?.[1]), u: iso(dm?.[1]), ref: rm ? `RG ${rm[1]} / ${rm[2]}` : (rg || dec), nat: g(r, 'nat'), prog: S.prog, grp: g(r, 'org'), sect, native: true };
    if (dobs.length) { e.dob = dobs[0]; e.dobs = dobs; } if (ids.length) { e.idno = ids[0]; e.ids = ids; } else if (idraw) e.idraw = idraw.slice(0, 80);
    if (g(r, 'mom')) e.mother = g(r, 'mom'); if (g(r, 'dad')) e.father = g(r, 'dad'); if (g(r, 'pob')) e.pob = g(r, 'pob'); if (g(r, 'addr')) e.addr = g(r, 'addr').replace(/\s+/g, ' ').slice(0, 300); if (g(r, 'role')) e.role = g(r, 'role').slice(0, 200); if (dec) e.dec = dec; if (typ) e.kind = typ;
    out.push(e);
  }
  out.official = official; return out;
}
/* Sayfa JSON'undan CSV bağlantısını çıkarır (aynı sayfadaki birden çok CSV'den ilgili bölüm kalıbına uyanı seçer). */
function masakCsvHref(pageJson, sect) {
  const html = (Array.isArray(pageJson) ? pageJson[0] : pageJson)?.content?.rendered || ''; const hs = [...html.matchAll(/href="([^"]+\.csv)"/gi)].map(m => m[1]);
  return hs.find(h => MASAK_SECT[sect].csv.test(decodeURIComponent(h.split('/').pop()))) || null;
}
module.exports = { parseDFAT, parseMOF, parseMASAK, parseMASAKcsv, masakCsvHref, MASAK_SECT, csvRows };
