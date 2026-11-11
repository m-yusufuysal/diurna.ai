'use strict';
/* Platform sahibi (Diurna işletmecisi) katmanı: kurum + kullanıcı açma (kullanıcı adı + geçici parola), kullanıcı (koltuk) sınırı, elle askıya alma.
 * Faturalama/PDF fatura/hatırlatma/gecikme askısı kodu KAPSAM DIŞI olduğu için varsayılan KAPALI tutulur (yalnızca UM_BILLING=1 ile arka uçta açılır; arayüzü yoktur). Kart ödemesi hiçbir zaman yoktur. */
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const store = require('./store'); const U = require('./util');
const PID = '_platform';
const DEFAULTS = () => ({
  seller: { name: 'Diurna Yazılım A.Ş. (ÖRNEK – düzenleyin)', address: 'Örnek Mah. Örnek Sk. No:1, İstanbul', taxOffice: 'Örnek V.D.', taxNo: '0000000000', email: 'fatura@diurna.example', phone: '' },
  bank: { bankName: 'Örnek Banka (ÖRNEK – düzenleyin)', accountHolder: 'Diurna Yazılım A.Ş.', iban: 'TR00 0000 0000 0000 0000 0000 00', swift: 'ORNKTRIS', branch: '' },
  invoicePrefix: 'DRN', vatRate: 20, currency: 'TRY', defaultTermDays: 15, reminderDays: [7, 3, 1], graceDays: 14,
});
const pdata = () => { const d = DEFAULTS(), s = store.global('platform.json', {}); return { ...d, ...s, seller: { ...d.seller, ...(s.seller || {}) }, bank: { ...d.bank, ...(s.bank || {}) } }; };
const savePdata = o => store.saveGlobal('platform.json', o);
const invoices = () => store.global('invoices.json', []); const saveInvoices = l => store.saveGlobal('invoices.json', l);
function paudit(user, action, target, detail) { const a = store.global('platform-audit.json', []); a.unshift({ ts: new Date().toISOString(), user: user?.name || 'sistem', action, target: target || '', detail: detail || '' }); store.saveGlobal('platform-audit.json', a.slice(0, 2000)); }
const tempPassword = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ', a = 'abcdefghijkmnopqrstuvwxyz', d = '23456789', sy = '#%+=?'; const pick = s => s[crypto.randomInt(s.length)]; const parts = [pick(A), pick(A), pick(a), pick(a), pick(a), pick(a), pick(a), pick(d), pick(d), pick(d), pick(sy), pick(a), pick(A), pick(d)]; for (let i = parts.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1);[parts[i], parts[j]] = [parts[j], parts[i]]; } return parts.join(''); };
const slug = s => String(s).toLowerCase().replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const todayISO = () => U.todayISO('Europe/Istanbul');
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

/* ── Platform yöneticisi tohumu ── */
async function ensurePlatformAdmin() {
  const auth = require('./auth'); const all = store.orgsAll();
  if (!all.some(o => o.id === PID)) { all.push({ id: PID, name: 'Diurna Platform', platform: true, plan: 'enterprise', seats: 5, createdAt: new Date().toISOString() }); store.saveOrgsAll(all); }
  if (store.authUsers().some(u => u.role === 'Platform')) return null;
  const pw = process.env.UM_PLATFORM_PASSWORD || tempPassword(); const email = (process.env.UM_PLATFORM_EMAIL || 'platform@diurna.local').toLowerCase();
  const u = await auth.createUser(PID, { email, username: 'platform', name: 'Platform Yöneticisi', role: 'Platform', password: pw, mustChangePassword: true, mfaRequired: true });
  const f = path.join(store.STATE, 'platform-admin.txt');
  try { fs.writeFileSync(f, `Platform yöneticisi — ilk girişte parola değişimi ve MFA kurulumu zorunludur\nkullanıcı adı: platform\ne-posta: ${email}\ngeçici parola: ${pw}\n`, { mode: 0o600 }); } catch { }
  console.log(`\n  Platform yöneticisi oluşturuldu: kullanıcı adı "platform"; geçici parola ${process.env.UM_PLATFORM_PASSWORD ? '(UM_PLATFORM_PASSWORD)' : 'data/state/platform-admin.txt dosyasında'}. İlk girişte parola değişimi + MFA zorunlu.\n`);
  return u;
}

