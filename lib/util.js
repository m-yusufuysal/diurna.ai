'use strict';
const crypto = require('crypto');

const F = require('./fetcher');
const UA = F.UA();

/* Tüm dış istekler lib/fetcher.js (robots.txt, host başına hız sınırı, geri çekilme) üzerinden gider. api:true = resmî toplu dosya/API (robots.txt uygulanmaz). */
async function fetchText(url, o = {}) { return F.text(url, o); }

function stripTags(h) {
  return decodeEntities(String(h || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\u00a0]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
function decodeEntities(s) {
  return String(s).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&#8217;|&rsquo;/g, '’').replace(/&#8211;|&ndash;/g, '–').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const TR_DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
function pad(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
function todayISO(tz = 'Europe/Istanbul') {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return p; // YYYY-MM-DD
}
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoDate(d); }
function trDate(iso) { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${+d} ${TR_MONTHS[+m - 1]} ${y}`; }
function trDateShort(iso) { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}.${m}.${y}`; }
function trWeekday(iso) { return TR_DAYS[new Date(iso + 'T12:00:00Z').getUTCDay()]; }
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }
function dmyToISO(s) { const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec((s || '').trim()); return m ? `${m[3]}-${pad(+m[2])}-${pad(+m[1])}` : ''; }
function mdyToISO(s) { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((s || '').trim()); return m ? `${m[3]}-${pad(+m[1])}-${pad(+m[2])}` : ''; }
function rangeDays(endISO, n) { const out = []; for (let i = 0; i < n; i++) out.push(addDays(endISO, -i)); return out; }

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function uid(prefix = '') { return prefix + crypto.randomBytes(5).toString('hex'); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Basit CSV ayrıştırıcı (tırnak, ; veya , ayırıcı otomatik)
function parseCSV(text, delim) {
  text = text.replace(/^\uFEFF/, '');
  if (!delim) {
    const first = text.split(/\r?\n/, 1)[0] || '';
    const cnt = c => (first.match(new RegExp('\\' + c, 'g')) || []).length;
    delim = cnt(';') > cnt(',') ? ';' : (cnt('\t') > cnt(',') ? '\t' : ',');
  }
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c === '\r') { /* skip */ }
    else f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}

// Koşullu istek: ETag / Last-Modified + içerik özeti. {changed, text, notModified}
async function fetchCond(url, key, { timeout = 60000, headers = {}, force = false, api = true, retries = 2 } = {}) {
  const store = require('./store');
  const cache = store.readCache('http-cache.json', {});
  const c = cache[key] || {};
  const h = { ...headers };
  if (!force) { if (c.etag) h['If-None-Match'] = c.etag; if (c.lm) h['If-Modified-Since'] = c.lm; }
  const r = await F.request(url, { timeout, headers: h, api, retries });
  if (r.status === 304) { cache[key] = { ...c, checkedAt: new Date().toISOString() }; store.writeCache('http-cache.json', cache); return { changed: false, notModified: true, etag: c.etag, lm: c.lm }; }
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  const buf = Buffer.from(await r.arrayBuffer());
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const text = buf.toString('utf8');
  if (/Just a moment\.\.\.|Client Challenge/i.test(text.slice(0, 4000))) { const e = new Error('Bot koruması (JS doğrulaması) nedeniyle engellendi'); e.blocked = true; throw e; }
  const changed = force || hash !== c.hash;
  cache[key] = { etag: r.headers.get('etag') || '', lm: r.headers.get('last-modified') || '', hash, checkedAt: new Date().toISOString(), changedAt: (hash !== c.hash) ? new Date().toISOString() : c.changedAt, size: buf.length };
  store.writeCache('http-cache.json', cache);
  return { changed, text, etag: cache[key].etag, lm: cache[key].lm, size: buf.length };
}

module.exports = { fetchCond, fetchText, stripTags, decodeEntities, TR_MONTHS, TR_DAYS, pad, isoDate, todayISO, addDays, trDate, trDateShort, trWeekday, daysBetween, dmyToISO, mdyToISO, rangeDays, sha256, uid, esc, parseCSV, UA };
