'use strict';
/* İsteğe bağlı (kullanıcı tıklamasıyla) dış arama: GDELT olumsuz haber (adverse media) ve Interpol kırmızı bülten.
 * GDELT: halka açık DOC 2.0 API, en fazla 5 sn'de bir istek (genel kuyruk), 6 saat önbellek. Interpol: halka açık API, varsayılan KAPALI (UM_INTERPOL=1).
 * Gizlilik: aranan isim üçüncü tarafa gider; UM_EXTERNAL_LOOKUPS=0 ile tümü kapatılır. Müşteri toplu listeleri bu kanaldan ASLA gönderilmez. */
const F = require('./fetcher');
const store = require('./store');
const enabled = () => process.env.UM_EXTERNAL_LOOKUPS !== '0';
const interpolOn = () => enabled() && process.env.UM_INTERPOL === '1';
const info = () => ({ enabled: enabled(), gdelt: enabled(), interpol: interpolOn() });
const NEG = '(sanction OR sanctions OR laundering OR fraud OR corruption OR bribery OR terrorism OR smuggling OR trafficking OR embezzlement OR indicted OR arrested)';
const TTL = 6 * 3600e3;
let q = Promise.resolve(); let lastAt = 0;
const slot = fn => (q = q.then(async () => { const w = lastAt + 5200 - Date.now(); if (w > 0) await new Promise(r => setTimeout(r, w)); lastAt = Date.now(); return fn(); }, () => fn()));
function cached(key, fn) {
  const c = store.readCache('adverse-cache.json', {}); const e = c[key];
  if (e && Date.now() - e.at < TTL) return Promise.resolve({ ...e.v, cached: true });
  return fn().then(v => { const c2 = store.readCache('adverse-cache.json', {}); const now = Date.now(); for (const k of Object.keys(c2)) if (now - c2[k].at > TTL) delete c2[k]; c2[key] = { at: now, v }; store.writeCache('adverse-cache.json', c2); return v; });
}
async function gdelt(name) {
  const nm = String(name || '').replace(/["\\]/g, ' ').trim().slice(0, 120); if (nm.length < 3) throw Object.assign(new Error('İsim çok kısa'), { status: 422 });
  return cached('g:' + nm.toLowerCase(), () => slot(async () => {
    const url = 'https://api.gdeltproject.org/api/v2/doc/doc?' + new URLSearchParams({ query: `"${nm}" ${NEG}`, mode: 'ArtList', maxrecords: '15', format: 'json', sort: 'DateDesc', timespan: '24months' });
    const r = await F.request(url, { api: true, timeout: 45000, retries: 1 }); if (!r.ok) throw Object.assign(new Error('GDELT yanıt vermedi (HTTP ' + r.status + ')'), { status: 502 });
    const txt = await r.text(); let j = {}; try { j = JSON.parse(txt); } catch { if (txt.trim()) throw Object.assign(new Error('GDELT beklenmeyen yanıt verdi'), { status: 502 }); }
    return { provider: 'GDELT 2.0 DOC', query: nm, articles: (j.articles || []).map(a => ({ title: a.title, url: a.url, domain: a.domain, date: a.seendate, lang: a.language, country: a.sourcecountry })) };
  }));
}
async function interpol(name) {
  if (!interpolOn()) throw Object.assign(new Error('Interpol sorgusu kapalı (UM_INTERPOL=1 ile yönetici açar).'), { status: 403 });
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean); if (!parts.length) throw Object.assign(new Error('İsim gerekli'), { status: 422 });
  const forename = parts.slice(0, -1).join(' '), n = parts[parts.length - 1];
  return cached('i:' + parts.join(' ').toLowerCase(), () => slot(async () => {
    const r = await F.request('https://ws-public.interpol.int/notices/v1/red?' + new URLSearchParams({ name: n, forename, resultPerPage: '10' }), { api: true, timeout: 20000, retries: 1 });
    if (r.status === 403) throw Object.assign(new Error('Interpol halka açık API bu istemciyi reddetti (403). Elle sorgulayın: interpol.int'), { status: 502 });
    if (!r.ok) throw Object.assign(new Error('Interpol yanıt vermedi (HTTP ' + r.status + ')'), { status: 502 });
    const j = await r.json(); const it = j?._embedded?.notices || [];
    return { provider: 'Interpol Red Notices (public)', total: j.total || it.length, notices: it.map(x => ({ name: `${x.forename || ''} ${x.name || ''}`.trim(), dob: x.date_of_birth, nationalities: x.nationalities, url: x._links?.self?.href, entity: x.entity_id })) };
  }));
}
module.exports = { gdelt, interpol, info, enabled };
