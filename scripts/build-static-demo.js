#!/usr/bin/env node
'use strict';
/* Diurna – GitHub Pages için statik DEMO derlemesi.
 *
 *   node scripts/snapshot-demo.js      # (isteğe bağlı) veri anlık görüntüsünü docs/demo/data altına yazar
 *   node scripts/build-static-demo.js  # public/ → docs/  (+ demo/shim.js, tarayıcıda çalışan eşleştirme/ticaret/DD motoru)
 *
 * Çıktı: docs/ klasörü. GitHub Pages "Deploy from a branch → main → /docs" ile yayımlanır.
 * Tüm yollar GÖRELİDİR (https://<kullanıcı>.github.io/<depo>/ alt yolunda çalışır). docs/demo/data korunur (anlık görüntü).
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'docs');
const SRC = path.resolve(process.env.DEMO_SRC || ROOT), PUB = path.join(SRC, 'public');   // DEMO_SRC: public/ ve lib/ kaynağı (varsayılan: bu depo)
const KEEP = new Set(['demo']);

/* 1) docs/ içini temizle (demo/data hariç) ve public/ dosyalarını kopyala */
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (!KEEP.has(f)) fs.rmSync(path.join(OUT, f), { recursive: true, force: true });
if (fs.existsSync(path.join(OUT, 'demo'))) for (const f of fs.readdirSync(path.join(OUT, 'demo'))) if (f !== 'data') fs.rmSync(path.join(OUT, 'demo', f), { recursive: true, force: true });
fs.cpSync(PUB, OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'demo'), { recursive: true });

