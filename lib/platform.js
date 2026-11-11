'use strict';
/* Çalışma zamanı (platform) yapılandırması: gün sınırı saat dilimi, yoklama sıklıkları, tarama penceresi. Ortam değişkenleriyle ayarlanır. */
const num = (v, d, min) => { const n = +v; return Number.isFinite(n) && n > 0 ? Math.max(min || 1, n) : d; };
module.exports = {
  tz: process.env.UM_TZ || 'Europe/Istanbul',
  pollNewsMinutes: num(process.env.UM_POLL_NEWS_MIN, 10, 5),     // haber/basın sayfaları: en az 5 dk
  pollListsMinutes: num(process.env.UM_POLL_LISTS_MIN, 60, 30),  // tam liste dosyaları: en az 30 dk
  scanDays: 14,                                                  // küresel tarama penceresi (kurum geriye bakışı en çok 14 gün)
};
