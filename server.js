#!/usr/bin/env node
'use strict';
/* Diurna (Yaptırım ve Uyum İstihbarat Merkezi) – yerel sunucu. Bağımlılık yok: yalnızca Node.js 20+ */
const http = require('http'), fs = require('fs'), path = require('path'), url = require('url');
const store = require('./lib/store');
const U = require('./lib/util');
const L = require('./lib/lists');
const scan = require('./lib/scan');
const S = require('./lib/sources');
const C = require('./lib/customers');
const Bul = require('./lib/bulletin');
const T = require('./lib/trade');
const DD = require('./lib/dd');
const bus = require('./lib/bus');
const sched = require('./lib/scheduler');
const screening = require('./lib/screening');
const I = require('./lib/i18n');
const auth = require('./lib/auth');
const work = require('./lib/work');
const SEC = require('./lib/secondary'); const reader = require('./lib/reader'); const billing = require('./lib/billing'); const platform = require('./lib/owner');
const mailer = require('./lib/mailer');
const seed = require('./lib/seed');
const P = require('./lib/platform');
const crypto = require('crypto');
const sec = require('./lib/security');

const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.png': 'image/png', '.ico': 'image/x-icon' };

const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const CSV_ROUTES = /^\/api\/(customers|csv\/preview|screen\/batch|dd\/draft)$/;
const safeParse = t => JSON.parse(t, (k, v) => (k === '__proto__' || k === 'constructor' || k === 'prototype') ? undefined : v);
const readBody = req => new Promise((ok, no) => {
  const limit = CSV_ROUTES.test(req.url.split('?')[0]) ? 12e6 : 1e6; let b = '', n = 0;
  req.on('data', c => { n += c.length; if (n > limit) { no(Object.assign(new Error('Gövde çok büyük (sınır ' + Math.round(limit / 1e6) + ' MB)'), { status: 413 })); req.destroy(); return; } b += c; });
  req.on('end', () => { try { ok(b ? (req.headers['content-type'] || '').includes('json') ? safeParse(b) : b : {}); } catch (e) { no(Object.assign(new Error('Geçersiz JSON'), { status: 400 })); } });
});
const clientIp = req => (process.env.UM_TRUST_PROXY === '1' && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
const TRUST = () => process.env.UM_TRUST_PROXY === '1'; const first = v => String(v || '').split(',')[0].trim();
/* Ters vekil/tünel (Pinggy, Cloudflare, nginx…) arkasında HTTPS algılama: X-Forwarded-Proto/Scheme, Forwarded: proto=, X-Forwarded-Ssl, CF-Visitor */
const fwdProto = req => { if (!TRUST()) return ''; const f = /proto="?([a-z]+)/i.exec(req.headers.forwarded || ''); return (first(req.headers['x-forwarded-proto']) || first(req.headers['x-forwarded-scheme']) || (f && f[1]) || (req.headers['x-forwarded-ssl'] === 'on' ? 'https' : '') || (/https/.test(req.headers['cf-visitor'] || '') ? 'https' : '')).toLowerCase(); };
const isSecure = req => !!req.socket.encrypted || process.env.UM_FORCE_SECURE === '1' || fwdProto(req) === 'https';
/* Origin denetimi: Host, (güvenilen vekilde) X-Forwarded-Host veya UM_ALLOWED_ORIGINS (virgüllü host listesi) ile eşleşmeli */
const originOk = req => { const o = req.headers.origin; if (!o) return true; let h; try { h = new URL(o).host; } catch { return false; } const ok = [req.headers.host]; if (TRUST()) ok.push(first(req.headers['x-forwarded-host'])); for (const x of String(process.env.UM_ALLOWED_ORIGINS || '').split(',')) if (x.trim()) ok.push(x.trim().replace(/^https?:\/\//, '')); return ok.includes(h); };
const can = (u, what) => auth.can(u, what);
function guard(u, what, res) { if (!can(u, what || 'write')) { send(res, 403, { error: 'role', message: `“${u.role}” rolünün bu işlem için yetkisi yok.` }); return false; } return true; }
const PUBLIC_ROUTES = new Set(['GET /api/public/brand', 'POST /api/auth/login', 'POST /api/auth/mfa', 'POST /api/auth/logout', 'GET /api/public/status', 'POST /api/public/demo-request']);

function sourceMeta() {
  const jobs = sched.snapshot(); const st = scan.sourceStatuses(); const lm = L.meta();
  const out = scan.ORDER.map(k => ({
    key: k, name: S.SRC[k].name, code: S.SRC[k].code, page: S.SRC[k].page, ...st[k],
    newsJob: jobs.find(j => j.id === 'news:' + k) || null, listJob: jobs.find(j => j.id === 'list:' + k) || null,
    list: lm[k] ? { count: lm[k].count, fetchedAt: lm[k].fetchedAt, checkedAt: lm[k].checkedAt, ok: lm[k].ok, lastError: lm[k].lastError } : null,
  }));
  out.push({ key: 'state', name: S.SRC.state.name, code: S.SRC.state.code, page: S.SRC.state.page, status: 'info', parts: {}, count: 0, infoOnly: true });
  return out;
}
function itemsWithPublished() {
  const pub = new Map(); for (const b of store.bulletins()) if (b.status === 'approved') for (const i of b.items) if (i.included) pub.set(i.itemId, b.id);
  return scan.items().map(i => ({ ...i, publishedIn: pub.get(i.id) || null }));
}

const routes = [];
const R = (method, re, fn) => routes.push({ method, re, fn });

R('GET', /^\/api\/status$/, async (req, res, m, q, u) => {
  const s = store.settings(); const lm = L.meta(); const live = scan.loadLive(); const org = store.orgsAll().find(o => o.id === u.orgId); const w = scan.orgWindow();
  send(res, 200, { csrf: req.__session.csrf, session: { idleExp: req.__session.idleExp, exp: req.__session.exp }, now: new Date().toISOString(), today: w.end, window: w, sources: sourceMeta(), jobs: sched.snapshot(), health: require('./lib/health').summary(sched.snapshot()), customers: store.customers().meta, lists: lm, listTotal: L.totalCount(), user: auth.pub(u), org: { id: org.id, name: org.name, plan: org.plan, demo: !!org.demo, seats: org.seats },  roles: Object.keys(store.ROLES), perms: store.ROLES[u.role], settings: { ...s, smtp: undefined, security: u.role === 'Admin' ? s.security : { ...s.security, ipAllowlist: undefined } }, prefs: u.prefs,
    fatf: T.fatf(), counts: { items: scan.items().length, notifications: work.userNotifs(u.id).filter(n => !n.read).length, tasks: store.tasks().filter(t => t.assignee === u.id && t.status !== 'closed').length }, liveUpdatedAt: live.updatedAt, version: require('./package.json').version, customersLoaded: C.has(), platform: { tz: P.tz, pollNewsMinutes: P.pollNewsMinutes, pollListsMinutes: P.pollListsMinutes, scanDays: P.scanDays } });
});
R('GET', /^\/api\/events$/, async (req, res, m, q, u) => { bus.add(res, { orgId: u.orgId, userId: u.id }); bus.emit('hello', { at: new Date().toISOString() }, { userId: u.id }); });
R('GET', /^\/api\/items$/, async (req, res) => send(res, 200, { items: itemsWithPublished(), keywords: S.KEYWORDS }));

// Kimlik
function loginResponse(req, res, r) {
  const secure = isSecure(req);
  store.runAs(r.user.orgId, () => store.logAudit(r.user, 'auth.login', r.user.email, 'Giriş' + (r.user.mfa?.enabled ? ' (MFA)' : '')));
  const org = store.orgsAll().find(o => o.id === r.user.orgId);
  send(res, 200, { user: auth.pub(r.user), org: org && { id: org.id, name: org.name }, csrf: r.csrf }, undefined, { 'Set-Cookie': auth.cookie(r.sid, auth.ABS_HOURS * 3600, secure) });
}
R('POST', /^\/api\/auth\/login$/, async (req, res) => {
  const ip = clientIp(req); const lim = sec.rateLimit('login:' + ip, 20, 10 * 60e3); if (!lim.ok) return send(res, 429, { error: 'rate_limited', message: `Çok fazla deneme. ${lim.retryAfter} sn sonra tekrar deneyin.` }, undefined, { 'Retry-After': lim.retryAfter });
  const b = await readBody(req); if (typeof b.email !== 'string' || typeof b.password !== 'string' || b.email.length > 200 || b.password.length > 200) return send(res, 400, { error: 'bad_request' });
  try {
    const known = store.authUsers().find(u => u.email === b.email.toLowerCase().trim() || u.username === b.email.toLowerCase().trim());
    if (known) { const allow = store.runAs(known.orgId, () => store.settings().security.ipAllowlist); if (!sec.ipAllowed(ip, allow)) { store.runAs(known.orgId, () => store.logAudit({ name: known.name, role: known.role }, 'security.ip_denied', known.email, 'İzin listesi dışı IP')); return send(res, 403, { error: 'ip', message: 'Bu ağdan erişim izni yok (kurum IP izin listesi).' }); } }
    const r = await auth.login(b.email, b.password, ip, req.headers['user-agent']);
    if (r.mfaRequired) return send(res, 200, { mfaRequired: true, ticket: r.ticket });
    loginResponse(req, res, r);
  } catch (e) { if (e.code === 'bad' || e.code === 'locked') { const k = store.authUsers().find(u => u.email === String(b.email).toLowerCase().trim() || u.username === String(b.email).toLowerCase().trim()); if (k) store.runAs(k.orgId, () => store.logAudit({ name: k.name, role: k.role }, 'security.login_failed', k.email, e.code === 'locked' ? 'Kilitli hesap' : 'Hatalı parola')); } send(res, e.code === 'locked' ? 423 : 401, { error: e.code || 'bad', message: e.message }); }
});
R('POST', /^\/api\/auth\/mfa$/, async (req, res) => {
  const ip = clientIp(req); const lim = sec.rateLimit('mfa:' + ip, 20, 10 * 60e3); if (!lim.ok) return send(res, 429, { error: 'rate_limited' });
  const b = await readBody(req); try { loginResponse(req, res, auth.verifyMfa(String(b.ticket || ''), b.code, ip)); } catch (e) { send(res, 401, { error: e.code || 'bad', message: e.message }); }
});
R('POST', /^\/api\/auth\/logout$/, async (req, res) => { auth.logout(req); send(res, 200, { ok: true }, undefined, { 'Set-Cookie': auth.cookie('', 0, isSecure(req)) }); });
R('GET', /^\/api\/public\/brand$/, async (req, res) => { const b = require('./lib/brand').get(); send(res, 200, { name: b.name, shortName: b.shortName, descriptor: b.descriptor, tagline: b.tagline, logo: b.logo, wordmark: b.wordmark, wordmarkLight: b.wordmarkLight, favicon: b.favicon, supportEmail: b.supportEmail, legalEntity: b.legalEntity }); });
R('GET', /^\/api\/public\/status$/, async (req, res) => send(res, 200, publicStatus()));
R('POST', /^\/api\/public\/demo-request$/, async (req, res) => {
  const b = await readBody(req); if (!b.email || !/^\S+@\S+\.\S+$/.test(b.email) || !b.name) return send(res, 422, { error: 'validation' });
  const l = store.global('demo-requests.json', []); l.unshift({ id: U.uid(), at: new Date().toISOString(), name: String(b.name).slice(0, 80), email: String(b.email).slice(0, 120), bank: String(b.bank || '').slice(0, 120), seats: +b.seats || null, message: String(b.message || '').slice(0, 800) }); store.saveGlobal('demo-requests.json', l.slice(0, 500)); send(res, 200, { ok: true });
});
function publicStatus() {
  const jobs = sched.snapshot();
  return { at: new Date().toISOString(), overall: jobs.every(j => j.status !== 'error' && j.status !== 'blocked') ? 'operational' : 'degraded', components: jobs.map(j => ({ id: j.id, label: j.label, kind: j.kind, status: j.status, lastOk: j.lastOk, lastError: j.lastError ? 'hata' : null, uptime24h: work.uptime(j.id, 24), uptime7d: work.uptime(j.id, 168), every: j.every })) };
}

// Kişisel
R('GET', /^\/api\/me\/today$/, async (req, res, m, q, u) => send(res, 200, work.todayFor(u)));
R('PUT', /^\/api\/me\/prefs$/, async (req, res, m, q, u) => { const b = await readBody(req); const x = auth.updatePrefs(u.id, b); store.logAudit(u, 'prefs.update', u.email, Object.keys(b).join(',')); send(res, 200, x.prefs); });
R('POST', /^\/api\/me\/password$/, async (req, res, m, q, u) => {
  const b = await readBody(req);
  try { await auth.changePassword(u.id, b.current, b.next); auth.revokeAll(u.id, req.__session.sessionId); store.logAudit(u, 'auth.password', u.email, 'Parola değişti; diğer oturumlar kapatıldı'); send(res, 200, { ok: true }); }
  catch (e) { send(res, 422, { error: e.code || 'bad', issues: e.issues, message: e.message }); }
});
R('GET', /^\/api\/me\/security$/, async (req, res, m, q, u) => send(res, 200, { mfa: !!u.mfa?.enabled, mfaEnabledAt: u.mfa?.enabledAt || null, recoveryLeft: (u.mfa?.recovery || []).length, sessions: auth.sessionsOf(u.id, req.__session.sessionId), pwChangedAt: u.pwChangedAt, argon2: auth.hasArgon, idleMinutes: store.settings().security.idleMinutes }));
R('POST', /^\/api\/me\/mfa\/begin$/, async (req, res, m, q, u) => send(res, 200, auth.mfaBegin(u.id)));
R('POST', /^\/api\/me\/mfa\/confirm$/, async (req, res, m, q, u) => { const b = await readBody(req); try { const rec = auth.mfaConfirm(u.id, b.code); store.logAudit(u, 'security.mfa_enabled', u.email, 'TOTP etkinleştirildi'); send(res, 200, { recovery: rec }); } catch (e) { send(res, 422, { error: e.code || 'bad', message: e.message }); } });
R('POST', /^\/api\/me\/mfa\/disable$/, async (req, res, m, q, u) => { if (store.settings().security.requireMfa || u.mfaRequired || u.role === 'Platform') return send(res, 422, { error: 'required', message: 'Bu hesap için MFA zorunludur.' }); const b = await readBody(req); try { await auth.mfaDisable(u.id, b.password); store.logAudit(u, 'security.mfa_disabled', u.email, ''); send(res, 200, { ok: true }); } catch (e) { send(res, 422, { error: 'bad', message: e.message }); } });
R('POST', /^\/api\/me\/sessions\/revoke$/, async (req, res, m, q, u) => { const b = await readBody(req); if (b.all) auth.revokeAll(u.id, req.__session.sessionId); else auth.revokeOne(u.id, String(b.id || '')); store.logAudit(u, 'security.session_revoke', u.email, b.all ? 'tümü' : String(b.id)); send(res, 200, { ok: true }); });
R('GET', /^\/api\/me\/watchlist$/, async (req, res, m, q, u) => { const hs = T.meta ? null : null; send(res, 200, work.listWatch(u.id).map(w => ({ ...w, hsInfo: w.type === 'hs' ? T.checkHS(w.value) : undefined }))); });
R('POST', /^\/api\/me\/watchlist$/, async (req, res, m, q, u) => { const b = await readBody(req); try { const w = work.addWatch(u, b); store.logAudit(u, 'watch.add', w.type, w.value); send(res, 200, w); } catch (e) { send(res, 422, { error: e.message }); } });
R('DELETE', /^\/api\/me\/watchlist\/([\w-]+)$/, async (req, res, m, q, u) => { work.delWatch(u, m[1]); send(res, 200, { ok: true }); });
R('GET', /^\/api\/notifications$/, async (req, res, m, q, u) => send(res, 200, work.userNotifs(u.id).slice(0, 100)));
R('POST', /^\/api\/notifications\/read$/, async (req, res, m, q, u) => { work.markRead(u.id); send(res, 200, { ok: true }); });
R('GET', /^\/api\/me\/report$/, async (req, res, m, q, u) => { const r = work.buildReport(u, q.lang); send(res, 200, r); });
R('POST', /^\/api\/me\/report\/send$/, async (req, res, m, q, u) => { const rec = await work.sendDaily(u, true); store.logAudit(u, 'report.send', u.email, rec.mode); send(res, 200, rec); });
R('GET', /^\/api\/outbox$/, async (req, res, m, q, u) => { if (!guard(u, 'write', res)) return; send(res, 200, mailer.outbox().filter(r => u.role !== 'Analist' || r.to === u.email)); });
R('GET', /^\/api\/outbox\/([\w-]+)$/, async (req, res, m, q, u) => { const h = mailer.outboxHtml(m[1]); if (!h) return send(res, 404, {}); send(res, 200, h, 'text/html; charset=utf-8', { ...sec.headers(false, 'frame') }); });

// Görevler
R('GET', /^\/api\/tasks$/, async (req, res, m, q, u) => send(res, 200, { tasks: work.scopeTasks(u).map(work.withSla).sort((a, b) => (a.status === 'closed') - (b.status === 'closed') || new Date(a.dueAt) - new Date(b.dueAt)), users: auth.orgUsers(u.orgId).filter(x => x.active).map(auth.pub) }));
R('POST', /^\/api\/tasks$/, async (req, res, m, q, u) => { if (!guard(u, 'write', res)) return; const b = await readBody(req); if (!String(b.title || '').trim()) return send(res, 422, { error: 'title' }); if (b.assignee && !auth.orgUsers(u.orgId).some(x => x.id === b.assignee)) return send(res, 422, { error: 'assignee' }); const t = work.createTask(u, b); store.logAudit(u, 'task.create', t.no, t.title); send(res, 200, work.withSla(t)); });
R('PUT', /^\/api\/tasks\/([\w-]+)$/, async (req, res, m, q, u) => {
  if (!guard(u, 'write', res)) return; const b = await readBody(req);
  if (b.assignee && !auth.orgUsers(u.orgId).some(x => x.id === b.assignee)) return send(res, 422, { error: 'assignee' });
  const t = work.updateTask(u, m[1], b); if (!t) return send(res, 404, {});
  store.logAudit(u, 'task.update', t.no, [b.status && 'durum=' + b.status, b.resolution && 'sonuç=' + b.resolution, b.assignee && 'atama', b.comment && 'yorum'].filter(Boolean).join(', '));
  if (b.status === 'closed') work.webhookEmit('task.closed', { no: t.no, resolution: t.resolution }); send(res, 200, work.withSla(t));
});
R('GET', /^\/api\/analytics$/, async (req, res) => send(res, 200, work.analytics()));

// Yönetim: kullanıcılar, faturalama, anahtarlar, webhooklar
R('GET', /^\/api\/org\/users$/, async (req, res, m, q, u) => { if (!guard(u, 'users', res)) return; const org = store.orgsAll().find(o => o.id === u.orgId); const b = billing.ensure(u.orgId); send(res, 200, { users: auth.orgUsers(u.orgId).map(auth.pub), seats: b.seats, plan: b.plan, active: auth.orgUsers(u.orgId).filter(x => x.active).length, org }); });
R('POST', /^\/api\/org\/users$/, async (req, res, m, q, u) => {
  if (!guard(u, 'users', res)) return; const b = await readBody(req); const bl = billing.ensure(u.orgId);
  if (!store.ROLES[b.role] || b.role === 'Platform' || !/^\S+@\S+\.\S+$/.test(b.email || '') || !b.name) return send(res, 422, { error: 'validation' });
  if (auth.orgUsers(u.orgId).filter(x => x.active).length >= bl.seats) return send(res, 402, { error: 'seats', message: 'Sözleşmedeki koltuk sayısına ulaşıldı. Koltuk eklemek için Diurna ile iletişime geçin (Yönetim → Faturalama).' });
  const pw = platform.tempPassword();
  try { const nu = await auth.createUser(u.orgId, { email: b.email, username: b.username || undefined, name: String(b.name).slice(0, 60), role: b.role, password: pw, branchId: b.branchId || null, mustChangePassword: true, mfaRequired: true }); store.logAudit(u, 'user.add', nu.email, nu.role); send(res, 200, { user: auth.pub(nu), tempPassword: pw }); } catch (e) { send(res, e.code === 'weak' || e.code === 'bad' ? 422 : 409, { error: e.code || 'dup', message: e.message, issues: e.issues }); }
});
R('PUT', /^\/api\/org\/users\/([\w-]+)$/, async (req, res, m, q, u) => {
  if (!guard(u, 'users', res)) return; const b = await readBody(req); const us = store.authUsers(); const x = us.find(z => z.id === m[1] && z.orgId === u.orgId); if (!x) return send(res, 404, { error: 'not found' });
  const self = x.id === u.id; const bl = billing.ensure(u.orgId);
  if ('role' in b) { if (!store.ROLES[b.role] || b.role === 'Platform') return send(res, 422, { error: 'validation' }); if (self && b.role !== x.role) return send(res, 422, { error: 'self', message: 'Kendi rolünüzü değiştiremezsiniz.' }); x.role = b.role; }
  if ('branchId' in b) x.branchId = b.branchId || null; if (b.name) x.name = String(b.name).slice(0, 60);
  if ('active' in b) {
    const on = !!b.active; if (self && !on) return send(res, 422, { error: 'self', message: 'Kendi hesabınızı pasifleştiremezsiniz.' });
    if (on && !x.active && us.filter(z => z.orgId === u.orgId && z.active).length >= bl.seats) return send(res, 402, { error: 'seats', message: 'Sözleşmedeki koltuk sayısına ulaşıldı.' });
    x.active = on; if (!on) auth.revokeAll(x.id);
  }
  store.saveAuthUsers(us); if (b.resetMfa) { auth.resetMfa(x.id); if (self) auth.revokeAll(x.id); }
  store.logAudit(u, 'user.update', x.email, Object.keys(b).join(',')); send(res, 200, auth.pub(store.authUsers().find(z => z.id === x.id)));
});
// ── Çeviri (DeepL/Azure/Google/LibreTranslate veya LLM) ──
const TRN = require('./lib/translate'); const ai = require('./lib/ai'); const EN = require('./lib/entities'); const WATCH = require('./lib/watch'); const FETCH = require('./lib/fetcher');
R('GET', /^\/api\/translate\/info$/, async (req, res, m, q, u) => send(res, 200, { ...TRN.info(), aiStatus: ai.status() }));
R('POST', /^\/api\/translate$/, async (req, res, m, q, u) => {
  const lim = sec.rateLimit('tr:' + u.id, 60, 60e3); if (!lim.ok) return send(res, 429, { error: 'rate_limited' });
  const b = await readBody(req);
  try { const r = await TRN.translate(b.texts, b.target, ['news', 'regulation', 'dd', 'bulletin', 'task', 'note'].includes(b.kind) ? b.kind : 'news', { aiAllowed: ai.status().enabled }); store.logAudit(u, 'translate', String(b.kind || 'news'), `${r.provider}; ${r.items.length} metin → ${r.target}${r.ai ? '; yapay zekâ' : ''}`); send(res, 200, r); }
  catch (e) { send(res, { confidential: 403, ai_disabled: 403, integrity: 502, not_configured: 503, lang: 422, size: 413 }[e.code] || 502, { error: e.code || 'provider', message: e.message }); }
});
// ── Yapay zekâ (insan onaylı, atıflı, denetim kayıtlı; kuruma göre kapatılabilir) ──
R('GET', /^\/api\/ai\/status$/, async (req, res, m, q, u) => send(res, 200, ai.status()));
R('GET', /^\/api\/ai\/log$/, async (req, res, m, q, u) => { if (!guard(u, 'admin', res)) return; let a = []; try { a = JSON.parse(fs.readFileSync(path.join(store.orgDir(), 'ai-log.json'), 'utf8')); } catch { } send(res, 200, a.slice(0, 100)); });
const liveItem = id => scan.items({ all: true }).find(i => i.id === id);
function aiRoute(kind, fn) {
  R('POST', new RegExp('^\\/api\\/ai\\/' + kind + '$'), async (req, res, m, q, u) => {
    const lim = sec.rateLimit('ai:' + u.id, 30, 60e3); if (!lim.ok) return send(res, 429, { error: 'rate_limited' }, undefined, { 'Retry-After': lim.retryAfter });
    const b = await readBody(req); const lang = I.langs.includes(b.lang) ? b.lang : 'tr';
    try { send(res, 200, await fn(u, b, lang)); } catch (e) { if (e.status) return send(res, e.status, { error: 'bad_request', message: e.message }); send(res, { ai_disabled: 403, not_configured: 503 }[e.code] || 502, { error: e.code || 'ai', message: e.message }); }
  });
}
const need = (cond, msg) => { if (!cond) throw Object.assign(new Error(msg), { status: 422 }); };
aiRoute('article', async (u, b, lang) => { need(b.id, 'id gerekli'); const it = scan.items({ all: true }).find(i => i.id === String(b.id)); need(it, 'öğe bulunamadı'); const a = await reader.getFor(it, { fetch: true }); const text = (a.paragraphs || []).join('\n') || a.excerpt; need(text && text.length > 80, 'Özetlenecek metin yok'); return ai.articleSummary({ user: u, item: it, article: text, lang }); });
aiRoute('summary', async (u, b, lang) => { need(Array.isArray(b.ids), 'ids gerekli'); const all = scan.items({ all: true }); const by = new Map(all.map(i => [i.id, i])); const items = b.ids.slice(0, 20).map(id => by.get(String(id))).filter(Boolean); const r = await ai.summary({ user: u, items, lang }); return { ...r, idMap: Object.fromEntries(items.map((it, i) => ['n' + (i + 1), it.id])) }; });
aiRoute('bulletin', async (u, b, lang) => { const item = liveItem(String(b.itemId || '')); need(item, 'Kalem bulunamadı'); return ai.bulletinDraft({ user: u, item, lang }); });
aiRoute('regulation', async (u, b, lang) => { const item = liveItem(String(b.itemId || '')); need(item, 'Kalem bulunamadı'); return ai.regSummary({ user: u, item, lang }); });
aiRoute('hit', async (u, b, lang) => { need(b.entry && typeof b.entry === 'object' && JSON.stringify(b).length < 12000, 'Geçersiz eşleşme verisi'); return ai.explainHit({ user: u, query: b.query || {}, entry: b.entry, score: b.score, reasons: (b.reasons || []).map(String).slice(0, 12), lang }); });
aiRoute('dd', async (u, b, lang) => { const question = String(b.question || '').trim().slice(0, 600); need(question.length >= 8, 'Soru çok kısa'); return ai.ddDraft({ user: u, question, lang }); });
aiRoute('trade', async (u, b, lang) => { need(b.check && typeof b.check === 'object' && JSON.stringify(b.check).length < 20000, 'Ticaret kontrolü verisi gerekli'); const result = T.assess(b.check, lang); return ai.tradeNote({ user: u, result, ref: String(b.check.ref || 'ticaret').slice(0, 60), lang }); });
// ── Veri motoru: birleşik varlık deposu, sayfa izleme, nazik çekim ──
R('GET', /^\/api\/entities\/stats$/, async (req, res) => send(res, 200, EN.stats()));
R('GET', /^\/api\/entities\/feed$/, async (req, res, m, q) => send(res, 200, EN.feed({ since: String(q.since || ''), src: String(q.src || ''), kind: String(q.kind || ''), limit: Math.min(300, +q.limit || 100) })));
R('GET', /^\/api\/entities$/, async (req, res, m, q) => send(res, 200, EN.search({ q: String(q.q || '').slice(0, 120), src: String(q.src || ''), type: String(q.type || ''), status: String(q.status || ''), programme: String(q.programme || ''), limit: Math.min(100, +q.limit || 30), offset: Math.max(0, +q.offset || 0) })));
R('GET', /^\/api\/entities\/([^/]+)$/, async (req, res, m) => { const e = EN.get(m[1]); e ? send(res, 200, e) : send(res, 404, { error: 'not found' }); });
R('GET', /^\/api\/reader\/([\w-]+)$/, async (req, res, m, q, u) => {
  const lim = sec.rateLimit('reader:' + u.id, 40, 60e3); if (!lim.ok) return send(res, 429, { error: 'rate_limited' }, undefined, { 'Retry-After': lim.retryAfter });
  const it = scan.items({ all: true }).find(i => i.id === m[1]); if (!it) return send(res, 404, { error: 'not found' });
  send(res, 200, await reader.getFor(it, { fetch: q.fetch !== '0', force: q.force === '1' && can(u, 'write') }));
});
R('GET', /^\/api\/watch$/, async (req, res) => send(res, 200, WATCH.summary()));
R('GET', /^\/api\/fetch\/stats$/, async (req, res, m, q, u) => { if (!guard(u, 'admin', res)) return; send(res, 200, { userAgent: FETCH.UA, fallbackOpenSanctions: process.env.UM_FALLBACK_OPENSANCTIONS === '1', hosts: FETCH.stats() }); });
if (process.env.UM_BILLING === '1') { // Faturalama modülü varsayılan KAPALI (kapsam dışı); arka uç kodu yalnızca yeniden etkinleştirme için saklanır
R('GET', /^\/api\/billing$/, async (req, res, m, q, u) => {
  if (!guard(u, 'billing', res)) return; const b = billing.ensure(u.orgId); const act = auth.orgUsers(u.orgId).filter(x => x.active).length; const usage = store.usage(); const P = platform.pdata();
  send(res, 200, { contract: { plan: b.plan, seats: b.seats, currency: b.currency, pricePerSeat: b.pricePerSeat, ...b.contract }, plans: billing.PLANS, activeSeats: act, monthly: billing.monthly(u.orgId), usage: usage[billing.monthKey()] || {}, usageHistory: usage, invoices: platform.invoicesOf(u.orgId).map(i => ({ ...i, history: undefined, reminders: undefined })), bank: P.bank, seller: { name: P.seller.name, email: P.seller.email }, graceDays: P.graceDays, alert: platform.billingAlert(u.orgId), suspended: b.status === 'suspended', note: 'Faturalama: kurumsal sözleşme + havale/EFT. Kartla ödeme yoktur; ödeme durumu Diurna tarafından manuel işaretlenir.' });
});
R('GET', /^\/api\/billing\/invoices\/([\w-]+)\/pdf$/, async (req, res, m, q, u) => {
  if (!guard(u, 'billing', res)) return; const inv = platform.invoicesOf(u.orgId).find(i => i.id === m[1]); if (!inv) return send(res, 404, { error: 'not found' });
  const buf = await platform.invoicePdf(inv); res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${inv.number}.pdf"`, 'Cache-Control': 'no-store' }); res.end(buf);
});
}
// ── Platform sahibi paneli (yalnızca "Platform" rolü) ──
const pguard = (u, res) => { if (u.role !== 'Platform') { send(res, 403, { error: 'role', message: 'Yalnızca platform yöneticisi' }); return false; } return true; };
const perr = (res, e) => send(res, { nf: 404, seats: 409, bad: 422, weak: 422 }[e.code] || 409, { error: e.code || 'error', message: e.message, issues: e.issues });
R('GET', /^\/api\/platform\/overview$/, async (req, res, m, q, u) => {
  if (!pguard(u, res)) return; const orgs = platform.listOrgs();
  send(res, 200, { orgs, totals: { orgs: orgs.length, seats: orgs.reduce((a, o) => a + o.seats, 0), seatsUsed: orgs.reduce((a, o) => a + o.used, 0), suspended: orgs.filter(o => o.suspended).length }, demoRequests: store.global('demo-requests.json', []), audit: store.global('platform-audit.json', []).slice(0, 100), now: new Date().toISOString() });
});
R('POST', /^\/api\/platform\/orgs$/, async (req, res, m, q, u) => { if (!pguard(u, res)) return; try { send(res, 200, await platform.createOrg(await readBody(req), u)); } catch (e) { perr(res, e); } });
R('PUT', /^\/api\/platform\/orgs\/([\w-]+)$/, async (req, res, m, q, u) => { if (!pguard(u, res)) return; try { send(res, 200, platform.updateOrg(m[1], await readBody(req), u)); } catch (e) { perr(res, e); } });
R('POST', /^\/api\/platform\/orgs\/([\w-]+)\/suspend$/, async (req, res, m, q, u) => { if (!pguard(u, res)) return; const b = await readBody(req); try { send(res, 200, platform.setSuspended(m[1], !!b.on, b.reason || 'manual', u)); } catch (e) { perr(res, e); } });
R('GET', /^\/api\/platform\/orgs\/([\w-]+)\/users$/, async (req, res, m, q, u) => { if (!pguard(u, res)) return; send(res, 200, auth.orgUsers(m[1]).map(auth.pub)); });
R('POST', /^\/api\/platform\/orgs\/([\w-]+)\/users$/, async (req, res, m, q, u) => { if (!pguard(u, res)) return; try { send(res, 200, await platform.createUserFor(m[1], await readBody(req), u)); } catch (e) { perr(res, e); } });
R('POST', /^\/api\/platform\/users\/([\w-]+)\/reset$/, async (req, res, m, q, u) => { if (!pguard(u, res)) return; try { send(res, 200, await platform.resetUser(m[1], u)); } catch (e) { perr(res, e); } });
if (process.env.UM_BILLING === '1') { // Faturalama modülü varsayılan KAPALI (kapsam dışı); arka uç kodu yalnızca yeniden etkinleştirme için saklanır
R('PUT', /^\/api\/platform\/settings$/, async (req, res, m, q, u) => {
  if (!pguard(u, res)) return; const b = await readBody(req); const P = platform.pdata(); const S = (o, ks) => Object.fromEntries(ks.filter(k => k in (o || {})).map(k => [k, String(o[k]).slice(0, 200)]));
  if (b.seller) P.seller = { ...P.seller, ...S(b.seller, ['name', 'address', 'taxOffice', 'taxNo', 'email', 'phone']) }; if (b.bank) P.bank = { ...P.bank, ...S(b.bank, ['bankName', 'accountHolder', 'iban', 'swift', 'branch']) };
  if (b.invoicePrefix) P.invoicePrefix = String(b.invoicePrefix).replace(/[^A-Z0-9]/gi, '').slice(0, 8).toUpperCase() || P.invoicePrefix; if ('vatRate' in b) P.vatRate = Math.min(100, Math.max(0, +b.vatRate || 0)); if ('defaultTermDays' in b) P.defaultTermDays = Math.min(120, Math.max(1, +b.defaultTermDays || 15)); if ('graceDays' in b) P.graceDays = Math.min(120, Math.max(0, +b.graceDays || 0));
  if (b.reminderDays) P.reminderDays = [...new Set(String(Array.isArray(b.reminderDays) ? b.reminderDays.join(',') : b.reminderDays).split(',').map(x => +x.trim()).filter(x => x > 0 && x < 90))].sort((a, c) => c - a);
  platform.savePdata(P); platform.paudit(u, 'settings.update', '', Object.keys(b).join(',')); send(res, 200, P);
});
R('POST', /^\/api\/platform\/invoices$/, async (req, res, m, q, u) => { if (!pguard(u, res)) return; try { send(res, 200, platform.createInvoice(await readBody(req), u)); } catch (e) { perr(res, e); } });
R('PUT', /^\/api\/platform\/invoices\/([\w-]+)\/status$/, async (req, res, m, q, u) => { if (!pguard(u, res)) return; const b = await readBody(req); try { send(res, 200, platform.setInvoiceStatus(m[1], b.status, b.note, u)); } catch (e) { perr(res, e); } });
R('POST', /^\/api\/platform\/invoices\/([\w-]+)\/remind$/, async (req, res, m, q, u) => {
  if (!pguard(u, res)) return; const inv = platform.invoices().find(i => i.id === m[1]); if (!inv) return send(res, 404, { error: 'not found' }); const P = platform.pdata();
  platform.notifyOrg(inv.orgId, 'invoice_reminder', `Ödeme hatırlatması: fatura ${inv.number}`, `${inv.number} numaralı faturanın vadesi ${inv.dueDate}. Havale/EFT: ${P.bank.iban} (${P.bank.accountHolder}) — açıklama: ${inv.number}`, null, inv.number + ':manual' + Date.now()); platform.paudit(u, 'invoice.remind', inv.number, 'manuel hatırlatma'); send(res, 200, { ok: true });
});
R('GET', /^\/api\/platform\/invoices\/([\w-]+)\/pdf$/, async (req, res, m, q, u) => {
  if (!pguard(u, res)) return; const inv = platform.invoices().find(i => i.id === m[1]); if (!inv) return send(res, 404, { error: 'not found' });
  const buf = await platform.invoicePdf(platform.effective(inv)); res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${inv.number}.pdf"`, 'Cache-Control': 'no-store' }); res.end(buf);
});
R('POST', /^\/api\/platform\/tick$/, async (req, res, m, q, u) => { if (!pguard(u, res)) return; platform.tick(); send(res, 200, { ok: true }); });
}
R('GET', /^\/api\/apikeys$/, async (req, res, m, q, u) => { if (!guard(u, 'admin', res)) return; send(res, 200, store.apiKeys().map(k => ({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.createdAt, lastUsed: k.lastUsed, revoked: !!k.revoked }))); });
R('POST', /^\/api\/apikeys$/, async (req, res, m, q, u) => { if (!guard(u, 'admin', res)) return; const b = await readBody(req); const key = 'um_live_' + crypto.randomBytes(24).toString('base64url'); const ks = store.apiKeys(); const rec = { id: 'K' + U.uid().slice(0, 5), name: String(b.name || 'API').slice(0, 60), prefix: key.slice(0, 14), hash: U.sha256(key), createdAt: new Date().toISOString(), lastUsed: null, orgId: u.orgId }; ks.push(rec); store.saveApiKeys(ks); const idx = store.global('apikey-index.json', {}); idx[rec.hash] = { orgId: u.orgId, id: rec.id }; store.saveGlobal('apikey-index.json', idx); store.logAudit(u, 'apikey.create', rec.id, rec.name); send(res, 200, { ...rec, hash: undefined, key }); });
R('DELETE', /^\/api\/apikeys\/([\w-]+)$/, async (req, res, m, q, u) => { if (!guard(u, 'admin', res)) return; const ks = store.apiKeys(); const k = ks.find(x => x.id === m[1]); if (k) { k.revoked = true; store.saveApiKeys(ks); const idx = store.global('apikey-index.json', {}); delete idx[k.hash]; store.saveGlobal('apikey-index.json', idx); store.logAudit(u, 'apikey.revoke', k.id, k.name); } send(res, 200, { ok: true }); });
R('GET', /^\/api\/webhooks$/, async (req, res, m, q, u) => { if (!guard(u, 'admin', res)) return; const w = store.webhooks(); send(res, 200, { hooks: w.hooks.map(h => ({ ...h, secret: h.secret.slice(0, 6) + '…' })), deliveries: w.deliveries, events: work.EVENTS }); });
R('POST', /^\/api\/webhooks$/, async (req, res, m, q, u) => { if (!guard(u, 'admin', res)) return; const b = await readBody(req); if (!work.validHookUrl(b.url)) return send(res, 422, { error: 'url', message: 'Geçerli bir http(s) adresi girin' }); const w = store.webhooks(); const h = { id: 'H' + U.uid().slice(0, 5), url: b.url, events: (b.events || work.EVENTS).filter(e => work.EVENTS.includes(e)), secret: crypto.randomBytes(18).toString('hex'), active: true, createdAt: new Date().toISOString() }; w.hooks.push(h); store.saveWebhooks(w); store.logAudit(u, 'webhook.create', h.id, h.url); send(res, 200, h); });
R('DELETE', /^\/api\/webhooks\/([\w-]+)$/, async (req, res, m, q, u) => { if (!guard(u, 'admin', res)) return; const w = store.webhooks(); w.hooks = w.hooks.filter(h => h.id !== m[1]); store.saveWebhooks(w); store.logAudit(u, 'webhook.delete', m[1], ''); send(res, 200, { ok: true }); });
R('POST', /^\/api\/webhooks\/([\w-]+)\/test$/, async (req, res, m, q, u) => { if (!guard(u, 'admin', res)) return; const h = store.webhooks().hooks.find(x => x.id === m[1]); if (!h) return send(res, 404, {}); send(res, 200, await work.deliver(u.orgId, h, 'test.ping', { hello: 'world' })); });

// Bültenler
const affOnly = u => !!store.ROLES[u.role]?.affiliateOnly;   // Okuyucu / iştirak: yalnızca onaylı bültenin iştirak sürümü
const affSlim = b => ({ id: b.id, date: b.date, status: b.status, lang: b.lang, items: b.items.filter(i => i.included).length, approvedAt: b.approvals?.at(-1)?.at || null, contentHash: b.contentHash || null, affiliateOnly: true });
R('GET', /^\/api\/bulletins$/, async (req, res, m, q, u) => { const all = store.bulletins(); if (affOnly(u)) return send(res, 200, all.filter(b => b.status === 'approved').map(affSlim).reverse()); send(res, 200, all.map(b => ({ id: b.id, date: b.date, status: b.status, lang: b.lang, items: b.items.filter(i => i.included).length, createdAt: b.createdAt, createdBy: b.createdBy, approvals: b.approvals, overall: Bul.overallBase(b).state, contentHash: b.contentHash || null })).reverse()); });
R('GET', /^\/api\/bulletins\/today$/, async (req, res, m, q, u) => { if (affOnly(u)) { const ap = store.bulletins().filter(b => b.status === 'approved'); const t0 = ap.find(b => b.date === U.todayISO()) || ap[ap.length - 1]; return send(res, 200, t0 ? { ...affSlim(t0), isToday: t0.date === U.todayISO() } : { none: true, affiliateOnly: true }); } const b = Bul.todayBulletin(u); store.saveBulletins(store.bulletins().map(x => x.id === b.id ? b : x)); send(res, 200, { ...b, errors: Bul.validateForApproval(b), overall: Bul.overallBase(b) }); });
R('GET', /^\/api\/bulletins\/([\w-]+)$/, async (req, res, m, q, u) => { const b = store.bulletins().find(x => x.id === m[1]); if (!b) return send(res, 404, { error: 'not found' }); if (affOnly(u)) return b.status === 'approved' ? send(res, 200, affSlim(b)) : send(res, 403, { error: 'role', message: 'Bu bülten henüz onaylanmadı.' }); if (b.status === 'draft' && Bul.syncDraft(b)) store.saveBulletins(store.bulletins().map(x => x.id === b.id ? b : x)); send(res, 200, { ...b, errors: Bul.validateForApproval(b), overall: Bul.overallBase(b) }); });
R('PUT', /^\/api\/bulletins\/([\w-]+)$/, async (req, res, m, q, u) => {
  if (!guard(u, 'write', res)) return;
  const all = store.bulletins(); const b = all.find(x => x.id === m[1]); if (!b) return send(res, 404, { error: 'not found' });
  if (b.status === 'approved') return send(res, 409, { error: 'locked', message: 'Onaylanmış bülten değiştirilemez.' });
  const body = await readBody(req);
  if (body.items) for (const p of body.items) { const it = b.items.find(i => i.itemId === p.itemId); if (!it) continue; for (const k of ['included', 'note']) if (k in p) it[k] = p[k]; if (p.base) it.base = { decision: ['var', 'yok', ''].includes(p.base.decision) ? p.base.decision : '', note: String(p.base.note || '').slice(0, 400) }; if (p.edit) it.edit = { title: String(p.edit.title || '').slice(0, 300), summary: String(p.edit.summary || '').slice(0, 1500) }; }
  for (const k of ['intro', 'outro']) if (k in body) b[k] = String(body[k]).slice(0, 3000);
  if (body.lang && I.langs.includes(body.lang)) b.lang = body.lang;
  if (b.status === 'review' && !body.keepStatus) b.status = 'draft';
  b.updatedAt = new Date().toISOString(); b.updatedBy = u.name;
  store.saveBulletins(all);
  store.logAudit(u, 'bulletin.edit', b.id, 'Taslak düzenlendi');
  send(res, 200, { ...b, errors: Bul.validateForApproval(b), overall: Bul.overallBase(b) });
});
R('POST', /^\/api\/bulletins\/([\w-]+)\/(submit|approve|reject|reopen)$/, async (req, res, m, q, u) => {
  const all = store.bulletins(); const b = all.find(x => x.id === m[1]); if (!b) return send(res, 404, { error: 'not found' });
  const act = m[2]; const body = await readBody(req); const s = store.settings();
  if (act === 'submit') { if (!guard(u, 'write', res)) return; if (b.status !== 'draft') return send(res, 409, { error: 'state' }); if (Bul.syncDraft(b)) { /* taslak güncel olsun */ } const errs0 = Bul.validateForApproval(b); if (errs0.length) return send(res, 422, { error: 'validation', errors: errs0, message: errs0.some(e => e.code === 'empty') ? 'Boş bülten incelemeye gönderilemez: en az bir gelişme seçili olmalı.' : 'Bülten tamamlanmadan incelemeye gönderilemez (base tespiti eksik).' }); b.status = 'review'; b.submittedBy = u.name; b.submittedAt = new Date().toISOString(); store.logAudit(u, 'bulletin.submit', b.id, 'İncelemeye gönderildi'); for (const mu of auth.orgUsers(u.orgId).filter(x => ['Admin', 'Uyum Yöneticisi'].includes(x.role) && x.id !== u.id)) work.notify(mu.id, 'bulletin_workflow', { title: `Bülten onay bekliyor · ${b.date}`, body: u.name, link: '#/bulten', refId: b.id + ':submit' }); }
  if (act === 'approve') {
    if (!guard(u, 'approve', res)) return;
    if (b.status === 'approved') return send(res, 409, { error: 'state' });
    const errs = Bul.validateForApproval(b); if (errs.length) return send(res, 422, { error: 'validation', errors: errs });
    if (s.fourEyes && (b.submittedBy === u.name || b.createdBy === u.name && !b.submittedBy)) return send(res, 422, { error: 'four_eyes', message: 'Dört göz ilkesi: hazırlayan ile onaylayan farklı olmalı.' });
    b.status = 'approved'; b.contentHash = Bul.hashOf(b);
    b.approvals.push({ by: u.name, role: u.role, at: new Date().toISOString(), comment: String(body.comment || '').slice(0, 500), hash: b.contentHash });
    // sürüm özetleri (arşivde değişmez kopya)
    b.rendered = { internal: Bul.render(b, 'internal', b.lang, 'html'), affiliate: Bul.render(b, 'affiliate', b.lang, 'html') };
    work.webhookEmit('bulletin.approved', { id: b.id, date: b.date, hash: b.contentHash }); billing.meter('bulletins', 1);
    store.logAudit(u, 'bulletin.approve', b.id, `Onaylandı (SHA-256 ${b.contentHash.slice(0, 12)}…)${body.comment ? ' · ' + body.comment : ''}`);
  }
  if (act === 'reject') { if (!guard(u, 'approve', res)) return; b.status = 'draft'; b.history.push({ at: new Date().toISOString(), by: u.name, action: 'reject', comment: String(body.comment || '') }); store.logAudit(u, 'bulletin.reject', b.id, body.comment || 'Taslağa geri gönderildi'); }
  if (act === 'reopen') { if (!guard(u, 'approve', res)) return; if (b.status === 'approved') { b.history.push({ at: new Date().toISOString(), by: u.name, action: 'reopen', comment: String(body.comment || ''), prevHash: b.contentHash }); b.status = 'draft'; b.rendered = null; store.logAudit(u, 'bulletin.reopen', b.id, 'Onay geri alındı: ' + (body.comment || '')); } }
  store.saveBulletins(all); send(res, 200, { ...b, errors: Bul.validateForApproval(b), overall: Bul.overallBase(b) });
});
R('GET', /^\/api\/bulletins\/([\w-]+)\/render$/, async (req, res, m, q, u) => {
  const b = store.bulletins().find(x => x.id === m[1]); if (!b) return send(res, 404, { error: 'not found' });
  const version = q.version === 'affiliate' ? 'affiliate' : 'internal';
  if (affOnly(u) && (version !== 'affiliate' || b.status !== 'approved')) return send(res, 403, { error: 'role', message: 'Bu rol yalnızca onaylı bültenin iştirak sürümünü görüntüleyebilir.' }); const lang = I.langs.includes(q.lang) ? q.lang : b.lang; const fmt = q.format === 'text' ? 'text' : 'html';
  for (const [k, v] of Object.entries(sec.headers(false, 'frame'))) res.setHeader(k, v);
  let out;
  try { out = Bul.render(b, version, lang, fmt); } catch (e) { return send(res, 500, { error: 'render', message: e.message }); }
  if (q.download) { store.logAudit(u, 'bulletin.export', b.id, `${version}/${lang}/${fmt}`); return send(res, 200, out, fmt === 'text' ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8', { 'Content-Disposition': `attachment; filename="bulten-${b.date}-${version}-${lang}.${fmt === 'text' ? 'txt' : 'html'}"` }); }
  if (q.log) store.logAudit(u, 'bulletin.copy', b.id, `${version}/${lang}/${fmt}`);
  send(res, 200, out, fmt === 'text' ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8');
});

// Müşteri tabanı
R('GET', /^\/api\/customers$/, async (req, res) => { const c = store.customers(); send(res, 200, { meta: c.meta, sample: c.rows.slice(0, 200), total: c.rows.length }); });
R('GET', /^\/api\/templates\/customers\.csv$/, async (req, res) => send(res, 200, '\uFEFF' + C.TEMPLATE, 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="musteri-sablonu.csv"' }));
R('POST', /^\/api\/csv\/preview$/, async (req, res) => { const b = await readBody(req); try { send(res, 200, C.preview(b.csv || '')); } catch (e) { send(res, 400, { error: 'csv', message: e.message }); } });
R('POST', /^\/api\/customers$/, async (req, res, m, q, u) => {
  if (!guard(u, 'write', res)) return; const body = await readBody(req);
  try {
    const c = C.parse(body.csv || '', body.filename, false, body.mapping);
    if (body.dryRun) return send(res, 200, { meta: c.meta, errors: c.errors, warnings: c.warnings, preview: c.rows.slice(0, 8) });
    if (!c.rows.length) return send(res, 422, { error: 'empty', errors: c.errors, message: 'İçe aktarılacak geçerli satır yok' });
    C.save(c); store.logAudit(u, 'customers.upload', c.meta.filename, `${c.meta.count} kayıt, ${c.meta.skipped} atlandı (yerel, ${c.meta.sha})`); scan.reenrichAll(); setTimeout(() => store.runAs(u.orgId, () => screening.runFull()), 20);
    send(res, 200, { meta: c.meta, errors: c.errors, warnings: c.warnings });
  } catch (e) { send(res, 400, { error: e.code || 'csv', message: e.message }); }
});
// Anlık toplu arama (müşteri tabanına kaydedilmez)
R('POST', /^\/api\/screen\/batch$/, async (req, res, m, q, u) => {
  const body = await readBody(req); const thr = +body.threshold || store.settings().matchThreshold;
  try {
    const c = C.parse(body.csv || '', body.filename, false, body.mapping); if (c.rows.length > 20000) return send(res, 413, { error: 'too_many', message: 'En fazla 20.000 satır' });
    const idx = L.orgIndex(); const out = []; let hitRows = 0;
    for (const r of c.rows) {
      const hits = idx.search(r.name, { threshold: thr, limit: 3, imo: r.imo ? [r.imo] : undefined }).map(h => ({ score: h.score, how: h.type, reasons: h.reasons, name: h.entry.n[0], src: h.entry.s, id: h.entry.id, program: h.entry.c || '', url: L.present(h.entry).url }));
      if (!hits.length && r.aliases.length) for (const al of r.aliases) { const hh = idx.search(al, { threshold: thr, limit: 2 }); for (const h of hh) hits.push({ score: h.score, how: 'alias', reasons: h.reasons, name: h.entry.n[0], src: h.entry.s, id: h.entry.id, program: h.entry.c || '', url: L.present(h.entry).url }); }
      if (hits.length) hitRows++; out.push({ id: r.id, name: r.name, imo: r.imo, type: r.type, hits: hits.slice(0, 3) });
    }
    work.webhookEmit('match.hit', { batch: true, rows: c.rows.length, hitRows });
    store.logAudit(u, 'screen.batch', body.filename || '', `${c.rows.length} satır, ${hitRows} olası eşleşme, eşik ${thr}`); billing.meter('screenings', c.rows.length);
    send(res, 200, { total: c.rows.length, hitRows, threshold: thr, results: out, errors: c.errors, warnings: c.warnings, lists: L.meta(), at: new Date().toISOString() });
  } catch (e) { send(res, 400, { error: e.code || 'csv', message: e.message }); }
});
R('POST', /^\/api\/customers\/sample$/, async (req, res, m, q, u) => { if (!guard(u, 'write', res)) return; const c = C.loadSample(); store.logAudit(u, 'customers.sample', c.meta.filename, 'Örnek veri yüklendi'); scan.reenrichAll(); setTimeout(() => screening.runFull(), 20); send(res, 200, { meta: c.meta }); });
R('DELETE', /^\/api\/customers$/, async (req, res, m, q, u) => { if (!guard(u, 'write', res)) return; C.save({ meta: null, rows: [] }); store.saveMatchRun(null); store.logAudit(u, 'customers.delete', '', 'Müşteri verisi silindi'); scan.reenrichAll(); bus.emit('match', { hitCount: 0 }); send(res, 200, { ok: true }); });
R('GET', /^\/api\/match$/, async (req, res) => send(res, 200, store.matchRun() || null));
R('POST', /^\/api\/match\/run$/, async (req, res, m, q, u) => { const b = await readBody(req); const r = screening.runFull(+b.threshold || undefined); store.logAudit(u, 'match.run', '', `Toplu tarama: ${r ? r.hitCount + ' olası eşleşme / ' + r.screened : 'müşteri yok'}`); send(res, 200, r); });
R('GET', /^\/api\/adverse\/info$/, async (req, res) => send(res, 200, require('./lib/adverse').info()));
R('POST', /^\/api\/adverse$/, async (req, res, m, q, u) => {
  const A = require('./lib/adverse'); if (!A.enabled()) return send(res, 403, { error: 'external_lookups_disabled', message: 'Dış aramalar bu kurulumda kapalı (UM_EXTERNAL_LOOKUPS=0).' });
  if (!sec.rateLimit('adv:' + u.id, 20, 60e3).ok) return send(res, 429, { error: 'rate', message: 'Çok fazla istek' });
  const b = await readBody(req); const name = String(b.name || '').slice(0, 120); const out = { name };
  store.logAudit(u, 'adverse.lookup', name.slice(0, 80), 'GDELT' + (b.interpol ? '+Interpol' : ''));
  try { out.gdelt = await A.gdelt(name); } catch (e) { out.gdelt = { error: e.message }; }
  if (b.interpol) { try { out.interpol = await A.interpol(name); } catch (e) { out.interpol = { error: e.message }; } }
  send(res, 200, out);
});
R('POST', /^\/api\/screen\/ownership$/, async (req, res, m, q, u) => {
  const b = await readBody(req); const thr = +b.threshold || store.settings().matchThreshold; const owners = (Array.isArray(b.owners) ? b.owners : []).slice(0, 50);
  const rows = owners.map(o => { const pct = Math.max(0, Math.min(100, +o.pct || 0)); const hits = L.orgIndex().search(String(o.name || ''), { threshold: thr, limit: 3 }).map(h => ({ score: h.score, entry: L.present(h.entry) })); return { name: String(o.name || '').slice(0, 160), pct, hits }; });
  const direct = rows.filter(r => r.hits.length).reduce((a, r) => a + r.pct, 0);
  const level = direct >= 50 ? 'block' : direct >= 25 ? 'edd' : rows.some(r => r.hits.length) ? 'review' : 'clear';
  store.logAudit(u, 'screen.ownership', '', `sahip=${rows.length} toplam%=${direct} seviye=${level}`); send(res, 200, { rows, aggregatePct: direct, level, note: 'Pratik ilk sürüm: yalnızca girilen doğrudan/dolaylı pay yüzdeleri toplanır; sahiplik grafı (zincirleme çarpma) yoktur.' });
});

/* Good-guy (güvenilir) liste: müşteri × liste kaydı çifti, gerekçe ve onaylayan ile; denetim kaydı zorunlu */
R('GET', /^\/api\/screen\/goodguys$/, (req, res, m, q, u) => send(res, 200, { items: store.settings().goodGuys || [] }));
R('POST', /^\/api\/screen\/goodguys$/, async (req, res, m, q, u) => {
  if (!guard(u, 'approve', res)) return; const b = await readBody(req);
  if (!b.customerId || !b.src || !b.entryId || String(b.note || '').trim().length < 10) return send(res, 422, { error: 'bad_request', message: 'customerId, src, entryId ve en az 10 karakterlik gerekçe gerekli' });
  const s = store.settings(); const gg = s.goodGuys || []; if (gg.some(g => g.customerId === b.customerId && g.src === b.src && g.entryId === b.entryId)) return send(res, 200, { items: gg });
  gg.push({ customerId: String(b.customerId), src: String(b.src), entryId: String(b.entryId), customerName: String(b.customerName || '').slice(0, 120), entryName: String(b.entryName || '').slice(0, 120), note: String(b.note).slice(0, 400), by: u.name, at: new Date().toISOString() });
  store.saveSettings({ ...s, goodGuys: gg }); store.logAudit(u, 'screen.goodguy.add', `${b.customerId}×${b.src}:${b.entryId}`, String(b.note).slice(0, 200)); send(res, 200, { items: gg });
});
R('DELETE', /^\/api\/screen\/goodguys\/(\d+)$/, (req, res, m, q, u) => {
  if (!guard(u, 'approve', res)) return; const s = store.settings(); const gg = s.goodGuys || []; const g = gg[+m[1]]; if (!g) return send(res, 404, { error: 'not found' });
  gg.splice(+m[1], 1); store.saveSettings({ ...s, goodGuys: gg }); store.logAudit(u, 'screen.goodguy.remove', `${g.customerId}×${g.src}:${g.entryId}`, ''); send(res, 200, { items: gg });
});
R('POST', /^\/api\/screen$/, async (req, res, m, q, u) => {
  const b = await readBody(req); const thr = +b.threshold || store.settings().matchThreshold;
  const cust = { id: '_q', taxId: b.taxId || b.id || '', yob: b.yob || b.dob || '' }; const cids = SEC.idsOf(cust); const lt = store.settings().listThresholds || {};
  const raw = L.orgIndex().search(b.name || '', { threshold: thr, limit: 16, ids: cids.length ? cids : undefined, imo: b.imo ? [String(b.imo).replace(/\D/g, '')] : undefined });
  const adj = SEC.adjust(cust, raw, { thresholdOf: s => lt[s] ?? thr }); const hits = adj.hits.slice(0, 12).map(h => ({ score: h.score, reasons: h.reasons, how: h.type, entry: L.present(h.entry) }));
  store.logAudit(u, 'screen.query', (b.name || b.imo || '').slice(0, 80), `${hits.length} sonuç`); send(res, 200, { hits, lists: L.meta() });
});

// Ticaret
R('POST', /^\/api\/trade\/check$/, async (req, res, m, q, u) => { const b = await readBody(req); const r = T.assess(b, I.langs.includes(b.lang) ? b.lang : 'tr'); store.logAudit(u, 'trade.check', (b.ref || '').slice(0, 60), `seviye=${r.level} HS=${(b.hs || []).length} IMO=${(b.imo || []).length} ülke=${(b.countries || []).length}`); send(res, 200, r); });
R('GET', /^\/api\/hs$/, async (req, res, m, q) => send(res, 200, { items: T.searchHS(q.q), meta: T.meta() }));
R('GET', /^\/api\/trade\/meta$/, async (req, res) => send(res, 200, { meta: T.meta(), fatf: T.fatf(), gates: T.gates(), countries: T.countries() }));
R('GET', /^\/api\/trade\/notes$/, async (req, res) => send(res, 200, store.tradeNotes().reverse()));
R('POST', /^\/api\/trade\/notes$/, async (req, res, m, q, u) => { if (!guard(u, 'write', res)) return; const b = await readBody(req); const n = store.tradeNotes(); const rec = { id: 'T' + U.uid(), at: new Date().toISOString(), by: u.name, ref: String(b.ref || '').slice(0, 100), level: b.level, note: String(b.note || '').slice(0, 8000), input: b.input }; n.push(rec); store.saveTradeNotes(n); store.logAudit(u, 'trade.note.save', rec.id, rec.ref || ''); send(res, 200, rec); });

// DD
R('GET', /^\/api\/dd$/, async (req, res) => send(res, 200, DD.overview()));
R('PUT', /^\/api\/dd\/validity\/([\w-]+)$/, async (req, res, m, q, u) => { if (!guard(u, 'write', res)) return; const b = await readBody(req); const d = store.dd(); const v = d.validity.find(x => x.id === m[1]); if (!v) return send(res, 404, {}); const old = v.date; v.date = b.date || null; if (b.owner != null) v.owner = b.owner; if (b.note != null) v.note = b.note; store.saveDD(d); store.logAudit(u, 'dd.validity', v.id, `${old || '-'} → ${v.date || '-'}`); send(res, 200, DD.overview()); });
R('PUT', /^\/api\/dd\/library\/([\w-]+)$/, async (req, res, m, q, u) => {
  if (!guard(u, 'write', res)) return; const b = await readBody(req); const d = store.dd(); const a = d.library.find(x => x.id === m[1]); if (!a) return send(res, 404, {});
  if (b.answer != null && b.answer !== a.answer) { a.history.push({ at: new Date().toISOString(), by: u.name, answer: a.answer }); a.answer = String(b.answer).slice(0, 4000); a.status = 'draft'; a.approvedOn = null; }
  if (b.approve) { if (!guard(u, 'approve', res)) return; a.status = 'approved'; a.approvedOn = U.todayISO(P.tz); a.approvedBy = u.name; }
  if (b.owner != null) a.owner = b.owner; store.saveDD(d); store.logAudit(u, b.approve ? 'dd.answer.approve' : 'dd.answer.edit', a.id, a.question.slice(0, 60)); send(res, 200, DD.overview());
});
R('POST', /^\/api\/dd\/library$/, async (req, res, m, q, u) => { if (!guard(u, 'write', res)) return; const b = await readBody(req); const d = store.dd(); const a = { id: 'c-' + U.uid(), category: b.category || 'Genel', wolfsberg: b.wolfsberg || '', question: String(b.question || '').slice(0, 1000), answer: String(b.answer || '').slice(0, 4000), keywords: [], owner: u.name, approvedOn: null, status: 'draft', reviewMonths: 12, linkedTo: null, params: [], history: [] }; d.library.push(a); store.saveDD(d); store.logAudit(u, 'dd.answer.add', a.id, a.question.slice(0, 60)); send(res, 200, DD.overview()); });
R('PUT', /^\/api\/dd\/docs\/([\w-]+)$/, async (req, res, m, q, u) => { if (!guard(u, 'write', res)) return; const b = await readBody(req); const d = store.dd(); const x = d.docs.find(z => z.id === m[1]); if (!x) return send(res, 404, {}); x.status = b.status; x.updatedAt = new Date().toISOString(); store.saveDD(d); store.logAudit(u, 'dd.doc', x.id, b.status); send(res, 200, DD.overview()); });
R('POST', /^\/api\/dd\/draft$/, async (req, res, m, q, u) => { const b = await readBody(req); const d = DD.draft(b.text, { correspondent: b.correspondent || '[CORRESPONDENT]', bank: b.bank }, b.name); const dd = store.dd(); dd.drafts = [d, ...(dd.drafts || [])].slice(0, 30); store.saveDD(dd); store.logAudit(u, 'dd.draft', d.id, `${d.rows.length} soru · ${d.ctx.correspondent}`); send(res, 200, d); });
R('PUT', /^\/api\/dd\/draft\/([\w-]+)$/, async (req, res, m, q, u) => { if (!guard(u, 'write', res)) return; const b = await readBody(req); const dd = store.dd(); const d = (dd.drafts || []).find(x => x.id === m[1]); if (!d) return send(res, 404, {}); d.rows = b.rows || d.rows; d.updatedAt = new Date().toISOString(); store.saveDD(dd); if (b.approved) store.logAudit(u, 'dd.draft.approve', d.id, `${d.rows.filter(r => r.decision === 'ok').length}/${d.rows.length} onaylı`); send(res, 200, d); });

// Kaynaklar / referans
R('GET', /^\/api\/sources$/, async (req, res) => send(res, 200, { directory: JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'sources.json'), 'utf8')), status: sourceMeta(), lists: L.meta(), listDefs: L.DEFS }));
R('GET', /^\/api\/fatf$/, async (req, res) => { const f = T.fatf(); const ctr = Object.fromEntries(T.countries().map(c => [c.iso, c])); send(res, 200, { ...f, black: f.black.map(x => ({ ...x, tr: ctr[x.iso]?.tr || x.en })), grey: f.grey.map(x => ({ ...x, tr: ctr[x.iso]?.tr || x.en })) }); });
R('GET', /^\/api\/audit$/, async (req, res, m, q, u) => { if (!guard(u, 'approve', res)) return; send(res, 200, { events: store.audit(500), verify: store.verifyAudit() }); });
R('GET', /^\/api\/audit\.csv$/, async (req, res, m, q, u) => { if (!guard(u, 'approve', res)) return; const rows = [['n', 'zaman_utc', 'kullanici', 'rol', 'islem', 'hedef', 'ayrinti', 'hash'], ...store.audit().map(e => [e.n, e.ts, e.user, e.role, e.action, e.target, e.detail, e.hash])]; send(res, 200, sec.toCSV(rows), 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="denetim-izi.csv"' }); });

// Ayarlar / kullanıcılar
R('PUT', /^\/api\/settings$/, async (req, res, m, q, u) => {
  if (!guard(u, 'admin', res)) return; const b = await readBody(req); const s = store.settings();
  const num = (k, lo, hi) => { if (k in b) s[k] = Math.min(hi, Math.max(lo, +b[k] || lo)); };
  num('lookbackDays', 1, 14); num('matchThreshold', 60, 100); num('policyReviewMonths', 1, 36); num('boardListMaxAgeMonths', 1, 36); num('shareholdingMaxAgeMonths', 1, 36);
  for (const k of ['institution', 'department', 'bulletinSignature']) if (k in b) s[k] = String(b[k]).slice(0, 120);
  if (Array.isArray(b.listsEnabled)) { const ok = b.listsEnabled.filter(x => Object.keys(L.DEFS).includes(x)); if (!ok.length) return send(res, 422, { error: 'lists', message: 'En az bir liste açık olmalı' }); s.listsEnabled = ok; setTimeout(() => screening.runAllOrgs(), 50); }
  if (b.listThresholds && typeof b.listThresholds === 'object') { const lt = {}; for (const [k, v] of Object.entries(b.listThresholds)) if (L.DEFS[k] && v !== null && v !== '' && +v) lt[k] = Math.min(100, Math.max(60, Math.round(+v))); s.listThresholds = lt; store.logAudit(u, 'settings.listThresholds', '', Object.entries(lt).map(([k, v]) => k + '=' + v).join(', ') || 'varsayılan'); setTimeout(() => screening.runAllOrgs(), 50); }
  if (b.ai && 'enabled' in b.ai) { s.ai = { enabled: b.ai.enabled === null ? null : !!b.ai.enabled }; store.logAudit(u, 'settings.ai', '', 'Yapay zekâ (harici LLM) ayarı: ' + (s.ai.enabled === null ? 'varsayılan' : s.ai.enabled ? 'açık' : 'kapalı')); }
  if ('fourEyes' in b) s.fourEyes = !!b.fourEyes; if (b.defaultLang && I.langs.includes(b.defaultLang)) s.defaultLang = b.defaultLang;
  if (b.retention) for (const k of ['notificationsDays', 'outboxDays', 'auditYears', 'scansDays']) if (k in b.retention) s.retention[k] = Math.max(1, Math.min(3650, +b.retention[k] || 1));
  if (b.slaHours) for (const k of ['critical', 'high', 'normal']) if (k in b.slaHours) s.slaHours[k] = Math.max(1, Math.min(240, +b.slaHours[k] || 1));
  if (b.smtp) { const sm = s.smtp; for (const k of ['host', 'user', 'from']) if (k in b.smtp) sm[k] = String(b.smtp[k]).slice(0, 160); if ('port' in b.smtp) sm.port = +b.smtp.port || 587; if ('secure' in b.smtp) sm.secure = !!b.smtp.secure; if (b.smtp.pass) sm.pass = String(b.smtp.pass).slice(0, 200); }
  if (b.sso) for (const k of ['idpMetadataUrl', 'entityId', 'note', 'protocol']) if (k in b.sso) s.sso[k] = String(b.sso[k]).slice(0, 300); if (b.sso && 'enabled' in b.sso) s.sso.enabled = !!b.sso.enabled;
  const J = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'jurisdictions.json'), 'utf8'));
  if (Array.isArray(b.jurisdictions)) { const ok = b.jurisdictions.filter(c => J.jurisdictions.some(j => j.code === c)); if (ok.length) s.jurisdictions = ok; }
  if (b.residency && J.residency.some(r => r.id === b.residency.mode)) s.residency = { mode: b.residency.mode, note: String(b.residency.note || '').slice(0, 300) };
  if (b.security) {
    const x = b.security, t = s.security;
    if ('idleMinutes' in x) t.idleMinutes = Math.min(240, Math.max(5, +x.idleMinutes || 30)); if ('requireMfa' in x) t.requireMfa = !!x.requireMfa; if ('minPasswordLength' in x) t.minPasswordLength = Math.min(64, Math.max(12, +x.minPasswordLength || 12));
    if (Array.isArray(x.ipAllowlist)) { const l = x.ipAllowlist.map(v => String(v).trim()).filter(Boolean).slice(0, 100); if (l.some(v => !/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^[0-9a-f:]+$/i.test(v))) return send(res, 422, { error: 'ip_format', message: 'Geçersiz IP / CIDR' }); if (l.length && !sec.ipAllowed(clientIp(req), l)) return send(res, 422, { error: 'self_lockout', message: 'Mevcut IP adresiniz listede yok; kendinizi kilitlemeyin.' }); t.ipAllowlist = l; }
  }
  if (b.roi) { const r = s.roi, x = b.roi; for (const [k, lo, hi] of [['analysts', 1, 500], ['hourlyCostUsd', 1, 1000], ['manualMinutesPerDay', 0, 1000], ['autoMinutesPerDay', 0, 1000], ['workdays', 1, 31]]) if (k in x) r[k] = Math.min(hi, Math.max(lo, +x[k] || lo)); if (Array.isArray(x.tools)) r.tools = x.tools.slice(0, 10).map(t => ({ name: String(t.name || '').slice(0, 60), annualUsd: Math.max(0, +t.annualUsd || 0) })); }
  store.saveSettings(s); store.logAudit(u, 'settings.update', '', Object.keys(b).join(', ')); scan.reenrichAll(); send(res, 200, { ...s, smtp: { ...s.smtp, pass: s.smtp.pass ? '••••••' : '' } });
});
R('GET', /^\/api\/settings\/full$/, async (req, res, m, q, u) => { if (!guard(u, 'admin', res)) return; const s = store.settings(); send(res, 200, { ...s, smtp: { ...s.smtp, pass: s.smtp.pass ? '••••••' : '' }, nodemailer: mailer.hasNodemailer }); });
R('GET', /^\/api\/blocklist$/, async (req, res, m, q, u) => { if (!guard(u, 'approve', res)) return; send(res, 200, store.blocklist()); });
R('POST', /^\/api\/blocklist$/, async (req, res, m, q, u) => {
  if (!guard(u, 'approve', res)) return; const b = await readBody(req); const name = String(b.name || '').trim().slice(0, 200); if (!name) return send(res, 422, { error: 'name' });
  const bl = store.blocklist(); if (bl.length >= 5000) return send(res, 422, { error: 'limit' });
  const rec = { id: 'IB' + U.uid().slice(0, 6), name, type: ['person', 'entity', 'vessel'].includes(b.type) ? b.type : 'entity', imo: String(b.imo || '').replace(/\D/g, '').slice(0, 7) || undefined, note: String(b.note || '').slice(0, 300), aliases: [], addedBy: u.name, addedAt: new Date().toISOString() };
  bl.push(rec); store.saveBlocklist(bl); store.logAudit(u, 'blocklist.add', rec.id, rec.name.slice(0, 60)); setTimeout(() => screening.runAllOrgs(), 50); send(res, 200, rec);
});
R('DELETE', /^\/api\/blocklist\/([\w-]+)$/, async (req, res, m, q, u) => { if (!guard(u, 'approve', res)) return; store.saveBlocklist(store.blocklist().filter(x => x.id !== m[1])); store.logAudit(u, 'blocklist.delete', m[1], ''); setTimeout(() => screening.runAllOrgs(), 50); send(res, 200, { ok: true }); });
R('GET', /^\/api\/export\/audit\.json$/, async (req, res, m, q, u) => { if (!guard(u, 'admin', res)) return; store.logAudit(u, 'audit.export', 'json', ''); send(res, 200, { exportedAt: new Date().toISOString(), org: u.orgId, verify: store.verifyAudit(), events: store.audit() }, undefined, { 'Content-Disposition': 'attachment; filename="denetim-izi.json"' }); });
R('GET', /^\/api\/export\/my-data\.json$/, async (req, res, m, q, u) => { store.logAudit(u, 'kvkk.export', u.email, 'Kişisel veri dışa aktarımı'); send(res, 200, { user: auth.pub(u), prefs: u.prefs, watchlist: work.listWatch(u.id), notifications: work.userNotifs(u.id), tasks: store.tasks().filter(t => t.assignee === u.id) }, undefined, { 'Content-Disposition': 'attachment; filename="verilerim.json"' }); });

// REST API v1 (API anahtarı ile)
const API_DOC = [
  ['GET', '/api/v1/entities?q=ad&src=ofac&type=p&status=active', 'Birleşik varlık deposunda ara (kişi/kuruluş/gemi/hava aracı; takma ad, program, ilk/son görülme, çıkarılma)'], ['GET', '/api/v1/changes?since=2026-11-01&kind=added', 'Liste değişiklik günlüğü (added/updated/removed/readded)'],
  ['GET', '/api/v1/status', 'Platform ve kaynak durumu'], ['GET', '/api/v1/items?type=ADD&source=ofac', 'Son gelişmeler (filtre: type, source, since=YYYY-MM-DD)'],
  ['POST', '/api/v1/screen', '{ "name": "...", "imo": "...", "threshold": 85 } → liste eşleşmeleri'], ['GET', '/api/v1/bulletins', 'Onaylı bültenler (özet)'],
];
async function apiV1(req, res, pathname, q) {
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || ''); const hit = m && store.global('apikey-index.json', {})[U.sha256(m[1])];
  if (!hit) return send(res, 401, { error: 'unauthorized', message: 'Authorization: Bearer <API key>' });
  const rl = (apiV1.rl = apiV1.rl || new Map()); const k = hit.id, now = Date.now(); const w = (rl.get(k) || []).filter(t => t > now - 60000); if (w.length >= 120) return send(res, 429, { error: 'rate_limited', limit: '120/min' }); w.push(now); rl.set(k, w);
  return store.runAs(hit.orgId, async () => {
    const ks = store.apiKeys(); const key = ks.find(x => x.id === hit.id); if (key) { key.lastUsed = new Date().toISOString(); store.saveApiKeys(ks); } billing.meter('api_calls', 1);
    if (pathname === '/api/v1/entities' && req.method === 'GET') return send(res, 200, require('./lib/entities').search({ q: String(q.q || '').slice(0, 120), src: String(q.src || ''), type: String(q.type || ''), status: String(q.status || ''), limit: Math.min(100, +q.limit || 40), offset: Math.max(0, +q.offset || 0) }));
    if (pathname === '/api/v1/changes' && req.method === 'GET') return send(res, 200, require('./lib/entities').feed({ since: String(q.since || ''), src: String(q.src || ''), kind: String(q.kind || ''), limit: Math.min(300, +q.limit || 100) }));
    if (pathname === '/api/v1/status' && req.method === 'GET') return send(res, 200, { ...publicStatus(), lists: L.meta() });
    if (pathname === '/api/v1/items' && req.method === 'GET') { let it = scan.items({ all: true }); if (q.type) it = it.filter(i => i.type === q.type); if (q.source) it = it.filter(i => i.srcKey === q.source); if (q.since) it = it.filter(i => i.date >= q.since); return send(res, 200, { count: it.length, items: it.map(i => ({ id: i.id, date: i.date, source: i.source, type: i.type, title: i.title, url: i.url, entities: (i.entities || []).map(e => ({ name: e.name, type: e.type, imo: e.imo })) })) }); }
    if (pathname === '/api/v1/bulletins' && req.method === 'GET') return send(res, 200, store.bulletins().filter(b => b.status === 'approved').map(b => ({ id: b.id, date: b.date, lang: b.lang, hash: b.contentHash, approvedBy: b.approvals.map(a => a.by) })));
    if (pathname === '/api/v1/screen' && req.method === 'POST') { const b = await readBody(req); const hits = L.orgIndex().search(b.name || '', { threshold: +b.threshold || 85, limit: 10, imo: b.imo ? [String(b.imo)] : undefined }).map(h => ({ score: h.score, reasons: h.reasons, entry: L.present(h.entry) })); return send(res, 200, { hits }); }
    return send(res, 404, { error: 'not found', endpoints: API_DOC });
  });
}
R('GET', /^\/api\/reference$/, async (req, res) => send(res, 200, JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'jurisdictions.json'), 'utf8'))));
R('GET', /^\/api\/org\/branches$/, async (req, res, m, q, u) => { const o = store.orgsAll().find(x => x.id === u.orgId); send(res, 200, { branches: o.branches || [{ id: 'hq', name: 'Genel Müdürlük', type: 'hq', parent: null }], users: auth.orgUsers(u.orgId).map(auth.pub) }); });
R('PUT', /^\/api\/org\/branches$/, async (req, res, m, q, u) => {
  if (!guard(u, 'admin', res)) return; const b = await readBody(req); const l = Array.isArray(b.branches) ? b.branches.slice(0, 500) : null; if (!l) return send(res, 422, { error: 'validation' });
  const ids = new Set(); for (const x of l) { if (!/^[\w-]{1,40}$/.test(x.id || '') || ids.has(x.id) || !String(x.name || '').trim() || !['hq', 'region', 'branch'].includes(x.type)) return send(res, 422, { error: 'validation', message: 'Geçersiz birim: ' + x.id }); ids.add(x.id); }
  if (l.filter(x => x.type === 'hq').length !== 1) return send(res, 422, { error: 'validation', message: 'Tam olarak bir Genel Müdürlük olmalı' });
  for (const x of l) if (x.type !== 'hq' && !ids.has(x.parent)) return send(res, 422, { error: 'validation', message: 'Üst birim bulunamadı: ' + x.name });
  const clean = l.map(x => ({ id: x.id, name: String(x.name).slice(0, 80), type: x.type, parent: x.type === 'hq' ? null : x.parent }));
  const orgs = store.orgs(); orgs.find(o => o.id === u.orgId).branches = clean; store.saveOrgs(orgs); store.logAudit(u, 'org.branches', '', `${clean.length} birim`); send(res, 200, { branches: clean });
});
R('GET', /^\/api\/roi$/, async (req, res, m, q, u) => {
  const r = store.settings().roi; const b = billing.ensure(u.orgId); const an = work.analytics(); const sub = null; /* faturalama kapsam dışı: abonelik bedeli ROI'ye katılmaz */
  const hoursSavedMonth = Math.max(0, (r.manualMinutesPerDay - r.autoMinutesPerDay)) * r.analysts * r.workdays / 60; const costSaved = hoursSavedMonth * r.hourlyCostUsd; const toolsMonthly = r.tools.reduce((a, t) => a + (t.annualUsd || 0), 0) / 12;
  send(res, 200, { inputs: r, measured: { bulletinMinutes: an.kpi.bulletinMinutes }, hoursSavedMonth: Math.round(hoursSavedMonth), costSavedMonth: Math.round(costSaved), toolsReplacedMonth: Math.round(toolsMonthly), subscriptionMonth: sub, netMonth: sub == null ? null : Math.round(costSaved + toolsMonthly - sub), roiMultiple: sub ? Math.round((costSaved + toolsMonthly) / sub * 10) / 10 : null, plan: b.plan, seats: b.seats, note: 'Tahmindir: değerler Ayarlar › Tasarruf alanındaki girdilerinize dayanır.' });
});
R('GET', /^\/api\/docs$/, async (req, res) => send(res, 200, { base: '/api/v1', auth: 'Authorization: Bearer <API key>', rateLimit: '120/dk', endpoints: API_DOC, webhook: { signature: 'X-UM-Signature: sha256=HMAC(secret, body)', events: work.EVENTS } }));

const MFA_EXEMPT = /^\/api\/(status|me|me\/password|me\/security|me\/mfa\/(begin|confirm)|auth\/logout|events)$/;
const PW_EXEMPT = /^\/api\/(status|me\/password|auth\/logout|events)$/;
const PLATFORM_ONLY = /^\/api\/(platform\/|status$|me(\/|$)|auth\/|events$|public\/)/;
async function handle(req, res) {
  const pathname = decodeURIComponent(req.url.split('?')[0]); const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const secure = isSecure(req); const ip = clientIp(req);
  for (const [k, v] of Object.entries(sec.headers(secure))) res.setHeader(k, v);
  if (pathname.startsWith('/api/')) { const lim = sec.rateLimit('ip:' + ip, 900, 60e3); if (!lim.ok) return send(res, 429, { error: 'rate_limited' }, undefined, { 'Retry-After': lim.retryAfter }); }
  if (pathname.startsWith('/api/v1/')) return apiV1(req, res, pathname, q);
  if (pathname.startsWith('/api/')) {
    for (const r of routes) {
      if (r.method !== req.method) continue; const m = r.re.exec(pathname); if (!m) continue;
      const open = PUBLIC_ROUTES.has(r.method + ' ' + pathname);
      try {
        if (open) { await r.fn(req, res, m, q, null); return; }
        const sess = auth.fromRequest(req); if (!sess) return send(res, 401, { error: 'auth', message: 'Oturum gerekli veya süresi doldu' });
        const u = sess.user; req.__session = sess;
        if (!['GET', 'HEAD'].includes(req.method)) {
          if (req.headers['x-csrf-token'] !== sess.csrf) return send(res, 403, { error: 'csrf', message: 'CSRF doğrulaması başarısız' });
          if (!originOk(req)) return send(res, 403, { error: 'origin' });
        }
        const sset = store.runAs(u.orgId, () => store.settings().security);
        if (!sec.ipAllowed(ip, sset.ipAllowlist)) return send(res, 403, { error: 'ip', message: 'Bu ağdan erişim izni yok' });
        if (u.mustChangePassword && !PW_EXEMPT.test(pathname)) return send(res, 403, { error: 'password_change_required', message: 'İlk girişte geçici parolanızı değiştirmelisiniz' });
        if (u.role === 'Platform' && !PLATFORM_ONLY.test(pathname)) return send(res, 403, { error: 'role', message: 'Platform hesabı kurum verilerine erişemez' });
        if ((sset.requireMfa || u.mfaRequired || u.role === 'Platform') && !u.mfa?.enabled && !MFA_EXEMPT.test(pathname)) return send(res, 403, { error: 'mfa_enrollment_required', message: 'Devam etmek için MFA’yı etkinleştirin' });
        const lim = sec.rateLimit('u:' + u.id, 600, 60e3); if (!lim.ok) return send(res, 429, { error: 'rate_limited' });
        if (/^\/api\/(screen\/batch|customers)$/.test(pathname) && req.method === 'POST') { const l2 = sec.rateLimit('heavy:' + u.id, 12, 60e3); if (!l2.ok) return send(res, 429, { error: 'rate_limited' }); }
        await store.runAs(u.orgId, () => r.fn(req, res, m, q, u));
      } catch (e) { console.error(pathname, sec.mask(e.message)); if (!res.headersSent) send(res, e.status || 500, { error: 'server', message: e.status ? e.message : 'Sunucu hatası' }); }
      return;
    }
    return send(res, 404, { error: 'not found' });
  }
  if (pathname === '/brand.css') { res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(require('./lib/brand').css()); }
  let f = path.normalize(path.join(PUB, pathname === '/' ? 'index.html' : pathname));
  if (!f.startsWith(PUB)) return send(res, 403, 'forbidden', 'text/plain');
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUB, 'index.html');
  const ext = path.extname(f);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.ttf' ? 'public, max-age=86400' : 'no-cache' });
  fs.createReadStream(f).pipe(res);
}

const server = http.createServer((req, res) => { handle(req, res).catch(e => { console.error(e); if (!res.headersSent) send(res, 500, { error: e.message }); }); });
server.requestTimeout = 60000; server.headersTimeout = 15000;
server.listen(PORT, HOST, async () => {
  console.log(`\n  ${require('./lib/brand').name('tr')}  →  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}\n  Zamanlayıcı başlatıldı: kaynaklar kendiliğinden güncellenir (manuel yenileme yok).\n`);
  if (await seed.run()) console.log(`  DEMO verisi oluşturuldu (yalnızca ilk çalıştırma). Demo giriş: admin@demo-banka.example — parola README'de / UM_DEMO_PASSWORD ile değiştirilebilir.\n`);
  scan.loadLive(); sched.init(); setTimeout(() => { try { require('./lib/entities').ingestAll(); } catch (e) { console.error('entities', e.message); } }, 3000).unref(); setTimeout(() => { try { require('./lib/entities').ingestAll(); } catch (e) { console.error('entities', e.message); } }, 3000).unref();
  setTimeout(() => { try { screening.runAllOrgs(); } catch (e) { console.error('screening', e.message); } }, 8000).unref();
  if (process.env.UM_BILLING === '1') { try { platform.tick(); } catch (e) { console.error('platform.tick', e.message); } setInterval(() => { try { platform.tick(); } catch (e) { console.error('platform.tick', e.message); } }, 3600e3).unref(); }
  setInterval(() => { try { work.dailyTick(); } catch (e) { console.error('dailyTick', e.message); } }, 60000).unref();
  setInterval(() => { for (const o of store.orgs()) store.runAs(o.id, () => { try { work.retention(); } catch { } }); }, 6 * 3600e3).unref();
});
process.on('unhandledRejection', e => console.error('unhandledRejection', e && e.message));