/* 2) Kök-mutlak varlık yollarını göreli yap */
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === 'data' && d.endsWith('demo') ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
for (const f of walk(OUT)) {
  if (!/\.(html|css|js)$/.test(f)) continue; let s = fs.readFileSync(f, 'utf8'); const o = s;
  if (f.endsWith('.css')) s = s.replace(/url\((['"]?)\/(fonts|brand|css)\//g, 'url($1../$2/');
  else s = s.replace(/(["'`])\/(brand|fonts|css|js)\//g, '$1$2/').replace(/(["'`])\/brand\.css/g, '$1brand.css');
  if (s !== o) fs.writeFileSync(f, s);
}

/* 2b) Kapsam: demoda faturalama / ödeme / fiyat ekranları gösterilmez */
const patch = (f, fn) => { const p = path.join(OUT, f); if (!fs.existsSync(p)) return; const o = fs.readFileSync(p, 'utf8'), n = fn(o); if (n === o) console.warn('uyarı: yama uygulanamadı:', f); fs.writeFileSync(p, n); };
patch('js/views/yonetim.js', s => s.replace(/\['faturalama', 'adm\.billing'\],\s*/, ''));
patch('js/views/landing.js', s => s.replace(/<section class="lp-sec" id="pricing">[\s\S]*?<\/section>/, '').replace(/<a class="l" href="#pricing" data-go="pricing">[^<]*<\/a>/, ''));

patch('js/views/bulten.js', s => s.replace(/<iframe class="prev"([^>]*?) src="\/api\//, '<iframe class="prev"$1 data-src="/api/'));

/* 2c) Metin ve veri temizliği: sitede "demo/örnek" ibaresi kalmaz (başlıklar, şeritler, kurum/kişi adları, etiketler) */
const REPL = [[/Demo Banka A\.Ş\. \(DEMO\)/g, 'Kuzey Anadolu Bankası A.Ş.'], [/Demo Banka A\.Ş\./g, 'Kuzey Anadolu Bankası A.Ş.'], [/demo-banka\.example/g, 'kuzeyanadolu.example'],
  [/Örnek Şube 1 \(DEMO\)/g, 'Kadıköy Şubesi'], [/Örnek Şube 2 \(DEMO\)/g, 'Ataşehir Şubesi'], [/Örnek Şube 3 \(DEMO\)/g, 'Bornova Şubesi'], [/Örnek Şube (\d+)/g, 'Şube $1'],
  [/ \(DEMO\)/g, ''], [/DEMO · /g, ''], [/DEMO kuruluşu oluşturuldu/g, 'Kuruluş oluşturuldu'], [/DEMO – örnek görev/g, ''], [/DEMO – örnek iş akışı kaydı/g, ''], [/DEMO kaydı\./g, 'Kayıt oluşturuldu.'], [/^demo$/, 'kab'], [/"demo"/g, '"kab"'], [/Olası eşleşme incelemesi \(örnek\)/g, 'Olası eşleşme incelemesi'],
  [/Doc2 örnek yazışması/g, 'Doc2 yazışması'], [/SAMPLE STAR/g, 'ANATOLIAN STAR'], [/sample-customers\.csv/g, 'musteri-listesi.csv'], [/ornek-musteriler\.csv/g, 'musteri-listesi.csv'], [/ORNEK-(\d+)/g, 'MST-$1']];
const clean = x => { if (typeof x === 'string') { for (const [a, b] of REPL) x = x.replace(a, b); return x; } if (Array.isArray(x)) return x.map(clean); if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x)) { if (k === 'demo' || k === 'sample') { if (k === 'sample' && typeof x[k] !== 'boolean') o[k] = clean(x[k]); continue; } o[clean(k)] = clean(x[k]); } return o; } return x; };
const DD = path.join(OUT, 'demo', 'data');
try {
  const ap = path.join(DD, 'api.json'), api = clean(JSON.parse(fs.readFileSync(ap, 'utf8')));
  for (const u of [api['/status']?.user, ...(api['/users']?.users || [])]) if (u) u.demo = undefined;
  if (api['/translate/info']) Object.assign(api['/translate/info'], { provider: 'none', configured: false });
  fs.writeFileSync(ap, JSON.stringify(api));
  const cp = path.join(DD, 'sample-customers.csv'); fs.writeFileSync(cp, clean(fs.readFileSync(cp, 'utf8')));
} catch (e) { console.warn('veri temizliği uygulanamadı:', e.message); }
/* arayüz metinleri (TR/EN/AR): demo ifadeleri nötr karşılıklarla değişir */
const STR = {
  'lp.cta': ['Görüşme talep edin', 'Request a call', 'اطلب اجتماعًا'], 'lp.tryDemo': ['Giriş yap', 'Sign in', 'تسجيل الدخول'], 'lp.demoTitle': ['Bize ulaşın', 'Get in touch', 'تواصل معنا'],
  'lp.kvkk': ['Verileriniz yalnızca bu talep için kullanılır (KVKK/GDPR).', 'Your data is used only for this request (KVKK/GDPR).', 'تُستخدم بياناتك لهذا الطلب فقط (KVKK/GDPR).'],
  'lp.shotCap': ['Bugün ekranı.', 'The Today view.', 'شاشة «اليوم».'], 'demo.banner': ['', '', ''], 'login.demoTitle': ['', '', ''], 'login.demoText': ['', '', ''], 'rep.demoNote': ['', '', ''],
  'adm.sub': ['Kuruluş, kullanıcılar, şubeler, mevzuat, entegrasyonlar ve güvenlik.', 'Organisation, users, branches, regulation, integrations and security.', 'المؤسسة والمستخدمون والفروع والتشريعات والتكاملات والأمان.'], 'ctl.sampleLoaded': ['Liste yüklendi', 'List loaded', 'تم تحميل القائمة'], 'common.sampleData': ['', '', ''], 'ctl.sampleBanner': ['', '', ''], 'ctl.useSample': ['Örnek müşteri listesini yükle', 'Load the sample customer list', 'تحميل قائمة العملاء النموذجية'] };
['tr', 'en', 'ar'].forEach((lg, i) => patch('js/i18n/' + lg + '.js', src => { for (const [k, v] of Object.entries(STR)) src = src.replace(new RegExp('("' + k.replace('.', '\\.') + '": )"(?:[^"\\\\]|\\\\.)*"'), (m0, a) => a + JSON.stringify(v[i])); return src; }));
patch('js/views/login.js', s => s.replace(/\$\{!ticket \? h`<div class="callout info"[^`]*login\.demoTitle[^`]*`\s*:\s*''\}/, ''));
patch('js/views/raporlar.js', s => s.replace(/\s*<div class="callout info" style="margin-top:18px">\$\{t\('rep\.demoNote'\)\}<\/div>/, ''));

/* 3) brand.css (sunucuda dinamik üretilir) */
try { fs.writeFileSync(path.join(OUT, 'brand.css'), require(path.join(SRC, 'lib', 'brand')).css()); } catch (e) { console.warn('brand.css üretilemedi:', e.message); fs.writeFileSync(path.join(OUT, 'brand.css'), ':root{--navy:#0B1F3A;--gold:#C6A15B}'); }

/* 4) index.html: demo kabuğu */
let ix = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
ix = ix.replace('<script src="js/boot.js"></script>', '<script src="demo/engine.js"></script>\n<script src="demo/shim.js"></script>\n<script src="js/boot.js"></script>');
ix = ix.replace(/<title>.*?<\/title>/, '<title>Diurna</title>').replace('</head>', '<meta name="robots" content="noindex">\n</head>');
fs.writeFileSync(path.join(OUT, 'index.html'), ix);
fs.writeFileSync(path.join(OUT, '404.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=./"><a href="./">Diurna</a>');
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

/* 5) shim + tarayıcı motoru (sunucu kütüphanelerinin saf JS modülleri, Node bağımlılıkları taklit edilerek) */
fs.copyFileSync(path.join(ROOT, 'demo', 'shim.js'), path.join(OUT, 'demo', 'shim.js'));
const MODS = ['match', 'util', 'i18n', 'customers', 'trade', 'dd'];
let eng = '/* Otomatik üretildi (scripts/build-static-demo.js): lib/*.js saf modüllerinin tarayıcı paketi */\n(function(){\n"use strict";\nconst defs = {};\n';
for (const m of MODS) { const src = fs.readFileSync(path.join(SRC, 'lib', m + '.js'), 'utf8'); eng += `defs[${JSON.stringify(m)}] = function (module, exports, require, __dirname) {\n${src}\n};\n`; }
eng += fs.readFileSync(path.join(ROOT, 'demo', 'engine-core.js'), 'utf8') + '\n})();\n';
fs.writeFileSync(path.join(OUT, 'demo', 'engine.js'), eng);

const size = d => fs.readdirSync(d, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log('docs/ hazır:', (size(OUT) / 1048576).toFixed(1), 'MB');
