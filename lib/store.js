'use strict';
/* Depolama katmanı. Çok kiracılı: her banka (organizasyon) kendi dizininde tutulur (data/state/orgs/<id>/).
 * İstek/iş bağlamı AsyncLocalStorage ile taşınır; resmî yaptırım verileri (listeler, tarama) kiracılar arasında paylaşılır. */
const fs = require('fs'), path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const ROOT = path.join(__dirname, '..');
const STATE = process.env.UM_DATA_DIR ? path.resolve(process.env.UM_DATA_DIR) : path.join(ROOT, 'data', 'state');
const CACHE = process.env.UM_CACHE_DIR ? path.resolve(process.env.UM_CACHE_DIR) : path.join(ROOT, 'data', 'cache');
fs.mkdirSync(STATE, { recursive: true }); fs.mkdirSync(CACHE, { recursive: true });
const { sha256 } = require('./util');
const sec = require('./security');
const als = new AsyncLocalStorage();

function readJSON(p, def) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return def; } }
function writeJSON(p, obj) { fs.mkdirSync(path.dirname(p), { recursive: true }); const tmp = p + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, p); }
const seed = n => readJSON(path.join(ROOT, 'data', n), null);
const gfile = n => path.join(STATE, n);

const DEFAULT_SETTINGS = {
  institution: 'Demo Banka A.Ş.', department: 'Uyum Müdürlüğü', timezone: 'Europe/Istanbul', lookbackDays: 5, pollNewsMinutes: 10, pollListsMinutes: 60,
  matchThreshold: 85, fourEyes: true, policyReviewMonths: 12, boardListMaxAgeMonths: 12, shareholdingMaxAgeMonths: 12,
  bulletinSignature: 'Uyum Müdürlüğü – Yaptırım İzleme', defaultLang: 'tr',
  retention: { notificationsDays: 180, outboxDays: 60, auditYears: 10, scansDays: 400 },
  slaHours: { critical: 4, high: 8, normal: 24 },
  smtp: { host: '', port: 587, secure: false, user: '', pass: '', from: 'diurna@example.bank' },
  sso: { enabled: false, protocol: 'SAML 2.0', idpMetadataUrl: '', entityId: '', note: '' },
  security: { idleMinutes: 30, requireMfa: false, ipAllowlist: [], minPasswordLength: 12 },
  listsEnabled: ['ofac', 'ofacc', 'uk', 'eu', 'un', 'tr'],
  ai: { enabled: null },
  jurisdictions: ['TR'], residency: { mode: 'cloud-eu', note: '' },
  roi: { analysts: 4, hourlyCostUsd: 35, manualMinutesPerDay: 90, autoMinutesPerDay: 20, workdays: 21, tools: [{ name: '', annualUsd: 0 }, { name: '', annualUsd: 0 }] },
  kpiBaseline: { bulletinMinutes: 90, missedEvents: null, falsePositiveRate: null, auditEvidenceHours: 16 },
};
const ROLES = {
  'Admin': { approve: true, write: true, admin: true, billing: true, users: true, read: true },
  'Uyum Yöneticisi': { approve: true, write: true, admin: false, billing: false, users: false, read: true },
  'Analist': { approve: false, write: true, admin: false, billing: false, users: false, read: true },
  'Platform': { approve: false, write: false, admin: false, billing: false, users: false, read: true, platform: true },
  'Okuyucu': { approve: false, write: false, admin: false, billing: false, users: false, read: true, affiliateOnly: true },
};
const org = () => { const c = als.getStore(); if (!c) throw new Error('Kiracı bağlamı yok'); return c.orgId; };
const odir = () => path.join(STATE, 'orgs', org());
const of = n => path.join(odir(), n);
const merge = (d, s) => { const o = { ...d, ...s }; for (const k of Object.keys(d)) if (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) o[k] = { ...d[k], ...(s?.[k] || {}) }; return o; };

