'use strict';
/* İsteğe bağlı (kullanıcı tıklamasıyla) dış arama: GDELT olumsuz haber (adverse media) ve Interpol kırmızı bülten.
 * GDELT: halka açık DOC 2.0 API, en fazla 5 sn'de bir istek (genel kuyruk), 6 saat önbellek. Interpol: halka açık API, varsayılan KAPALI (UM_INTERPOL=1).
 * Gizlilik: aranan isim üçüncü tarafa gider; UM_EXTERNAL_LOOKUPS=0 ile tümü kapatılır. Müşteri toplu listeleri bu kanaldan ASLA gönderilmez. */
const F = require('./fetcher');
const store = require('./store');
/* Açık/kapalı: kurum ayarı (Yönetim → Listeler → Dış sorgular) varsa o; yoksa kurulum varsayılanı (ortam değişkeni). UM_EXTERNAL_LOOKUPS=0 kurulum düzeyinde kesin kapatır. */
const hardOff = () => process.env.UM_EXTERNAL_LOOKUPS === '0';
const setting = k => { try { const v = store.settings().lookups?.[k]; return v === true || v === false ? v : null; } catch { return null; } };
const gdeltOn = () => !hardOff() && (setting('gdelt') ?? true);
const interpolOn = () => !hardOff() && (setting('interpol') ?? process.env.UM_INTERPOL === '1');
const enabled = () => gdeltOn() || interpolOn();
const STATE = 'adverse-state.json';
const record = (k, ok, err) => { try { const c = store.readCache(STATE, {}); c[k] = { at: new Date().toISOString(), ok, error: ok ? null : String(err || '').slice(0, 160) }; store.writeCache(STATE, c); } catch { } };
const lastOutcome = k => { try { return store.readCache(STATE, {})[k] || null; } catch { return null; } };
const info = () => ({ enabled: enabled(), gdelt: gdeltOn(), interpol: interpolOn(), hardOff: hardOff() });
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
  if (!interpolOn()) throw Object.assign(new Error('Interpol sorgusu kapalı (yönetici Yönetim → Listeler ekranından açabilir).'), { status: 403 });
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
const gdeltT = async n => { try { const r = await gdelt(n); record('gdelt', true); return r; } catch (e) { if (e.status !== 422) record('gdelt', false, e.message); throw e; } };
const interpolT = async n => { try { const r = await interpol(n); record('interpol', true); return r; } catch (e) { if (e.status !== 422 && e.status !== 403 || /reddetti/.test(e.message)) record('interpol', false, e.message); throw e; } };
module.exports = { gdelt: gdeltT, interpol: interpolT, info, enabled, gdeltOn, interpolOn, hardOff, lastOutcome, setting };
