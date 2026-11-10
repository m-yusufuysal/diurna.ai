'use strict';
/* Kimlik doğrulama (bankacılık düzeyi):
 *  - Parola: argon2id (yoksa scrypt’e düşer; hash biçimi kendini tanımlar), parola politikası, kilitleme
 *  - MFA: TOTP (RFC 6238) + tek kullanımlık kurtarma kodları
 *  - Oturum: HttpOnly + SameSite=Strict (+Secure/__Host- HTTPS’te), girişte yenileme, boşta/mutlak zaman aşımı, CSRF belirteci, oturum listesi/iptali
 *  - SSO (SAML 2.0 / OIDC) yalnızca yer tutucudur. */
const crypto = require('crypto');
const store = require('./store'); const U = require('./util'); const sec = require('./security');
let argon = null; try { argon = require('argon2'); } catch { }
const ABS_HOURS = 12; const LOCK_AFTER = 5; const LOCK_MIN = 15;

async function hashPw(pw) {
  if (argon) return argon.hash(pw, { type: argon.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const salt = crypto.randomBytes(16).toString('hex'); return `scrypt$${salt}$${crypto.scryptSync(pw, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex')}`;
}
async function verifyPw(hash, pw) {
  if (!hash) return false;
  if (hash.startsWith('$argon2')) { if (!argon) return false; try { return await argon.verify(hash, pw); } catch { return false; } }
  if (hash.startsWith('scrypt$')) { const [, salt, h] = hash.split('$'); const a = crypto.scryptSync(pw, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }), b = Buffer.from(h, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); }
  return false;
}
const DEFAULT_PREFS = () => ({
  lang: 'tr',
  subscriptions: { sources: ['ofac', 'uk', 'eu', 'un', 'fatf'], regimes: [], countries: [] },
  rules: {
    new_add: { inapp: true, email: false }, customer_match: { inapp: true, email: true }, watchlist_hit: { inapp: true, email: true }, vessel_delisting: { inapp: true, email: false },
    fatf_change: { inapp: true, email: true }, general_licence: { inapp: true, email: false }, task_assigned: { inapp: true, email: true }, sla_breach: { inapp: true, email: true }, bulletin_workflow: { inapp: true, email: false },
  },
  dailyReport: { enabled: true, time: '08:30', lang: 'tr', email: true },
});
function policyMin() { try { return store.settings().security.minPasswordLength || 12; } catch { return 12; } }
async function createUser(orgId, { email, name, role, password, demo, branchId, username, mustChangePassword, mfaRequired }) {
  const issues = sec.passwordIssues(password, { email }, demo ? 12 : store.runAs(orgId, policyMin));
  if (issues.length) throw Object.assign(new Error('Parola politikası: ' + issues.join(', ')), { code: 'weak', issues });
  const users = store.authUsers();
  if (users.some(u => u.email.toLowerCase() === email.toLowerCase())) throw new Error('Bu e-posta adresi zaten kayıtlı');
  let un = username ? String(username).trim().toLowerCase() : (mustChangePassword ? String(email).split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '') : null);
  if (un) { if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(un)) throw Object.assign(new Error('Kullanıcı adı 3–32 karakter (a-z, 0-9, . _ -) olmalı'), { code: 'bad' }); const base = un; let n = 1; while (users.some(x => (x.username || '') === un || x.email === un)) { if (username) throw new Error('Bu kullanıcı adı zaten kayıtlı'); un = base + (++n); } }
  if (users.some(x => x.username && x.username === email.trim().toLowerCase())) throw new Error('Bu e-posta adresi zaten kayıtlı');
  const u = { id: 'u_' + crypto.randomBytes(4).toString('hex'), orgId, email: email.trim().toLowerCase(), username: un, mustChangePassword: !!mustChangePassword, mfaRequired: !!mfaRequired, name, role, branchId: branchId || null, active: true, demo: !!demo, createdAt: new Date().toISOString(), prefs: DEFAULT_PREFS(), lastLogin: null, pwHash: await hashPw(password), pwChangedAt: new Date().toISOString(), mfa: { enabled: false }, fails: 0, lockedUntil: 0 };
  users.push(u); store.saveAuthUsers(users); return u;
}
const pub = u => u && ({ id: u.id, orgId: u.orgId, email: u.email, name: u.name, role: u.role, branchId: u.branchId || null, active: u.active, demo: !!u.demo, lastLogin: u.lastLogin, createdAt: u.createdAt, mfa: !!u.mfa?.enabled, username: u.username || null, mustChangePassword: !!u.mustChangePassword, mfaRequired: !!(u.mfaRequired || u.role === 'Platform') });

