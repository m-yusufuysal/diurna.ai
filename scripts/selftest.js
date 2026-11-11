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
  const PL = require('../lib/owner'), auth = require('../lib/auth'), U = require('../lib/util');
  process.env.UM_PLATFORM_PASSWORD = 'Tamga-Kule#2026x'; const pu = await PL.ensurePlatformAdmin(); assert(pu && pu.role === 'Platform' && pu.mustChangePassword && pu.mfaRequired); assert(!store.orgs().some(o => o.id === '_platform') && store.orgsAll().some(o => o.id === '_platform')); ok('platform: yönetici tohumlanır, kurum listesinde görünmez');
  const co = await PL.createOrg({ name: 'Test Bankası A.Ş.', seats: 2, admin: { name: 'Ada Yönetici', email: 'ada@test.example', username: 'ada.yonetici' } }, pu);
  assert(co.tempPassword.length >= 12 && co.admin.mustChangePassword && co.admin.username === 'ada.yonetici'); ok('platform: kurum + yönetici (kullanıcı adı + geçici parola) oluşturulur');
  let lr = await auth.login('ADA.yonetici', co.tempPassword, '1.1.1.1', 'x'); assert(lr.user.mustChangePassword && lr.sid); ok('giriş: kullanıcı adıyla; mustChangePassword işaretli');
  await assert.rejects(auth.changePassword(lr.user.id, co.tempPassword, co.tempPassword)); await auth.changePassword(lr.user.id, co.tempPassword, 'Kestane-Bulut#7731-Zr'); assert(!store.authUsers().find(u => u.id === lr.user.id).mustChangePassword); ok('parola değişimi bayrağı kaldırır');
  await PL.createUserFor('test-bankasi-a-s', { name: 'Bora', email: 'bora@test.example', role: 'Analist' }, pu); await assert.rejects(PL.createUserFor('test-bankasi-a-s', { name: 'Can', email: 'can@test.example', role: 'Analist' }, pu), e => e.code === 'seats'); ok('koltuk sınırı sözleşmeyi aşan kullanıcıyı reddeder');
  assert.throws(() => PL.updateOrg('test-bankasi-a-s', { seats: 1 }, pu), e => e.code === 'seats'); PL.updateOrg('test-bankasi-a-s', { seats: 3 }, pu); ok('koltuk sayısı aktif kullanıcı sayısının altına inemez');
  PL.updateOrg('test-bankasi-a-s', { pricePerSeat: 100, currency: 'TRY', billingEmail: 'fin@test.example' }, pu); /* faturalama modülü kapalı ama arka uç mantığı sınanır */
  const T0 = U.todayISO(); const inv = PL.createInvoice({ orgId: 'test-bankasi-a-s', issueDate: U.addDays(T0, -20), dueDate: U.addDays(T0, -1) }, pu); assert.strictEqual(inv.total, +(3 * 100 * 1.2).toFixed(2)); assert.strictEqual(inv.status, 'gecikti'); assert(inv.number.startsWith('DRN-')); ok('fatura: toplam (koltuk × birim + KDV), vade geçince "gecikti"');
  const pdf = await PL.invoicePdf(inv); assert(pdf.slice(0, 4).toString() === '%PDF' && pdf.length > 3000); ok('fatura PDF üretilir');
  PL.tick(); assert(!PL.orgSuspended('test-bankasi-a-s')); const list = store.global('invoices.json', []); list[0].dueDate = U.addDays(T0, -30); store.saveGlobal('invoices.json', list); PL.tick(); assert(PL.orgSuspended('test-bankasi-a-s')); ok('ek süre dolunca erişim askıya alınır');
  await assert.rejects(auth.login('ada.yonetici', 'Kestane-Bulut#7731-Zr', '1.1.1.1', 'x'), e => e.code === 'suspended'); ok('askıdaki kurumun kullanıcısı giriş yapamaz');
  PL.setInvoiceStatus(inv.id, 'odendi', 'havale alındı', pu); assert(!PL.orgSuspended('test-bankasi-a-s')); assert.strictEqual(PL.invoicesOf('test-bankasi-a-s')[0].status, 'odendi'); ok('ödendi işaretlenince askı kalkar');
  const inv2 = PL.createInvoice({ orgId: 'test-bankasi-a-s', issueDate: T0, dueDate: U.addDays(T0, 3) }, pu); PL.tick(); assert((store.global('invoices.json', []).find(i => i.id === inv2.id).reminders || []).includes('d3')); ok('vade hatırlatması (3 gün kala) bir kez gönderilir');
  llmSrv.close(); delete process.env.UM_LLM_BASE_URL; delete process.env.UM_LLM_MODEL;
  { // QA regresyon: yazım hatası / transliterasyon (varsayılan eşik 85) ve yanlış-pozitif sınırı
    const M = require('../lib/match'); const sc = (a, b) => M.scoreTokens(M.tokens(a), M.tokens(b)).score;
    assert(sc('Volta Shiping Services', 'Volta Shipping Services L.L.C.') >= 85, 'Volta Shiping');
    assert(sc('Hüseyin Shamkhani', 'Hossein Shamkhani') >= 85, 'Hüseyin Shamkhani');
    assert(sc('Huseyin Shamkhani', 'SHAMKHANI Hossein') >= 85, 'Huseyin/ters sıra');
    for (const [a, b] of [['Hasan Shamkhani', 'Hossein Shamkhani'], ['Alpha Shipping Services', 'Beta Shipping Services'], ['Ali Yilmaz', 'Veli Yilmaz'], ['Mehmet Kaya', 'Mehmet Demir'], ['Hussein Ali', 'Hasan Ali']]) assert(sc(a, b) < 85, 'yanlış pozitif: ' + a + ' ~ ' + b);
    const ix = new M.NameIndex(); ix.add({ id: 1, n: ['Hossein SHAMKHANI'], names: ['Hossein SHAMKHANI'], t: 'p' }); ix.add({ id: 2, n: ['VOLTA SHIPPING SERVICES L.L.C.'], names: ['VOLTA SHIPPING SERVICES L.L.C.'], t: 'e' });
    assert.strictEqual(ix.search('Hüseyin Shamkhani', { threshold: 85 }).length, 1); assert.strictEqual(ix.search('Volta Shiping Services', { threshold: 85 }).length, 1); assert.strictEqual(ix.search('Hasan Shamkhani', { threshold: 85 }).length, 0);
    ok('eşleştirme regresyonu: Volta Shiping + Hüseyin Shamkhani ≥85; Hasan/Alpha/Veli yanlış pozitif vermez');
    const Bu = require('../lib/bulletin'); assert(Bu.validateForApproval({ items: [] }).some(e => e.code === 'empty')); ok('boş bülten doğrulaması: empty hatası');
  }
  { // Resmî liste ayrıştırıcıları (kayıtlı örnek dosyalarla; canlı çekim ayrıca doğrulandı)
    const R = require('../lib/regional'); const fx = f => require('path').join(__dirname, 'fixtures', f); const rd = f => fs.readFileSync(fx(f));
    const au = R.parseDFAT(rd('dfat-mini.xlsx')); assert.strictEqual(au.length, 3, 'DFAT: 1000/1000a/1000b tek kayıt'); const v = au.find(e => e.id === '1000'); assert(v.n.includes('فولتا للخدمات البحرية') && v.n.includes('Volta Shiping') && v.n[0].startsWith('VOLTA') && v.u === '2024-03-12'); assert.deepStrictEqual(au.find(e => e.id === '2001').imo, ['9179842']); assert.strictEqual(au.find(e => e.id === '2001').t, 'v'); ok('DFAT xlsx ayrıştırıcı: ad+takma ad+Arapça yazım tek kayıt, IMO, tarih');
    const jp = R.parseMOF(rd('mof-mini.xlsx')); assert.strictEqual(jp.length, 2, 'MOF: silinen satır atlanır'); assert(jp[0].n.includes('MOHAMMAD HASSAN AKHUND') && jp[0].n.includes('محمد حسن آخوند') && jp[0].n.includes('Mullah') && jp[0].d === '2001-09-22'); assert.strictEqual(jp[1].t, 'e'); ok('Japonya MOF xlsx ayrıştırıcı: İngilizce/Arapça ad, takma ad, tarih, silinen satır atlanır');
    const tr = R.parseMASAK(JSON.parse(fs.readFileSync(fx('masak-sample.json'), 'utf8'))); assert(tr.length >= 30 && tr.every(e => e.s === 'tr' && e.n.length && e.ref && e.d)); const o39 = tr.find(e => /OFFICE 39/.test(e.n[0])); assert(o39 && o39.n.includes('Bureau 39') && o39.prog === '7262' && o39.d === '2021-02-24' && o39.ref === 'RG 31405'); assert(tr.some(e => e.prog.startsWith('6415 md.5')) && tr.some(e => e.prog.startsWith('6415 md.6')) && tr.some(e => e.prog.startsWith('6415 md.7')) && tr.some(e => e.dob)); assert.strictEqual(new Set(tr.map(e => e.id)).size, tr.length); ok('MASAK ayrıştırıcı: 6415 md.5/6/7 + 7262, karar (RG tarihi/sayısı), takma adlar, doğum tarihi, tekil kimlik');
  }
  { // Çok dilli eşleştirme regresyonu (kayıtlı etiketli çiftler: UN/UAE/Katar/Suudi/Japonya/DFAT gerçek adları + el yapımı TR/AR/RU/ZH/DE varyantları)
    const M = require('../lib/match'); const P = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'match-pairs.json'), 'utf8')); const sc = (a, b) => M.scoreNames(M.tokens(a), M.tokens(b)).score;
    const st = f => { let tp = 0, fp = 0, fn = 0; for (const p of P.filter(f)) { const h = sc(p.q, p.n) >= 85; if (p.y && h) tp++; else if (p.y) fn++; else if (h) fp++; } return { tp, fp, fn, prec: tp / (tp + fp || 1), rec: tp / (tp + fn || 1) }; };
    const all = st(() => true), hand = st(p => p.k === 'hand'), ar = st(p => p.k.startsWith('ar-lat'));
    assert(all.prec >= 0.98, 'kesinlik ' + all.prec); assert(hand.rec >= 0.85, 'el yapımı duyarlılık ' + hand.rec); assert(ar.rec >= 0.4 && ar.fp === 0, 'Arapça↔Latin ' + JSON.stringify(ar));
    for (const [a, b] of [['Hüseyin Shamkhani', 'Hossein SHAMKHANI'], ['Volta Shiping', 'VOLTA SHIPPING SERVICES L.L.C.'], ['İbrahim Çağlar', 'Ibrahim Caglar'], ['Müller GmbH', 'Mueller'], ['محمد حسن أخوند', 'MOHAMMAD HASSAN AKHUND'], ['Сергей Лавров', 'Sergei Lavrov'], ['习近平', 'Xi Jinping'], ['Abdul Rahman Al Sayed', 'Abdulrahman Alsayed'], ['Al-Qaida', 'Alqaeda'], ['Mohamed bin Zayed', 'Muhammad ibn Zayed']]) assert(sc(a, b) >= 85, a + ' ~ ' + b + ' = ' + sc(a, b));
    for (const [a, b] of [['Hasan Shamkhani', 'Hossein Shamkhani'], ['Mehmet Öz', 'Mohammed Ozil'], ['Ali Yilmaz', 'Veli Yilmaz'], ['Ivan Ivanov', 'Ivan Petrov'], ['Alpha Shipping Services', 'Beta Shipping Services']]) assert(sc(a, b) < 85, 'yanlış pozitif ' + a + ' ~ ' + b);
    assert.strictEqual(M.fold('IŞIK İSTANBUL ıi'), 'isik istanbul ii'); assert.strictEqual(M.fold('١٢٣ أ إ آ'), '123 a a a'); ok(`çok dilli eşleştirme: kesinlik ${all.prec.toFixed(2)}, duyarlılık el yapımı ${hand.rec.toFixed(2)} / Arapça↔Latin ${ar.rec.toFixed(2)} (hata pozitif ${all.fp})`);
  }
  
