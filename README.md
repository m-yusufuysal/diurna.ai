# Diurna — Yaptırım ve Uyum İstihbarat Merkezi

> **Bugün ne değişti. Şimdi ne yapmalı.**
> Bankalar ve şubeler için (Türkiye ve Körfez) çok kiracılı, koltuk başı fiyatlı yaptırım/uyum konsolu: günlük bülten, müşteri tabanı tespiti (*base tespiti*), ticaret ve gemi kontrolü, muhabir banka DD, görevler, raporlar.

**Marka:** “Diurna” nihai ad olarak uygulanmıştır (Latince *diurna* = “günlük”; Roma'nın resmî günlük duyuruları *Acta Diurna*). Ad, açıklama, slogan, renkler ve logo **tek yerden** değişir: `config/brand.json` + `public/brand/`. Marka araştırması: `/workspace/brand-research.md` (ticari marka/alan adı taraması hukuki tescil görüşü değildir; kullanıma almadan önce yetkili vekile kontrol ettirin).

> ⚠️ **Bu bir çalışan prototip/ürün iskeletidir.** Aşağıdaki “Yer tutucular ve sınırlar” bölümünü okuyun. Yaptırım verisi **uydurulmaz**: listeler resmî kaynaklardan canlı çekilir; DEMO kurumun müşteri/kullanıcı/görev verisi örnektir ve arayüzde “DEMO / ÖRNEK VERİ” olarak etiketlidir.

## 1. Kurulum ve çalıştırma (tek komut)

Gereksinim: **Node.js 20+** (test: 24).

```bash
unzip uyum-merkezi.zip && cd uyum-merkezi
npm install --omit=dev        # argon2 + nodemailer (yalnızca 2 bağımlılık)
node server.js                # varsayılan http://127.0.0.1:3000
```

İlk açılışta DEMO kurum oluşturulur ve kaynaklar (OFAC, UK, AB, BM, FATF) **kendiliğinden** çekilmeye başlar (soğuk başlangıçta ~1 dk; **manuel yenile düğmesi yoktur**). Eşleşmeler liste yüklenince otomatik hesaplanır.

### Demo kullanıcıları (hepsinin parolası: `Uyum-Demo#2026`, `UM_DEMO_PASSWORD` ile değiştirilir)
| E-posta | Rol |
|---|---|
| admin@demo-banka.example | Admin |
| yonetici@demo-banka.example | Uyum Yöneticisi |
| analist1@demo-banka.example, analist2@demo-banka.example | Analist |
| istirak@demo-banka.example | Okuyucu (yalnızca iştirak versiyonu) |

> **Üretimde** demo kullanıcılarını kullanmayın; `UM_DEMO_PASSWORD` verin ya da demo kurumu kaldırın. Dört göz için bülteni farklı iki kullanıcıyla hazırlayıp onaylayın.

### Ortam değişkenleri
| Değişken | Anlam |
|---|---|
| `PORT`, `HOST` | Dinleme portu/adresi (varsayılan 3000 / 127.0.0.1) |
| `UM_DATA_DIR` | Veri dizini (varsayılan `./data`) |
| `UM_DATA_KEY` | **32 bayt** AES-256-GCM anahtarı (base64/hex). Yoksa yerel geliştirme anahtarı üretilir ve uyarı verilir |
| `UM_FORCE_SECURE=1` | Çerezi `Secure` + `__Host-` önekli yapar, HSTS ekler (TLS arkasında) |
| `UM_TRUST_PROXY=1` | `X-Forwarded-For/Proto` başlıklarına güven (ters vekil arkasında) |
| `UM_SMTP_HOST/PORT/USER/PASS/FROM` | Gerçek e-posta için SMTP (nodemailer). Yoksa e-postalar **giden kutusuna** yazılır ve uygulama içinde önizlenir |
| `UM_TZ` | Gün sınırı saat dilimi (varsayılan `Europe/Istanbul`) |
| `UM_POLL_NEWS_MIN`, `UM_POLL_LISTS_MIN` | Haber (≥5 dk, varsayılan 10) ve tam liste (≥30 dk, varsayılan 60) yoklama sıklığı |
| `UM_DEMO_PASSWORD` | Demo kullanıcı parolası (≥12 karakter, politikaya uygun) |
| `UM_CACHE_DIR` | Küresel önbellek dizini (liste dosyaları, varlık deposu, HTTP önbelleği; varsayılan `./data/cache`) |
| `UM_CONTACT` | Dış kaynaklara giden `User-Agent` içindeki iletişim adresi (**kurumunuzunkini yazın**) |
| `UM_HOST_MIN_GAP_MS` | Host başına asgari istek aralığı (varsayılan host'a göre 1,5–10 sn) |
| `UM_FALLBACK_OPENSANCTIONS=1`, `UM_FALLBACK_AFTER_HOURS` | Birincil liste N saatten (varsayılan 36) uzun süre alınamazsa OpenSanctions yedeği (**ticari lisans gerekir**) |
| `UM_OPENSANCTIONS_DATASETS` | Virgüllü ek OpenSanctions veri kümeleri (`os_<ad>` olarak izlenir; örn. `peps`) |
| `UM_CSL_URL` | trade.gov CSL adresini geçersiz kıl |
| `UM_TRANSLATE_PROVIDER` (`deepl`/`azure`/`google`/`libretranslate`), `UM_DEEPL_KEY`, `UM_AZURE_TRANSLATOR_KEY/_REGION/_ENDPOINT`, `UM_GOOGLE_TRANSLATE_KEY`, `UM_LIBRETRANSLATE_URL/_KEY`, `UM_TRANSLATE_PUBLIC=1` | Çeviri sağlayıcısı (aşağıda “Çeviri”) |
| `UM_TRANSLATE_ALLOW_EXTERNAL_CONFIDENTIAL=1` | Gizli içeriğin (DD, bülten, görev, not) harici sağlayıcıya gitmesine izin ver (varsayılan **kapalı**) |
| `UM_EXTERNAL_LOOKUPS=0`, `UM_INTERPOL=1` | Kontrol ekranındaki GDELT/Interpol isim aramalarını kapat / Interpol'ü aç (varsayılan: GDELT açık-tıklamayla, Interpol kapalı) |
| `UM_OPENSANCTIONS_TR=1` | MASAK yansısını (OpenSanctions `tr_fcib`) açar — **yalnızca değerlendirme**; ticari kullanım OpenSanctions lisansı gerektirir |

`npm test` → güvenlik temelleri ve i18n eşitliği için hızlı kendi kendine test.

## 2. Ekranlar (7 ana menü)
**Bugün** (kişisel “bugün senin için”: gelişmeler, yapılacaklar, izleme isabetleri, başlangıç ipuçları) · **Bülten** (TR/EN/AR taslak; iç ve iştirak versiyonu; “Base tespiti: var/yok”; dört göz onayı; HTML/yazdır/e-postaya kopyala; değiştirilemez arşiv + SHA-256) · **Kontrol** (müşteri tabanı CSV, toplu/tekil arama, ticaret GTİP-HS/IMO/FATF/sınır kapısı + analist notu, muhabir banka DD) · **Görevler** (SLA, yorum, çözüm gerekçesi, bildirimler) · **Raporlar** (analitik/KPI, ROI-tasarruf, şube raporu, denetim izi) · **Kaynaklar** (dizin, canlı kaynak durumu, FATF, sınır kapıları, ülke mevzuat katmanı) · **Yönetim** (kuruluş, kullanıcılar, şubeler, listeler + kurum içi engelleme listesi, mevzuat/veri yerleşimi, faturalama, entegrasyon: API/webhook, güvenlik). Kullanıcıya özel ayarlar **Ayarlarım**'da (bildirim kuralları, izleme listesi, günlük e-posta, MFA/parola/oturumlar).

Herkese açık sayfalar: tanıtım/fiyat/güvenlik/demo talep (`#/`), **durum sayfası** (`#/durum`).

### CSV içe aktarma
Şablon indirme → sürükle-bırak → **sütun eşleme** → satır bazlı doğrulama raporu (hata/uyarı) → içe aktarma. Toplu aramada sonuçlar CSV olarak indirilir (formül enjeksiyonu korumalı). Limitler: 10 MB, 20.000 satır; UTF-8/Windows-1254 algılanır.

### Diller
TR, EN, **AR (sağdan sola)**; `public/js/i18n/{tr,en,ar}.js` (820 anahtar, eşitlik `npm test` ile doğrulanır). Yeni dil: aynı anahtarlarla yeni dosya + `core.js` içindeki `DICTS`/`DIR`. Bülten dili TR/EN/AR (`lib/i18n.js`). *Ticaret notu taslağı şu an AR seçilirse İngilizce üretilir.*

### Otomatik güncelleme
Zamanlayıcı (jitter + üstel geri çekilme) koşullu istekle (ETag/Last-Modified/özet) kaynakları izler; değişiklik **SSE** ile anında arayüze ve bildirimlere itilir; kaynak başarısız olursa önceki veri korunur ve durum “kısmi/hata” gösterilir.

## 3. Veri kaynakları — CANLI mı, yer tutucu mu?
Tüm kaynaklar **tek ortak çekimle** (kurumlar/kullanıcılar için ayrı değil) zamanlayıcıda yoklanır; durum **Kaynaklar → Kaynak durumu** ve herkese açık `/#/durum` sayfasında görünür.

| Kaynak | Yöntem | Durum |
|---|---|---|
| OFAC SDN | Sanctions List Service `SDN.CSV`+`ALT.CSV` (yansı: Hazine `sdn.csv`); Recent Actions HTML (robots'a uyar) | **CANLI** (listeler 60 dk, haber 10 dk) |
| OFAC Konsolide (SDN dışı) | `CONS_PRIM.CSV`+`CONS_ALT.CSV` | **CANLI** |
| ABD CSL (BIS Entity List, DPL, UVL, MEU, Dışişleri) | trade.gov `consolidated.csv`; Hazine/OFAC satırları ayıklanır (OFAC zaten ayrı) | **CANLI**; eşleştirmede varsayılan kapalı (Yönetim → Listeler) |
| Birleşik Krallık | UK Sanctions List XML + GOV.UK Search API | **CANLI** |
| AB | FSF konsolide CSV + EUR-Lex OJ L günlük görünümü (RSS yok; CELLAR SPARQL kullanılmadı) | **CANLI** (EUR-Lex 10 sn host aralığı nedeniyle tarama birkaç dakika sürer) |
| BM Güvenlik Konseyi | `consolidated.xml` + basın | **CANLI** |
| Kanada SEMA | resmî XML | **CANLI** |
| İsviçre SECO (SESAM) | resmî XML, çıkarılanlar elenir | **CANLI** |
| US Federal Register | resmî API (OFAC+BIS belgeleri) | **CANLI** |
| FATF | HTML tablo + yayın duyuruları; `data/fatf.json` elle doğrulanmış tablo | **CANLI haber / elle doğrulanan tablo** |
| Resmî Gazete | günlük içindekiler + son günler, anahtar kelime süzgeci | **CANLI** (içerik çıkarımı değil, ilan başlığı) |
| Sayfa izleme: EOCN/BAE, CBUAE, SAMA, NCTC/Katar, QCB, CBB, MASAK, DFAT, Japonya MOF | sayfa parmak izi + bağlantı farkı; `data/watch.json` düzenlenebilir; robots yasaklarsa çekilmez (EOCN şu an yasaklıyor → “elle takip”) | **KISMEN**: değişiklik uyarısı, yapılandırılmış liste **değil** |
| MASAK 6415/7262 listeleri | OpenSanctions `tr_fcib` (`UM_OPENSANCTIONS_TR=1`) | **İSTEĞE BAĞLI** (lisans); resmî API yok |
| OpenSanctions yedek / ek kümeler / PEP | `UM_FALLBACK_OPENSANCTIONS`, `UM_OPENSANCTIONS_DATASETS` | **İSTEĞE BAĞLI** (lisans) |
| GDELT olumsuz haber | Kontrol ekranında tıklamayla, 5 sn aralık, 6 sa önbellek | **CANLI (isteğe bağlı sorgu)** |
| Interpol kırmızı bülten | halka açık API; `UM_INTERPOL=1`; 403 verirse nazikçe hata | **KAPALI varsayılan / dış API 403 verebilir** |
| Japonya MOF, DFAT liste dosyası | yalnızca sayfa izleme (dosya ayrıştırıcısı yok) | **YER TUTUCU** |

### Varlık deposu (çekirdek) ve değişiklik geçmişi
`lib/entities.js`: tüm listelerdeki kişi/kuruluş/gemi/hava aracı kayıtları tek iç depoda (adlar+takma adlar, tür, program, IMO/BM ref., liste menşei, ilk/son görülme, çıkarılma tarihi). İlk alım **başlangıç** sayılır (sahte “yeni” patlaması olmaz); sonraki her senkronizasyonda `added/updated/removed/readded` günlüğü tutulur. Kaynaklar arası aynı varlık IMO, BM referansı veya katlanmış ad+tür ile bağlanır. Arayüz: **Kaynaklar → Veri motoru**; API: `GET /api/v1/entities`, `GET /api/v1/changes` (anahtar `Bearer`).

### Nazik ve dayanıklı çekim (hiçbir kaynak bizi engellememeli, site hep güncel kalmalı)
- **Resmî toplu dosya/API tercih edilir**; kazıma yalnızca başka yol yoksa ve **robots.txt'ye uyularak** (önbellek 24 sa, `Crawl-delay` dikkate alınır). Toplu dosya/API uçları robots dışı tutulur.
- **Tek ortak çekim**: bir kaynak, tüm kiracılar için bir kez çekilir; aynı URL için eşzamanlı istekler birleştirilir. Kullanıcı eylemi dış kaynağa istek tetiklemez (GDELT/Interpol/çeviri hariç, kullanıcı tıklaması + hız sınırı).
- **Koşullu istek** (ETag / If-Modified-Since + içerik özeti), **host başına hız sınırı + jitter**, genel eşzamanlılık 2, zamanlama aralıklarına jitter.
- **429/5xx**: üstel geri çekilme, `Retry-After` (saniye veya tarih) **zamanlayıcıyı da erteler**.
- **Dürüst User-Agent**: `Diurna/… (+iletişim)`; `UM_CONTACT` ayarlayın. Bot koruması (JS doğrulaması) algılanır, atlatılmaya çalışılmaz, kaynak “engelli” görünür.
- **Önbellek**: son başarılı veri her zaman korunur ve sunulur; başarısız çekim veriyi silmez.
- **Yansı/yedek**: OFAC için Hazine yansısı; `UM_FALLBACK_OPENSANCTIONS=1` ile birincil liste 36 sa'ten uzun alınamazsa OpenSanctions veri kümesine geçilir (arayüzde “yedek kaynak” etiketi). OpenSanctions verisi ticari kullanımda **lisans** gerektirir.
- **Bayat veri uyarıları ve sağlık alarmı** (`lib/health.js`): bir iş son başarıdan `max(3×aralık, 2 sa; liste 6 sa)` sonra “bayat”, ≥3 ardışık hatada “hata” sayılır → **tüm kullanıcılara bant**, Admin/Uyum Yöneticisi'ne **uygulama içi bildirim**, Admin'e **e-posta** (SMTP yoksa giden kutusu), toparlanınca bildirim; olay başına tek alarm. `/api/status.health` ve herkese açık durum sayfasında da görünür.
- **Doğrulama**: Yönetim ekranında host başına istek/son durum (Kaynaklar → Veri motoru → Nazik çekim politikası; `GET /api/fetch/stats`).

### Çeviri
Her haber, bülten kaydı, mevzuat metni ve DD cevabında **Çevir** düğmesi; hedef dil arayüz dilidir (TR/EN/AR). Orijinal görünür kalır, sonuç “Makine çevirisi · sağlayıcı” etiketiyle altına eklenir. Sağlayıcılar: DeepL, Azure Translator, Google, kurum içi **LibreTranslate/Argos** (`UM_LIBRETRANSLATE_URL`), isteğe bağlı kamuya açık LibreTranslate (`UM_TRANSLATE_PUBLIC=1`). Sağlayıcı yoksa düğme açık bir ayar mesajı verir. **Gizlilik politikası:** gizli türler (dd, bülten, görev, not) yalnızca kurum içi sağlayıcıya gider (aksi `UM_TRANSLATE_ALLOW_EXTERNAL_CONFIDENTIAL=1`); yalnızca halka açık metinler diske önbelleğe alınır; denetim izine yalnızca üst veri (tür, uzunluk, sağlayıcı) yazılır.

## 4. Mimari ve yönetişim ilkeleri
Çok kiracılı (kuruluş başına ayrı veri dizini), hiyerarşi **Genel Müdürlük → bölge → şube**, şube bazlı kullanıcı ve rapor. Eşleştirme **kural tabanlı ve açıklanabilir** (Jaro-Winkler + Türkçe katlama + gürültü kelime ağırlığı; her eşleşme için neden kodları). **Otomatik karar yoktur**: bülten, görev kapanışı, ticaret notu ve muhabir banka yanıtları insan onayı ister; dört göz ilkesi yapılandırılabilir; her işlem hash zincirli denetim izine yazılır. Ayrıntı: **`SECURITY.md`** (ISO 27001, SOC 2, BDDK, KVKK, GDPR, OWASP eşlemesi).

Kurumsal dağıtım: veri yerleşimi seçenekleri (kurum içi / ülke içi bulut) Yönetim → Mevzuat ve veri'de kayıt olarak tutulur; fiziksel dağıtım sizin altyapınızda yapılır. **TLS için ters vekil kullanın** (örnek: nginx `proxy_pass http://127.0.0.1:3000;` + `X-Forwarded-*` başlıkları, `UM_TRUST_PROXY=1`, `UM_FORCE_SECURE=1`).

## 5. REST API ve webhook
Yönetim → Entegrasyon'da anahtar üretin (`Authorization: Bearer um_live_…`; değer bir kez gösterilir). Uç noktalar uygulama içinde listelenir (örn. `POST /api/v1/screen` — **ödeme/mesaj alanı taraması için devir noktası**). Webhook olayları: `item.new`, `match.hit`, `bulletin.approved`, `task.closed` (HMAC-SHA256 imzalı).

## 6. Markayı değiştirmek
`config/brand.json` (ad/açıklama/slogan TR-EN-AR, renkler, e-posta gönderen) ve `public/brand/*.svg` (logo, wordmark, favicon). Sunucu yeniden başlatılmadan CSS değişkenleri yenilenir.

**Tasarım dili ve yazı tipleri.** Editoryal-kurumsal bir dil: Lacivert #0B1F3A ana renk, şafak altını #C6A15B yalnızca vurgu (aktif gezinti işareti, kural çizgisi, odak halkası), krem zemin, nötr griler; kırmızı/kehribar yalnızca ürün içi risk durumlarında. Gölge ve degrade yok, 1 px ince çizgiler, 4–6 px köşe yarıçapı, tabular rakamlar. Başlık/wordmark: **Source Serif 4**; arayüz: **IBM Plex Sans**; Arapça: **IBM Plex Sans Arabic**; kod: IBM Plex Mono. Hepsi `public/fonts/` altında kendi sunucumuzdan (woff2; latin + latin-ext, yani Türkçe ğ ş İ ı tam desteklenir; üçüncü taraf CDN yok) ve SIL OFL 1.1 lisanslıdır. Simgeler Lucide (ISC), 1,5 px çizgi. Logo: serif “Diurna” + “D ve ufuk çizgisi” işareti (gün doğumu); `public/brand/` içinde `logo.svg`, `logo-light.svg`, `logo-mono.svg` (tek renk, `currentColor`), `wordmark*.svg` (metin yola çevrilmiştir), `favicon.svg`.

## 7. Rakip araştırmasındaki 18 “olmazsa olmaz”ın durumu
| # | Özellik | Durum |
|---|---|---|
| 1 | Kaynak güncelliği + zaman damgası, otomatik yenileme | ✅ (delta: tüm listeler için varlık deposunda ekleme/güncelleme/çıkarma günlüğü; OFAC `/changes/latest` **kullanılmadı**, tam dosya farkı alınır) |
| 2 | UKSL (OFSI değil) | ✅ |
| 3 | OFAC (SDN + SDN dışı), UKSL, AB, BM, FATF, MASAK | ✅ (+ CSL, Kanada, İsviçre, Federal Register) / ⚠️ MASAK yapılandırılmış veri yalnızca lisanslı OpenSanctions yansısıyla (varsayılan kapalı) |
| 4 | Ayarlanabilir bulanık eşleştirme | ✅ eşik, ikincil alanlar (IMO); doğum yılı/ulus­luk puanı sınırlı; AR/RU/ZH harf çevirisi **yok** |
| 5 | Müşteri defteri tarama + yeniden tarama | ✅ |
| 6 | Vaka yönetimi, dört göz, denetim izi | ✅ (kanıt paketi dışa aktarımı: denetim izi CSV/JSON) |
| 7 | RBAC, kiracı izolasyonu, SSO | ✅ / SSO **yer tutucu** |
| 8 | API + toplu + arayüz | ✅ |
| 9 | Kurum içi engelleme listesi | ✅ (Yönetim → Listeler) |
| 10 | Bildirim + günlük özet e-posta | ✅ |
| 11 | Sahiplik / %50 kuralı | ⚠️ pratik ilk sürüm: Kontrol → Sahiplik (%50) girilen pay yüzdelerini toplar (≥%50 engel, %25–50 EDD); **zincirleme sahiplik grafı yok** |
| 12 | Gemi/IMO | ✅ (derin AIS: Seasearcher vb. bağlantı) |
| 13 | On-prem / yurt içi veri yerleşimi | ✅ seçenek kaydı + on-prem çalışma; fiziksel dağıtım size ait |
| 14 | Liste kapsamı | ✅ (Yönetim → Listeler; **risk iştahı/puan eşiği liste bazında değil**, kuruluş genelinde) |
| 15 | Yönetim MI | ✅ |
| 16 | PEP / olumsuz haber | ⚠️ olumsuz haber: GDELT isteğe bağlı sorgu (anahtar kelime, doğrulama gerekir); PEP: yalnızca isteğe bağlı OpenSanctions `peps` kümesi (lisans) — **dahili PEP veritabanı yok**; World-Check bağlantısı |
| 17 | Ödeme/mesaj alanı taraması | ⚠️ `POST /api/v1/screen` devir noktası; SWIFT/ISO 20022 ayrıştırma **yok** |
| 18 | OpenSanctions yeniden dağıtım lisansı | ⚠️ varsayılan KAPALI; ticari kullanımda lisans bütçelenmeli |

## 8. Yer tutucular ve sınırlar (açık liste)
- **Marka/ticari marka:** “Diurna” ad ve logosu henüz hukuki tescil kontrolünden geçmemiştir; yasal şirket adı, destek e-postası ve gönderen adresleri **yer tutucudur**.
- **SSO (SAML/OIDC):** yalnızca ayar alanı; çalışmaz.
- **Ödemeler (Stripe/iyzico):** yalnızca arayüz; gerçek tahsilat yok. **Fiyatlar (49/149 USD/koltuk) ve planlar yer tutucudur.** Faturalar “DEMO”.
- **Körfez yerel listeleri:** yapılandırılmış liste çekimi yok; yalnızca düzenleyici/mevzuat katmanı + resmî sayfa **değişiklik izleme** (robots izin verirse). EOCN sayfası robots.txt ile otomasyonu yasakladığı için elle takip gerekir. Mevzuat özetleri hukuki görüş değildir; güncel metinden doğrulanmalıdır.
- **MASAK:** resmî API yok; OpenSanctions yansısı lisans gerektirir (varsayılan kapalı).
- **Dahili PEP veritabanı, sahiplik zincir grafı, ödeme mesajı (SWIFT/ISO 20022) ayrıştırma, AR/RU/ZH harf çevirisi, liste bazında eşik:** yok.
- **Çeviri** sağlayıcı anahtarı olmadan çalışmaz (düğme ayar mesajı verir); sağlayıcı ayarlanmadığı sürece çeviri **sahte üretilmez**.
- **Quick tunnel** (demo URL) kalıcı değildir; kalıcı kurulum için DEPLOY.md.
- **GTİP/HS veri seti:** AB ek listelerinden türetilmiş ön kontrol; hukuki görüş değildir.
- **FATF listeleri:** el ile doğrulanmış veri dosyası (`data/fatf.json`, doğrulama tarihi uygulamada görünür); her toplantıdan sonra güncellenmelidir.
- **Ticaret notu taslağı:** AR seçildiğinde İngilizce üretilir.
- **Demo veri:** kullanıcılar, görevler, KPI başlangıç değerleri ve 20 örnek müşteri **uydurmadır**; örnek müşteri adları gerçek liste kayıtlarıyla eşleşecek biçimde seçilmiştir (eşleştirme akışını göstermek için) ve bu müşteriler gerçek kişileri temsil etmez.
- **Tek düğüm JSON depolama**, bellek içi hız sınırlayıcı; çoklu düğüm/HA için veritabanı katmanı gerekir. Sızma testi yapılmamıştır.
- Gerçek e-posta göndermek için SMTP tanımlayın; aksi hâlde hiçbir e-posta dışarı gönderilmez (giden kutusu önizlemesi).

## 8b. Dağıtım
`Dockerfile`, `docker-compose.yml` ve **DEPLOY.md** (VPS + Docker, adlandırılmış Cloudflare Tunnel, quick tunnel; Vercel/serverless **uygun değildir**: zamanlayıcı, SSE ve dosya depolaması).

## 9. Dizin yapısı
`server.js` (HTTP, rotalar, REST API) · `lib/` (fetcher, health, entities, translate, watch, adverse, auth, security, store, scan, scheduler, lists, match, screening, bulletin, trade, dd, work, billing, mailer, brand, i18n, seed) · `public/` (arayüz: `js/views/*`, `js/i18n/*`, `css/app.css`, `brand/`) · `config/brand.json` · `data/` (yönetilen veri; `data/state` çalışma verisi, `data/cache` liste önbelleği) · `scripts/` (veri üretimi, `selftest.js`) · `screenshots/` · `SECURITY.md`.
