#!/usr/bin/env node
/*
 * AB Reg. 833/2014 (konsolide metin) ekleri → GTİP/HS veri seti üretici.
 * Kaynak: EUR-Lex konsolide metin CELEX 02014R0833-<tarih>. Çıktı: data/hs-dataset.json, data/eu-vessels.json
 * Kullanım: node scripts/build-hs-dataset.js [YYYYMMDD]
 */
const fs = require('fs'), path = require('path');
const VERSION = process.argv[2] || '20260724';
const CELEX = `02014R0833-${VERSION}`;
const URL = `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:${CELEX}`;
const OUT = path.join(__dirname, '..', 'data');

// Ek → madde, kısa Türkçe etiket, işlem türü. Madde metninden alıntı otomatik eklenir (İngilizce, resmî).
const ANNEXES = {
  'VII':   { art: '2a(1), 2b(1)', tr: 'Askerî/teknolojik güçlendirmeye katkı sağlayabilecek mal ve teknoloji (çift kullanımlı ve gelişmiş teknoloji)', kind: 'İhracat/tedarik yasağı' },
  'X':     { art: '3b(1)', tr: 'Petrol rafinajı ve doğalgaz sıvılaştırmaya uygun mal ve teknoloji', kind: 'İhracat/tedarik yasağı' },
  'XI':    { art: '3c(1)', tr: 'Havacılık ve uzay sanayiine uygun mal ve teknoloji', kind: 'İhracat/tedarik yasağı' },
  'XX':    { art: '3c(1)', tr: 'Jet yakıtı ve yakıt katkıları', kind: 'İhracat/tedarik yasağı' },
  'XVII':  { art: '3g', tr: 'Demir ve çelik ürünleri', kind: 'İthalat/satın alma/taşıma yasağı (Rusya menşeli veya Rusya’dan ihraç)' },
  'XVIII': { art: '3h(1)', tr: 'Lüks mallar', kind: 'İhracat/tedarik yasağı' },
  'XXI':   { art: '3i(1)', tr: 'Rusya’ya önemli gelir sağlayan mallar', kind: 'İthalat/satın alma yasağı (Rusya menşeli veya Rusya’dan ihraç)' },
  'XXIII': { art: '3k(1)', tr: 'Rusya’nın sanayi kapasitesini artırabilecek mallar', kind: 'İhracat/tedarik yasağı' },
  'XXXVII':{ art: '3k(1a)', tr: 'Rusya üzerinden transit yasağı kapsamındaki mal ve teknoloji', kind: 'Transit yasağı' },
  'XXV':   { art: '3m, 3n', tr: 'Ham petrol ve petrol ürünleri', kind: 'İthalat yasağı / hizmet yasağı (fiyat tavanı rejimi)' },
  'XXVI':  { art: '3o(1)-(2)', tr: 'Altın', kind: 'İthalat/satın alma yasağı' },
  'XXVII': { art: '3o(3)', tr: 'Altın içeren mücevher ve kuyumculuk ürünleri', kind: 'İthalat/satın alma yasağı' },
  'XXXIII':{ art: '12f', tr: 'Belirli üçüncü ülkelere (örn. Kırgızistan) ihracatı yasak mal ve teknoloji', kind: 'İhracat yasağı (üçüncü ülke)' },
  'XXXV':  { art: '2aa', tr: 'Ateşli silahlar ve diğer silahlar', kind: 'İhracat/tedarik yasağı' },
  'XL':    { art: '2, 2a, 12g, 12gb', tr: 'Ortak yüksek öncelikli kalemler (Rusya’ya yeniden ihracat riski)', kind: 'İhracat kontrolü / yeniden ihracat yasağı sözleşme şartı / özen yükümlülüğü' },
  'XLVIII':{ art: '12gb', tr: 'Rusya’ya yeniden ihracat riski için özen yükümlülüğü kapsamındaki mallar', kind: 'Özen (due diligence) yükümlülüğü' },
};
const ROMAN = Object.keys(ANNEXES);

function clean(h) {
  let t = h.replace(/<\/(p|tr|div|table|h\d)>/g, '\n').replace(/<[^>]+>/g, ' ');
  t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#8217;|&rsquo;/g, '’').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
  return t.replace(/[ \t\u00a0]+/g, ' ').replace(/\n\s*\n+/g, '\n');
}
const CODE_LINE = /^\s*(ex\s+)?(\d{2}|\d{4}(?: ?\d{2}){0,3})(\s*,\s*\d{4}(?: ?\d{2}){0,3})*\s*$/i;