const tickets = new Map(); // MFA bekleyen girişler (bellek içi, 5 dk)
function newSession(u, ip, ua) {
  const sid = crypto.randomBytes(32).toString('hex'); const ss = store.sessions(); const now = Date.now();
  for (const k of Object.keys(ss)) if (ss[k].exp < now || (ss[k].idleExp && ss[k].idleExp < now)) delete ss[k];
  const idle = (store.runAs(u.orgId, () => store.settings().security.idleMinutes) || 30) * 60e3;
  ss[U.sha256(sid)] = { userId: u.id, created: now, exp: now + ABS_HOURS * 3600e3, idle, idleExp: now + idle, lastSeen: now, ip: ip || '', ua: String(ua || '').slice(0, 120), csrf: crypto.randomBytes(24).toString('hex') };
  store.saveSessions(ss); return { sid, csrf: ss[U.sha256(sid)].csrf };
}
async function login(email, pw, ip, ua) {
  const key = String(email || '').toLowerCase().trim(); const users = store.authUsers(); const u = users.find(x => x.email === key || (x.username && x.username === key));
  const bad = () => Object.assign(new Error('E-posta veya parola hatalı'), { code: 'bad' });
  if (!u || !u.active) { await hashPw('x'.repeat(12)); throw bad(); } // zamanlama farkını azalt
  if (u.lockedUntil > Date.now()) throw Object.assign(new Error(`Hesap geçici olarak kilitlendi. ${Math.ceil((u.lockedUntil - Date.now()) / 60000)} dk sonra tekrar deneyin.`), { code: 'locked' });
  if (!(await verifyPw(u.pwHash, pw || ''))) { u.fails = (u.fails || 0) + 1; if (u.fails >= LOCK_AFTER) { u.lockedUntil = Date.now() + LOCK_MIN * 60e3; u.fails = 0; store.runAs(u.orgId, () => store.logAudit({ name: u.name, role: u.role }, 'security.lockout', u.email, 'Hesap kilitlendi (5 hatalı deneme)')); } store.saveAuthUsers(users); throw bad(); }
  u.fails = 0; store.saveAuthUsers(users);
  if (u.role !== 'Platform' && require('./platform').orgSuspended(u.orgId)) throw Object.assign(new Error('Kurumunuzun erişimi askıya alındı (ödeme/sözleşme). Lütfen Diurna ile iletişime geçin.'), { code: 'suspended' });
  if (u.mfa?.enabled) { const t = crypto.randomBytes(18).toString('hex'); tickets.set(t, { userId: u.id, exp: Date.now() + 5 * 60e3, tries: 0, ip, ua }); return { mfaRequired: true, ticket: t }; }
  return finish(u, ip, ua);
}
function finish(u, ip, ua) { const users = store.authUsers(); const x = users.find(z => z.id === u.id); x.lastLogin = new Date().toISOString(); store.saveAuthUsers(users); const s = newSession(x, ip, ua); return { ...s, user: x }; }
function verifyMfa(ticket, code, ip) {
  const t = tickets.get(ticket); if (!t || t.exp < Date.now()) throw Object.assign(new Error('Doğrulama süresi doldu, yeniden giriş yapın'), { code: 'expired' });
  const users = store.authUsers(); const u = users.find(x => x.id === t.userId); const ok = checkSecondFactor(users, u, code);
  if (!ok) { t.tries++; if (t.tries >= 5) { tickets.delete(ticket); u.lockedUntil = Date.now() + LOCK_MIN * 60e3; store.saveAuthUsers(users); } throw Object.assign(new Error('Doğrulama kodu hatalı'), { code: 'bad_code' }); }
  store.saveAuthUsers(users); tickets.delete(ticket); return finish(u, ip, t.ua);
}
function checkSecondFactor(users, u, code) {
  code = String(code || '').trim();
  const secret = sec.decStr(u.mfa.secret); const step = sec.totpVerify(secret, code);
  if (step && step !== u.mfa.lastStep) { u.mfa.lastStep = step; return true; } // aynı kod iki kez kullanılamaz
  const h = U.sha256(code.toLowerCase().replace(/[^a-z0-9]/g, '')); const i = (u.mfa.recovery || []).indexOf(h); if (i >= 0) { u.mfa.recovery.splice(i, 1); return true; }
  return false;
}
/* MFA kayıt: önce gizli anahtar üret, sonra kodla doğrula */
function mfaBegin(userId) { const us = store.authUsers(); const u = us.find(x => x.id === userId); const secret = sec.totpSecret(); u.mfa = { enabled: false, pending: sec.encStr(secret) }; store.saveAuthUsers(us); return { secret, uri: sec.otpauth(secret, u.email) }; }
function mfaConfirm(userId, code) {
  const us = store.authUsers(); const u = us.find(x => x.id === userId); if (!u.mfa?.pending) throw new Error('no_pending');
  const secret = sec.decStr(u.mfa.pending); const step = sec.totpVerify(secret, code); if (!step) throw Object.assign(new Error('Kod hatalı'), { code: 'bad_code' });
  const rec = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex').replace(/^(.{5})(.{5})$/, '$1-$2'));
  u.mfa = { enabled: true, secret: u.mfa.pending, lastStep: step, recovery: rec.map(r => U.sha256(r.replace('-', ''))), enabledAt: new Date().toISOString() }; store.saveAuthUsers(us); return rec;
}
async function mfaDisable(userId, password) { const us = store.authUsers(); const u = us.find(x => x.id === userId); if (u.mfaRequired || u.role === 'Platform') throw Object.assign(new Error('Bu hesap için MFA zorunludur'), { code: 'required' }); if (!(await verifyPw(u.pwHash, password || ''))) throw Object.assign(new Error('Parola hatalı'), { code: 'bad' }); u.mfa = { enabled: false }; store.saveAuthUsers(us); }
function resetMfa(userId) { const us = store.authUsers(); const u = us.find(x => x.id === userId); if (u) { u.mfa = { enabled: false }; store.saveAuthUsers(us); revokeAll(userId); } }
async function changePassword(userId, current, next) {
  const us = store.authUsers(); const u = us.find(x => x.id === userId); if (!(await verifyPw(u.pwHash, current || ''))) throw Object.assign(new Error('Mevcut parola hatalı'), { code: 'bad' });
  const issues = sec.passwordIssues(next, { email: u.email }, policyMin()); if (issues.length) throw Object.assign(new Error('Parola politikası'), { code: 'weak', issues });
  if (await verifyPw(u.pwHash, next)) throw Object.assign(new Error('Yeni parola eskisiyle aynı olamaz'), { code: 'same' });
  u.pwHash = await hashPw(next); u.pwChangedAt = new Date().toISOString(); u.mustChangePassword = false; store.saveAuthUsers(us);
}
function sidOf(req) { const m = /(?:^|;\s*)(?:__Host-)?um_sid=([a-f0-9]{64})/.exec(req.headers.cookie || ''); return m && m[1]; }
/* Oturumu doğrula + boşta zaman aşımı + kayan süre */
function fromRequest(req) {
  const sid = sidOf(req); if (!sid) return null; const ss = store.sessions(); const h = U.sha256(sid); const s = ss[h]; const now = Date.now();
  if (!s || s.exp < now || s.idleExp < now) { if (s) { delete ss[h]; store.saveSessions(ss); } return null; }
  const u = store.authUsers().find(x => x.id === s.userId && x.active); if (!u) return null;
  if (u.role !== 'Platform' && require('./platform').orgSuspended(u.orgId)) return null;
  if (now - s.lastSeen > 60e3) { s.lastSeen = now; s.idleExp = now + s.idle; store.saveSessions(ss); }
  return { user: u, csrf: s.csrf, sessionId: h.slice(0, 12), idleExp: s.idleExp, exp: s.exp };
}
function logout(req) { const sid = sidOf(req); if (!sid) return; const ss = store.sessions(); delete ss[U.sha256(sid)]; store.saveSessions(ss); }
function revokeAll(userId, exceptHash) { const ss = store.sessions(); for (const k of Object.keys(ss)) if (ss[k].userId === userId && k.slice(0, 12) !== exceptHash) delete ss[k]; store.saveSessions(ss); }
function sessionsOf(userId, currentHash) { const ss = store.sessions(); return Object.entries(ss).filter(([, v]) => v.userId === userId && v.exp > Date.now()).map(([k, v]) => ({ id: k.slice(0, 12), current: k.slice(0, 12) === currentHash, created: new Date(v.created).toISOString(), lastSeen: new Date(v.lastSeen).toISOString(), ip: sec.mask(v.ip), ua: v.ua })); }
function revokeOne(userId, id) { const ss = store.sessions(); for (const k of Object.keys(ss)) if (ss[k].userId === userId && k.startsWith(id)) delete ss[k]; store.saveSessions(ss); }
function cookie(sid, maxAge, secure) { return `${secure ? '__Host-' : ''}um_sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`; }
const can = (u, what) => !!(store.ROLES[u.role] || {})[what || 'write'];
function orgUsers(orgId) { return store.authUsers().filter(u => u.orgId === orgId); }
function updatePrefs(userId, patch) {
  const users = store.authUsers(); const u = users.find(x => x.id === userId); if (!u) return null;
  const d = DEFAULT_PREFS(); const lang = patch.lang && ['tr', 'en', 'ar'].includes(patch.lang) ? patch.lang : u.prefs.lang;
  u.prefs = { ...d, ...u.prefs, lang, rules: { ...d.rules, ...(u.prefs.rules || {}), ...(patch.rules || {}) }, subscriptions: { ...d.subscriptions, ...(u.prefs.subscriptions || {}), ...(patch.subscriptions || {}) }, dailyReport: { ...d.dailyReport, ...(u.prefs.dailyReport || {}), ...(patch.dailyReport || {}) } };
  store.saveAuthUsers(users); return u;
}
module.exports = { createUser, login, verifyMfa, logout, fromRequest, cookie, can, pub, orgUsers, updatePrefs, mfaBegin, mfaConfirm, mfaDisable, resetMfa, changePassword, sessionsOf, revokeAll, revokeOne, hashPw, verifyPw, DEFAULT_PREFS, ABS_HOURS, hasArgon: !!argon };
