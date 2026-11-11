'use strict';
/* İş akışı: görevler (SLA), izleme listeleri, bildirim kuralları, günlük rapor, analitik, webhook. */
const crypto = require('crypto');
const store = require('./store'); const U = require('./util'); const M = require('./match'); const scan = require('./scan');
const auth = require('./auth'); const bus = require('./bus'); const mailer = require('./mailer'); const billing = require('./billing');
const P = require('./platform'); const I = require('./i18n');

/* ───────── Görevler ───────── */
const PRIO = ['critical', 'high', 'normal'];
function slaHours(prio) { const s = store.settings().slaHours || {}; return s[prio] || 24; }
function slaState(t) {
  if (t.status === 'closed') return { state: t.closedAt && t.dueAt && t.closedAt > t.dueAt ? 'breached_closed' : 'met', left: null };
  const left = new Date(t.dueAt) - Date.now(); const total = slaHours(t.priority) * 3600e3;
  return { state: left < 0 ? 'breached' : left < total * 0.25 ? 'due_soon' : 'ok', left };
}
function createTask(user, p) {
  const tasks = store.tasks(); const prio = PRIO.includes(p.priority) ? p.priority : 'normal';
  const t = { id: 'T' + U.uid().slice(0, 6), no: 'G-' + String(tasks.length + 1).padStart(4, '0'), title: String(p.title || '').slice(0, 200), kind: p.kind || 'manual', ref: p.ref || null, status: 'open', resolution: '', priority: prio,
    assignee: p.assignee || null, branchId: (store.authUsers().find(x => x.id === p.assignee) || user || {}).branchId || null, createdBy: user?.id || 'system', createdByName: user?.name || 'Sistem', createdAt: new Date().toISOString(), dueAt: new Date(Date.now() + slaHours(prio) * 3600e3).toISOString(), closedAt: null, comments: [], demo: !!p.demo, detail: String(p.detail || '').slice(0, 1000) };
  tasks.push(t); store.saveTasks(tasks); billing.meter('tasks', 1);
  if (t.assignee) notify(t.assignee, 'task_assigned', { title: t.no + ' · ' + t.title, body: user ? `${user.name}` : 'Sistem', link: '#/gorevler', refId: t.id });
  bus.emit('tasks', { id: t.id }, { orgId: store.orgId() }); return t;
}
function updateTask(user, id, p) {
  const tasks = store.tasks(); const t = tasks.find(x => x.id === id); if (!t) return null;
  const prevAssignee = t.assignee;
  if (p.status && ['open', 'review', 'closed'].includes(p.status)) { t.status = p.status; if (p.status === 'closed') { t.closedAt = new Date().toISOString(); t.resolution = p.resolution || t.resolution || 'done'; } else { t.closedAt = null; } }
  if ('assignee' in p) t.assignee = p.assignee || null;
  if (p.priority && PRIO.includes(p.priority)) { t.priority = p.priority; t.dueAt = new Date(new Date(t.createdAt).getTime() + slaHours(p.priority) * 3600e3).toISOString(); }
  if (p.comment) t.comments.push({ id: U.uid().slice(0, 5), by: user.id, byName: user.name, at: new Date().toISOString(), text: String(p.comment).slice(0, 1000) });
  store.saveTasks(tasks);
  if (t.assignee && t.assignee !== prevAssignee) notify(t.assignee, 'task_assigned', { title: t.no + ' · ' + t.title, body: user.name, link: '#/gorevler', refId: t.id });
  bus.emit('tasks', { id: t.id }, { orgId: store.orgId() }); return t;
}
function subtree(orgId, rootId) { const o = store.orgsAll().find(x => x.id === orgId); const bs = o?.branches || []; const out = new Set([rootId]); let ch = true; while (ch) { ch = false; for (const b of bs) if (out.has(b.parent) && !out.has(b.id)) { out.add(b.id); ch = true; } } return out; }
/* Şube düzeyi kullanıcılar yalnızca kendi birimleri (ve altı) + kendilerine atanan görevleri görür */
function scopeTasks(user) {
  const all = store.tasks(); if (['Admin', 'Uyum Yöneticisi'].includes(user.role) || !user.branchId) return all;
  const o = store.orgsAll().find(x => x.id === user.orgId); const b = (o?.branches || []).find(x => x.id === user.branchId); if (!b || b.type === 'hq') return all;
  const set = subtree(user.orgId, user.branchId); return all.filter(t => t.assignee === user.id || set.has(t.branchId));
}
const withSla = t => ({ ...t, sla: slaState(t) });
function checkSla() {
  const tasks = store.tasks(); let ch = false;
  for (const t of tasks) if (t.status !== 'closed' && !t.breachNotified && new Date(t.dueAt) < Date.now()) {
    t.breachNotified = true; ch = true;
    const targets = new Set([t.assignee, ...auth.orgUsers(store.orgId()).filter(u => ['Uyum Yöneticisi'].includes(u.role)).map(u => u.id)].filter(Boolean));
    for (const uid of targets) notify(uid, 'sla_breach', { title: `SLA: ${t.no} · ${t.title}`, body: '', link: '#/gorevler', refId: t.id });
  }
  if (ch) store.saveTasks(tasks);
}

