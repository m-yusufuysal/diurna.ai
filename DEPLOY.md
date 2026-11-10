# Diurna — Dağıtım (Deployment)

Diurna uzun süre çalışan bir Node.js sürecidir: arka plan **zamanlayıcı** (kaynak yoklama), **SSE** (canlı güncelleme) ve **dosya tabanlı depolama** kullanır.
Bu nedenle **Vercel / Netlify / Cloud Functions gibi sunucusuz (serverless) platformlara uygun değildir** — süreç ömrü kısadır, SSE kopar, yazılabilir kalıcı disk yoktur, zamanlayıcı çalışmaz.
Uygun olanlar: VPS, VM, Docker/Kubernetes, Fly.io/Railway/Render gibi kalıcı diskli konteyner platformları.

## 1. Hızlı: VPS + Docker Compose

```bash
git clone <depo> diurna && cd diurna
cat > .env <<EOF
UM_DATA_KEY=$(openssl rand -hex 32)      # veri şifreleme anahtarı — yedekleyin, kaybederseniz veri açılamaz
UM_CONTACT=uyum@bankaniz.example         # dış kaynaklara giden dürüst User-Agent'taki iletişim adresi
# UM_FALLBACK_OPENSANCTIONS=1            # birincil liste düşerse yedek (lisans notuna bakın)
# UM_TRANSLATE_PROVIDER=libretranslate  UM_LIBRETRANSLATE_URL=http://libretranslate:5000
# UM_SMTP_HOST=… UM_SMTP_USER=… UM_SMTP_PASS=… UM_SMTP_FROM=…
EOF
docker compose up -d --build
```
Uygulama `127.0.0.1:3000`'de dinler; dışarıya bir TLS sonlandırıcı (Caddy/nginx/Cloudflare Tunnel) açın.
Veri `diurna-data` biriminde kalıcıdır (`/app/data`). Yedek: birimi ve `UM_DATA_KEY`'i birlikte yedekleyin.

## 2. Kalıcı: Cloudflare Tunnel (adlandırılmış tünel)
Sunucuda açık gelen port gerekmez.
1. Cloudflare Zero Trust → Networks → Tunnels → *Create tunnel* (cloudflared). Bir token verir.
2. Public hostname: `diurna.alanadiniz.com` → Service `http://diurna:3000` (compose içinde) veya `http://localhost:3000`.
3. `.env` içine `TUNNEL_TOKEN=…` yazın ve `docker compose --profile tunnel up -d`.
4. İsteğe bağlı: Cloudflare Access ile kurum e-posta alan adına kısıtlayın (SSO'ya ek ikinci kapı).
`UM_TRUST_PROXY=1` ve `UM_FORCE_SECURE=1` (compose'da açık) sayesinde istemci IP'si ve HTTPS doğru algılanır, çerezler `Secure` olur.
SSE için Cloudflare'de ek ayar gerekmez (uygulama 25 sn'de bir yorum satırı gönderir).

## 3. Hızlı demo: Cloudflare quick tunnel
```bash
UM_TRUST_PROXY=1 PORT=3111 node server.js &   # X-Forwarded-Proto=https tünelden gelir → çerezler Secure
cloudflared tunnel --url http://localhost:3111      # https://<rastgele>.trycloudflare.com
```
Quick tunnel adresi her başlatmada değişir ve SLA'sızdır; yalnızca demo içindir.

## 4. Üretimde mutlaka
- `UM_DEMO_PASSWORD`'ü değiştirin ya da DEMO kurumunu yönetimden silin (varsayılan demo parolası dokümanlarda yayımlıdır).
- `UM_DATA_KEY`'i ortam/secret deposundan verin (dosyada `.datakey` yerine).
- SMTP ve çeviri sağlayıcısını yapılandırın; kaynak sağlığı uyarı e-postaları Admin'lere gider.
- Çıkış (egress) kuralı: `*.ofac.treas.gov, sanctionslist.fcdo.gov.uk, webgate.ec.europa.eu, scsanctions.un.org, data.trade.gov, www.international.gc.ca, www.sesam.search.admin.ch, www.federalregister.gov, data.opensanctions.org, api.gdeltproject.org, resmigazete.gov.tr` ve izlenen resmî sayfalar (`data/watch.json`).
- Süreç yöneticisi: Docker `restart: unless-stopped` (compose) ya da systemd/pm2.
- Veri yerleşimi: kurulumu hedef ülkede (TR/AE/SA…) barındırın; kurum bazında `dataResidency` ayarı yalnızca etiketler, fiziksel konumu siz seçersiniz.
