#!/usr/bin/env node
'use strict';
/* Diurna – GitHub Pages demo için veri anlık görüntüsü.
 *
 * Çalışan bir Diurna sunucusuna (yalnızca OKUMA istekleri) demo kullanıcısıyla bağlanır, ana ekranların GET yanıtlarını ve
 * resmî liste önbelleğini (data/cache/list-*.json) docs/demo/data/ altına yazar. Gizli bilgi yazılmaz: IP adresleri maskelenir,
 * oturum/CSRF alanları atılır. Yalnızca DEMO kurumunun örnek kişi/müşteri verisi kullanılır.
 *
 *   DEMO_BASE=http://127.0.0.1:3111 DEMO_USER=admin@demo-banka.example DEMO_PASS=... \
 *   DEMO_CACHE=./data/cache node scripts/snapshot-demo.js
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = path.resolve(process.env.DEMO_SRC || ROOT);   // lib/ ve data/ kaynağı (varsayılan: bu depo)
const BASE = process.env.DEMO_BASE || 'http://127.0.0.1:3111';
const USER = process.env.DEMO_USER, PASS = process.env.DEMO_PASS;
const CACHE = path.resolve(process.env.DEMO_CACHE || path.join(SRC, 'data', 'cache'));
const OUT = path.join(ROOT, 'docs', 'demo', 'data');
if (!USER || !PASS) { console.error('DEMO_USER ve DEMO_PASS gerekli'); process.exit(1); }
fs.mkdirSync(path.join(OUT, 'lists'), { recursive: true });

let cookie = '';
async function call(method, p, body, raw) {
  const r = await fetch(BASE + '/api' + p, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), cookie, ...(method !== 'GET' && csrf ? { 'X-CSRF-Token': csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(',').map(x => x.split(';')[0]).join('; ');
  const ct = r.headers.get('content-type') || ''; const txt = await r.text();
  if (!r.ok) return { __status: r.status };
  return raw || !ct.includes('json') ? { __text: txt, __ct: ct } : JSON.parse(txt);
}
let csrf = '';
const out = {};
const scrub = o => JSON.parse(JSON.stringify(o).replace(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g, '203.0.113.$4').replace(/QA taslak giriş metni\./g, 'Günlük yaptırım gelişmeleri aşağıda özetlenmiştir.').replace(/QA dört göz onay/g, 'Dört göz ilkesi uyarınca onaylandı').replace(/"(csrf|ticket|token|secret|pwHash|passwordHash|hash)":"[^"]*"/g, '"$1":""'));
async function get(p, key) { const r = await call('GET', p); if (r && r.__status) { console.log('  –', p, r.__status); return null; } out[key || p] = r.__text !== undefined ? { ...r, __text: r.__text.replace(/QA taslak giriş metni\./g, 'Günlük yaptırım gelişmeleri aşağıda özetlenmiştir.') } : scrub(r); return r; }

(async () => {
  const l = await call('POST', '/auth/login', { email: USER, password: PASS });
  if (!l.user) throw new Error('Giriş başarısız: ' + JSON.stringify(l).slice(0, 120));
  const st = await call('GET', '/status'); csrf = st.csrf;
  console.log('Kullanıcı:', l.user.email, '·', l.user.role, '· kurum:', l.org?.name);
  out['/status'] = scrub(st);
  for (const p of ['/items', '/me/today', '/notifications', '/tasks', '/analytics', '/org/users', '/bulletins', '/bulletins/today', '/customers', '/match', '/adverse/info',
    '/trade/meta', '/trade/notes', '/dd', '/sources', '/fatf', '/audit', '/settings/full', '/blocklist', '/reference', '/org/branches', '/roi', '/docs', '/outbox', '/apikeys', '/webhooks',
    '/me/watchlist', '/me/security', '/public/brand', '/public/status', '/watch', '/fetch/stats', '/translate/info', '/ai/status', '/ai/log', '/entities/stats', '/entities/feed?limit=40',
    '/me/report?lang=tr', '/me/report?lang=en', '/me/report?lang=ar']) await get(p);
  /* okuyucu paneli: öğelerin tam metni (sunucu önbelleği; saniyede sınırlı) */
  for (const it of ((out['/items'] || {}).items || []).slice(0, 36)) await get('/reader/' + it.id);
  const bl = out['/bulletins'] || [];
  for (const b of bl.slice(0, 12)) {
    await get('/bulletins/' + b.id);
    for (const ver of ['internal', 'affiliate']) for (const lang of ['tr', 'en', 'ar']) for (const fmt of ['html', 'text']) await get(`/bulletins/${b.id}/render?version=${ver}&lang=${lang}&format=${fmt}`);
  }
  const td = out['/bulletins/today']; if (td?.id) for (const ver of ['internal', 'affiliate']) for (const lang of ['tr', 'en', 'ar']) for (const fmt of ['html', 'text']) await get(`/bulletins/${td.id}/render?version=${ver}&lang=${lang}&format=${fmt}`);
  for (const m of (out['/outbox'] || []).slice(0, 6)) await get('/outbox/' + m.id);
  await get('/templates/customers.csv'); await get('/audit.csv'); await get('/export/audit.json'); await get('/export/my-data.json');

  /* Sunucuda henüz HTTP yolu olmayan ekranlar için kütüphane düzeyinde anlık görüntü (Veri motoru, izlenen sayfalar, çeviri/YZ durumu) */
  process.env.UM_CACHE_DIR = CACHE;
  try {
    const E = require(path.join(SRC, 'lib', 'entities'));
    if (!out['/entities/stats']) out['/entities/stats'] = E.stats();
    if (!out['/entities/feed?limit=40']) out['/entities/feed?limit=40'] = E.feed({ limit: 40 });
  } catch (e) { console.log('  – entities:', e.message); }
  try { if (!out['/watch']) out['/watch'] = require(path.join(SRC, 'lib', 'watch')).summary(); } catch (e) { console.log('  – watch:', e.message); }
  out['/translate/info'] = { configured: false, provider: 'none', ai: false, selfHosted: false };
  out['/ai/status'] = { enabled: false, configured: false, setting: null };
  out['/ai/log'] = [];
  out['/fetch/stats'] = out['/fetch/stats'] || { userAgent: 'Diurna/2 (+compliance-monitor)', fallbackOpenSanctions: true, hosts: [] };

  delete out['/billing']; delete out['/public/plans']; if (out['/status']) { delete out['/status'].billingAlert; if (out['/status'].org) { delete out['/status'].org.plan; delete out['/status'].org.seats; } }   // kapsam dışı: faturalama / fiyat
  out.__meta = { takenAt: new Date().toISOString(), user: { email: l.user.email, role: l.user.role }, org: l.org?.name };
  fs.writeFileSync(path.join(OUT, 'api.json'), JSON.stringify(out));
  console.log('api.json', (fs.statSync(path.join(OUT, 'api.json')).size / 1024).toFixed(0), 'KB;', Object.keys(out).length, 'uç');

  /* Liste önbelleği → kompakt dosyalar (kaynak başına). Alanlar kısaltıldı; 8 addan fazlası atılır. */
  const meta = JSON.parse(fs.readFileSync(path.join(CACHE, 'lists-meta.json'), 'utf8')); const lm = {};
  for (const f of fs.readdirSync(CACHE).filter(f => /^list-.+\.json$/.test(f))) {
    const src = f.slice(5, -5); const d = JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')); let n = 0;
    const rows = d.entries.map(e => { n++; const o = { s: e.s, id: String(e.id), n: (e.n || []).slice(0, 8), t: e.t, c: String(e.c || '').slice(0, 90) }; for (const k of ['d', 'u', 'ref', 'un', 'cty', 'imo', 'v', 'url']) if (e[k] && (!Array.isArray(e[k]) || e[k].length)) o[k] = typeof e[k] === 'string' ? e[k].slice(0, 160) : e[k]; return o; });
    fs.writeFileSync(path.join(OUT, 'lists', src + '.json'), JSON.stringify({ fetchedAt: d.fetchedAt, entries: rows })); lm[src] = n;
  }
  fs.writeFileSync(path.join(OUT, 'lists', 'index.json'), JSON.stringify({ counts: lm, meta }));
  console.log('listeler:', JSON.stringify(lm));
  fs.copyFileSync(path.join(SRC, 'data', 'sample-customers.csv'), path.join(OUT, 'sample-customers.csv'));
  for (const f of ['hs-dataset.json', 'border-gates.json', 'fatf.json', 'jurisdictions.json', 'eu-vessels.json']) if (fs.existsSync(path.join(SRC, 'data', f))) fs.copyFileSync(path.join(SRC, 'data', f), path.join(OUT, f));
})().catch(e => { console.error(e); process.exit(1); });
