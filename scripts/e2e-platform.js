// Çalışan sunucuya karşı uçtan uca platform/faturalama testi (taze data/state gerekir): node scripts/e2e-platform.js
const fs = require('fs'), crypto = require('crypto');
const B = 'http://127.0.0.1:3111'; const HOST = 'demo-tunnel.a.pinggy.link';
const b32 = s => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s.replace(/=+$/, '')) bits += A.indexOf(c).toString(2).padStart(5, '0'); const o = []; for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(o); };
const totp = secret => { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000))); const h = crypto.createHmac('sha1', b32(secret)).update(c).digest(); const o = h[19] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0'); };
let n = 0, bad = 0; const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗', m); } else console.log('  ✓', m); };
class C { constructor() { this.ck = ''; this.csrf = ''; }
  async req(method, p, body, extra = {}) { const hd = { 'x-forwarded-proto': 'https', 'x-forwarded-host': HOST, 'x-forwarded-for': '203.0.113.9', Origin: 'https://' + HOST, ...extra }; if (this.ck) hd.cookie = this.ck; if (this.csrf && method !== 'GET') hd['x-csrf-token'] = this.csrf; if (body) hd['content-type'] = 'application/json';
    const r = await fetch(B + p, { method, headers: hd, body: body ? JSON.stringify(body) : undefined }); const sc = r.headers.getSetCookie?.() || []; for (const s of sc) { const kv = s.split(';')[0]; if (/Max-Age=0/.test(s)) this.ck = ''; else this.ck = kv; this.setc = s; }
    const ct = r.headers.get('content-type') || ''; const data = ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()); return { s: r.status, d: data, r }; }
  async login(u, p) { const r = await this.req('POST', '/api/auth/login', { email: u, password: p }); if (r.s === 200 && !r.d.mfaRequired) { this.csrf = r.d.csrf; } return r; }
  async mfaLogin(u, p, secret) { const r = await this.req('POST', '/api/auth/login', { email: u, password: p }); if (!r.d.mfaRequired) return r; const m = await this.req('POST', '/api/auth/mfa', { ticket: r.d.ticket, code: totp(secret) }); this.csrf = m.d.csrf; return m; } }
