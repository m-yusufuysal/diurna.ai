'use strict';
/* İlk çalıştırmada DEMO kuruluşları ve kullanıcıları oluşturur. Yaptırım verisi UYDURULMAZ; yalnızca iş akışı (görev/izleme listesi) örnekleri “demo” etiketlidir. */
const store = require('./store'); const auth = require('./auth'); const C = require('./customers'); const billing = require('./billing'); const U = require('./util');
const PW = process.env.UM_DEMO_PASSWORD || 'Uyum-Demo#2026';
const DEMO_USERS = [
  ['admin@demo-banka.example', 'Deniz Admin (DEMO)', 'Admin', 'hq'],
  ['yonetici@demo-banka.example', 'Selin Uyum Yöneticisi (DEMO)', 'Uyum Yöneticisi', 'hq'],
  ['analist1@demo-banka.example', 'Ahmet Analist (DEMO)', 'Analist', 'hq'],
  ['analist2@demo-banka.example', 'Zeynep Analist (DEMO)', 'Analist', 'b-1'],
  ['istirak@demo-banka.example', 'İştirak Okuyucu (DEMO)', 'Okuyucu', 'b-3'],
];
async function run() {
  if (store.orgs().length) { await require('./platform').ensurePlatformAdmin(); return false; }
  const now = new Date().toISOString();
  store.saveOrgs([
    { id: 'demo', name: 'Demo Banka A.Ş. (DEMO)', plan: 'professional', seats: 12, demo: true, contract: { legalName: 'Demo Banka A.Ş. (DEMO)', address: 'Örnek Cad. No:1, İstanbul', taxOffice: 'Örnek V.D.', taxNo: '1111111111', billingEmail: 'billing@demo-banka.example', currency: 'USD', pricePerSeat: 149, billingMonths: 1, termDays: 15, start: '2026-01-01', end: '2026-12-31' }, createdAt: now, country: 'TR', branches: [
      { id: 'hq', name: 'Genel Müdürlük', type: 'hq', parent: null }, { id: 'r-marmara', name: 'Marmara Bölge Müdürlüğü', type: 'region', parent: 'hq' }, { id: 'r-ege', name: 'Ege Bölge Müdürlüğü', type: 'region', parent: 'hq' },
      { id: 'b-1', name: 'Örnek Şube 1 (DEMO)', type: 'branch', parent: 'r-marmara' }, { id: 'b-2', name: 'Örnek Şube 2 (DEMO)', type: 'branch', parent: 'r-marmara' }, { id: 'b-3', name: 'Örnek Şube 3 (DEMO)', type: 'branch', parent: 'r-ege' }] },
    { id: 'ornek-katilim', name: 'Örnek Katılım Bankası (DEMO)', plan: 'starter', seats: 6, demo: true, contract: { legalName: 'Örnek Katılım Bankası (DEMO)', address: 'Örnek Sk. No:2, Ankara', taxOffice: 'Örnek V.D.', taxNo: '2222222222', billingEmail: 'billing@ornek-katilim.example', currency: 'USD', pricePerSeat: 49, billingMonths: 1, termDays: 15, start: '2026-01-01', end: '2026-12-31' }, createdAt: now },
  ]);
  await store.runAs('demo', async () => {
    const s = store.settings(); store.saveSettings({ ...s, institution: 'Demo Banka A.Ş. (DEMO)', department: 'Uyum Müdürlüğü' });
    const us = []; for (const [e, n, r, b] of DEMO_USERS) us.push(await auth.createUser('demo', { email: e, name: n, role: r, password: PW, demo: true, branchId: b }));
    billing.ensure('demo'); C.loadSample();
    const [adm, mgr, a1, a2] = us;
    const wl = store.watchlists(); const W = (u, type, value, note) => wl.push({ id: 'W' + U.uid().slice(0, 5), userId: u.id, type, value, note, createdAt: now, demo: true });
    W(a1, 'name', 'Volta Shipping', 'DEMO: örnek izleme'); W(a1, 'imo', '9179842', 'DEMO'); W(a1, 'country', 'Iran', 'DEMO'); W(a2, 'country', 'Russia', 'DEMO'); W(a2, 'hs', '8517', 'DEMO: telekom ekipmanı'); W(mgr, 'country', 'Syria', 'DEMO');
    store.saveWatchlists(wl);
    // geçmiş (kapanmış) demo görevler: analitik grafikleri için – sahte yaptırım verisi içermez
    const tasks = []; const H = 3600e3; const mk = (i, title, kind, assignee, prio, hoursAgo, took, res) => ({ id: 'T' + U.uid().slice(0, 6), no: 'G-' + String(i).padStart(4, '0'), title, kind, ref: null, status: 'closed', resolution: res, priority: prio, assignee: assignee.id, branchId: assignee.branchId, createdBy: 'system', createdByName: 'Sistem', createdAt: new Date(Date.now() - hoursAgo * H).toISOString(), dueAt: new Date(Date.now() - hoursAgo * H + ({ critical: 4, high: 8, normal: 24 })[prio] * H).toISOString(), closedAt: new Date(Date.now() - (hoursAgo - took) * H).toISOString(), comments: [{ id: 'c1', by: assignee.id, byName: assignee.name, at: now, text: 'DEMO kaydı.' }], demo: true, detail: 'DEMO – örnek iş akışı kaydı' });
    tasks.push(mk(1, 'DEMO · Olası eşleşme incelemesi (örnek)', 'hit', a1, 'high', 300, 3.2, 'false_positive'), mk(2, 'DEMO · Olası eşleşme incelemesi (örnek)', 'hit', a2, 'critical', 240, 2.1, 'false_positive'), mk(3, 'DEMO · Olası eşleşme incelemesi (örnek)', 'hit', a1, 'high', 180, 5.5, 'true_match'), mk(4, 'DEMO · Olası eşleşme incelemesi (örnek)', 'hit', a2, 'normal', 120, 11, 'false_positive'), mk(5, 'DEMO · Aylık erişim gözden geçirme', 'manual', a2, 'normal', 96, 20, 'done'));
    const open = (i, title, assignee, prio, hrsAgo) => ({ ...mk(i, title, 'manual', assignee, prio, hrsAgo, 0, ''), status: 'open', closedAt: null, resolution: '', detail: 'DEMO – örnek görev', comments: [] });
    tasks.push({ ...open(6, 'DEMO · Muhabir banka DD: Yönetim Kurulu listesini güncelle', a1, 'normal', 6), status: 'review' }, open(7, 'DEMO · World-Check lisans kullanıcılarını doğrula', a2, 'normal', 2), open(8, 'DEMO · Haftalık kaynak sağlığı kontrolü', a1, 'high', 9));
    store.saveTasks(tasks);
    store.logAudit(adm, 'org.seed', 'demo', 'DEMO kuruluşu oluşturuldu');
    const u = store.usage(); const m = billing.monthKey(); u[m] = { api_calls: 214, emails: 38, reports: 21, tasks: 8, webhooks: 12, screenings: 4 }; store.saveUsage(u);
  });
  await store.runAs('ornek-katilim', async () => { store.saveSettings({ ...store.settings(), institution: 'Örnek Katılım Bankası (DEMO)', jurisdictions: ['TR'] }); await auth.createUser('ornek-katilim', { email: 'admin@ornek-katilim.example', name: 'Katılım Admin (DEMO)', role: 'Admin', password: PW, demo: true }); billing.ensure('ornek-katilim'); });
  await require('./platform').ensurePlatformAdmin(); require('./platform').seedDemoInvoices();
  return true;
}
module.exports = { run, PW, DEMO_USERS };