/* ── Kurumlar ── */
const activeUsers = orgId => store.authUsers().filter(u => u.orgId === orgId && u.active);
function orgView(o) {
  return { id: o.id, name: o.name, seats: o.seats, used: activeUsers(o.id).length, demo: !!o.demo, createdAt: o.createdAt, suspended: o.suspended || null, users: store.authUsers().filter(u => u.orgId === o.id).length };
}
const listOrgs = () => store.orgs().map(orgView);
const CONTRACT_FIELDS = ['legalName', 'address', 'taxOffice', 'taxNo', 'billingEmail', 'currency', 'start', 'end', 'termDays', 'note'];
function applyContract(o, b) {
  o.contract = o.contract || {};
  for (const k of CONTRACT_FIELDS) if (k in b) o.contract[k] = String(b[k] ?? '').slice(0, 300);
  if ('pricePerSeat' in b) o.contract.pricePerSeat = Math.max(0, +b.pricePerSeat || 0);
  if ('billingMonths' in b) o.contract.billingMonths = Math.min(36, Math.max(1, +b.billingMonths || 1));
  if (b.plan && require('./billing').PLANS[b.plan]) o.plan = b.plan;
  if ('seats' in b) { const n = Math.min(5000, Math.max(1, +b.seats || 1)); const used = activeUsers(o.id).length; if (n < used) throw Object.assign(new Error(`Koltuk sayısı aktif kullanıcıdan (${used}) az olamaz`), { code: 'seats' }); o.seats = n; }
}
async function createOrg(b, by) {
  const auth = require('./auth'); const name = String(b.name || '').trim().slice(0, 100); if (name.length < 3) throw Object.assign(new Error('Kurum adı gerekli'), { code: 'bad' });
  const all = store.orgsAll(); let id = slug(b.id || name) || 'kurum'; while (all.some(o => o.id === id)) id += '-' + crypto.randomInt(10, 99);
  const a = b.admin || {}; if (!a.name || !/^\S+@\S+\.\S+$/.test(a.email || '')) throw Object.assign(new Error('İlk yönetici için ad ve e-posta gerekli'), { code: 'bad' });
  const o = { id, name, plan: 'professional', seats: 10, createdAt: new Date().toISOString(), country: String(b.country || 'TR').slice(0, 2).toUpperCase(), branches: [{ id: 'hq', name: 'Genel Müdürlük', type: 'hq', parent: null }], contract: {} };
  applyContract(o, { seats: b.seats ?? 10 });
  all.push(o); store.saveOrgsAll(all);
  store.runAs(id, () => store.saveSettings({ ...store.settings(), institution: name }));
  const tp = tempPassword(); let user;
  try { user = await auth.createUser(id, { email: a.email, username: a.username, name: String(a.name).slice(0, 60), role: 'Admin', password: tp, mustChangePassword: true, mfaRequired: true }); }
  catch (e) { store.saveOrgsAll(store.orgsAll().filter(x => x.id !== id)); throw e; }
  paudit(by, 'org.create', id, `${name}; ${o.seats} koltuk; yönetici ${user.username}`); return { org: orgView(o), admin: auth.pub(user), tempPassword: tp };
}
function updateOrg(id, b, by) { const all = store.orgsAll(); const o = all.find(x => x.id === id && !x.platform); if (!o) throw Object.assign(new Error('Kurum bulunamadı'), { code: 'nf' }); if (b.name) o.name = String(b.name).slice(0, 100); applyContract(o, b); store.saveOrgsAll(all); paudit(by, 'org.update', id, `${o.seats} koltuk, plan ${o.plan}`); return orgView(o); }
function setSuspended(id, on, reason, by) {
  const all = store.orgsAll(); const o = all.find(x => x.id === id && !x.platform); if (!o) throw Object.assign(new Error('Kurum bulunamadı'), { code: 'nf' });
  if (on) { o.suspended = { since: new Date().toISOString(), reason: reason || 'manual' }; revokeOrgSessions(id); } else delete o.suspended;
  store.saveOrgsAll(all); paudit(by, on ? 'org.suspend' : 'org.unsuspend', id, reason || ''); return orgView(o);
}
function revokeOrgSessions(orgId) { const ids = new Set(store.authUsers().filter(u => u.orgId === orgId).map(u => u.id)); const ss = store.sessions(); for (const k of Object.keys(ss)) if (ids.has(ss[k].userId)) delete ss[k]; store.saveSessions(ss); }
const orgSuspended = id => !!store.orgsAll().find(o => o.id === id)?.suspended;
async function createUserFor(orgId, b, by) {
  const auth = require('./auth'); const o = store.orgsAll().find(x => x.id === orgId && !x.platform); if (!o) throw Object.assign(new Error('Kurum bulunamadı'), { code: 'nf' });
  if (activeUsers(orgId).length >= o.seats) throw Object.assign(new Error('Sözleşmedeki koltuk sayısına ulaşıldı'), { code: 'seats' });
  if (!store.ROLES[b.role] || b.role === 'Platform') throw Object.assign(new Error('Geçersiz rol'), { code: 'bad' });
  const tp = tempPassword(); const u = await auth.createUser(orgId, { email: b.email, username: b.username, name: String(b.name).slice(0, 60), role: b.role, password: tp, mustChangePassword: true, mfaRequired: true });
  paudit(by, 'user.create', u.username, `${orgId} / ${u.role}`); return { user: auth.pub(u), tempPassword: tp };
}
async function resetUser(userId, by) {
  const auth = require('./auth'); const us = store.authUsers(); const u = us.find(x => x.id === userId && x.role !== 'Platform'); if (!u) throw Object.assign(new Error('Kullanıcı bulunamadı'), { code: 'nf' });
  const tp = tempPassword(); u.pwHash = await auth.hashPw(tp); u.mustChangePassword = true; u.mfaRequired = true; u.mfa = { enabled: false }; u.lockedUntil = 0; u.fails = 0; store.saveAuthUsers(us); auth.revokeAll(u.id);
  paudit(by, 'user.reset', u.username, u.orgId); return { tempPassword: tp, user: auth.pub(u) };
}

