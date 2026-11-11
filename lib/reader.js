'use strict';
/* Uygulama içi okuyucu: haber / duyuru / mevzuat öğelerinin TAM metni. Kaynak sayfa nazikçe (robots.txt + hız sınırı: lib/fetcher) çekilir;
 * HTML → okunabilir düz metin (script/style/nav/form atılır, etiketler soyulur), PDF → pdftotext. Çıktı yalnızca DÜZ METİN paragraflarıdır
 * (HTML tutulmaz → betik/enjeksiyon olanağı yok; arayüzde textContent ile basılır). Önbelleğe alınır; çekilemezse en iyi özet + neden gösterilir. */
const fs = require('fs'); const os = require('os'); const path = require('path'); const cp = require('child_process');
const store = require('./store'); const U = require('./util'); const F = require('./fetcher');
const MAX_HTML = 3 * 1024 * 1024, MAX_PDF = 25 * 1024 * 1024, MAX_CHARS = 80000, TTL_OK = 14 * 864e5, TTL_FAIL = 6 * 3600e3;
const key = url => 'art-' + U.sha256(url).slice(0, 24) + '.json';
const privateHost = h => /^(localhost|.*\.local|.*\.internal)$/i.test(h) || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1|\[?fc|\[?fd)/.test(h);

function paragraphs(html) {
  let h = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript|svg|iframe|form|nav|header|footer|aside|button|select|template)\b[\s\S]*?<\/\1>/gi, ' ');
  const pick = re => { const m = re.exec(h); return m ? m[1] : null; };
  const main = pick(/<article\b[^>]*>([\s\S]*)<\/article>/i) || pick(/<main\b[^>]*>([\s\S]*)<\/main>/i) || pick(/<div[^>]+(?:id|class)=["'][^"']*(?:article-body|article-content|entry-content|post-content|page-content|field--name-body|main-content|content-body|body-content|news-detail|detail-content)[^"']*["'][^>]*>([\s\S]*)/i) || pick(/<body\b[^>]*>([\s\S]*)<\/body>/i) || h;
  const text = U.decodeEntities(main.replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/table|\/blockquote|\/dd|\/dt)\s*\/?>/gi, '\n').replace(/<\s*(p|li|h[1-6]|tr|div)\b[^>]*>/gi, '\n').replace(/<\/t[dh]>/gi, ' | ').replace(/<[^>]+>/g, ' '));
  const BOILER = /^(skip to|cookie|accept all|menu|search|share|print|follow us|sign up|subscribe|back to top|javascript|çerez|ana içeriğe|paylaş|yazdır|menü|arama)\b/i;
  const out = []; for (let l of text.split('\n')) { l = l.replace(/[ \t\u00a0]+/g, ' ').replace(/(\|\s*)+$/, '').trim(); if (!l || l.length < 3 || BOILER.test(l)) continue; if (out.length && out[out.length - 1] === l) continue; out.push(l); }
  return out;
}
const titleOf = html => { const m = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i.exec(html) || /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html) || /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html); return m ? U.decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 300) : ''; };

function pdfText(buf) {
  const f = path.join(os.tmpdir(), 'um-' + U.uid() + '.pdf');
  try { fs.writeFileSync(f, buf); const r = cp.spawnSync('pdftotext', ['-layout', '-enc', 'UTF-8', '-nopgbrk', f, '-'], { maxBuffer: 64 * 1024 * 1024, timeout: 60000, env: { PATH: process.env.PATH } }); if (r.error) throw Object.assign(new Error('pdftotext kurulu değil (poppler-utils)'), { code: 'nopdf' }); return r.stdout.toString('utf8'); }
  finally { try { fs.unlinkSync(f); } catch { } }
}