function annexSlice(t, rom) {
  const re = new RegExp('^\\s*ANNEX ' + rom + '\\s*$', 'm');
  const m = re.exec(t); if (!m) return null;
  const rest = t.slice(m.index + m[0].length);
  const n = /^\s*ANNEX [IVXLC]+\s*$/m.exec(rest);
  return rest.slice(0, n ? n.index : undefined);
}
function articleQuote(t, art) {
  const first = art.split(/[,(]/)[0].trim();
  const m = new RegExp('^\\s*Article ' + first + '\\s*$', 'm').exec(t);
  if (!m) return '';
  const seg = t.slice(m.index, m.index + 1200).split('\n').map(s => s.trim()).filter(s => s.length > 4 && !/^▼/.test(s) && !/^Article /.test(s));
  return seg.slice(0, 4).join(' ').replace(/\s+/g, ' ').slice(0, 380);
}

function parseCodes(slice) {
  const lines = slice.split('\n').map(s => s.trim()).filter(Boolean);
  const rows = []; let part = ''; let pendingEx = false; let cur = null;
  const flush = () => { if (cur) { cur.desc = cur.desc.join(' ').replace(/\s+/g, ' ').trim(); rows.push(cur); cur = null; } };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^▼/.test(l) || /^►/.test(l) || /^[–—-]{3,}/.test(l)) { continue; }
    if (/^Part [A-Z]\b/i.test(l)) { flush(); part = l.replace(/\s+/g, ' ').slice(0, 20); continue; }
    if (/^ex$/i.test(l)) { flush(); pendingEx = true; continue; }
    const m = CODE_LINE.exec(l);
    if (m) {
      flush();
      const ex = pendingEx || !!m[1]; pendingEx = false;
      const codes = l.replace(/^ex\s+/i, '').split(',').map(s => s.trim()).filter(Boolean);
      cur = { codes, ex, part, desc: [] };
    } else if (cur) {
      if (/^(CN|Description|Name of the good|Product|CN code|CN Code|Country|CN\/TARIC Code)$/i.test(l)) continue;
      if (/^List of goods/.test(l) || /^List of /.test(l)) { flush(); continue; }
      cur.desc.push(l);
    }
  }
  flush();
  return rows.filter(r => r.desc !== '' || r.codes.length);
}

(async () => {
  console.log('İndiriliyor', URL);
  const res = await fetch(URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const html = await res.text();
  const t = clean(html);
  const items = [];
  const stats = {};
  for (const rom of ROMAN) {
    const sl = annexSlice(t, rom); if (!sl) { console.log('Ek bulunamadı', rom); continue; }
    const meta = ANNEXES[rom];
    const quote = articleQuote(t, meta.art);
    let rows = parseCodes(sl);
    if (rom === 'VII') rows = rows.filter(r => r.part === 'Part B');   // Kısım A çift kullanımlı kategori metnidir (CN kodu içermez)
    rows = rows.filter(r => rom === 'XI' || r.codes.every(c => c.replace(/\s/g, '').length >= 4));
    stats[rom] = 0;
    for (const r of rows) for (const code of r.codes) {
      const digits = code.replace(/\s/g, '');
      if (digits.length < 2) continue;
      items.push({ annex: rom, article: meta.art, part: r.part, code: code, digits, h4: digits.slice(0, 4), chapter: digits.length === 2, ex: r.ex, desc: r.desc.slice(0, 400) });
      stats[rom]++;
    }
    meta.quote = quote;
  }
  fs.writeFileSync(path.join(OUT, 'hs-dataset.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), source: URL, celex: CELEX,
    note: 'Reg. (AB) 833/2014 konsolide metninden (EUR-Lex) otomatik çıkarılmıştır. Bağlayıcı değildir; resmî metin Resmî Gazete’dir (OJ).',
    annexes: ANNEXES, items
  }));
  // Ek XLII gemi listesi
  const sl = annexSlice(t, 'XLII');
  const lines = sl.split('\n').map(s => s.trim()).filter(Boolean);
  const vessels = []; let blk = [];
  const pushBlk = () => {
    if (!blk.length) return;
    const imoIdx = blk.findIndex(x => /^\d{7}$/.test(x));
    if (imoIdx > 0) {
      const name = blk.slice(0, imoIdx).join(' ').replace(/\s+/g, ' ');
      const rest = blk.slice(imoIdx + 1);
      const date = [...rest].reverse().find(x => /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(x)) || '';
      const grounds = rest.filter(x => x !== date).join(' ').replace(/\s+/g, ' ').slice(0, 420);
      vessels.push({ name, imo: blk[imoIdx], grounds, date });
    }
    blk = [];
  };
  for (const l of lines) {
    if (/^▼|^►/.test(l)) continue;
    if (/^\d+\.?$/.test(l) && !/^\d{7}$/.test(l)) { pushBlk(); continue; }
    if (/^(Vessel name|IMO number|Grounds for inclusion|Date of application|List of vessels)/.test(l)) continue;
    blk.push(l);
  }
  pushBlk();
  fs.writeFileSync(path.join(OUT, 'eu-vessels.json'), JSON.stringify({ generatedAt: new Date().toISOString(), source: URL, celex: CELEX, annex: 'XLII', article: '3s', vessels }));
  console.log('Satır sayıları (ek bazında):', stats, 'Toplam', items.length, '· gemi', vessels.length);
})().catch(e => { console.error(e); process.exit(1); });
