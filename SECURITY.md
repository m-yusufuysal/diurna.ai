# Diurna — Güvenlik Mimarisi ve Standart Eşlemesi

> **Durum:** Bu belge, kod tabanında **uygulanmış** kontrolleri ve **kurulumda sizin tamamlamanız gereken** kontrolleri ayırır. Bir sertifikasyon (ISO 27001, SOC 2) veya bağımsız sızma testi **yerine geçmez**; denetçiye sunulacak kanıt eşlemesidir. Hukuki görüş değildir.

## 1. Uygulanan kontroller

| Alan | Uygulama | Kod |
|---|---|---|
| Parola saklama | **Argon2id** (m=19 MiB, t=2, p=1); paket yoksa scrypt yedeği | `lib/auth.js` |
| Parola politikası | ≥12 karakter, büyük/küçük harf + rakam + sembol, yaygın kelime/e-posta parçası reddi; kuruluş uzunluğu artırabilir | `lib/security.js` |
| Kilitleme | 5 başarısız denemede hesap 15 dk kilitlenir; giriş IP başına 10 dk'da 20 deneme | `lib/auth.js`, `server.js` |
| MFA | TOTP (RFC 6238), kurtarma kodları (tek kullanımlık), tekrar kullanım (replay) koruması; kuruluş zorunlu kılabilir | `lib/auth.js`, `lib/security.js` |
| Oturum | `um_sid` / `__Host-um_sid` çerezi: **HttpOnly, SameSite=Strict**, HTTPS'te **Secure**; boşta kalma zaman aşımı (varsayılan 30 dk, 5–240) ve mutlak süre (12 sa); oturum belirteci sunucuda yalnızca SHA-256 özetiyle saklanır; tek tek/toplu oturum sonlandırma | `lib/auth.js` |
| CSRF | Oturuma bağlı belirteç (`X-CSRF-Token`) + `Origin` denetimi (durum değiştiren tüm isteklerde) | `server.js` |
| Başlıklar | CSP (`script-src 'self'`, satır içi betik yok, `frame-ancestors 'none'`, `base-uri 'none'`), HSTS (HTTPS'te), X-Frame-Options, X-Content-Type-Options, Referrer-Policy, COOP/CORP, Permissions-Policy | `lib/security.js` |
| Bülten önizleme | Sandbox'lı iframe + kendi kısıtlayıcı CSP'si; tüm şablonlar otomatik HTML-kaçışlı (`h` etiketli şablon) | `public/js/core.js`, `server.js` |
| Hız sınırı | IP: 900/dk, kullanıcı: 600/dk, ağır uç noktalar (CSV, toplu arama): 12/dk, giriş/MFA: 20/10 dk | `server.js` |
| Girdi doğrulama | Sunucuda tip/uzunluk/liste doğrulaması, gövde boyutu sınırı, CSV: UTF-8/Windows-1254 algılama, ikili dosya reddi, 10 MB ve satır sınırı, satır bazlı hata raporu | `server.js`, `lib/customers.js` |
| CSV enjeksiyonu | Dışa aktarımlarda `= + - @` ile başlayan hücreler önek ile etkisizleştirilir | `lib/security.js`, `public/js/core.js` |
| RBAC | Admin / Uyum Yöneticisi / Analist / Okuyucu — **her uç noktada sunucuda** denetlenir (arayüzde gizlemek yetmez); Okuyucu yalnızca iştirak versiyonunu görür | `lib/store.js`, `server.js` |
| Kiracı izolasyonu | `AsyncLocalStorage` ile istek başına kuruluş bağlamı; kuruluş verisi ayrı dizin; API anahtarı yalnızca kendi kuruluşuna çözülür | `lib/store.js` |
| Bekleyen veri şifreleme | **AES-256-GCM**: müşteri dosyası, SMTP parolası; anahtar `UM_DATA_KEY` (32 bayt, base64/hex) — KMS/HSM entegrasyonu için tek noktalı yer tutucu (`keyInfo`) | `lib/security.js` |
| IP izin listesi | Kuruluş bazında CIDR/IP listesi; reddedilen deneme denetim izine yazılır | `lib/security.js`, `server.js` |
| Denetim izi | **Hash zincirli** (her kayıt öncekinin SHA-256 özetini içerir), yalnızca eklenir; “Raporlar → Denetim izi”nde doğrulama; CSV/JSON dışa aktarım | `lib/store.js` |
| Günlük gizliliği | Günlüklere müşteri adı/kimlik yazılmaz (`mask`); denetim izinde yalnızca işlem türü ve nesne kimliği | `lib/security.js` |
| Sırlar | Yalnızca ortam değişkeni (`UM_*`); depoda sır yok; geliştirme anahtarı otomatik üretilirse konsola uyarı yazılır | `server.js` |
| API anahtarları | `um_live_…` biçiminde; **yalnızca SHA-256 özeti saklanır**, değer bir kez gösterilir; iptal edilebilir | `server.js` |
| Webhook | HMAC-SHA256 imzası (`X-UM-Signature`), http(s) hedef doğrulaması, metadata adresi engeli | `lib/work.js` |
| Bağımlılıklar | 2 doğrudan bağımlılık (argon2, nodemailer); `npm audit` → **0 zafiyet** (11 Kas 2026, UTC+4) | `package.json` |
| Yönetişim | Kural tabanlı, açıklanabilir eşleştirme (neden gösterilir); otomatik karar yok; bülten/görev kapanışı/ticaret notu insan onayı; dört göz ilkesi yapılandırılabilir | `lib/match.js`, `lib/bulletin.js` |

## 2. Sizin kurulumda yapmanız gerekenler (kod bunları sizin yerinize yapamaz)

1. **TLS**: Sunucuyu doğrudan internete açmayın; TLS 1.2+ sonlandıran ters vekil (nginx, HAProxy, bulut LB) arkasında çalıştırın ve `UM_TRUST_PROXY=1` + `UM_FORCE_SECURE=1` verin. Örnek `nginx`: `proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto https;`.
2. **`UM_DATA_KEY`**: 32 baytlık rastgele anahtar üretip KMS/HSM/gizli yönetim aracından ortama verin (`openssl rand -base64 32`). Anahtarı veriyle aynı diskte tutmayın. Anahtar kaybı = şifreli verinin kaybı; yedekleyin ve döndürme (rotation) prosedürü tanımlayın.
3. **Demo parolası**: `UM_DEMO_PASSWORD` ile değiştirin veya üretimde demo kuruluşunu oluşturmayın (yeni kurulumda tek ilk Admin hesabı açın).
4. **Yedekleme ve saklama**: `data/state` dizinini şifreli yedekleyin; saklama süreleri Yönetim → Güvenlik'te.
5. **Ağ**: Giden bağlantılar yalnızca resmî kaynak alanlarına (ofac.treasury.gov, sanctionslist.fcdo.gov.uk, webgate.ec.europa.eu, scsanctions.un.org, eur-lex.europa.eu, gov.uk, fatf-gafi.org) izin verilerek kısıtlanabilir.
6. **Sızma testi ve kod incelemesi**: Üretim öncesi bağımsız test yaptırın; bu depo bunu temsil etmez.
7. **SSO (SAML/OIDC)**: Yer tutucudur; kurumsal kurulumda kimlik sağlayıcıya bağlanır.

## 3. Standart eşlemesi (özet)

**Not:** “Karşılar” ifadesi, kontrolün teknik gereksinimi desteklediği anlamına gelir; uyumluluk organizasyonel süreçlerle birlikte sağlanır.

### ISO/IEC 27001:2022 — Ek A
| Madde | Kontrol | Karşılık |
|---|---|---|
| A.5.15 / A.5.18 | Erişim kontrolü, erişim hakları | RBAC, kullanıcı yaşam döngüsü (Yönetim → Kullanıcılar), pasifleştirme |
| A.5.17 | Kimlik doğrulama bilgileri | Argon2id, parola politikası, MFA |
| A.8.2 / A.8.5 | Ayrıcalıklı erişim, güvenli kimlik doğrulama | Admin rolü sınırlı; MFA zorunlu kılma; kilitleme |
| A.8.15 / A.8.16 | Günlükleme, izleme | Zincirli denetim izi, kaynak/uptime izleme |
| A.8.24 | Kriptografi kullanımı | AES-256-GCM, TLS (ters vekil), HMAC |
| A.8.26 / A.8.28 | Uygulama güvenliği, güvenli kodlama | CSP, CSRF, çıktı kaçışı, girdi doğrulama |
| A.8.12 | Veri sızıntısı önleme | Günlükte maskeleme, dışa aktarım denetim kaydı |
| A.5.34 | Gizlilik ve kişisel veri | KVKK/GDPR notları, saklama süreleri, kişisel veri dışa aktarımı |
| A.8.13 | Yedekleme | Kurulum sorumluluğu (bkz. §2) |

### SOC 2 (Trust Services Criteria — Security / Confidentiality)
CC6.1–CC6.3 (mantıksal erişim: RBAC, kiracı izolasyonu, kullanıcı yönetimi) · CC6.6–CC6.7 (sistem sınırı, veri aktarımı: başlıklar, TLS, IP izin listesi) · CC7.2–CC7.3 (izleme, olay tespiti: denetim izi, başarısız giriş kaydı) · CC8.1 (değişiklik yönetimi: kurulum sorumluluğu) · C1.1–C1.2 (gizlilik: şifreleme, saklama/silme).

### BDDK Bilgi Sistemleri Yönetmeliği (ve Bilgi Sistemleri Yönetimi Tebliği)
| Konu | Karşılık |
|---|---|
| Erişim yetkilendirme ve rol ayrımı | 4 rol, dört göz ilkesi, sunucu tarafı yetki |
| Kimlik doğrulama ve oturum güvenliği | Argon2id, MFA, boşta kalma zaman aşımı |
| Kayıt ve izleme (log) | Hash zincirli, dışa aktarılabilir denetim izi; 10 yıl saklama varsayılanı (ayarlanabilir) |
| Gizlilik ve veri sınıflandırma | Müşteri verisi şifreli; günlükte maskeleme |
| Veri yerleşimi / yurt içinde tutma | Kurum içi (on-prem) veya ülke içi bulut dağıtım seçeneği (Yönetim → Mevzuat ve veri) |
| Dış hizmet / bulut | Kurumsal kurulumda on-prem; SaaS ise ayrı dış hizmet değerlendirmesi gerekir |

### KVKK / GDPR
Hukuki sebep ve aydınlatma kurumun sorumluluğundadır (Diurna veri işleyen sıfatıyla çalışır). Teknik karşılıklar: veri minimizasyonu (müşteri dosyasında yalnızca eşleştirme alanları), şifreleme, erişim kısıtı, saklama süreleri sonunda otomatik silme, kişisel veri dışa aktarımı (“Ayarlarım → Profil”), müşteri verisini tek tıkla silme, denetim izi, veri yerleşimi seçenekleri. Demo talep formu yalnızca yerel olarak saklanır; üçüncü kişiye gönderilmez.

### OWASP ASVS 4.0 / Top 10 (2021)
| OWASP | Karşılık |
|---|---|
| A01 Erişim kontrolü bozukluğu | Her uç noktada sunucu tarafı rol ve kiracı denetimi |
| A02 Kriptografik hatalar | AES-256-GCM, Argon2id, rastgelelik için `crypto` |
| A03 Enjeksiyon | Veritabanı yok (JSON dosyası); çıktı kaçışı; CSV enjeksiyonu koruması; dosya yolu sabit |
| A04 Güvensiz tasarım | Tehdit odaklı: kilitleme, hız sınırı, dört göz |
| A05 Yanlış yapılandırma | Sıkı başlıklar, varsayılan kapalı IP/izin, sır yönetimi uyarısı |
| A06 Eski bileşenler | 2 bağımlılık, `npm audit` temiz |
| A07 Kimlik doğrulama hataları | MFA, kilitleme, parola politikası, oturum yenileme/iptal |
| A08 Bütünlük hataları | Zincirli denetim, bülten SHA-256 özeti, imzalı webhook |
| A09 Günlükleme/izleme | Denetim izi + canlı durum sayfası |
| A10 SSRF | Webhook hedefi yalnızca http(s) ve bulut metadata adresleri engelli; **özel IP aralıkları için ek engel kurulumda (çıkış güvenlik duvarı) uygulanmalıdır**; sunucu geri kalanda yalnızca sabit resmî kaynak adreslerine bağlanır |
| ASVS V2 / V3 / V4 / V5 / V7 / V8 / V9 / V12 / V13 | Parola, oturum, erişim, doğrulama, günlükleme, veri koruma, iletişim, dosya yükleme, API |

## 4. Bilinen sınırlar (dürüst liste)
- JSON dosya depolama tek düğüm içindir; yüksek erişilebilirlik / çoklu düğüm için veritabanı katmanı eklenmelidir.
- TLS uygulama içinde sonlandırılmaz (ters vekil gerekir).
- SSO, WebAuthn ve donanım güvenlik modülü (HSM) entegrasyonu yer tutucudur / yol haritasındadır.
- Bellek içi hız sınırlayıcı süreç yeniden başlayınca sıfırlanır; çok düğümde ortak depo gerekir.
- Sızma testi yapılmamıştır.

## 5. Zafiyet bildirimi
`config/brand.json` içindeki `supportEmail` adresine bildirin (yer tutucu; kurulumda gerçek bir güvenlik iletişim adresiyle değiştirin).


## Çıkış trafiği ve çeviri gizliliği (v2.1)
- **Dış istekler tek merkezden** (`lib/fetcher.js`): dürüst User-Agent, robots.txt, host başına hız sınırı, geri çekilme; kullanıcı girdisi hiçbir zaman keyfi URL'e istek tetiklemez (SSRF yüzeyi yok: URL'ler sabit kaynak tanımlarından gelir; `data/watch.json` yalnızca yönetici/dağıtımcı tarafından düzenlenir).
- **Müşteri verisi dışarı çıkmaz**: müşteri listeleri, eşleşme sonuçları ve toplu yüklemeler hiçbir dış servise gönderilmez. Kontrol ekranında GDELT/Interpol aramasında yalnızca kullanıcının tıkladığı **tek ismin** metni gider (`UM_EXTERNAL_LOOKUPS=0` ile kapatılır; denetim izine yazılır).
- **Çeviri**: gizli türler (DD, bülten, görev, not) varsayılan olarak yalnızca kurum içi (LibreTranslate/Argos) sağlayıcıya gönderilir; harici sağlayıcıya göndermek açık bir ortam değişkeni ister. Gizli metin diske önbelleğe alınmaz; denetim izine yalnızca üst veri yazılır; istek başına 6000 karakter / 20 metin sınırı, kullanıcı başına 60 istek/dk.
- **Kaynak sağlığı alarmı** olay başına tek bildirimdir; e-posta yalnızca Admin rolüne gider.
- Tünel/ters vekil arkasında `UM_TRUST_PROXY=1` yalnızca vekil istemci başlıklarını **kendisi ayarlıyorsa** kullanılmalıdır; doğrudan internete açık bırakmayın.