/* ---- İkincil kimlik doğrulayıcılar (kimlik/doğum yılı/kripto) ---- */
{
  const SEC = require('../lib/secondary'); const Mm = require('../lib/match');
  const rm = SEC.parseRemarks('DOB 08 Jan 1960; POB Tehran, Iran; nationality Iran; Passport A1234567 (Iran) expires 2030; National ID No. 0044123456 (Iran); Digital Currency Address - XBT 1HrQ3MoXz8y9uPzLkN4bW7vFh2qDcRtYaB;');
  assert(rm.dobs.includes('1960-01-08')); ok('OFAC remarks: doğum tarihi/yılı');
  assert(rm.ids.includes('A1234567') && rm.ids.includes('0044123456')); ok('OFAC remarks: pasaport + kimlik no'); assert(rm.wallets.length === 1 && rm.nat[0] === 'Iran'); ok('OFAC remarks: cüzdan + uyruk');
  const ix = new Mm.NameIndex(); ix.add({ s: 'tr', id: 'X1', n: ['MEHMET KAYA'], t: 'p', dobs: ['1975-03-02'], ids: ['12345678901'] }); ix.add({ s: 'tr', id: 'X2', n: ['AHMET YILMAZ'], t: 'p', dobs: ['1980-01-01'] });
  const byId = ix.search('Tamamen Farklı İsim', { threshold: 85, ids: ['123 456 789 01'] }); assert(byId.length === 1 && byId[0].entry.id === 'X1' && byId[0].reasons.includes('taxid')); ok('kimlik no birebir → ad farklı olsa da bulunur');
  const h = ix.search('Ahmet Yılmaz', { threshold: 85 }); assert(h.length === 1); ok('ad eşleşmesi');
  const a1 = SEC.adjust({ id: 'c1', yob: '1952' }, h, { thresholdOf: () => 85 }); assert(a1.hits.length === 0 && a1.dropped[0].why === 'yob_conflict'); ok('doğum yılı çelişkisi → elendi (yanlış pozitif azalır)');
  const a2 = SEC.adjust({ id: 'c1', yob: '1981' }, h, { thresholdOf: () => 85 }); assert(a2.hits.length === 1 && a2.hits[0].reasons.includes('yob')); ok('±1 yıl hoşgörüyle doğum yılı uyumlu → bonus');
  const a3 = SEC.adjust({ id: 'c1', yob: '1980' }, h, { goodGuys: [{ customerId: 'c1', src: 'tr', entryId: 'X2' }] }); assert(a3.hits.length === 0 && a3.dropped[0].why === 'good_guy'); ok('good-guy çifti bastırılır');
}