/* ───────── İzleme listeleri ───────── */
const WL_TYPES = ['name', 'imo', 'hs', 'country'];
function listWatch(userId) { return store.watchlists().filter(w => w.userId === userId); }
function addWatch(user, p) {
  if (!WL_TYPES.includes(p.type)) throw new Error('type'); let v = String(p.value || '').trim().slice(0, 120); if (!v) throw new Error('value');
  if (p.type === 'imo') v = v.replace(/\D/g, '').slice(0, 7); if (p.type === 'hs') v = v.replace(/[^\d]/g, '').slice(0, 12);
  const all = store.watchlists(); if (all.some(w => w.userId === user.id && w.type === p.type && w.value.toLowerCase() === v.toLowerCase())) throw new Error('dup');
  const w = { id: 'W' + U.uid().slice(0, 5), userId: user.id, type: p.type, value: v, note: String(p.note || '').slice(0, 200), createdAt: new Date().toISOString() };
  all.push(w); store.saveWatchlists(all); return w;
}
function delWatch(user, id) { const all = store.watchlists().filter(w => !(w.id === id && w.userId === user.id)); store.saveWatchlists(all); }
function itemText(it) { return M.fold([it.title, typeof it.summary === 'object' ? it.summary.en : it.summary, ...(it.entities || []).map(e => [e.name, e.program, ...(e.aliases || []), e.raw || ''].join(' '))].join(' ')); }
function watchMatches(it, wl) {
  const out = []; const txt = itemText(it);
  for (const w of wl) {
    if (w.type === 'imo') { if ((it.entities || []).some(e => (e.imo || []).includes(w.value)) || txt.includes('imo ' + w.value)) out.push({ w, how: 'IMO' }); }
    else if (w.type === 'name') {
      const tk = M.tokens(w.value); if (!tk.length) continue; let best = 0;
      for (const e of it.entities || []) for (const n of [e.name, ...(e.aliases || [])]) { const r = M.scoreTokens(tk, M.tokens(n)); if (r.score > best) best = r.score; }
      if (best >= 88) out.push({ w, how: 'name', score: best });
    }
    else if (w.type === 'country') { const c = require('./trade').findCountry(w.value); const names = c ? [M.fold(c.en), M.fold(c.tr)] : [M.fold(w.value)]; if (names.some(n => n.length > 2 && new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(txt))) out.push({ w, how: 'country' }); }
    else if (w.type === 'hs') { if (it.srcKey === 'eu' && /833\/2014|annex|restrictive measures/i.test(it.title)) out.push({ w, how: 'hs-annex' }); }
  }
  return out;
}

