'use strict';
/* BYOL – kurumun kendi lisanslı veri ortağı abonelikleri (bring-your-own-license).
 * Kimlik bilgileri kuruma özeldir, AES-256-GCM ile şifrelenir ve istemciye ASLA geri döndürülmez (yalnızca son 4 karakter + dolu/boş).
 * Giden istekler SSRF korumalı safeFetch ile yapılır. Doğrulanamayan sağlayıcılar için yalnızca genel HTTP bağdaştırıcısı vardır:
 * uç nokta adresleri sözleşmenizdeki API belgesinden girilir; durum dürüstçe “Yapılandırıldı – test edilmedi / Bağlı / Hata” olarak gösterilir. Veri uydurulmaz. */
const fs = require('fs'), path = require('path');
const store = require('./store'), sec = require('./security'), U = require('./util'), M = require('./match');
const { safeFetch, urlProblem } = require('./netguard');

const OS_API = 'https://api.opensanctions.org';
const OS_BULK = d => `https://data.opensanctions.org/datasets/latest/${d}/targets.simple.csv`;
/* adapter: 'opensanctions' = doğrulanmış gerçek uç noktalar; 'generic' = yapılandırılabilir HTTP bağdaştırıcısı (uç nokta sözleşmeden). */
const PROVIDERS = [
  { id: 'opensanctions', name: 'OpenSanctions', adapter: 'opensanctions', fields: ['apiKey'], verified: true, docs: 'https://www.opensanctions.org/docs/api/', unlocks: ['ae', 'qa', 'sa', 'pep'] },
  { id: 'dowjones', name: 'Dow Jones Risk & Compliance', adapter: 'generic', fields: ['username', 'secret'], auth: 'oauth2', docs: 'https://developer.dowjones.com/' },
  { id: 'worldcheck', name: 'LSEG World-Check One', adapter: 'generic', fields: ['secret'], auth: 'bearer', docs: 'https://developers.lseg.com/' },
  { id: 'lexisnexis', name: 'LexisNexis Bridger / WorldCompliance', adapter: 'generic', fields: ['username', 'secret'], auth: 'basic', docs: 'https://risk.lexisnexis.com/' },
  { id: 'orbis', name: 'Moody’s / Bureau van Dijk Orbis', adapter: 'generic', fields: ['secret'], auth: 'header', header: 'ApiToken', docs: 'https://www.bvdinfo.com/' },
  { id: 'refinitiv', name: 'Refinitiv', adapter: 'generic', fields: ['username', 'secret'], auth: 'oauth2', docs: 'https://developers.lseg.com/' },
  { id: 'complyadvantage', name: 'ComplyAdvantage', adapter: 'generic', fields: ['secret'], auth: 'header', header: 'Authorization', prefix: 'Token ', docs: 'https://docs.complyadvantage.com/' },
  { id: 'sayari', name: 'Sayari', adapter: 'generic', fields: ['username', 'secret'], auth: 'oauth2', docs: 'https://documentation.sayari.com/' },
  { id: 'custom', name: 'Özel REST (HTTPS)', adapter: 'generic', fields: ['username', 'secret'], auth: 'bearer', custom: true, docs: '' },
];
const byId = id => PROVIDERS.find(p => p.id === id);
const file = n => path.join(store.orgDir(), n);
const rd = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; } };
const wr = (n, o) => { const p = file(n); fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 }); const t = p + '.' + process.pid + '.tmp'; fs.writeFileSync(t, JSON.stringify(o), { mode: 0o600 }); fs.renameSync(t, p); };
const cfg = () => rd('byol.json', { providers: {} });
const saveCfg = c => wr('byol.json', c);
const creds = pc => { try { return pc?.cred ? JSON.parse(sec.decStr(pc.cred)) : {}; } catch { return {}; } };
const mask = v => v ? '••••' + String(v).slice(-4) : '';
const clean = (s, n = 300) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, n);
const ENDPOINT_KEYS = ['baseUrl', 'tokenUrl', 'testPath', 'dataPath', 'authHeader', 'format', 'jsonPath', 'mapName', 'mapAliases', 'mapId', 'mapType', 'mapCountry', 'mapProgram', 'mapDate'];

