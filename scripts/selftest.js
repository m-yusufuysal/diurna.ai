'use strict';
/* Hızlı kendi kendine test: node scripts/selftest.js — sunucu başlatmadan güvenlik ve i18n temellerini doğrular. */
const assert = require('assert'); const fs = require('fs'); const path = require('path'); const cp = require('child_process');
const root = path.join(__dirname, '..'); let n = 0; const ok = (m) => { n++; console.log('  ✓', m); };
process.env.UM_DATA_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'diurna-test-')); process.env.UM_CACHE_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'diurna-cache-'));
const sec = require('../lib/security');
// 1) şifreleme gidiş-dönüş
const enc = sec.encStr('gizli veri'); assert.notStrictEqual(enc, 'gizli veri'); assert.strictEqual(sec.decStr(enc), 'gizli veri'); ok('AES-256-GCM şifreleme gidiş-dönüş');
// 2) parola politikası
assert(sec.passwordIssues('kisa').length); assert.strictEqual(sec.passwordIssues('Uyum-Demo#2026-x').length, 0); ok('parola politikası');
// 3) CSV enjeksiyon koruması
assert(/^"'=/.test(sec.csvCell('=HYPERLINK("x")'))); ok('CSV formül enjeksiyonu engellenir');
// 4) TOTP
const s = sec.totpSecret(); assert(s.length >= 16); ok('TOTP sırrı üretimi');
// 5) IP izin listesi
assert(sec.ipAllowed('10.1.2.3', ['10.0.0.0/8'])); assert(!sec.ipAllowed('11.1.2.3', ['10.0.0.0/8'])); assert(sec.ipAllowed('1.2.3.4', [])); ok('IP izin listesi (CIDR)');
// 6) i18n anahtar eşitliği (tr/en/ar)
const load = f => { const src = fs.readFileSync(path.join(root, 'public/js/i18n', f), 'utf8').replace(/^[\s\S]*?export default /, '').replace(/;\s*$/, ''); return JSON.parse(src); };
const tr = load('tr.js'), en = load('en.js'), ar = load('ar.js'); const k = o => Object.keys(o).sort().join();
assert.strictEqual(k(tr), k(en)); assert.strictEqual(k(tr), k(ar)); ok(`i18n: ${Object.keys(tr).length} anahtar, TR/EN/AR eşit`);
// 7) sunucu tarafı bülten sözlükleri
const I = require('../lib/i18n'); assert.deepStrictEqual(I.langs.sort(), ['ar', 'en', 'tr']); ok('bülten sözlükleri: tr/en/ar');
// 8) sözdizimi
for (const f of ['server.js', ...fs.readdirSync(path.join(root, 'lib')).map(x => 'lib/' + x)]) if (f.endsWith('.js')) cp.execFileSync(process.execPath, ['--check', path.join(root, f)]); ok('sunucu dosyaları sözdizimi');
// 9) marka yapılandırması
const b = require('../lib/brand').get(); assert(b.name.tr && b.tagline.en && b.descriptor.ar); ok('marka yapılandırması (config/brand.json)');
(async () => {
  // 10) çeviri sağlayıcısı (LibreTranslate uyumlu yerel taslak sunucu), önbellek ve gizlilik ilkesi
  const http = require('http'); let calls = 0;
  const srv = http.createServer((rq, rs) => { let b = ''; rq.on('data', d => b += d); rq.on('end', () => { calls++; const j = JSON.parse(b); rs.setHeader('content-type', 'application/json'); rs.end(JSON.stringify({ translatedText: '[' + j.target + '] ' + j.q, detectedLanguage: { language: 'en' } })); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const T = require('../lib/translate');
  for (const k of Object.keys(process.env)) if (/^UM_(DEEPL|AZURE|GOOGLE|LIBRE|TRANSLATE)/.test(k)) delete process.env[k];
  await assert.rejects(() => T.translate('hello', 'tr', 'news'), e => e.code === 'not_configured'); ok('çeviri: sağlayıcı yoksa açık hata mesajı');
  process.env.UM_LIBRETRANSLATE_URL = 'http://127.0.0.1:' + srv.address().port;
  const r1 = await T.translate(['Sanctions update'], 'tr', 'news'); assert.strictEqual(r1.items[0].text, '[tr] Sanctions update'); assert(r1.machine && r1.selfHosted);
  const r2 = await T.translate(['Sanctions update'], 'tr', 'news'); assert(r2.items[0].cached); assert.strictEqual(calls, 1); ok('çeviri: LibreTranslate sağlayıcısı + önbellek');
  const r3 = await T.translate(['Onaylı yanıt'], 'en', 'dd'); assert.strictEqual(calls, 2); assert(r3.items[0].text.startsWith('[en]')); ok('çeviri: kurum içi sağlayıcıda gizli içerik çevrilir');
  delete process.env.UM_LIBRETRANSLATE_URL; process.env.UM_DEEPL_KEY = 'x:fx';
  await assert.rejects(() => T.translate('answer', 'tr', 'dd'), e => e.code === 'confidential'); ok('çeviri: gizli içerik dış sağlayıcıya gönderilmez'); delete process.env.UM_DEEPL_KEY; srv.close();
  // 11) yeni liste ayrıştırıcıları
  const L = require('../lib/lists');
  const csl = L.parseCSL('_id,source,entity_number,type,programs,name,title,addresses,federal_register_notice,start_date,end_date,standard_order,license_requirement,license_policy,call_sign,vessel_type,gross_tonnage,gross_registered_tonnage,vessel_flag,vessel_owner,remarks,source_list_url,alt_names,citizenships,dates_of_birth,nationalities,places_of_birth,source_information_url,ids\n"1","Entity List (EL) - Bureau of Industry and Security","","","","ACME TRADING LLC","","1 Main St, Dubai, AE","80 FR 1","2020-01-02","","","All items","","","","","","","","","","ACME TRADE;ACME LLC","","","","","",""\n"2","Specially Designated Nationals (SDN) - Treasury Department","1","Entity","X","SKIP ME","","","","","","","","","","","","","","","","","","","","","","",""\n');
  assert.strictEqual(csl.length, 1); assert.deepStrictEqual(csl[0].n, ['ACME TRADING LLC', 'ACME TRADE', 'ACME LLC']); assert.strictEqual(csl[0].c, 'EL'); ok('liste ayrıştırıcı: BIS/CSL (OFAC kayıtları ayrı kaynaktan, çift sayılmaz)');
  const ca = L.parseSEMA('<data-set><record><Country-Pays>Russia / Russie</Country-Pays><EntityOrShip-EntiteOuNavire>Sea Star</EntityOrShip-EntiteOuNavire><ShipIMONumber-NumeroOMIDuNavire>9074729</ShipIMONumber-NumeroOMIDuNavire><Schedule-Annexe>1.1</Schedule-Annexe><Item-NumeroDarticle>7</Item-NumeroDarticle><DateOfListing-DateDinscription>2025-02-21</DateOfListing-DateDinscription></record></data-set>');
  assert.strictEqual(ca[0].t, 'v'); assert.deepStrictEqual(ca[0].imo, ['9074729']); ok('liste ayrıştırıcı: Kanada SEMA (gemi/IMO)');
  const ch = L.parseSECO('<x><sanctions-program ssid="1"><program-key lang="eng">Belarus</program-key><sanctions-set ssid="9" lang="eng">x</sanctions-set></sanctions-program><target ssid="5"><sanctions-set-id>9</sanctions-set-id><individual><identity><name name-type="primary-name"><name-part order="1"><value>Doe</value></name-part><name-part order="2"><value>John</value></name-part></name></identity></individual><modification modification-type="listed" enactment-date="2020-01-01"/></target><target ssid="6"><sanctions-set-id>9</sanctions-set-id><individual><identity><name name-type="primary-name"><name-part order="1"><value>Gone</value></name-part></name></identity></individual><modification modification-type="listed" enactment-date="2020-01-01"/><modification modification-type="de-listed" enactment-date="2021-01-01"/></target></x>');
  assert.strictEqual(ch.length, 1); assert.strictEqual(ch[0].c, 'Belarus'); ok('liste ayrıştırıcı: İsviçre SECO (çıkarılanlar elenir)');
  // 12) birleşik varlık deposu: temel çizgi, ekleme/güncelleme/çıkarma günlüğü, kaynaklar arası bağ
  const store = require('../lib/store'); const E = require('../lib/entities');
  const ent = (id, n, extra = {}) => ({ s: 'ofac', id, n, t: 'e', c: 'IRAN', ...extra });
  store.writeCache('list-ofac.json', { fetchedAt: 't1', entries: [ent('1', ['ALPHA CORP']), ent('2', ['BETA SHIPPING'], { t: 'v', imo: ['9074729'] })] });
  assert.strictEqual(E.ingest('ofac').first, true); assert.strictEqual(E.feed({}).length, 0);
  store.writeCache('list-ofac.json', { fetchedAt: 't2', entries: [ent('1', ['ALPHA CORP', 'ALPHA CO']), ent('3', ['GAMMA LTD'])] });
  const d = E.ingest('ofac'); assert.deepStrictEqual([d.added, d.updated, d.removed], [1, 1, 1]); assert.strictEqual(E.feed({}).length, 3);
  assert(E.search({ q: 'beta', status: 'removed' }).total === 1 && E.get('ofac:2').entity.removed); ok('varlık deposu: temel çizgi + ekleme/güncelleme/çıkarma günlüğü');
  store.writeCache('list-uk.json', { fetchedAt: 'u1', entries: [{ s: 'uk', id: 'U1', n: ['Beta Shipping'], t: 'v', c: 'Russia', imo: ['9074729'] }] }); E.ingest('uk');
  assert.strictEqual(E.get('ofac:2').related.length, 1); ok('varlık deposu: aynı IMO ile kaynaklar arası eşleme');
  // 13) nazik çekim: robots.txt, Retry-After, sağlık eşikleri
  const F = require('../lib/fetcher'); const rb = F.parseRobots('User-agent: *\nDisallow: /private\nAllow: /private/ok\nCrawl-delay: 7\n');
  assert(!F.robotsOk(rb, '/private/x') && F.robotsOk(rb, '/private/ok') && F.robotsOk(rb, '/public') && rb.delay === 7); ok('fetcher: robots.txt kuralları + Crawl-delay');
  assert.strictEqual(F.parseRetryAfter('12'), 12000); assert(F.parseRetryAfter(new Date(Date.now() + 30000).toUTCString()) > 20000 && F.parseRetryAfter('') === 0); ok('fetcher: Retry-After (saniye ve tarih)');
  const H = require('../lib/health'); const iso = ms => new Date(Date.now() - ms).toISOString();
  const bad = H.assess([{ id: 'a', label: 'A', kind: 'news', everyMin: 15, lastOk: iso(5 * 3600e3), fails: 0 }, { id: 'b', label: 'B', kind: 'list', everyMin: 60, lastOk: iso(1 * 3600e3), fails: 0 }, { id: 'c', label: 'C', kind: 'news', everyMin: 15, lastOk: iso(60000), fails: 3, lastError: 'HTTP 503' }]);
  assert.deepStrictEqual(bad.map(x => x.id + ':' + x.reason), ['a:stale', 'c:failing']); ok('sağlık: bayat ve art arda hata tespiti');
  // 14) LLM: maskeleme, bütünlük doğrulaması, atıf/sayı doğrulaması, sahte OpenAI sunucusu ile çeviri
  const LLM = require('../lib/llm'); const AI = require('../lib/ai');
  const mk = LLM.mask('OFAC designated MAHAN AIR (IMO 9074729) on 12 May 2026 under Reg 833/2014.', ['MAHAN AIR']);
  assert(!/9074729|MAHAN|2026|833/.test(mk.masked) && LLM.unmask(mk.masked, mk.map).includes('IMO 9074729') && LLM.verify(mk.masked, mk.masked, mk.map)); ok('llm: ad/IMO/tarih/referans maskelenir ve geri yüklenir');
  assert(!LLM.verify(mk.masked, mk.masked.replace('⟦a⟧', ''), mk.map) && !LLM.verify(mk.masked, mk.masked + ' ⟦a⟧', mk.map)); ok('llm: eksik/fazla jeton reddedilir');
  const g = AI.ground('- Valid line [n1]\n- Cites unknown [n9]\n- No citation here\n- Invented number 555 [n1]\n- Date 12 May 2026 ok [n1]', new Set(['n1']), 'Notice on 12 May 2026 about Mahan.');
  assert.strictEqual(g.dropped, 3); assert(g.text.includes('Valid line') && g.text.includes('Date 12 May 2026')); ok('ai: atıfsız/yanlış atıflı/uydurma sayılı satırlar atılır');
  let mode = 'ok'; const llmSrv = require('http').createServer((rq, rs) => { let b = ''; rq.on('data', d => b += d); rq.on('end', () => { const j = JSON.parse(b); const u = j.messages[1].content; const out = mode === 'ok' ? '[TR] ' + u : '[TR] ' + u.replace(/⟦[a-z]+⟧/g, ''); rs.setHeader('content-type', 'application/json'); rs.end(JSON.stringify({ choices: [{ message: { content: out } }], usage: {} })); }); });
  await new Promise(r => llmSrv.listen(0, '127.0.0.1', r)); process.env.UM_LLM_BASE_URL = 'http://127.0.0.1:' + llmSrv.address().port + '/v1'; process.env.UM_LLM_MODEL = 'mock';
  const TR = require('../lib/translate'); assert(LLM.info().onprem && TR.info().ai);
  const tr1 = await TR.translate(['OFAC designated MAHAN AIR IMO 9074729 on 12 May 2026'], 'tr', 'news'); assert(tr1.ai && tr1.items[0].text.includes('IMO 9074729') && tr1.items[0].text.includes('MAHAN AIR') && tr1.items[0].text.startsWith('[TR]')); ok('çeviri: LLM sağlayıcısı ad/IMO/tarihi korur (sahte sunucu)');
  mode = 'bad'; await assert.rejects(TR.translate(['Sanctions on IMO 9074729 vessel'], 'tr', 'regulation'), e => e.code === 'integrity'); ok('çeviri: jeton kaybeden LLM çıktısı reddedilir');
  // faturalama / platform sahibi
  const PL = require('../lib/platform'), auth = require('../lib/auth'), U = require('../lib/util');
  process.env.UM_PLATFORM_PASSWORD = 'Tamga-Kule#2026x'; const pu = await PL.ensurePlatformAdmin(); assert(pu && pu.role === 'Platform' && pu.mustChangePassword && pu.mfaRequired); assert(!store.orgs().some(o => o.id === '_platform') && store.orgsAll().some(o => o.id === '_platform')); ok('platform: yönetici tohumlanır, kurum listesinde görünmez');
  const co = await PL.createOrg({ name: 'Test Bankası A.Ş.', seats: 2, plan: 'starter', pricePerSeat: 100, contract: { billingEmail: 'fin@test.example', currency: 'TRY' }, admin: { name: 'Ada Yönetici', email: 'ada@test.example', username: 'ada.yonetici' } }, pu);
  assert(co.tempPassword.length >= 12 && co.admin.mustChangePassword && co.admin.username === 'ada.yonetici'); ok('platform: kurum + yönetici (kullanıcı adı + geçici parola) oluşturulur');
  let lr = await auth.login('ADA.yonetici', co.tempPassword, '1.1.1.1', 'x'); assert(lr.user.mustChangePassword && lr.sid); ok('giriş: kullanıcı adıyla; mustChangePassword işaretli');
  await assert.rejects(auth.changePassword(lr.user.id, co.tempPassword, co.tempPassword)); await auth.changePassword(lr.user.id, co.tempPassword, 'Kestane-Bulut#7731-Zr'); assert(!store.authUsers().find(u => u.id === lr.user.id).mustChangePassword); ok('parola değişimi bayrağı kaldırır');
  await PL.createUserFor('test-bankasi-a-s', { name: 'Bora', email: 'bora@test.example', role: 'Analist' }, pu); await assert.rejects(PL.createUserFor('test-bankasi-a-s', { name: 'Can', email: 'can@test.example', role: 'Analist' }, pu), e => e.code === 'seats'); ok('koltuk sınırı sözleşmeyi aşan kullanıcıyı reddeder');
  assert.throws(() => PL.updateOrg('test-bankasi-a-s', { seats: 1 }, pu), e => e.code === 'seats'); PL.updateOrg('test-bankasi-a-s', { seats: 3 }, pu); ok('koltuk sayısı aktif kullanıcı sayısının altına inemez');
  const T0 = U.todayISO(); const inv = PL.createInvoice({ orgId: 'test-bankasi-a-s', issueDate: U.addDays(T0, -20), dueDate: U.addDays(T0, -1) }, pu); assert.strictEqual(inv.total, +(3 * 100 * 1.2).toFixed(2)); assert.strictEqual(inv.status, 'gecikti'); assert(inv.number.startsWith('DRN-')); ok('fatura: toplam (koltuk × birim + KDV), vade geçince "gecikti"');
  const pdf = await PL.invoicePdf(inv); assert(pdf.slice(0, 4).toString() === '%PDF' && pdf.length > 3000); ok('fatura PDF üretilir');
  PL.tick(); assert(!PL.orgSuspended('test-bankasi-a-s')); const list = store.global('invoices.json', []); list[0].dueDate = U.addDays(T0, -30); store.saveGlobal('invoices.json', list); PL.tick(); assert(PL.orgSuspended('test-bankasi-a-s')); ok('ek süre dolunca erişim askıya alınır');
  await assert.rejects(auth.login('ada.yonetici', 'Kestane-Bulut#7731-Zr', '1.1.1.1', 'x'), e => e.code === 'suspended'); ok('askıdaki kurumun kullanıcısı giriş yapamaz');
  PL.setInvoiceStatus(inv.id, 'odendi', 'havale alındı', pu); assert(!PL.orgSuspended('test-bankasi-a-s')); assert.strictEqual(PL.invoicesOf('test-bankasi-a-s')[0].status, 'odendi'); ok('ödendi işaretlenince askı kalkar');
  const inv2 = PL.createInvoice({ orgId: 'test-bankasi-a-s', issueDate: T0, dueDate: U.addDays(T0, 3) }, pu); PL.tick(); assert((store.global('invoices.json', []).find(i => i.id === inv2.id).reminders || []).includes('d3')); ok('vade hatırlatması (3 gün kala) bir kez gönderilir');
  llmSrv.close(); delete process.env.UM_LLM_BASE_URL; delete process.env.UM_LLM_MODEL;
  console.log(`\n${n} test geçti.`);
})().catch(e => { console.error(e); process.exit(1); });