/* ── Faturalar ── */
const effective = inv => { if (inv.status === 'bekliyor' && inv.dueDate < todayISO()) return { ...inv, status: 'gecikti', auto: true, overdueDays: daysBetween(inv.dueDate, todayISO()) }; return { ...inv, overdueDays: inv.status === 'gecikti' ? daysBetween(inv.dueDate, todayISO()) : 0 }; };
function createInvoice(b, by) {
  const o = store.orgsAll().find(x => x.id === b.orgId && !x.platform); if (!o) throw Object.assign(new Error('Kurum bulunamadı'), { code: 'nf' });
  const P = pdata(); const c = o.contract || {}; const issueDate = /^\d{4}-\d{2}-\d{2}$/.test(b.issueDate || '') ? b.issueDate : todayISO(); const term = +b.termDays || +c.termDays || P.defaultTermDays;
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(b.dueDate || '') ? b.dueDate : U.addDays(issueDate, term); const months = Math.max(1, Math.min(36, +b.months || +c.billingMonths || 1));
  const unit = b.unitPrice != null ? +b.unitPrice : +c.pricePerSeat || 0; const seats = +b.seats || o.seats; const PL = require('./billing').PLANS[o.plan];
  const lines = Array.isArray(b.lines) && b.lines.length ? b.lines.slice(0, 20).map(l => ({ desc: String(l.desc || '').slice(0, 200), qty: +l.qty || 1, unit: +l.unit || 0 })) : [{ desc: `Diurna ${PL.name.tr} — ${seats} koltuk × ${months} ay (${b.periodStart || issueDate} / ${b.periodEnd || U.addDays(issueDate, months * 30)})`, qty: seats * months, unit }];
  lines.forEach(l => { l.amount = Math.round(l.qty * l.unit * 100) / 100; }); const sub = Math.round(lines.reduce((a, l) => a + l.amount, 0) * 100) / 100; const vatRate = b.vatRate != null ? +b.vatRate : P.vatRate; const vat = Math.round(sub * vatRate) / 100;
  const list = invoices(); const year = issueDate.slice(0, 4); const seq = list.filter(i => i.number.includes('-' + year + '-')).length + 1;
  const inv = { id: 'I' + U.uid().slice(0, 8), number: `${P.invoicePrefix}-${year}-${String(seq).padStart(4, '0')}`, orgId: o.id, orgName: o.name, buyer: { name: c.legalName || o.name, address: c.address || '', taxOffice: c.taxOffice || '', taxNo: c.taxNo || '' }, issueDate, dueDate, periodStart: b.periodStart || issueDate, periodEnd: b.periodEnd || '', lines, subtotal: sub, vatRate, vat, total: Math.round((sub + vat) * 100) / 100, currency: c.currency || P.currency, status: 'bekliyor', note: String(b.note || '').slice(0, 300), createdAt: new Date().toISOString(), createdBy: by?.name || '', reminders: [], history: [{ at: new Date().toISOString(), by: by?.name || '', status: 'bekliyor', note: 'Düzenlendi' }] };
  list.unshift(inv); saveInvoices(list); paudit(by, 'invoice.create', inv.number, `${o.id}; ${inv.total} ${inv.currency}; vade ${dueDate}`); return effective(inv);
}
function setInvoiceStatus(id, status, note, by) {
  if (!['bekliyor', 'odendi', 'gecikti', 'iptal'].includes(status)) throw Object.assign(new Error('Geçersiz durum'), { code: 'bad' });
  const list = invoices(); const inv = list.find(i => i.id === id); if (!inv) throw Object.assign(new Error('Fatura bulunamadı'), { code: 'nf' });
  inv.status = status; if (status === 'odendi') inv.paidAt = new Date().toISOString(); inv.history.push({ at: new Date().toISOString(), by: by?.name || '', status, note: String(note || '').slice(0, 200) });
  saveInvoices(list); paudit(by, 'invoice.status', inv.number, `${status}${note ? ' — ' + note : ''}`);
  if (status === 'odendi' || status === 'iptal') reconcileSuspension(inv.orgId, by);
  return effective(inv);
}
const invoicesOf = orgId => invoices().filter(i => i.orgId === orgId).map(effective);
function reconcileSuspension(orgId, by) { const o = store.orgsAll().find(x => x.id === orgId); if (o?.suspended?.reason === 'overdue' && !invoicesOf(orgId).some(i => i.status === 'gecikti' && i.overdueDays > pdata().graceDays)) setSuspended(orgId, false, '', by || { name: 'sistem' }); }

