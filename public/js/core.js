// Çekirdek: durum, API, i18n, güvenli şablon, yönlendirme, canlı olaylar (SSE)
import tr from './i18n/tr.js';
import en from './i18n/en.js';
import ar from './i18n/ar.js';
export const DICTS = { tr, en, ar };           // Yeni dil eklemek için: i18n/<kod>.js oluşturup buraya ekleyin (RTL için DIR tablosuna ekleyin).
export const LANGS = [{ code: 'tr', label: 'TR', name: 'Türkçe' }, { code: 'en', label: 'EN', name: 'English' }, { code: 'ar', label: 'ع', name: 'العربية' }];
export const DIR = { tr: 'ltr', en: 'ltr', ar: 'rtl' };

export const BRAND = { name: null, shortName: null, descriptor: null, tagline: null, logo: '/brand/logo.svg', wordmark: '/brand/wordmark.svg', wordmarkLight: '/brand/wordmark-light.svg' };
export async function loadBrand() { try { Object.assign(BRAND, await (await fetch('/api/public/brand')).json()); const n = BRAND.name?.[S.lang] || BRAND.name?.en; if (n) document.title = n; } catch { } }
export const S = {
  lang: localStorage.getItem('um.lang') || 'tr', theme: document.documentElement.dataset.theme || 'light',
  csrf: '', status: null, notifs: [], toasts: [], route: '', flash: new Set(), sseOk: false,
};

/* ───── güvenli HTML şablonu: tüm enterpolasyonlar kaçışlanır ───── */
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Raw(s);
const flat = v => v instanceof Raw ? v.s : Array.isArray(v) ? v.map(flat).join('') : v === false || v == null ? '' : esc(v);
export const h = (strs, ...vals) => new Raw(strs.reduce((a, s, i) => a + s + (i < vals.length ? flat(vals[i]) : ''), ''));
export const html = x => (x instanceof Raw ? x.s : esc(x));