function view(p, pc) {
  const c = creds(pc || {}); const secretSet = Object.fromEntries(p.fields.map(f => [f, { set: !!c[f], masked: mask(c[f]) }]));
  const st = pc?.status || {}; const configured = p.fields.every(f => c[f] || f === 'username') && !!Object.keys(c).length;
  const state = !configured ? 'unset' : st.state || 'configured';
  return { id: p.id, name: p.name, adapter: p.adapter, verified: !!p.verified, docs: p.docs || '', fields: p.fields, custom: !!p.custom, unlocks: p.unlocks || [], credentials: secretSet, endpoint: pc?.endpoint || {}, enabled: !!pc?.enabled, state, message: st.message || '', testedAt: st.at || null, sync: pc?.sync || null };
}
function list() { const c = cfg(); return PROVIDERS.map(p => view(p, c.providers[p.id])); }

function setCreds(id, body, u) {
  const p = byId(id); if (!p) throw Object.assign(new Error('Bilinmeyen sağlayıcı'), { status: 404 });
  const c = cfg(); const pc = c.providers[id] || {}; const cur = creds(pc); const inC = body.credentials || {};
  for (const f of p.fields) if (typeof inC[f] === 'string' && inC[f].trim()) cur[f] = inC[f].trim().slice(0, 2000);
  if (Object.keys(cur).length) pc.cred = sec.encStr(JSON.stringify(cur));
  if (body.endpoint && p.adapter === 'generic') { pc.endpoint = pc.endpoint || {}; for (const k of ENDPOINT_KEYS) if (k in body.endpoint) { const v = clean(body.endpoint[k]); if (/Url$/.test(k) && v) { const pr = urlProblem(v); if (pr || !/^https:\/\//i.test(v)) throw Object.assign(new Error('Adres https:// ile başlayan genel bir adres olmalı.'), { status: 422 }); } pc.endpoint[k] = v; } }
  if (!pc.status || inC && Object.keys(inC).length) pc.status = { state: 'configured', message: 'Yapılandırıldı – test edilmedi', at: null };
  if ('enabled' in body) pc.enabled = !!body.enabled && !!pc.cred;
  c.providers[id] = pc; saveCfg(c); store.logAudit(u, 'byol.update', id, [Object.keys(inC).filter(k => inC[k]).map(k => 'cred:' + k).join(','), 'enabled' in body ? 'enabled=' + !!body.enabled : ''].filter(Boolean).join(' ') || 'endpoint'); return view(p, pc);
}
function remove(id, u) { const p = byId(id); if (!p) throw Object.assign(new Error('Bilinmeyen sağlayıcı'), { status: 404 }); const c = cfg(); delete c.providers[id]; saveCfg(c); try { fs.unlinkSync(file(`byol-${id}.json`)); } catch { } invalidate(); store.logAudit(u, 'byol.delete', id, 'kimlik bilgileri ve eşitlenen veri silindi'); return view(p, null); }

async function http(url, init = {}) { const r = await safeFetch(url, { ...init, signal: AbortSignal.timeout(init.timeout || 30000), headers: { 'User-Agent': 'Diurna-BYOL/1', ...(init.headers || {}) } }); return r; }
async function authHeaders(p, pc) {
  const c = creds(pc), e = pc.endpoint || {};
  if (p.adapter === 'opensanctions') return { Authorization: 'ApiKey ' + c.apiKey };
  if (p.auth === 'oauth2' || (p.custom && e.tokenUrl)) {
    if (!e.tokenUrl) throw new Error('Jeton adresi (tokenUrl) girilmeli.');
    const r = await http(e.tokenUrl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c.username || '', client_secret: c.secret || '' }) });
    if (!r.ok) throw new Error('Jeton alınamadı: HTTP ' + r.status); const j = await r.json().catch(() => ({})); if (!j.access_token) throw new Error('Jeton yanıtında access_token yok'); return { Authorization: 'Bearer ' + j.access_token };
  }
  if (p.auth === 'basic') return { Authorization: 'Basic ' + Buffer.from((c.username || '') + ':' + (c.secret || '')).toString('base64') };
  if (p.auth === 'header' || e.authHeader) { const name = e.authHeader || p.header || 'Authorization'; return { [name]: (p.prefix || '') + c.secret }; }
  return { Authorization: 'Bearer ' + c.secret };
}
function joinUrl(base, pth) { return new URL(String(pth || '').replace(/^\//, ''), base.replace(/\/?$/, '/')).href; }
const errMsg = e => e?.code === 'ssrf' ? 'Adres güvenlik kuralı nedeniyle engellendi' : /abort|timeout/i.test(e?.name + e?.message) ? 'Zaman aşımı' : clean(e?.message || e, 160);

async function test(id, u) {
  const p = byId(id); const c = cfg(); const pc = c.providers[id]; if (!p || !pc?.cred) throw Object.assign(new Error('Önce kimlik bilgilerini girin.'), { status: 422 });
  let state = 'error', message = '';
  try {
    if (p.adapter === 'opensanctions') {
      const r = await http(OS_API + '/match/default', { method: 'POST', headers: { ...await authHeaders(p, pc), 'Content-Type': 'application/json' }, body: JSON.stringify({ queries: { q1: { schema: 'Person', properties: { name: ['Test Kisi'] } } } }) });
      if (r.status === 401 || r.status === 403) message = 'Anahtar reddedildi (HTTP ' + r.status + ')'; else if (r.ok) { state = 'connected'; message = 'Bağlı – OpenSanctions API anahtarı geçerli'; } else message = 'OpenSanctions yanıtı: HTTP ' + r.status;
    } else {
      const e = pc.endpoint || {}; if (!e.baseUrl) throw new Error('Temel adres (baseUrl) girilmeli – sözleşmenizdeki API belgesinden.'); if (!e.testPath) throw new Error('Test yolu (testPath) girilmeli.');
      const r = await http(joinUrl(e.baseUrl, e.testPath), { headers: { ...await authHeaders(p, pc), Accept: 'application/json' } });
      if (r.status === 401 || r.status === 403) message = 'Kimlik bilgisi reddedildi (HTTP ' + r.status + ')'; else if (r.ok) { state = 'connected'; message = 'Bağlı – uç nokta yanıt verdi (HTTP ' + r.status + ')'; } else message = 'Uç nokta yanıtı: HTTP ' + r.status;
    }
  } catch (e) { message = errMsg(e); }
  pc.status = { state, message: state === 'connected' ? message : 'Hata: ' + message, at: new Date().toISOString() }; saveCfg(c); store.logAudit(u, 'byol.test', id, state); return view(p, pc);
}

const dig = (o, pth) => String(pth || '').split('.').filter(Boolean).reduce((a, k) => a?.[k], o);
const type = v => { v = String(v || '').toLowerCase(); return /vessel|ship|gemi/.test(v) ? 'v' : /person|individual|kişi|kisi/.test(v) ? 'p' : 'e'; };
async function fetchRecords(p, pc) {
  const hdr = await authHeaders(p, pc); const out = [];
  if (p.adapter === 'opensanctions') {
    const L = require('./lists'); const ds = [...new Set(['ae_local_terrorists', 'qa_nctc_sanctions', 'sa_designated_terrorists', ...(pc.endpoint?.datasets || [])])]; const errs = [];
    for (const d of ds) { try { const r = await http(OS_BULK(d), { headers: hdr, timeout: 120000 }); if (!r.ok) { errs.push(d + ': HTTP ' + r.status); continue; } for (const e of L.parseTR(await r.text(), 'byol')) { e.c = e.c || d; out.push(e); } } catch (e) { errs.push(d + ': ' + errMsg(e)); } }
    if (!out.length) throw new Error('Veri alınamadı (' + errs.join('; ') + '). Toplu veri teslimi OpenSanctions sözleşmenize bağlıdır.'); return { out, warn: errs.join('; ') };
  }
  const e = pc.endpoint || {}; if (!e.baseUrl || !e.dataPath) throw new Error('baseUrl ve dataPath girilmeli.'); if (!e.mapName) throw new Error('Alan eşlemesinde en az “ad” alanı girilmeli.');
  const r = await http(joinUrl(e.baseUrl, e.dataPath), { headers: { ...hdr, Accept: e.format === 'csv' ? 'text/csv' : 'application/json' }, timeout: 120000 }); if (!r.ok) throw new Error('Veri uç noktası: HTTP ' + r.status);
  const txt = await r.text(); if (txt.length > 60e6) throw new Error('Yanıt çok büyük (60 MB sınırı)');
  let rows; if (e.format === 'csv') { const t = U.parseCSV(txt, txt.split('\n', 1)[0].includes(';') ? ';' : ','); const h = t[0].map(x => x.trim()); rows = t.slice(1).map(r2 => Object.fromEntries(h.map((k, i) => [k, r2[i]]))); } else { const j = JSON.parse(txt); rows = e.jsonPath ? dig(j, e.jsonPath) : j; if (!Array.isArray(rows)) throw new Error('jsonPath bir dizi göstermiyor'); }
  rows.slice(0, 500000).forEach((x, i) => { const name = clean(dig(x, e.mapName), 200); if (!name) return; const al = dig(x, e.mapAliases); out.push({ s: 'byol', id: clean(dig(x, e.mapId) || p.id + '-' + i, 80), n: [name, ...(Array.isArray(al) ? al : String(al || '').split(/[;|]/)).map(a => clean(a, 200).trim()).filter(Boolean)], t: type(dig(x, e.mapType)), c: clean(dig(x, e.mapProgram) || dig(x, e.mapCountry) || '', 120), d: clean(dig(x, e.mapDate) || '', 10) }); });
  if (!out.length) throw new Error('Eşleme sonucunda kayıt çıkmadı – alan adlarını kontrol edin.'); return { out };
}
async function sync(id, u) {
  const p = byId(id); const c = cfg(); const pc = c.providers[id]; if (!p || !pc?.cred) throw Object.assign(new Error('Önce kimlik bilgilerini girin.'), { status: 422 });
  try {
    const { out, warn } = await fetchRecords(p, pc); for (const e of out) { e.s = 'byol'; e.ref = p.name; e.id = p.id + ':' + e.id; }
    wr(`byol-${id}.json`, sec.encrypt(JSON.stringify(out))); pc.sync = { at: new Date().toISOString(), count: out.length, error: '', warn: warn || '' }; pc.status = { state: 'connected', message: 'Bağlı', at: new Date().toISOString() };
  } catch (e) { pc.sync = { ...(pc.sync || {}), error: errMsg(e), failedAt: new Date().toISOString() }; pc.status = { state: 'error', message: 'Hata: ' + errMsg(e), at: new Date().toISOString() }; }
  saveCfg(c); invalidate(); store.logAudit(u, 'byol.sync', id, pc.sync.error ? 'hata' : pc.sync.count + ' kayıt'); return view(p, pc);
}
function records() { const c = cfg(); let all = []; for (const p of PROVIDERS) { const pc = c.providers[p.id]; if (!pc?.enabled || !pc.sync?.count) continue; const o = rd(`byol-${p.id}.json`, null); if (!o) continue; try { all = all.concat(JSON.parse(sec.decrypt(o))); } catch { } } return all; }
const cache = new Map(); function invalidate() { cache.delete(store.orgId()); }
/* kuruma özel ek indeks (lists.orgIndex içinde kurum içi listeyle birlikte aranır) */
function index() { const c = cfg(); const key = Object.values(c.providers).map(x => (x.enabled ? 1 : 0) + ':' + (x.sync?.at || '')).join('|'); const hit = cache.get(store.orgId()); if (hit && hit.key === key) return hit.ix; const recs = records(); let ix = null; if (recs.length) { ix = new M.NameIndex(); for (const e of recs) ix.add({ ...e, names: e.n }); } cache.set(store.orgId(), { key, ix }); return ix; }
function summary() { const l = list(); const on = l.filter(x => x.enabled && x.sync?.count && !x.sync.error); const cfgd = l.filter(x => x.state !== 'unset'); return { active: on.length, configured: cfgd.length, records: on.reduce((a, x) => a + x.sync.count, 0), names: on.map(x => x.name), error: l.find(x => x.state === 'error')?.message || '' }; }
module.exports = { PROVIDERS, list, setCreds, remove, test, sync, index, summary };