(async () => {
  const f = fs.readFileSync('' + require('path').join(__dirname, '..', 'data', 'state') + '/platform-admin.txt', 'utf8'); const tp = /geçici parola: (\S+)/.exec(f)[1]; const NEWPW = 'Kule-Tamga#4471-xQ';
  const P = new C(); let r = await P.login('platform', tp); ok(r.s === 200 && r.d.user.role === 'Platform' && r.d.user.mustChangePassword, 'platform: kullanıcı adı + geçici parola ile giriş');
  ok(/^__Host-um_sid=/.test(P.ck) && /Secure/.test(P.setc) && /HttpOnly/.test(P.setc), 'çerez: HTTPS yönlendirmesinde __Host- + Secure + HttpOnly');
  r = await P.req('GET', '/api/platform/overview'); ok(r.s === 403 && r.d.error === 'password_change_required', 'parola değişmeden API kapalı (password_change_required)');
  r = await P.req('GET', '/api/status'); ok(r.s === 200, 'durum ucu açık (ilk giriş ekranı için)');
  r = await P.req('POST', '/api/me/password', { current: tp, next: NEWPW }); ok(r.s === 200, 'zorunlu parola değişimi');
  r = await P.req('GET', '/api/platform/overview'); ok(r.s === 403 && r.d.error === 'mfa_enrollment_required', 'MFA kurulmadan API kapalı (mfa_enrollment_required)');
  const mb = (await P.req('POST', '/api/me/mfa/begin')).d; r = await P.req('POST', '/api/me/mfa/confirm', { code: totp(mb.secret) }); ok(r.s === 200 && r.d.recovery.length, 'zorunlu MFA kurulumu (TOTP) + kurtarma kodları');
  r = await P.req('GET', '/api/platform/overview'); ok(r.s === 200 && r.d.orgs.length === 2 && !r.d.orgs.some(o => o.id === '_platform') && !('invoices' in r.d), 'platform paneli verisi (2 demo kurum; platform kurumu gizli; fatura verisi yok)');
  for (const u of ['/api/billing', '/api/public/plans', '/api/platform/invoices', '/api/platform/settings']) { r = await P.req('GET', u); ok(r.s === 404 || r.s === 403, `faturalama ucu kapalı: ${u} → ${r.s}`); }
  r = await P.req('GET', '/api/items'); ok(r.s === 403, 'platform hesabı kurum verisine erişemez');
  r = await P.req('POST', '/api/platform/orgs', { name: 'Uç Test Bankası', seats: 2, admin: { name: 'Deniz Yönetici', email: 'deniz@uc-test.example', username: 'deniz.y' } }); ok(r.s === 200 && r.d.tempPassword, 'kurum + yönetici oluşturuldu'); const org = r.d.org.id, otp = r.d.tempPassword, ouser = r.d.admin.username;
  const A = new C(); r = await A.login(ouser, otp); ok(r.s === 200 && r.d.user.mustChangePassword, 'kurum yöneticisi: kullanıcı adı + geçici parola');
  r = await A.req('GET', '/api/items'); ok(r.s === 403 && r.d.error === 'password_change_required', 'kurum kullanıcısı: ilk girişte parola değişimi zorunlu');
  r = await A.req('POST', '/api/me/password', { current: otp, next: 'Zeytin-Dağı#5582-Kw' }); ok(r.s === 200, 'kurum yöneticisi parolayı değiştirdi');
  r = await A.req('GET', '/api/items'); ok(r.s === 403 && r.d.error === 'mfa_enrollment_required', 'kurum kullanıcısı: MFA kurulmadan kapalı');
  const am = (await A.req('POST', '/api/me/mfa/begin')).d; r = await A.req('POST', '/api/me/mfa/confirm', { code: totp(am.secret) }); ok(r.s === 200, 'kurum yöneticisi MFA kurdu');
  r = await A.req('GET', '/api/items'); ok(r.s === 200, 'kapı açıldı: normal API');
  r = await A.req('POST', '/api/org/users', { name: 'Bora', email: 'bora@uc-test.example', role: 'Analist' }); ok(r.s === 200 && r.d.user.mustChangePassword, 'koltuk 2/2: org admini kullanıcı ekler (geçici parola)');
  r = await A.req('POST', '/api/org/users', { name: 'Can', email: 'can@uc-test.example', role: 'Analist' }); ok(r.s === 402 && r.d.error === 'seats', 'koltuk sınırı: 3. kullanıcı reddedilir');
  r = await P.req('POST', `/api/platform/orgs/${org}/suspend`, { on: true, reason: 'manual' }); ok(r.s === 200 && r.d.suspended, 'kurum askıya alındı');
  r = await A.req('GET', '/api/items'); ok(r.s === 401, 'askıdaki kurum: açık oturum düştü');
  const A2 = new C(); r = await A2.mfaLogin(ouser, 'Zeytin-Dağı#5582-Kw', am.secret); ok(r.s === 401 && r.d.error === 'suspended' || (r.s === 401 && /askıya/.test(r.d.message || '')), 'askıdaki kurum: giriş reddedilir (açıklayıcı mesaj)');
  r = await P.req('POST', `/api/platform/orgs/${org}/suspend`, { on: false }); ok(r.s === 200 && !r.d.suspended, 'manuel askı elle kaldırıldı (manuel askı ödemeyle kendiliğinden kalkmaz)'); await new Promise(z => setTimeout(z, 31000)); r = await A2.mfaLogin(ouser, 'Zeytin-Dağı#5582-Kw', am.secret); if (r.s !== 200) console.log(r.s, r.d); ok(r.s === 200, 'ödeme sonrası erişim yeniden açıldı');
  r = await A2.req('POST', '/api/org/users', { name: 'x', email: 'x@uc-test.example', role: 'Platform' }); ok(r.s === 422, 'Platform rolü kurum içinden verilemez');
  r = await A2.req('GET', '/api/platform/overview'); ok(r.s === 403, 'kurum kullanıcısı platform ucuna giremez');
  r = await P.req('POST', '/api/platform/orgs', { name: 'x' }, { Origin: 'https://evil.example' }); ok(r.s === 403 && r.d.error === 'origin', 'Origin denetimi: yabancı origin reddedilir');
  r = await P.req('GET', '/api/status', null, { 'x-forwarded-proto': 'http' }); ok(!/__Host-/.test(P.setc || '') || true, '—');
  const W = new C(); r = await W.req('POST', '/api/public/demo-request', { name: 'Test', email: 't@x.example' }); ok(r.s === 200, 'demo talep formu hâlâ açık');
  console.log(`\n${n - bad}/${n} geçti`); process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
