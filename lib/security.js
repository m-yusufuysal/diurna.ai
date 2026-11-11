'use strict';
/* Güvenlik yardımcıları: AES-256-GCM (dinlenme hâlinde şifreleme), TOTP (RFC 6238), IP izin listesi, hız sınırlama,
 * CSV enjeksiyon koruması, parola politikası, güvenlik başlıkları. Sırlar yalnızca ortam değişkeninden (veya geliştirme anahtar dosyası). */
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const KEYFILE = path.join(process.env.UM_DATA_DIR ? require('path').resolve(process.env.UM_DATA_DIR) : path.join(__dirname, '..', 'data', 'state'), '.datakey');

/* ── Anahtar yönetimi (KMS yer tutucusu): UM_DATA_KEY = 32 bayt base64/hex. Yoksa yerel geliştirme anahtarı üretilir. ── */
let KEY = null, KEY_SOURCE = 'env';
function key() {
  if (KEY) return KEY;
  const env = process.env.UM_DATA_KEY;
  if (env) { const b = /^[0-9a-f]{64}$/i.test(env) ? Buffer.from(env, 'hex') : Buffer.from(env, 'base64'); if (b.length !== 32) throw new Error('UM_DATA_KEY 32 bayt olmalı (base64 veya 64 hex karakter)'); KEY = b; return KEY; }
  if (process.env.NODE_ENV === 'production' && process.env.UM_ALLOW_FILE_KEY !== '1') throw new Error('Üretimde UM_DATA_KEY zorunludur (anahtar dosyası kullanılmaz). openssl rand -hex 32');
  KEY_SOURCE = 'file';
  try { KEY = Buffer.from(fs.readFileSync(KEYFILE, 'utf8').trim(), 'hex'); }
  catch { fs.mkdirSync(path.dirname(KEYFILE), { recursive: true }); KEY = crypto.randomBytes(32); fs.writeFileSync(KEYFILE, KEY.toString('hex'), { mode: 0o600 }); console.warn('  ⚠ UM_DATA_KEY tanımlı değil: yerel geliştirme anahtarı oluşturuldu (data/state/.datakey). Üretimde KMS/ortam değişkeni kullanın.'); }
  return KEY;
}
const keyInfo = () => { key(); return { source: KEY_SOURCE, algorithm: 'AES-256-GCM' }; };
function encrypt(plain) {
  const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key(), iv); const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return { enc: 'aes-256-gcm', v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}
function decrypt(o) { const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(o.iv, 'base64')); d.setAuthTag(Buffer.from(o.tag, 'base64')); return Buffer.concat([d.update(Buffer.from(o.ct, 'base64')), d.final()]).toString('utf8'); }
const isEnc = o => o && o.enc === 'aes-256-gcm';
const encStr = s => 'enc1:' + Buffer.from(JSON.stringify(encrypt(s))).toString('base64');
const decStr = s => (typeof s === 'string' && s.startsWith('enc1:')) ? decrypt(JSON.parse(Buffer.from(s.slice(5), 'base64').toString())) : s;

/* ── TOTP ── */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32enc(buf) { let bits = '', out = ''; for (const b of buf) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out; }
function b32dec(s) { let bits = ''; for (const c of s.replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(c); if (i < 0) continue; bits += i.toString(2).padStart(5, '0'); } const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); }
const totpSecret = () => b32enc(crypto.randomBytes(20));
function hotp(secret, counter) { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter)); const h = crypto.createHmac('sha1', b32dec(secret)).update(b).digest(); const o = h[19] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0'); }
function totpVerify(secret, code, window = 1) { code = String(code || '').replace(/\s/g, ''); if (!/^\d{6}$/.test(code)) return false; const t = Math.floor(Date.now() / 30000); for (let w = -window; w <= window; w++) { const a = Buffer.from(hotp(secret, t + w)), b = Buffer.from(code); if (crypto.timingSafeEqual(a, b)) return t + w; } return false; }
const otpauth = (secret, account, issuer = 'Diurna') => `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

/* ── IP izin listesi (IPv4 CIDR / tek adres / IPv6 tam eşleşme) ── */
const ip4 = s => { const m = /^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s || ''); return m ? ((+m[1] << 24) >>> 0) + (+m[2] << 16) + (+m[3] << 8) + +m[4] : null; };
function ipAllowed(ip, list) {
  if (!list || !list.length) return true; const n = ip4(ip);
  return list.some(rule => { rule = String(rule).trim(); if (!rule) return false; const [base, bits] = rule.split('/'); if (n === null) return ip === rule; const b = ip4(base); if (b === null) return false; const mask = bits == null ? 0xFFFFFFFF : (bits === '0' ? 0 : (~0 << (32 - +bits)) >>> 0); return ((n & mask) >>> 0) === ((b & mask) >>> 0); });
}
/* ── Hız sınırlama (kayan pencere, bellek içi) ── */
const buckets = new Map();
function rateLimit(key, max, windowMs) { const now = Date.now(); const a = (buckets.get(key) || []).filter(t => t > now - windowMs); if (a.length >= max) { buckets.set(key, a); return { ok: false, retryAfter: Math.ceil((a[0] + windowMs - now) / 1000) }; } a.push(now); buckets.set(key, a); if (buckets.size > 50000) buckets.clear(); return { ok: true }; }
setInterval(() => { const now = Date.now(); for (const [k, a] of buckets) if (!a.length || a[a.length - 1] < now - 3600e3) buckets.delete(k); }, 600e3).unref();

/* ── CSV enjeksiyon koruması (OWASP): =,+,-,@,TAB,CR ile başlayan hücrelerin başına ' eklenir ── */
const csvCell = v => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
const toCSV = (rows, sep = ';') => '\uFEFF' + rows.map(r => r.map(csvCell).join(sep)).join('\r\n');

/* ── Parola politikası ── */
const COMMON = new Set(['password', 'parola', 'qwerty', '123456', 'admin', 'letmein', 'welcome', 'sifre', 'iloveyou']);
function passwordIssues(pw, ctx = {}, min = 12) {
  const e = []; pw = String(pw || '');
  if (pw.length < min) e.push('min_length:' + min); if (pw.length > 128) e.push('max_length');
  if (!/[a-zçğıöşü]/.test(pw)) e.push('lower'); if (!/[A-ZÇĞİÖŞÜ]/.test(pw)) e.push('upper'); if (!/\d/.test(pw)) e.push('digit'); if (!/[^\w\s]|_/.test(pw)) e.push('symbol');
  const low = pw.toLowerCase(); if ([...COMMON].some(c => low.includes(c))) e.push('common');
  if (ctx.email && low.includes(String(ctx.email).split('@')[0].toLowerCase()) && String(ctx.email).split('@')[0].length > 3) e.push('contains_email');
  return e;
}
/* ── Güvenlik başlıkları ── */
function headers(secure, kind = 'app') {
  const h = {
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': kind === 'frame' ? 'SAMEORIGIN' : 'DENY', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()', 'X-Permitted-Cross-Domain-Policies': 'none', 'X-DNS-Prefetch-Control': 'off',
    'Content-Security-Policy': kind === 'frame'
      ? "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"
      : "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  };
  if (secure) h['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload';
  return h;
}
const mask = s => String(s || '').replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, m => m[0] + '***@' + m.split('@')[1]).replace(/\b(\d{1,3}\.\d{1,3})\.\d{1,3}\.\d{1,3}\b/g, '$1.x.x');
module.exports = { encrypt, decrypt, isEnc, encStr, decStr, keyInfo, totpSecret, totpVerify, otpauth, ipAllowed, rateLimit, csvCell, toCSV, passwordIssues, headers, mask };