/* ───────── Bildirimler ───────── */
const KIND_ROLES = { customer_match: ['Admin', 'Uyum Yöneticisi', 'Analist'], sla_breach: null };
function notify(userId, kind, { title, body, link, refId, itemId }) {
  const user = store.authUsers().find(u => u.id === userId); if (!user || !user.active) return null;
  const rule = (user.prefs?.rules || {})[kind] || { inapp: true, email: false };
  const orgId = store.orgId(); let rec = null;
  if (rule.inapp) {
    const list = store.notifs(); const dedupe = refId || itemId;
    if (dedupe && list.some(n => n.userId === userId && n.kind === kind && n.refId === dedupe)) return null;
    rec = { id: 'n' + U.uid(), userId, kind, title, body: body || '', link: link || '', refId: dedupe || '', ts: new Date().toISOString(), read: false };
    list.unshift(rec); store.saveNotifs(list.slice(0, 1000)); bus.emit('notify', rec, { orgId, userId });
  }
  if (rule.email) emailNotification(user, kind, title, body, link).catch(() => { });
  return rec;
}
async function emailNotification(user, kind, title, body, link) {
  const lang = user.prefs?.lang || 'tr'; const org = store.orgsAll().find(o => o.id === store.orgId());
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#0B1F3A"><div style="background:#0B1F3A;color:#C6A15B;padding:14px 20px;border-radius:10px 10px 0 0;font-weight:600">${U.esc(org?.name || '')} · ${U.esc(require('./brand').name(lang))}</div><div style="border:1px solid #e4dfd1;border-top:0;padding:20px;border-radius:0 0 10px 10px"><p style="font-size:12px;color:#66758b;margin:0 0 6px">${U.esc(kind)}</p><h3 style="margin:0 0 8px">${U.esc(title)}</h3><p>${U.esc(body || '')}</p></div><p style="font-size:11px;color:#8a97a8">${lang === 'tr' ? 'Bu e-posta bildirim kurallarınıza göre gönderildi (Ayarlarım).' : 'Sent according to your notification rules (My settings).'}</p></div>`;
  await mailer.send({ to: user.email, subject: `[${lang === 'tr' ? 'Uyum' : 'Compliance'}] ${title}`.slice(0, 150), html, text: title + '\n' + (body || ''), kind });
}
function userNotifs(userId) { return store.notifs().filter(n => n.userId === userId); }
function markRead(userId) { const l = store.notifs().map(n => n.userId === userId ? { ...n, read: true } : n); store.saveNotifs(l); }

