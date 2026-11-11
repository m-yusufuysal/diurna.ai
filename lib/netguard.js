'use strict';
/* SSRF koruması: dış HTTP isteklerinden önce ana makineyi çözümler, özel/yerel/bağlantı-yerel/metadata adreslerini reddeder,
 * yönlendirmeleri elle (her sıçramada yeniden doğrulayarak) izler. UM_ALLOW_PRIVATE_FETCH=1 yalnızca yerel geliştirme/test içindir.
 * Bilinen sınır: çözümleme ile bağlantı arasında DNS yeniden bağlama (rebinding) penceresi kalır; tam çözüm için undici Agent + özel lookup
 * veya çıkış güvenlik duvarı (yalnızca 80/443, RFC1918/metadata engelli) kullanın — bkz. security-audit.md. */
const dns = require('dns').promises, net = require('net');
function v4Private(a) { const p = a.split('.').map(Number); const [x, y] = p; return x === 0 || x === 10 || x === 127 || (x === 100 && y >= 64 && y <= 127) || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 0) || (x === 192 && y === 168) || (x === 198 && (y === 18 || y === 19)) || x >= 224; }
function isPrivateIp(ip) {
  ip = String(ip).replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  if (net.isIPv4(ip)) return v4Private(ip);
  if (!net.isIPv6(ip)) return true;
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip); if (m) return v4Private(m[1]);
  const h = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip); if (h) { const n = (parseInt(h[1], 16) << 16) + parseInt(h[2], 16); return v4Private([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255].join('.')); }
  return ip === '::' || ip === '::1' || /^(fc|fd|fe[89ab])/.test(ip) || /^64:ff9b:/.test(ip) || /^(2001:db8|ff)/.test(ip);
}
const BAD_NAME = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|metadata\.google\.internal)$/i;
/* Senkron ön kontrol (URL zaten WHATWG ile normalleştirilir: 0x7f000001, 2130706433, 0177.0.0.1 → 127.0.0.1). */
function urlProblem(raw) {
  let u; try { u = new URL(raw); } catch { return 'geçersiz adres'; }
  if (!/^https?:$/.test(u.protocol)) return 'yalnızca http(s)'; if (u.username || u.password) return 'adreste kimlik bilgisi olamaz';
  const h = u.hostname.replace(/^\[|\]$/g, ''); if (BAD_NAME.test(h) || !h.includes('.') && !net.isIP(h) && !h.includes(':')) return 'yerel/iç ana makine';
  if ((net.isIP(h) || h.includes(':')) && isPrivateIp(h)) return 'özel/yerel IP';
  return null;
}
async function assertPublicUrl(raw) {
  if (process.env.UM_ALLOW_PRIVATE_FETCH === '1') return;
  const p = urlProblem(raw); if (p) throw Object.assign(new Error('SSRF engellendi: ' + p), { code: 'ssrf', blocked: true });
  const h = new URL(raw).hostname.replace(/^\[|\]$/g, ''); if (net.isIP(h)) return;
  const addrs = await dns.lookup(h, { all: true, verbatim: true }); if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw Object.assign(new Error('SSRF engellendi: ana makine özel adrese çözülüyor'), { code: 'ssrf', blocked: true });
}
/* fetch + elle yönlendirme (en çok 5 sıçrama, her biri yeniden doğrulanır) */
async function safeFetch(url, init = {}) {
  let cur = url; for (let i = 0; i <= 5; i++) {
    await assertPublicUrl(cur); const r = await fetch(cur, { ...init, redirect: 'manual' });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { try { r.body?.cancel(); } catch { } cur = new URL(r.headers.get('location'), cur).href; if (init.method && init.method !== 'GET' && r.status !== 307 && r.status !== 308) init = { ...init, method: 'GET', body: undefined }; continue; }
    return r;
  } throw Object.assign(new Error('Çok fazla yönlendirme'), { code: 'ssrf' });
}
module.exports = { isPrivateIp, urlProblem, assertPublicUrl, safeFetch };