/* ---- MASAK resmî CSV (cp1254, ';') ayrıştırıcı: dört bölüm ---- */
{
  const R2 = require('../lib/regional'); const fx2 = f => path.join(__dirname, 'fixtures', f);
  for (const [k, minN] of [['A', 20], ['B', 20], ['C', 30], ['D', 20]]) {
    const o = R2.parseMASAKcsv(fs.readFileSync(fx2('masak-' + k + '.csv')), k);
    assert(o.length >= minN && o.every(e => e.s === 'tr' && e.n[0] && e.sect === k && e.prog)); assert(o.official === o.length);
    ok('MASAK CSV bölüm ' + k + ': ' + o.length + ' kayıt, satır sayısı = ayrıştırılan');
  }
  const c = R2.parseMASAKcsv(fs.readFileSync(fx2('masak-C.csv')), 'C'); const e0 = c[0];
  assert(e0.idno && /^\d{11}$/.test(e0.idno) && e0.dob && e0.mother && e0.father && e0.ref.startsWith('RG ')); ok('MASAK md.7: TCKN, doğum tarihi, anne/baba, RG referansı alanları');
  assert(R2.masakCsvHref([{ content: { rendered: '<a href="https://ms.hmb.gov.tr/uploads/x/C-IC-DONDURMA-KARARI-6415-a.csv">c</a><a href="https://ms.hmb.gov.tr/uploads/x/B-YABANCI-6415-b.csv">b</a>' } }], 'B').endsWith('B-YABANCI-6415-b.csv')); ok('MASAK sayfa JSON → bölüme uyan CSV bağlantısı');
}
console.log(`\n${n} test geçti.`);
})().catch(e => { console.error(e); process.exit(1); });