function relevantFor(user, it) {
  const sub = user.prefs?.subscriptions || {}; if (sub.sources && sub.sources.length && !sub.sources.includes(it.srcKey)) return false;
  const txt = itemText(it);
  if ((sub.regimes || []).length && !sub.regimes.some(r => txt.includes(M.fold(r)))) return false;
  if ((sub.countries || []).length && !sub.countries.some(c => { const x = require('./trade').findCountry(c); return [M.fold(c), ...(x ? [M.fold(x.en), M.fold(x.tr)] : [])].some(n => n.length > 2 && txt.includes(n)); })) return false;
  return true;
}
/* Yeni öğe geldiğinde: tüm kiracılar için kuralları uygula */
function onNewItems(newItems) {
  for (const o of store.orgs()) store.runAs(o.id, () => {
    const users = auth.orgUsers(o.id).filter(u => u.active); const analysts = users.filter(u => u.role === 'Analist'); const managers = users.filter(u => ['Uyum Yöneticisi', 'Admin'].includes(u.role));
    for (const raw of newItems) {
      const it = scan.withBase(raw);
      for (const u of users) {
        if (u.role === 'Okuyucu') continue;
        const wl = listWatch(u.id); const hits = wl.length ? watchMatches(it, wl) : [];
        if (hits.length) notify(u.id, 'watchlist_hit', { title: `${it.title}`, body: hits.map(h => `${h.w.type}: ${h.w.value}`).join(' · '), link: '#/bugun', itemId: it.id });
        if (relevantFor(u, it)) {
          if (it.type === 'ADD') notify(u.id, 'new_add', { title: it.title, body: typeof it.summary === 'object' ? it.summary[u.prefs?.lang || 'tr'] : it.summary, link: '#/bugun', itemId: it.id });
          if (it.type === 'DEL' && it.vesselWarning) notify(u.id, 'vessel_delisting', { title: it.title, body: '', link: '#/bugun', itemId: it.id });
          if (it.type === 'GL') notify(u.id, 'general_licence', { title: it.title, body: '', link: '#/bugun', itemId: it.id });
        }
      }
      if (it.baseCheck?.state === 'possible') {
        const best = it.baseCheck.matches[0]; const pool = analysts.length ? analysts : managers; const assignee = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
        for (const u of users.filter(x => (KIND_ROLES.customer_match || []).includes(x.role))) notify(u.id, 'customer_match', { title: it.title, body: `${best.customerName} ↔ ${best.entity} (${best.score})`, link: '#/gorevler', itemId: it.id });
        const exists = store.tasks().some(t => t.ref && t.ref.itemId === it.id);
        if (!exists) createTask(null, { title: `${it.title} – ${best.customerName} (${best.score})`, kind: 'hit', ref: { itemId: it.id }, priority: best.score >= 95 ? 'critical' : 'high', assignee: assignee?.id, detail: `${best.entity} ↔ ${best.customerName}` });
      }
      webhookEmit('item.new', { id: it.id, source: it.source, type: it.type, date: it.date, title: it.title, url: it.url, baseCheck: it.baseCheck?.state || null });
    }
  });
}
scan.hooks.onNewItems = onNewItems;

