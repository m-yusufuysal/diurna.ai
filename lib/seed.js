'use strict';
/* İlk çalıştırmada DEMO kuruluşları ve kullanıcıları oluşturur. Yaptırım verisi UYDURULMAZ; yalnızca iş akışı (görev/izleme listesi) örnekleri “demo” etiketlidir. */
const store = require('./store'); const auth = require('./auth'); const C = require('./customers'); const billing = require('./billing'); const U = require('./util');
const PW = process.env.UM_DEMO_PASSWORD || 'Uyum-Demo#2026';
const DEMO_USERS = [
  ['admin@demo-banka.example', 'Deniz Admin', 'Admin', 'hq'],
  ['yonetici@demo-banka.example', 'Selin Uyum Yöneticisi', 'Uyum Yöneticisi', 'hq'],
  ['analist1@demo-banka.example', 'Ahmet Analist', 'Analist', 'hq'],
  ['analist2@demo-banka.example', 'Zeynep Analist', 'Analist', 'b-1'],
  ['istirak@demo-banka.example', 'İştirak Okuyucu', 'Okuyucu', 'b-3'],
];
async function run() {
  if (store.orgs().length) { await require('./owner').ensurePlatformAdmin(); return false; }
  const now = new Date().toISOString();
  store.saveOrgs([
    { id: 'demo', name: 'Anadolu Ticaret Bankası A.Ş.', plan: 'professional', seats: 12, demo: true, createdAt: now, country: 'TR', branches: [
      { id: 'hq', name: 'Genel Müdürlük', type: 'hq', parent: null }, { id: 'r-marmara', name: 'Marmara Bölge Müdürlüğü', type: 'region', parent: 'hq' }, { id: 'r-ege', name: 'Ege Bölge Müdürlüğü', type: 'region', parent: 'hq' },
      { id: 'b-1', name: 'Kadıköy Şubesi', type: 'branch', parent: 'r-marmara' }, { id: 'b-2', name: 'Çankaya Şubesi', type: 'branch', parent: 'r-marmara' }, { id: 'b-3', name: 'Alsancak Şubesi', type: 'branch', parent: 'r-ege' }] },
    { id: 'ornek-katilim', name: 'Hilal Katılım Bankası A.Ş.', plan: 'starter', seats: 6, demo: true, createdAt: now },
  ]);
  await store.runAs('demo', async () => {
    const s = store.settings(); store.saveSettings({ ...s, institution: 'Anadolu Ticaret Bankası A.Ş.', department: 'Uyum Müdürlüğü' });
    const us = []; for (const [e, n, r, b] of DEMO_USERS) us.push(await auth.createUser('demo', { email: e, name: n, role: r, password: PW, demo: true, branchId: b }));
    billing.ensure('demo'); C.loadSample();
    const [adm, mgr, a1, a2] = us;
    const wl = store.watchlists(); const W = (u, type, value, note) => wl.push({ id: 'W' + U.uid().slice(0, 5), userId: u.id, type, value, note, createdAt: now, demo: true });
    W(a1, 'name', 'Volta Shipping', 'İlk kayıt'); W(a1, 'imo', '9179842', 'İlk kayıt'); W(a1, 'country', 'Iran', 'İlk kayıt'); W(a2, 'country', 'Russia', 'İlk kayıt'); W(a2, 'hs', '8517', 'telekom ekipmanı'); W(mgr, 'country', 'Syria', 'İlk kayıt');
    store.saveWatchlists(wl);
    // geçmiş (kapanmış) demo görevler: analitik grafikleri için – sahte yaptırım verisi içermez
    const tasks = []; const H = 3600e3; const mk = (i, title, kind, assignee, prio, hoursAgo, took, res) => ({ id: 'T' + U.uid().slice(0, 6), no: 'G-' + String(i).padStart(4, '0'), title, kind, ref: null, status: 'closed', resolution: res, priority: prio, assignee: assignee.id, branchId: assignee.branchId, createdBy: 'system', createdByName: 'Sistem', createdAt: new Date(Date.now() - hoursAgo * H).toISOString(), dueAt: new Date(Date.now() - hoursAgo * H + ({ critical: 4, high: 8, normal: 24 })[prio] * H).toISOString(), closedAt: new Date(Date.now() - (hoursAgo - took) * H).toISOString(), comments: [{ id: 'c1', by: assignee.id, byName: assignee.name, at: now, text: 'Kayıt.' }], demo: true, detail: 'DEMO – örnek iş akışı kaydı' });
    tasks.push(mk(1, 'Olası eşleşme incelemesi', 'hit', a1, 'high', 300, 3.2, 'false_positive'), mk(2, 'Olası eşleşme incelemesi', 'hit', a2, 'critical', 240, 2.1, 'false_positive'), mk(3, 'Olası eşleşme incelemesi', 'hit', a1, 'high', 180, 5.5, 'true_match'), mk(4, 'Olası eşleşme incelemesi', 'hit', a2, 'normal', 120, 11, 'false_positive'), mk(5, 'Aylık erişim gözden geçirme', 'manual', a2, 'normal', 96, 20, 'done'));
    const open = (i, title, assignee, prio, hrsAgo) => ({ ...mk(i, title, 'manual', assignee, prio, hrsAgo, 0, ''), status: 'open', closedAt: null, resolution: '', detail: 'Rutin görev', comments: [] });
    tasks.push({ ...open(6, 'Muhabir banka DD: Yönetim Kurulu listesini güncelle', a1, 'normal', 6), status: 'review' }, open(7, 'World-Check lisans kullanıcılarını doğrula', a2, 'normal', 2), open(8, 'Haftalık kaynak sağlığı kontrolü', a1, 'high', 9));
    store.saveTasks(tasks);
    store.logAudit(adm, 'org.seed', 'demo', 'Kurum oluşturuldu');
    const u = store.usage(); const m = billing.monthKey(); u[m] = { api_calls: 214, emails: 38, reports: 21, tasks: 8, webhooks: 12, screenings: 4 }; store.saveUsage(u);
  });
  await store.runAs('ornek-katilim', async () => { store.saveSettings({ ...store.settings(), institution: 'Hilal Katılım Bankası A.Ş.', jurisdictions: ['TR'] }); await auth.createUser('ornek-katilim', { email: 'admin@ornek-katilim.example', name: 'Katılım Admin', role: 'Admin', password: PW, demo: true }); billing.ensure('ornek-katilim'); });
  await require('./owner').ensurePlatformAdmin(); if (process.env.UM_BILLING === '1') require('./owner').seedDemoInvoices();
  return true;
}
module.exports = { run, PW, DEMO_USERS };