/* ── PDF ── */
function invoicePdf(inv) {
  const PDF = require('pdfkit'); const P = pdata(); const doc = new PDF({ size: 'A4', margin: 48, info: { Title: 'Fatura ' + inv.number, Author: P.seller.name } });
  const R = path.join(__dirname, '..', 'data', 'fonts', 'LiberationSans-Regular.ttf'), B = path.join(__dirname, '..', 'data', 'fonts', 'LiberationSans-Bold.ttf'); doc.registerFont('R', R); doc.registerFont('B', B);
  const chunks = []; doc.on('data', c => chunks.push(c)); const done = new Promise(r => doc.on('end', () => r(Buffer.concat(chunks))));
  const navy = '#0B1F3A', gold = '#C6A15B', grey = '#5b6573'; const fm = n => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' ' + inv.currency; const fd = d => d ? d.split('-').reverse().join('.') : '—';
  doc.rect(0, 0, 595, 6).fill(navy); doc.fillColor(navy).font('B').fontSize(22).text('Diurna', 48, 36); doc.font('R').fontSize(8.5).fillColor(grey).text('Yaptırım ve Uyum İstihbarat Merkezi', 48, 62);
  doc.font('B').fontSize(18).fillColor(navy).text('FATURA / INVOICE', 330, 36, { width: 217, align: 'right' }); doc.font('R').fontSize(9).fillColor(grey).text('No: ' + inv.number, 330, 60, { width: 217, align: 'right' });
  doc.moveTo(48, 90).lineTo(547, 90).strokeColor(gold).lineWidth(1).stroke();
  doc.font('B').fontSize(8).fillColor(grey).text('SATICI', 48, 104).text('ALICI', 310, 104);
  doc.font('R').fontSize(9.5).fillColor('#111').text([P.seller.name, P.seller.address, `${P.seller.taxOffice} V.D. · VKN ${P.seller.taxNo}`, P.seller.email].filter(Boolean).join('\n'), 48, 118, { width: 240 });
  doc.text([inv.buyer.name, inv.buyer.address, inv.buyer.taxNo ? `${inv.buyer.taxOffice || ''} V.D. · VKN ${inv.buyer.taxNo}` : ''].filter(Boolean).join('\n'), 310, 118, { width: 237 });
  doc.font('R').fontSize(9.5).text(`Düzenleme tarihi: ${fd(inv.issueDate)}`, 48, 190).text(`Vade tarihi: ${fd(inv.dueDate)}`, 200, 190).text(`Dönem: ${fd(inv.periodStart)}${inv.periodEnd ? ' – ' + fd(inv.periodEnd) : ''}`, 340, 190);
  let y = 222; doc.rect(48, y, 499, 20).fill(navy); doc.fillColor('#fff').font('B').fontSize(8.5).text('AÇIKLAMA', 56, y + 6).text('ADET', 330, y + 6, { width: 40, align: 'right' }).text('BİRİM', 380, y + 6, { width: 70, align: 'right' }).text('TUTAR', 460, y + 6, { width: 80, align: 'right' }); y += 26;
  doc.font('R').fontSize(9.5).fillColor('#111');
  for (const l of inv.lines) { const h = doc.heightOfString(l.desc, { width: 265 }); doc.text(l.desc, 56, y, { width: 265 }); doc.text(String(l.qty), 330, y, { width: 40, align: 'right' }).text(fm(l.unit), 375, y, { width: 75, align: 'right' }).text(fm(l.amount), 455, y, { width: 85, align: 'right' }); y += Math.max(h, 14) + 8; doc.moveTo(48, y - 4).lineTo(547, y - 4).strokeColor('#e4dfd1').lineWidth(.5).stroke(); }
  y += 8; const row = (k, v, bold) => { doc.font(bold ? 'B' : 'R').fontSize(bold ? 11 : 9.5).fillColor(bold ? navy : '#111').text(k, 340, y, { width: 100 }).text(v, 440, y, { width: 100, align: 'right' }); y += bold ? 20 : 16; };
  row('Ara toplam', fm(inv.subtotal)); row(`KDV %${inv.vatRate}`, fm(inv.vat)); doc.moveTo(340, y).lineTo(547, y).strokeColor(gold).lineWidth(1).stroke(); y += 6; row('GENEL TOPLAM', fm(inv.total), true);
  y += 14; doc.rect(48, y, 499, 112).fillAndStroke('#f5f2ea', '#e4dfd1'); doc.fillColor(navy).font('B').fontSize(10).text('ÖDEME TALİMATI — Havale / EFT', 60, y + 10);
  doc.font('R').fontSize(9.5).fillColor('#111').text(`Banka: ${P.bank.bankName}${P.bank.branch ? ' · ' + P.bank.branch : ''}\nHesap sahibi: ${P.bank.accountHolder}`, 60, y + 28);
  doc.font('B').fontSize(11).text('IBAN: ' + P.bank.iban, 60, y + 58); doc.font('R').fontSize(9.5).text(`SWIFT/BIC: ${P.bank.swift}\nAçıklama alanına fatura numarasını yazınız: ${inv.number}\nSon ödeme tarihi: ${fd(inv.dueDate)}`, 60, y + 74);
  y += 128; if (inv.note) { doc.font('R').fontSize(9).fillColor(grey).text(inv.note, 48, y, { width: 499 }); y += 28; }
  doc.font('R').fontSize(7.5).fillColor(grey).text('Bu belge ödeme talimatı niteliğindeki faturadır; yasal e-Fatura/e-Arşiv belgesi satıcının mali sistemi üzerinden ayrıca düzenlenir. Ödeme durumu satıcı tarafından manuel işaretlenir. Vadesi geçen ödemelerde sözleşmedeki ek süre sonunda hizmet erişimi askıya alınabilir.', 48, 770, { width: 499 });
  doc.end(); return done;
}