const store = {
  ROLES, als,
  runAs(orgId, fn) { return als.run({ orgId }, fn); },
  orgId: org, orgDir: odir,
  orgs() { return readJSON(gfile('orgs.json'), []).filter(o => !o.platform); },
  orgsAll() { return readJSON(gfile('orgs.json'), []); },
  saveOrgs(o) { const keep = readJSON(gfile('orgs.json'), []).filter(x => x.platform && !o.some(y => y.id === x.id)); writeJSON(gfile('orgs.json'), [...o, ...keep]); },
  saveOrgsAll(o) { writeJSON(gfile('orgs.json'), o); },
  authUsers() { return readJSON(gfile('users.json'), []); },
  saveAuthUsers(u) { writeJSON(gfile('users.json'), u); },
  sessions() { return readJSON(gfile('sessions.json'), {}); }, saveSessions(s) { writeJSON(gfile('sessions.json'), s); },
  STATE,
  global(name, def) { return readJSON(gfile(name), def); }, saveGlobal(name, o) { writeJSON(gfile(name), o); },
  settings() { const s = merge(DEFAULT_SETTINGS, readJSON(of('settings.json'), {})); s.smtp.pass = sec.decStr(s.smtp.pass || ''); if (process.env.UM_SMTP_HOST) { s.smtp.host = process.env.UM_SMTP_HOST; s.smtp.user = process.env.UM_SMTP_USER || s.smtp.user; s.smtp.pass = process.env.UM_SMTP_PASS || s.smtp.pass; s.smtp.from = process.env.UM_SMTP_FROM || s.smtp.from; } return s; },
  saveSettings(s) { const o = { ...s, smtp: { ...s.smtp, pass: s.smtp.pass ? sec.encStr(sec.decStr(s.smtp.pass)) : '' } }; writeJSON(of('settings.json'), o); },
  customers() { const o = readJSON(of('customers.json'), null); if (!o) return { meta: null, rows: [] }; if (sec.isEnc(o)) { try { return JSON.parse(sec.decrypt(o)); } catch (e) { console.error('Müşteri verisi çözülemedi (anahtar uyuşmuyor?)'); return { meta: null, rows: [], error: 'decrypt' }; } } return o; },
  saveCustomers(c) { writeJSON(of('customers.json'), sec.encrypt(JSON.stringify(c))); },
  bulletins() { return readJSON(of('bulletins.json'), []); }, saveBulletins(b) { writeJSON(of('bulletins.json'), b); },
  blocklist() { return readJSON(of('blocklist.json'), []); }, saveBlocklist(b) { writeJSON(of('blocklist.json'), b); },
  tradeNotes() { return readJSON(of('trade-notes.json'), []); }, saveTradeNotes(b) { writeJSON(of('trade-notes.json'), b); },
  dd() { const d = readJSON(of('dd.json'), null); if (d) return d; const s = seed('dd-seed.json'); writeJSON(of('dd.json'), s); return s; }, saveDD(d) { writeJSON(of('dd.json'), d); },
  tasks() { return readJSON(of('tasks.json'), []); }, saveTasks(t) { writeJSON(of('tasks.json'), t); },
  watchlists() { return readJSON(of('watchlists.json'), []); }, saveWatchlists(w) { writeJSON(of('watchlists.json'), w); },
  notifs() { return readJSON(of('notifs.json'), []); }, saveNotifs(n) { writeJSON(of('notifs.json'), n); },
  apiKeys() { return readJSON(of('apikeys.json'), []); }, saveApiKeys(k) { writeJSON(of('apikeys.json'), k); },
  webhooks() { return readJSON(of('webhooks.json'), { hooks: [], deliveries: [] }); }, saveWebhooks(w) { writeJSON(of('webhooks.json'), w); },
  billing() { return readJSON(of('billing.json'), null); }, saveBilling(b) { writeJSON(of('billing.json'), b); },
  usage() { return readJSON(of('usage.json'), {}); }, saveUsage(u) { writeJSON(of('usage.json'), u); },
  outboxDir() { const d = of('outbox'); fs.mkdirSync(d, { recursive: true }); return d; },
  matchRun() { return readJSON(of('match-run.json'), null); }, saveMatchRun(r) { writeJSON(of('match-run.json'), r); },
  scan(date) { return readJSON(path.join(STATE, 'scans', date + '.json'), null); },
  saveScan(date, s) { writeJSON(path.join(STATE, 'scans', date + '.json'), s); },
  scanDates() { try { return fs.readdirSync(path.join(STATE, 'scans')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort().reverse(); } catch { return []; } },
  cacheFile(n) { return path.join(CACHE, n); },
  readCache(n, def = null) { return readJSON(path.join(CACHE, n), def); }, writeCache(n, o) { writeJSON(path.join(CACHE, n), o); },
  snapshotDir() { return path.join(STATE, 'snapshots'); },
  audit(limit) { const a = readJSON(of('audit.json'), []); return limit ? a.slice(-limit).reverse() : a; },
  logAudit(user, action, target, detail) {
    const a = readJSON(of('audit.json'), []); const prev = a.length ? a[a.length - 1].hash : 'GENESIS';
    const e = { n: a.length + 1, ts: new Date().toISOString(), user: user?.name || 'sistem', role: user?.role || '-', action, target: target || '', detail: detail || '' };
    e.hash = sha256(prev + JSON.stringify([e.n, e.ts, e.user, e.role, e.action, e.target, e.detail])).slice(0, 24);
    a.push(e); writeJSON(of('audit.json'), a); return e;
  },
  verifyAudit() { const a = readJSON(of('audit.json'), []); let prev = 'GENESIS'; for (const e of a) { const h = sha256(prev + JSON.stringify([e.n, e.ts, e.user, e.role, e.action, e.target, e.detail])).slice(0, 24); if (h !== e.hash) return { ok: false, brokenAt: e.n }; prev = e.hash; } return { ok: true, count: a.length }; },
};
module.exports = store;
