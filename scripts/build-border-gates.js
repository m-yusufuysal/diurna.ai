#!/usr/bin/env node
/* udybelgesi.com “Türkiye Sınır Kapıları” sayfasındaki kara sınır kapıları tablosunu data/border-gates.json olarak kaydeder. */
const fs = require('fs'), path = require('path');
const URL = 'https://www.udybelgesi.com/turkiye-sinir-kapilari.asp';
(async () => {
  const buf = Buffer.from(await (await fetch(URL, { headers: { 'User-Agent': 'Mozilla/5.0' } })).arrayBuffer());
  let html = buf.toString('utf8');
  if (html.includes('\uFFFD')) html = new TextDecoder('windows-1254').decode(buf);
  const tbl = /<table[\s\S]*?<\/table>/i.exec(html)[0];
  const rows = [...tbl.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map(m => [...m[0].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => c[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()));
  const gates = rows.filter(r => /^\d+$/.test(r[0])).map(r => {
    const raw = r[1]; const inactive = /FAAL DEĞİL/i.test(raw);
    const name = raw.replace(/\(FAAL DEĞİL\)/i, '').replace(/SINIR KAPISI/i, '').trim();
    return { no: +r[0], name, province: r[2], neighbour: r[3], active: !inactive };
  });
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'border-gates.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), source: URL, type: 'Kara sınır kapıları', gates }, null, 1));
  console.log(gates.length, 'kapı');
})().catch(e => { console.error(e); process.exit(1); });
