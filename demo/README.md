# Diurna – GitHub Pages demo

Sunucusuz, salt-okunur bir **demo**: `docs/` klasörü GitHub Pages'ten yayımlanır
(`https://m-yusufuysal.github.io/diurna.ai/`). Gerçek uygulamanın ön yüzü (`public/`) aynen kullanılır; `fetch('/api/…')`
ve `EventSource` çağrılarını `demo/shim.js` tarayıcıda yanıtlar.

| Katman | Kaynak |
|---|---|
| Ekran verisi (Bugün, Bülten, Görevler, Raporlar, Kaynaklar, Yönetim…) | `docs/demo/data/api.json` – demo kurumunun anlık görüntüsü |
| Resmî listeler (OFAC, UK, AB, BM, OFAC-Cons., BIS CSL, Kanada, İsviçre) | `docs/demo/data/lists/*.json` – gerçek liste anlık görüntüsü |
| Eşleştirme, tekil/toplu CSV tarama, müşteri tabanı taraması, sahiplik, ticaret kontrolü, DD taslağı | `lib/{match,customers,trade,dd,util,i18n}.js` **aynı kod**, tarayıcıda (`docs/demo/engine.js`) |
| Yazma işlemleri (görev, izleme, ayar, bülten onayı…) | bellekte; sayfa yenilenince sıfırlanır |
| Kapalı | e-posta, YZ özeti/çeviri, harici arama (GDELT/Interpol), PDF, SSO/MFA, gerçek kimlik doğrulama; faturalama/ödeme/fiyat ekranları gizli |

Giriş: demo girişi her bilgiyi kabul eder; gerçek parola/müşteri verisi pakette yoktur.

## Yenileme

```bash
# 1) çalışan bir sunucudan (demo kullanıcısı ile) anlık görüntü al
DEMO_BASE=http://127.0.0.1:3111 DEMO_USER=admin@demo-banka.example DEMO_PASS=… DEMO_CACHE=./data/cache node scripts/snapshot-demo.js
# 2) public/ → docs/ derle (kök-mutlak yollar göreli yapılır, shim + tarayıcı motoru eklenir)
node scripts/build-static-demo.js
```

`DEMO_SRC=/başka/kopya` ile `public/`, `lib/` ve `data/` başka bir dizinden okunabilir.
Boyut ≈ 11 MB (Pages sınırı 1 GB). GitHub'da: Settings → Pages → Branch: `main`, Folder: `/docs`.