/* ───────── Webhook ───────── */
const EVENTS = ['item.new', 'match.hit', 'bulletin.approved', 'task.closed'];
function validHookUrl(u) { return !require('./netguard').urlProblem(u) && String(u).length <= 500; }
function webhookEmit(event, payload) {
  const w = store.webhooks(); for (const h of w.hooks.filter(x => x.active && (x.events || []).includes(event))) deliver(store.orgId(), h, event, payload).catch(() => { });
}
async function deliver(orgId, hook, event, payload) {
  const body = JSON.stringify({ event, at: new Date().toISOString(), org: orgId, data: payload });
  const sig = crypto.createHmac('sha256', hook.secret).update(body).digest('hex'); let status = 0, err = null; const t0 = Date.now();
  try { const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 8000); const r = await require('./netguard').safeFetch(hook.url, { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-UM-Event': event, 'X-UM-Signature': 'sha256=' + sig, 'User-Agent': 'UyumMerkezi-Webhook/1' }, signal: ctrl.signal }); clearTimeout(to); status = r.status; } catch (e) { err = e.code === 'ssrf' ? 'blocked' : 'delivery_failed'; }
  store.runAs(orgId, () => { const w = store.webhooks(); w.deliveries.unshift({ id: U.uid(), hook: hook.id, event, at: new Date().toISOString(), status, error: err, ms: Date.now() - t0 }); w.deliveries = w.deliveries.slice(0, 60); store.saveWebhooks(w); billing.meter('webhooks', 1); });
  return { status, error: err };
}

/* ───────── “Bugün senin için” + günlük rapor ───────── */
function todayFor(user) {
  const items = scan.items(); const w = scan.orgWindow();
  const mine = items.filter(i => user.role !== 'Okuyucu' && relevantFor(user, i));
  const wl = listWatch(user.id); const watchHits = [];
  for (const it of items) { const m = wl.length ? watchMatches(it, wl) : []; if (m.length) watchHits.push({ item: it, matches: m.map(x => ({ id: x.w.id, type: x.w.type, value: x.w.value, how: x.how, score: x.score })) }); }
  const tasks = store.tasks().filter(t => t.assignee === user.id && t.status !== 'closed').map(withSla);
  const mgr = ['Admin', 'Uyum Yöneticisi'].includes(user.role);
  const bulls = store.bulletins(); const pending = mgr ? bulls.filter(b => b.status === 'review') : [];
  const todayB = bulls.find(b => b.date === w.end);
  const counts = {}; for (const i of mine) counts[i.type] = (counts[i.type] || 0) + 1;
  const todo = [];
  for (const t of tasks.filter(x => x.sla.state === 'breached')) todo.push({ k: 'sla', id: t.id, title: t.no + ' · ' + t.title });
  for (const b of pending) todo.push({ k: 'approve', id: b.id, title: b.date });
  if (user.role !== 'Okuyucu' && (!todayB || todayB.status === 'draft')) todo.push({ k: 'bulletin', title: w.end });
  for (const h of watchHits.slice(0, 3)) todo.push({ k: 'watch', title: h.item.title });
  return { counts, total: mine.length, items: mine.slice(0, 12), watchHits, tasks, pending: pending.map(b => ({ id: b.id, date: b.date, by: b.submittedBy })), todayBulletin: todayB ? { id: todayB.id, status: todayB.status } : null, todo, unread: userNotifs(user.id).filter(n => !n.read).length, window: w };
}
function buildReport(user, lang) {
  lang = lang || user.prefs?.dailyReport?.lang || 'tr'; const tr = lang === 'tr'; const T = I.dict(lang); const org = store.orgsAll().find(o => o.id === store.orgId());
  const d = todayFor(user); const date = U.todayISO(P.tz);
  const byType = Object.entries(d.counts).map(([k, v]) => `${v} ${T.types[k]}`).join(', ') || (tr ? 'yeni gelişme yok' : 'no new developments');
  const adds = d.items.filter(i => i.type === 'ADD'); const addEnts = adds.reduce((a, i) => a + (i.entities || []).length, 0);
  const possible = d.items.filter(i => i.baseCheck?.state === 'possible');
  const bySrc = {}; for (const i of d.items) bySrc[i.srcKey] = (bySrc[i.srcKey] || 0) + 1;
  const top = Object.entries(bySrc).sort((a, b) => b[1] - a[1])[0];
  const analysis = tr
    ? `Son ${d.window.days} günde aboneliklerinize göre ${d.total} gelişme tespit edildi (${byType}). ${addEnts ? `Toplam ${addEnts} yeni listeleme kaydı var; ${possible.length ? `${possible.length} olası müşteri eşleşmesi analist incelemesi bekliyor.` : 'müşteri tabanında olası eşleşme bulunmadı.'}` : 'Yeni listeleme kaydı yok.'} ${top ? `En yoğun kaynak: ${T.srcNames[top[0]]} (${top[1]}).` : ''} ${d.watchHits.length ? `İzleme listenizde ${d.watchHits.length} isabet var.` : ''} ${d.tasks.filter(t => t.sla.state === 'breached').length ? 'SLA süresi aşılmış görevleriniz var.' : ''}`
    : `Over the last ${d.window.days} days ${d.total} developments matched your subscriptions (${byType}). ${addEnts ? `There are ${addEnts} new designation records; ${possible.length ? `${possible.length} possible customer match(es) await analyst review.` : 'no possible customer match was found.'}` : 'No new designations.'} ${top ? `Busiest source: ${T.srcNames[top[0]]} (${top[1]}).` : ''} ${d.watchHits.length ? `${d.watchHits.length} hit(s) on your watchlist.` : ''} ${d.tasks.filter(t => t.sla.state === 'breached').length ? 'You have tasks past their SLA.' : ''}`;
  const rows = d.items.slice(0, 10).map(i => `<tr><td style="padding:6px 8px;border-bottom:1px solid #e4dfd1;font-size:12px;white-space:nowrap">${U.esc(T.srcNames[i.srcKey])}</td><td style="padding:6px 8px;border-bottom:1px solid #e4dfd1;font-size:12px"><b>${U.esc(T.types[i.type])}</b> · ${U.esc(i.title)}${i.baseCheck?.state === 'possible' ? ' <span style="color:#b23b34">⚑</span>' : ''}<br><a href="${U.esc(i.url)}" style="color:#2c5d93">${U.esc(i.url).slice(0, 70)}</a></td></tr>`).join('');
  const taskRows = d.tasks.slice(0, 6).map(t => `<li style="font-size:13px">${U.esc(t.no)} · ${U.esc(t.title)} <i style="color:${t.sla.state === 'breached' ? '#b23b34' : '#66758b'}">(${t.sla.state})</i></li>`).join('');
  const html = `<div style="background:#f5f3ed;padding:24px;font-family:Segoe UI,Arial,sans-serif;color:#0B1F3A"><div style="max-width:680px;margin:auto"><div style="background:#0B1F3A;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0"><div style="color:#C6A15B;font-size:11px;letter-spacing:.14em;text-transform:uppercase">${U.esc(require('./brand').name(lang))} · ${U.esc(org?.name || '')}</div><h2 style="margin:4px 0 0;font-family:Georgia,serif">${tr ? 'Günlük Analiz Raporu' : 'Daily Analysis Report'}</h2><div style="color:#aebcd3;font-size:13px">${U.esc(user.name)} · ${date}</div></div>
  <div style="background:#fff;padding:22px 24px;border:1px solid #e4dfd1;border-top:0;border-radius:0 0 12px 12px"><p style="line-height:1.6">${U.esc(analysis)}</p>
  <table style="width:100%;border-collapse:collapse;margin:14px 0"><tr>${[['ADD'], ['UPD'], ['DEL'], ['GL'], ['ENF']].map(([k]) => `<td style="text-align:center;padding:10px;background:#f5f3ed;border-radius:8px"><div style="font-size:22px;font-weight:700;font-family:Georgia,serif">${d.counts[k] || 0}</div><div style="font-size:11px;color:#66758b">${U.esc(T.types[k])}</div></td>`).join('<td width="6"></td>')}</tr></table>
  ${rows ? `<h4 style="margin:18px 0 6px">${tr ? 'Öne çıkan gelişmeler' : 'Key developments'}</h4><table style="width:100%;border-collapse:collapse">${rows}</table>` : ''}
  ${d.watchHits.length ? `<h4 style="margin:18px 0 6px">${tr ? 'İzleme listesi isabetleri' : 'Watchlist hits'}</h4><ul>${d.watchHits.slice(0, 5).map(h => `<li style="font-size:13px">${U.esc(h.item.title)} — ${U.esc(h.matches.map(m => m.value).join(', '))}</li>`).join('')}</ul>` : ''}
  ${taskRows ? `<h4 style="margin:18px 0 6px">${tr ? 'Görevleriniz' : 'Your tasks'}</h4><ul>${taskRows}</ul>` : ''}
  <p style="font-size:11px;color:#8a97a8;margin-top:22px">${tr ? 'Bu rapor otomatik hazırlanır; nihai karar analisttedir. Resmî kaynak bağlantıları her kayıtta yer alır. Saat/dil: Ayarlarım.' : 'This report is generated automatically; the final decision rests with the analyst. Official source links accompany every record. Time/language: My settings.'}</p></div></div></div>`;
  const text = `${tr ? 'Günlük Analiz Raporu' : 'Daily Analysis Report'} – ${date}\n\n${analysis}\n\n` + d.items.slice(0, 10).map(i => `- [${T.types[i.type]}] ${i.title}\n  ${i.url}`).join('\n');
  return { subject: `${tr ? 'Günlük Analiz Raporu' : 'Daily Analysis Report'} – ${date}`, html, text, summary: { total: d.total, counts: d.counts, possible: possible.length, watch: d.watchHits.length, tasks: d.tasks.length } };
}
async function sendDaily(user, force) {
  const dr = user.prefs?.dailyReport || {}; const r = buildReport(user);
  try {
    const lang = user.prefs?.dailyReport?.lang || 'tr'; const blk = await require('./ai').dailyBlock(todayFor(user).items, lang);
    if (blk) {
      const li = blk.text.split('\n').filter(Boolean).map(l => `<li style="font-size:13px;line-height:1.5">${U.esc(l.replace(/^\s*[-*•]\s*/, ''))}</li>`).join(''); const srcs = blk.sources.map(x => `${U.esc('[' + x.id + ']')} ${x.url ? `<a href="${U.esc(x.url)}">${U.esc((x.title || '').slice(0, 80))}</a>` : U.esc(x.title || '')}`).join('<br>');
      const html = `<div style="border-left:3px solid #5b6f8f;background:#f5f3ed;padding:8px 14px;margin:14px 0"><div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#66758b">${U.esc(blk.label)}</div><ul style="margin:6px 0">${li}</ul><div style="font-size:11px;color:#66758b">${srcs}</div></div>`;
      r.html = r.html.replace('</p>', '</p>' + html); r.text += `\n\n${blk.label}\n${blk.text}\n` + blk.sources.map(x => `[${x.id}] ${x.title} ${x.url || ''}`).join('\n');
    }
  } catch (e) { console.error('ai daily', e.message); }
  const rec = await mailer.send({ to: user.email, subject: r.subject, html: r.html, text: r.text, kind: 'daily_report' }); billing.meter('reports', 1); return rec;
}
function dailyTick() {
  const now = new Intl.DateTimeFormat('en-GB', { timeZone: P.tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); const today = U.todayISO(P.tz);
  const wd = new Date(today + 'T12:00:00Z').getUTCDay();
  for (const o of store.orgs()) store.runAs(o.id, () => {
    const users = store.authUsers(); let ch = false;
    for (const u of users.filter(x => x.orgId === o.id && x.active)) {
      const dr = u.prefs?.dailyReport; if (!dr || !dr.enabled || !dr.email || dr.lastSent === today || (wd === 0 || wd === 6)) continue;
      if (now >= dr.time) { dr.lastSent = today; ch = true; sendDaily(u).catch(e => console.error('report', e.message)); }
    }
    if (ch) store.saveAuthUsers(store.authUsers().map(x => users.find(y => y.id === x.id) || x));
    checkSla();
  });
}

/* ───────── Analitik ───────── */
function analytics() {
  const L = require('./lists'); const mon = []; const now = new Date();
  for (let i = 11; i >= 0; i--) mon.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  const tot = new Map(); const per = new Map();
  for (const s of ['uk', 'eu', 'un']) { const l = L.load(s); if (!l) continue; for (const e of l.entries) { if (!e.d) continue; const m = e.d.slice(0, 7); if (!mon.includes(m)) continue; const prog = (s === 'un' ? 'UN ' : s === 'eu' ? 'EU ' : 'UK ') + (e.c || '–'); tot.set(prog, (tot.get(prog) || 0) + 1); if (!per.has(prog)) per.set(prog, {}); per.get(prog)[m] = (per.get(prog)[m] || 0) + 1; } }
  const top = [...tot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(x => x[0]);
  const series = top.map(n => ({ name: n, total: tot.get(n), data: mon.map(m => per.get(n)[m] || 0) }));
  const tasks = store.tasks(); const users = auth.orgUsers(store.orgId());
  const workload = users.filter(u => u.role !== 'Okuyucu').map(u => ({ user: u.name, open: tasks.filter(t => t.assignee === u.id && t.status !== 'closed').length, closed: tasks.filter(t => t.assignee === u.id && t.status === 'closed').length }));
  const closed = tasks.filter(t => t.status === 'closed' && t.closedAt);
  const hrs = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : null;
  const ttc = {}; for (const p of PRIO) ttc[p] = hrs(closed.filter(t => t.priority === p).map(t => (new Date(t.closedAt) - new Date(t.createdAt)) / 3600e3));
  const hits = closed.filter(t => t.kind === 'hit' || t.resolution === 'true_match' || t.resolution === 'false_positive');
  const fp = hits.filter(t => t.resolution === 'false_positive').length; const tm = hits.filter(t => t.resolution === 'true_match').length;
  const bulls = store.bulletins().filter(b => b.status === 'approved' && b.approvals.length);
  const prep = bulls.map(b => (new Date(b.approvals[b.approvals.length - 1].at) - new Date(b.createdAt)) / 60000).filter(x => x > 0 && x < 60 * 24 * 3);
  const o = store.orgsAll().find(x => x.id === store.orgId()); const byBranch = (o?.branches || []).map(b => { const set = subtree(o.id, b.id); const ts = tasks.filter(t => set.has(t.branchId)); const cl = ts.filter(t => t.status === 'closed' && t.closedAt); return { id: b.id, name: b.name, type: b.type, parent: b.parent, open: ts.filter(t => t.status !== 'closed').length, closed: cl.length, breached: ts.filter(t => slaState(t).state.startsWith('breached')).length, avgHours: hrs(cl.map(t => (new Date(t.closedAt) - new Date(t.createdAt)) / 3600e3)), users: users.filter(x => set.has(x.branchId)).length }; });
  const base = store.settings().kpiBaseline; const run = store.matchRun();
  const breached = tasks.filter(t => slaState(t).state.startsWith('breached')).length;
  return { months: mon, series, regimeNote: 'UK/UN/AB listelerindeki “listeleme tarihi” alanlarından (OFAC SDN dosyası tarih içermediği için dahil değil)', workload, timeToClose: ttc,
    hitRate: { screened: run?.screened ?? null, possible: run?.hitCount ?? null, closed: hits.length, falsePositive: fp, trueMatch: tm, fpRate: hits.length ? Math.round(fp / hits.length * 100) : null },
    kpi: { bulletinMinutes: { baseline: base.bulletinMinutes, current: prep.length ? Math.round(prep.reduce((a, b) => a + b, 0) / prep.length) : null, n: prep.length }, missedEvents: { baseline: base.missedEvents, current: null }, falsePositive: { baseline: base.falsePositiveRate, current: hits.length ? Math.round(fp / hits.length * 100) : null, n: hits.length }, auditHours: { baseline: base.auditEvidenceHours, current: null } },
    byBranch, sla: { total: tasks.length, breached, open: tasks.filter(t => t.status !== 'closed').length } };
}

/* ───────── Çalışma süresi (durum sayfası) ───────── */
function recordUptime(jobId, ok) { const u = store.readCache('uptime.json', {}); (u[jobId] = u[jobId] || []).push([Date.now(), ok ? 1 : 0]); if (u[jobId].length > 800) u[jobId] = u[jobId].slice(-800); store.writeCache('uptime.json', u); }
function uptime(jobId, hours) { const u = (store.readCache('uptime.json', {})[jobId] || []).filter(x => x[0] > Date.now() - hours * 3600e3); return u.length ? Math.round(u.reduce((a, x) => a + x[1], 0) / u.length * 1000) / 10 : null; }

/* ───────── Saklama (retention) ───────── */
function retention() {
  const r = store.settings().retention; const cut = d => Date.now() - d * 86400e3;
  const n = store.notifs().filter(x => new Date(x.ts) > cut(r.notificationsDays)); store.saveNotifs(n);
  const fs = require('fs'), path = require('path'); const dir = store.outboxDir();
  try { for (const f of fs.readdirSync(dir)) if (f !== 'index.json' && fs.statSync(path.join(dir, f)).mtimeMs < cut(r.outboxDays)) fs.unlinkSync(path.join(dir, f)); } catch { }
}
module.exports = { scopeTasks, createTask, updateTask, withSla, slaState, listWatch, addWatch, delWatch, watchMatches, notify, userNotifs, markRead, todayFor, buildReport, sendDaily, dailyTick, analytics, recordUptime, uptime, deliver, webhookEmit, validHookUrl, EVENTS, retention, checkSla, relevantFor };