/* ── Hatırlatma + askıya alma (saatlik) ── */
function notifyOrg(orgId, kind, title, body, link, invNo, to) {
  const work = require('./work'); const mailer = require('./mailer'); const o = store.orgsAll().find(x => x.id === orgId); if (!o) return;
  store.runAs(orgId, () => {
    const admins = store.authUsers().filter(u => u.orgId === orgId && u.active && u.role === 'Admin'); const emails = new Set([...(to || []), o.contract?.billingEmail, ...admins.map(a => a.email)].filter(x => /^\S+@\S+$/.test(x || '')));
    for (const a of admins) { try { work.notify(a.id, kind, { title, body, link: link || '#/yonetim/faturalama', refId: invNo + ':' + title }); } catch { } }
    for (const e of emails) mailer.send({ to: e, subject: '[Diurna] ' + title, text: body, kind }).catch(() => { });
  });
}
function tick() {
  const P = pdata(); const list = invoices(); let dirty = false; const today = todayISO();
  for (const inv of list) {
    if (inv.status !== 'bekliyor' && inv.status !== 'gecikti') continue; const o = store.orgsAll().find(x => x.id === inv.orgId); if (!o) continue;
    const dd = daysBetween(today, inv.dueDate); inv.reminders = inv.reminders || [];
    const send = (key, title, body) => { if (inv.reminders.includes(key)) return; inv.reminders.push(key); dirty = true; notifyOrg(inv.orgId, 'invoice_reminder', title, body, null, inv.number); };
    const amt = `${new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2 }).format(inv.total)} ${inv.currency}`; const pay = `\nIBAN: ${P.bank.iban} (${P.bank.accountHolder}) — açıklama: ${inv.number}`;
    if (dd > 0 && (P.reminderDays || []).includes(dd)) send('d' + dd, `Fatura ${inv.number}: vadeye ${dd} gün kaldı`, `${inv.number} numaralı ${amt} tutarındaki faturanın vadesi ${inv.dueDate}. Havale/EFT ile ödeme yapabilirsiniz.${pay}`);
    else if (dd === 0) send('due', `Fatura ${inv.number}: vade bugün`, `${inv.number} numaralı faturanın vadesi bugün (${inv.dueDate}).${pay}`);
    else if (dd < 0) {
      const od = -dd; if (inv.status === 'bekliyor') { inv.status = 'gecikti'; inv.history.push({ at: new Date().toISOString(), by: 'sistem', status: 'gecikti', note: 'Vade geçti (otomatik)' }); dirty = true; }
      const left = P.graceDays - od;
      if (left >= 0 && (od === 1 || od % 3 === 1)) send('od' + od, `Fatura ${inv.number} gecikti — ${left} gün içinde ödenmezse erişim askıya alınır`, `${inv.number} numaralı faturanın vadesi ${inv.dueDate} tarihinde geçti. Sözleşmedeki ek süre ${P.graceDays} gündür; ${left} gün içinde ödeme yapılmazsa hizmet erişimi askıya alınacaktır.${pay}`);
      if (od > P.graceDays && !o.suspended) { setSuspended(inv.orgId, true, 'overdue', { name: 'sistem' }); inv.history.push({ at: new Date().toISOString(), by: 'sistem', status: inv.status, note: 'Erişim askıya alındı (ek süre doldu)' }); dirty = true; notifyOrg(inv.orgId, 'invoice_reminder', `Erişim askıya alındı — fatura ${inv.number}`, `Ek süre dolduğu için kurumunuzun erişimi askıya alındı. Ödeme işaretlendiğinde erişim yeniden açılır.${pay}`, null, inv.number + ':susp'); }
    }
  }
  if (dirty) saveInvoices(list);
}
/* Kurum yöneticisi için durum özeti (ek süre bandı) */
function billingAlert(orgId) {
  if (process.env.UM_BILLING !== '1') return null;
  const P = pdata(); const od = invoicesOf(orgId).filter(i => i.status === 'gecikti').sort((a, b) => b.overdueDays - a.overdueDays)[0];
  if (od) return { kind: 'overdue', invoice: od.number, dueDate: od.dueDate, daysOverdue: od.overdueDays, graceLeft: Math.max(0, P.graceDays - od.overdueDays) };
  const up = invoicesOf(orgId).filter(i => i.status === 'bekliyor').sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]; const d = up ? daysBetween(todayISO(), up.dueDate) : 99;
  return up && d <= 7 ? { kind: 'due', invoice: up.number, dueDate: up.dueDate, days: d } : null;
}
function seedDemoInvoices() {
  if (invoices().length) return; const T = todayISO(); const mk = (orgId, issueOff, dueOff, note) => createInvoice({ orgId, issueDate: U.addDays(T, issueOff), dueDate: U.addDays(T, dueOff), note }, { name: 'sistem' });
  const a = mk('demo', -45, -30, 'DEMO fatura – örnek veri'); setInvoiceStatus(a.id, 'odendi', 'DEMO: havale alındı', { name: 'sistem' }); mk('demo', -10, 5, 'DEMO fatura – örnek veri'); mk('ornek-katilim', -19, -4, 'DEMO fatura – örnek veri');
}
module.exports = { seedDemoInvoices, notifyOrg, PID, pdata, savePdata, paudit, tempPassword, ensurePlatformAdmin, listOrgs, orgView, createOrg, updateOrg, setSuspended, orgSuspended, createUserFor, resetUser, invoices, invoicesOf, createInvoice, setInvoiceStatus, invoicePdf, effective, tick, billingAlert, activeUsers };
