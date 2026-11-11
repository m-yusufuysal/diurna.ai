'use strict';
/* Bağımlılıksız minimal .xlsx okuyucu (ZIP + XML): yalnızca düz metin/sayı hücreleri. Kaynak dosyalar güvenilmez kabul edilir:
 * boyut/satır sınırları var, formül/makro çalıştırılmaz, harici bağlantı izlenmez. */
const zlib = require('zlib');
const MAX_ENTRY = 120 * 1024 * 1024, MAX_ROWS = 400000;
function unzip(buf) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--; if (e < 0) throw new Error('xlsx: ZIP bitiş kaydı bulunamadı');
  let n = buf.readUInt16LE(e + 10), p = buf.readUInt32LE(e + 16); const files = {};
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('xlsx: bozuk ZIP dizini');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl); p += 46 + nl + xl + cl;
    if (usize > MAX_ENTRY) throw new Error('xlsx: parça çok büyük');
    files[name] = () => { const lh = off; const l = buf.readUInt16LE(lh + 26), x = buf.readUInt16LE(lh + 28); const data = buf.subarray(lh + 30 + l + x, lh + 30 + l + x + csize); return method === 0 ? data : zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY }); };
  }
  return files;
}
const ent = s => s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (m, g) => g[0] === '#' ? String.fromCodePoint(g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10)) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[g]));
const col = ref => { let n = 0; for (const c of ref.replace(/[^A-Z]/gi, '').toUpperCase()) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };
function sharedStrings(xml) { const out = []; for (const m of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) { let t = ''; for (const r of m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) t += ent(r[1]); out.push(t); } return out; }
/** Çalışma kitabını oku → [{ name, rows: string[][] }]. sheet: dizin/ad filtresi (varsayılan tümü). */
function read(buf, { only } = {}) {
  const z = unzip(buf); const get = n => z[n] ? z[n]().toString('utf8') : null; const wb = get('xl/workbook.xml'); if (!wb) throw new Error('xlsx: workbook.xml yok');
  const rels = get('xl/_rels/workbook.xml.rels') || ''; const relMap = {}; for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) { const id = /Id="([^"]+)"/.exec(m[0]), tg = /Target="([^"]+)"/.exec(m[0]); if (id && tg) relMap[id[1]] = tg[1].replace(/^\/?(xl\/)?/, 'xl/'); }
  const sst = get('xl/sharedStrings.xml') ? sharedStrings(get('xl/sharedStrings.xml')) : []; const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = ent((/name="([^"]*)"/.exec(m[0]) || [])[1] || ''), rid = (/r:id="([^"]+)"/.exec(m[0]) || [])[1]; if (only && !only(name, sheets.length)) continue;
    const file = relMap[rid]; const xml = file && get(file); if (!xml) continue; const rows = [];
    for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length >= MAX_ROWS) break; const row = [];
      for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const at = c[1], body = c[2] || ''; const ref = /r="([A-Z]+)\d+"/.exec(at); const t = (/t="(\w+)"/.exec(at) || [])[1]; let v = '';
        if (t === 'inlineStr') v = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x => ent(x[1])).join(''); else { const vv = /<v>([\s\S]*?)<\/v>/.exec(body); if (vv) v = t === 's' ? (sst[+vv[1]] ?? '') : ent(vv[1]); }
        row[ref ? col(ref[1]) : row.length] = v;
      }
      rows.push(Array.from(row, x => x ?? ''));
    }
    sheets.push({ name, rows });
  }
  return sheets;
}
module.exports = { read, unzip };