/* URL'den makale çıkar. Dönüş: {status:'full'|'excerpt', text, title, reason, kind, chars} — hata durumunda throw yerine status:'failed'. */
async function extract(url) {
  let u; try { u = new URL(url); } catch { return { status: 'failed', reason: 'Geçersiz adres' }; }
  if (!/^https?:$/.test(u.protocol) || privateHost(u.hostname)) return { status: 'failed', reason: 'Yalnızca herkese açık http(s) adresleri okunur' };
  try {
    if (u.hostname === 'masak.hmb.gov.tr' && !/\.(pdf|csv|xlsx?|docx?)$/i.test(u.pathname)) {   // JS tabanlı site: aynı içeriği resmî WordPress JSON uç noktasından oku
      const slug = decodeURIComponent(u.pathname.replace(/\/+$/, '').split('/').pop() || ''); let j = null;
      for (const ep of ['posts', 'pages']) { const rr = await F.request(`https://masak.hmb.gov.tr/portal/v2/${ep}?slug=${encodeURIComponent(slug)}&_fields=title,content,date`, { timeout: 45000, retries: 1, headers: { Accept: 'application/json' } }); if (rr.ok) { const a = await rr.json(); if (Array.isArray(a) && a[0]) { j = a[0]; break; } } }
      if (j) { const paras = paragraphs(j.content?.rendered || ''); const text = paras.join('\n\n'); const title = U.stripTags(j.title?.rendered || ''); return text.replace(/\s/g, '').length < 120 ? { status: 'excerpt', kind: 'html', title, text, chars: text.length, reason: 'MASAK sayfası ağırlıklı olarak tablo/dosya bağlantılarından oluşuyor; ayrıntı için orijinal sayfaya bakın.' } : { status: 'full', kind: 'html', title, text, chars: text.length }; }
    }
    const r = await F.request(url, { timeout: 45000, retries: 1, headers: { Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5' } });
    if (!r.ok) return { status: 'failed', reason: `Kaynak HTTP ${r.status} döndürdü` };
    const ct = (r.headers.get('content-type') || '').toLowerCase(); const len = +r.headers.get('content-length') || 0;
    const isPdf = ct.includes('pdf') || /\.pdf($|\?)/i.test(u.pathname);
    if (len > (isPdf ? MAX_PDF : MAX_HTML)) { try { r.body?.cancel(); } catch { } return { status: 'failed', reason: 'Belge çok büyük (' + Math.round(len / 1048576) + ' MB)' }; }
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > (isPdf ? MAX_PDF : MAX_HTML)) return { status: 'failed', reason: 'Belge çok büyük' };
    let paras, title = '', kind = isPdf ? 'pdf' : 'html';
    if (isPdf) { const t = pdfText(buf); paras = t.split(/\n{2,}/).map(x => x.replace(/[ \t]+/g, ' ').replace(/\n(?!\n)/g, ' ').trim()).filter(x => x.length > 2); }
    else if (/html|xml|text/.test(ct) || !ct) {
      let html = buf.toString('utf8'); const cs = /charset=([\w-]+)/i.exec(ct) || /<meta[^>]+charset=["']?([\w-]+)/i.exec(html.slice(0, 2048)); if (cs && !/utf-?8/i.test(cs[1])) { try { html = new TextDecoder(cs[1]).decode(buf); } catch { } }
      if (/Just a moment\.\.\.|Client Challenge|Request Rejected|Attention Required/i.test(html.slice(0, 3000))) return { status: 'failed', reason: 'Kaynak site otomatik erişimi engelliyor (bot koruması/WAF); saygı gösterilir, atlatılmaz' };
      title = titleOf(html); paras = paragraphs(html);
    } else return { status: 'failed', reason: 'Desteklenmeyen içerik türü: ' + ct.split(';')[0] };
    let text = paras.join('\n\n'); if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '\n\n[…metin kısaltıldı…]';
    if (text.replace(/\s/g, '').length < 400) return { status: 'excerpt', kind, title, text, chars: text.length, reason: 'Sayfadan yeterli metin çıkarılamadı (içerik JavaScript ile yükleniyor, görsel/taranmış belge veya çok kısa olabilir)' };
    return { status: 'full', kind, title, text, chars: text.length };
  } catch (e) {
    return { status: 'failed', reason: e.robots ? 'robots.txt bu yola otomatik erişime izin vermiyor (saygı gösterilir)' : e.timeout ? 'Zaman aşımı' : e.code === 'nopdf' ? e.message : (e.message || 'Bilinmeyen hata') };
  }
}

const pub = (item, a) => ({ id: item.id, title: item.title, date: item.date, source: item.source, url: item.url || '', status: a.status, reason: a.reason || '', kind: a.kind || '', chars: a.chars || 0, fetchedAt: a.fetchedAt,
  paragraphs: (a.text || '').split(/\n{2,}/).filter(Boolean), excerpt: typeof item.summary === 'string' ? item.summary : (item.summary?.tr || item.summary?.en || '') });
const inflight = new Map();
/* Öğe için makale: önbellek → (izin varsa) çek. opts.fetch=false → yalnızca önbellek. */
async function getFor(item, { fetch = true, force = false } = {}) {
  const k = key(item.url || item.id); let a = store.readCache(k, null);
  const fresh = a && (Date.now() - Date.parse(a.fetchedAt) < (a.status === 'failed' ? TTL_FAIL : TTL_OK));
  if (a && fresh && !force) return pub(item, a);
  if (!fetch || !item.url) return pub(item, a || { status: item.url ? 'pending' : 'failed', reason: item.url ? 'Henüz çekilmedi' : 'Bu öğenin bir kaynak adresi yok', fetchedAt: null });
  if (!inflight.has(k)) inflight.set(k, (async () => { const r = await extract(item.url); r.fetchedAt = new Date().toISOString(); store.writeCache(k, r); return r; })().finally(() => inflight.delete(k)));
  a = await inflight.get(k); return pub(item, a);
}
/* Alım sırasında arka planda: kaynak başına en yeni N öğenin tam metnini sırayla (nazik hız sınırıyla) çek. */
let prefetching = false;
async function prefetch(items, perSource = +process.env.UM_READER_PREFETCH || 6) {
  if (prefetching || process.env.UM_READER === '0') return; prefetching = true;
  try {
    const by = new Map(); for (const it of items) { if (!it.url || !/^https?:/.test(it.url)) continue; const k = it.srcKey || it.source; if (!by.has(k)) by.set(k, []); by.get(k).push(it); }
    for (const list of by.values()) for (const it of list.sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, perSource)) { const c = store.readCache(key(it.url), null); if (c && Date.now() - Date.parse(c.fetchedAt) < (c.status === 'failed' ? TTL_FAIL : TTL_OK)) continue; try { await getFor(it); } catch { } }
  } finally { prefetching = false; }
}
module.exports = { extract, paragraphs, getFor, prefetch, key };
