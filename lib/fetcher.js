'use strict';
/* Nazik ve dayanıklı HTTP katmanı — tüm dış kaynak istekleri buradan geçer.
 *  • Dürüst User-Agent + iletişim adresi (UM_CONTACT)         • robots.txt (Disallow/Allow, Crawl-delay) — resmî toplu dosya/API'ler (api:true) hariç
 *  • Ana makine (host) başına seri istek + asgari aralık + jitter  • 429/5xx: Retry-After'a uyan üstel geri çekilme
 *  • Aynı URL için eşzamanlı istekleri tek istekte birleştirme  • Zaman aşımı, Cloudflare/JS-doğrulama tespiti
 * Her kaynak tüm kiracılar için TEK kez (zamanlayıcıyla) çekilir; kullanıcı eylemi dış kaynağa istek tetiklemez. */
const crypto = require('crypto');
const contact = () => (process.env.UM_CONTACT || 'destek@example.com').trim();
const UA = () => `Mozilla/5.0 (compatible; DiurnaBot/2.0; sanctions-compliance-monitoring; contact: ${contact()})`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE_GAP = +process.env.UM_HOST_MIN_GAP_MS || 2500;
const GAPS = { 'api.gdeltproject.org': 5500, 'press.un.org': 4000, 'www.resmigazete.gov.tr': 4000, 'www.federalregister.gov': 1500, 'sanctionslistservice.ofac.treas.gov': 3000, 'data.opensanctions.org': 3000, 'eur-lex.europa.eu': 4000 };
const hosts = new Map(); const inflight = new Map(); const robotsC = new Map();
const H = h => { let s = hosts.get(h); if (!s) { s = { tail: Promise.resolve(), next: 0, gap: GAPS[h] || BASE_GAP, reqs: 0, last: null, fails: 0 }; hosts.set(h, s); } return s; };
async function gate(host, fn) {
  const st = H(host); const prev = st.tail; let release; st.tail = new Promise(r => release = r); await prev.catch(() => { });
  const w = st.next - Date.now(); if (w > 0) await sleep(w);
  try { st.reqs++; return await fn(); } finally { st.next = Math.max(st.next, Date.now() + Math.round(st.gap * (1 + Math.random() * 0.3))); release(); }
}
function parseRetryAfter(v) { if (!v) return 0; if (/^\d+$/.test(v.trim())) return Math.min(+v * 1000, 6 * 3600e3); const t = Date.parse(v); return isNaN(t) ? 0 : Math.max(0, Math.min(t - Date.now(), 6 * 3600e3)); }