/* ───── i18n ───── */
export function t(key, params) {
  if (key === 'app.name' && BRAND.name) return L(BRAND.name);
  if (key === 'app.tagline' && BRAND.tagline) return L(BRAND.tagline);
  if (key === 'app.descriptor' && BRAND.descriptor) return L(BRAND.descriptor);
  let s = (DICTS[S.lang] && DICTS[S.lang][key]) ?? DICTS.en[key] ?? DICTS.tr[key];
  if (s === undefined) { (window.__i18nMissing ||= new Set()).add(key); s = key; }
  if (params) for (const k in params) s = s.replaceAll('{' + k + '}', params[k]);
  return s;
}
export const L = o => (o && typeof o === 'object' ? (o[S.lang] ?? o.en ?? o.tr ?? '') : o ?? '');   // sunucudan gelen {tr,en} metinleri
export function applyLang() { document.documentElement.lang = S.lang; document.documentElement.dir = DIR[S.lang] || 'ltr'; }
export function setLang(l) { S.lang = l; localStorage.setItem('um.lang', l); applyLang(); }
export function setTheme(th) { S.theme = th; localStorage.setItem('um.theme', th); document.documentElement.dataset.theme = th; }
const loc = () => (S.lang === 'tr' ? 'tr-TR' : S.lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB');
export const tz = () => S.status?.platform?.tz || 'Europe/Istanbul';
export function fmtDT(iso) { if (!iso) return '—'; return new Intl.DateTimeFormat(loc(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: tz() }).format(new Date(iso)); }
export function fmtD(iso) { if (!iso) return '—'; const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + 'T12:00:00Z') : new Date(iso); return new Intl.DateTimeFormat(loc(), { day: '2-digit', month: 'short', year: 'numeric', timeZone: /^\d{4}-\d{2}-\d{2}$/.test(iso) ? 'UTC' : tz() }).format(d); }
export function fmtLong(iso) { return new Intl.DateTimeFormat(loc(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z')); }
export function rel(iso) {
  if (!iso) return t('common.never');
  const s = Math.round((new Date(iso) - Date.now()) / 1000); const r = new Intl.RelativeTimeFormat(loc(), { numeric: 'auto' });
  const a = Math.abs(s);
  if (a < 45) return t('common.justNow');
  if (a < 3600) return r.format(Math.round(s / 60), 'minute'); if (a < 86400) return r.format(Math.round(s / 3600), 'hour'); return r.format(Math.round(s / 86400), 'day');
}
export const num = n => new Intl.NumberFormat(loc()).format(n ?? 0);

/* ───── API (oturum çerezi + CSRF belirteci) ───── */
export async function api(path, opts = {}) {
  const hd = {}; if (opts.body) hd['Content-Type'] = 'application/json'; if (opts.method && opts.method !== 'GET') hd['X-CSRF-Token'] = S.csrf;
  const r = await fetch('/api' + path, { method: opts.method || 'GET', headers: hd, credentials: 'same-origin', body: opts.body ? JSON.stringify(opts.body) : undefined });
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) {
    if (r.status === 401 && !opts.noRedirect && S.status) { S.status = null; location.hash = '#/login'; }
    const e = new Error((data && data.message) || r.statusText); e.data = data; e.status = r.status; throw e;
  }
  return data;
}
export async function loadStatus() { S.status = await api('/status', { noRedirect: true }); S.csrf = S.status.csrf; return S.status; }
export const me = () => S.status?.user || { name: '', role: '' };
/* İlk giriş kapısı: geçici parola değişimi, sonra zorunlu MFA kurulumu */
export const gate = () => { const u = S.status?.user; if (!u) return null; if (u.mustChangePassword) return 'pw'; if ((u.mfaRequired || S.status.settings?.security?.requireMfa) && !u.mfa) return 'mfa'; return null; };
export const money = (n, cur = 'TRY') => { try { return new Intl.NumberFormat(S.lang === 'tr' ? 'tr-TR' : S.lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', { style: 'currency', currency: cur }).format(n ?? 0); } catch { return (n ?? 0) + ' ' + cur; } };
export const canWrite = () => !!S.status?.perms?.write;
export const canApprove = () => !!S.status?.perms?.approve;
export const isAdmin = () => !!S.status?.perms?.admin;
export const isManager = () => ['Admin', 'Uyum Yöneticisi'].includes(me().role);
/* CSV enjeksiyon korumalı dışa aktarım */
export const csvCell = v => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
export const toCSV = rows => '\uFEFF' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');

/* ───── toast ───── */
export function toast(title, msg = '', ms = 6000) {
  const el = document.createElement('div'); el.className = 'toast'; el.innerHTML = `<b>${esc(title)}</b><span>${esc(msg)}</span>`;
  let host = document.querySelector('.toasts'); if (!host) { host = document.createElement('div'); host.className = 'toasts'; document.body.appendChild(host); }
  host.appendChild(el); setTimeout(() => el.remove(), ms);
}

/* ───── anahtar kelime vurgulama (güvenli) ───── */
export function hilite(text, kws) {
  let s = esc(text || ''); if (!kws || !kws.length) return raw(s);
  const re = new RegExp('(' + kws.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return raw(s.replace(re, '<mark>$1</mark>'));
}

/* ───── yönlendirici ───── */
export const routes = {};
export function route(name, mod) { routes[name] = mod; }
export function nav(r) { location.hash = '#/' + r; }
export function currentRoute() { return (location.hash.replace(/^#\//, '') || '').split('?')[0]; }

/* ───── canlı olaylar ───── */
const listeners = new Set();
export const onLive = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export function startLive() {
  const es = new EventSource('/api/events');
  es.onopen = () => { S.sseOk = true; emit('conn', {}); };
  es.onerror = () => { S.sseOk = false; emit('conn', {}); };
  for (const ev of ['scan', 'jobs', 'lists', 'match', 'notify', 'tasks']) es.addEventListener(ev, e => { let d = {}; try { d = JSON.parse(e.data); } catch { } emit(ev, d); });
}
function emit(type, data) { for (const fn of listeners) { try { fn(type, data); } catch (e) { console.error(e); } } }