function parseRobots(txt) {
  const groups = []; let cur = null; let lastWasUA = false;
  for (const raw of txt.split(/\r?\n/)) {
    const l = raw.replace(/#.*/, '').trim(); const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(l); if (!m) continue; const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!lastWasUA) { cur = { agents: [], rules: [], delay: 0 }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasUA = true; continue; }
    lastWasUA = false; if (!cur) continue;
    if (k === 'disallow') cur.rules.push({ allow: false, p: v }); else if (k === 'allow') cur.rules.push({ allow: true, p: v }); else if (k === 'crawl-delay') cur.delay = Math.min(60, +v || 0);
  }
  const mine = groups.filter(g => g.agents.some(a => a !== '*' && 'diurnabot'.includes(a.replace(/\/.*/, '')))); const star = groups.filter(g => g.agents.includes('*'));
  const use = mine.length ? mine : star; return { rules: use.flatMap(g => g.rules), delay: Math.max(0, ...use.map(g => g.delay), 0) };
}
function robotsOk(rb, pathq) {
  let best = null; for (const r of rb.rules) { if (!r.p) continue; const re = new RegExp('^' + r.p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')); if (re.test(pathq) && (!best || r.p.length > best.p.length || (r.p.length === best.p.length && r.allow))) best = r; }
  return !best || best.allow;
}
async function robots(u) {
  const c = robotsC.get(u.host); if (c && Date.now() - c.at < 24 * 3600e3) return c.rb;
  let rb = { rules: [], delay: 0 };
  try {
    const r = await gate(u.host, () => fetch(u.origin + '/robots.txt', { headers: { 'User-Agent': UA() }, signal: AbortSignal.timeout(10000) }));
    if (r.ok) { const t = await r.text(); if (!/<html/i.test(t.slice(0, 400))) rb = parseRobots(t.slice(0, 200000)); }
  } catch { /* erişilemiyorsa izin ver (standart davranış) */ }
  if (rb.delay) H(u.host).gap = Math.max(H(u.host).gap, rb.delay * 1000);
  robotsC.set(u.host, { at: Date.now(), rb }); return rb;
}

/* Çekirdek istek. Dönüş: Response (gövde okunmamış) — okuma çağıranın işi; 429/5xx için yeniden deneme burada. */
async function request(url, { method = 'GET', headers = {}, body, timeout = 30000, retries = 2, api = false, noRobots = false, maxWait = 45000 } = {}) {
  const u = new URL(url); let lastErr;
  if (!api && !noRobots) { const rb = await robots(u); if (!robotsOk(rb, u.pathname + u.search)) { const e = new Error('robots.txt bu yola otomatik erişime izin vermiyor'); e.robots = true; e.blocked = true; throw e; } }
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await gate(u.host, () => fetch(url, { method, body, redirect: 'follow', signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': UA(), 'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.8', ...headers } }));
      const st = H(u.host); st.last = { at: Date.now(), status: r.status };
      if (r.status === 429 || r.status === 503 || r.status === 502 || r.status === 504 || r.status === 500) {
        const ra = parseRetryAfter(r.headers.get('retry-after')); const back = ra || Math.min(60000, 2000 * 2 ** i) * (1 + Math.random() * 0.3); st.fails++;
        st.next = Math.max(st.next, Date.now() + back);
        const e = new Error('HTTP ' + r.status + (ra ? ` (Retry-After ${Math.round(ra / 1000)} sn)` : '')); e.status = r.status; e.retryAfterMs = Math.round(back); lastErr = e;
        try { r.body?.cancel(); } catch { }
        if (i < retries && back <= maxWait) { await sleep(back); continue; } throw e;
      }
      st.fails = 0; return r;
    } catch (e) {
      if (e.status) throw e; if (e.robots) throw e;
      lastErr = e.name === 'TimeoutError' || e.name === 'AbortError' ? Object.assign(new Error('Zaman aşımı'), { timeout: true }) : e;
      if (i < retries) { await sleep(Math.min(20000, 1500 * 2 ** i) * (1 + Math.random() * 0.3)); continue; }
    }
  }
  throw lastErr;
}
const CHALLENGE = /Just a moment\.\.\.|Client Challenge|cf-browser-verification|Attention Required! \| Cloudflare/i;
async function text(url, opts = {}) {
  const k = opts.asBuffer ? null : 'T|' + url + '|' + JSON.stringify(opts.headers || {}); if (k && inflight.has(k)) return inflight.get(k);
  const p = (async () => {
    const r = await request(url, opts);
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    const buf = Buffer.from(await r.arrayBuffer()); if (opts.asBuffer) return buf;
    const t = buf.toString('utf8'); if (CHALLENGE.test(t.slice(0, 4000))) { const e = new Error('Bot koruması (JS/Cloudflare doğrulaması) nedeniyle engellendi'); e.blocked = true; throw e; }
    return t;
  })();
  if (k) { inflight.set(k, p); p.finally(() => inflight.delete(k)).catch(() => { }); }
  return p;
}
function stats() { return [...hosts.entries()].map(([host, s]) => ({ host, requests: s.reqs, minGapMs: s.gap, lastStatus: s.last?.status || null, lastAt: s.last ? new Date(s.last.at).toISOString() : null, consecutiveFails: s.fails })); }
module.exports = { request, text, stats, UA, contact, parseRobots, robotsOk, parseRetryAfter, gate };
