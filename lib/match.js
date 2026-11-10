'use strict';
/* Bulanık isim eşleştirme: Türkçe karakter katlama, unvan/şirket türü ekleri temizliği,
 * token-seti + Jaro-Winkler hizalama, ters sıra ve kısaltma toleransı, token-indeksli aday seçimi. */

const FOLD = { 'İ': 'i', 'I': 'i', 'ı': 'i', 'Ş': 's', 'ş': 's', 'Ğ': 'g', 'ğ': 'g', 'Ç': 'c', 'ç': 'c', 'Ö': 'o', 'ö': 'o', 'Ü': 'u', 'ü': 'u', 'ß': 'ss', 'Ø': 'o', 'ø': 'o', 'Æ': 'ae', 'æ': 'ae', 'Ł': 'l', 'ł': 'l', 'Đ': 'd', 'đ': 'd' };
// Hukuki şekil / unvan gürültüsü (eşleştirmede önemsiz)
const NOISE = new Set(['as', 'a', 's', 'anonim', 'sirketi', 'sirket', 'ltd', 'sti', 'limited', 'llc', 'l', 'c', 'fzco', 'fze', 'fzc', 'fzllc', 'inc', 'corp', 'corporation', 'co', 'company', 'gmbh', 'sa', 'jsc', 'ooo', 'pjsc', 'ojsc', 'zao', 'ao', 'bv', 'nv', 'pte', 'pvt', 'plc', 'the', 'and', 've', 'tic', 'san', 'ticaret', 'sanayi', 'ltdsti', 'org', 'sdn', 'bhd', 'lp', 'llp', 'dmcc', 'kg', 'ag', 'srl', 'spa', 'oy', 'ab', 'as', 'a.s', 'ic', 'dis', 'mr', 'mrs', 'ms', 'dr', 'bay', 'bayan', 'sayin', 'al', 'el', 'bin', 'ibn', 'abu']);
const NOISE_STRONG = new Set(['as', 'a', 's', 'anonim', 'sirketi', 'sirket', 'ltd', 'sti', 'limited', 'llc', 'l', 'c', 'fzco', 'fze', 'fzc', 'inc', 'corp', 'corporation', 'co', 'company', 'gmbh', 'sa', 'jsc', 'ooo', 'pjsc', 'ojsc', 'zao', 'ao', 'bv', 'nv', 'pte', 'pvt', 'plc', 'the', 'and', 've', 'tic', 'san', 'ticaret', 'sanayi', 'sdn', 'bhd', 'lp', 'llp', 'dmcc', 'kg', 'ag', 'srl', 'spa', 'oy', 'ab', 'mr', 'mrs', 'ms', 'dr']);

function fold(s) {
  s = String(s || '');
  let out = '';
  for (const ch of s) out += FOLD[ch] !== undefined ? FOLD[ch] : ch;
  return out.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
// "A.Ş." → "as", "L.L.C." → "llc"
function normalize(s) {
  let t = fold(s);
  t = t.replace(/\b([a-z])\.(?=[a-z]\b|[a-z]\.)/g, '$1').replace(/\.(?=\s|$)/g, ' ');
  t = t.replace(/[^a-z0-9\u0400-\u04ff\u0600-\u06ff\s]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}
function tokens(s) {
  const t = normalize(s).split(' ').filter(Boolean);
  const core = t.filter(x => !NOISE_STRONG.has(x));
  return core.length ? core : t;
}

function jaro(a, b) {
  if (a === b) return 1;
  const la = a.length, lb = b.length; if (!la || !lb) return 0;
  const md = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const am = new Array(la).fill(false), bm = new Array(lb).fill(false);
  let m = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - md), hi = Math.min(lb - 1, i + md);
    for (let j = lo; j <= hi; j++) if (!bm[j] && a[i] === b[j]) { am[i] = bm[j] = true; m++; break; }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) if (am[i]) { while (!bm[k]) k++; if (a[i] !== b[k]) t++; k++; }
  t /= 2;
  return (m / la + m / lb + (m - t) / m) / 3;
}
function jw(a, b) {
  const j = jaro(a, b); if (j < 0.7) return j;
  let l = 0; while (l < 4 && l < a.length && l < b.length && a[l] === b[l]) l++;
  return j + l * 0.1 * (1 - j);
}
// Soundex benzeri iskelet (aday seçimi için): ilk harf + ünsüzler (tekrarsız)
function skeleton(tok) {
  const t = tok.replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
  return tok[0] + t.slice(1, 3);
}
function keys(tok) { return [tok.slice(0, 3), 'k:' + skeleton(tok)]; }

const GENERIC = new Set(['shipping', 'services', 'service', 'trading', 'trade', 'group', 'holding', 'holdings', 'international', 'global', 'logistics', 'marine', 'maritime', 'energy', 'oil', 'gas', 'petroleum', 'industrial', 'industries', 'industry', 'general', 'import', 'export', 'bank', 'finance', 'financial', 'investment', 'investments', 'technology', 'technologies', 'systems', 'solutions', 'enterprises', 'enterprise', 'commercial', 'transport', 'transportation', 'lojistik', 'denizcilik', 'nakliyat', 'enerji', 'petrol', 'insaat', 'uluslararasi', 'dis', 'ic', 'grup', 'yatirim', 'gida', 'tekstil', 'madencilik', 'otomotiv', 'turizm']);
const W = t => (GENERIC.has(t) ? 0.35 : 1);

/* İki token listesi arasında 0-100 skor + gerekçe (ağırlıklı, simetrik Dice benzeri) */
function scoreTokens(ta, tb) {
  if (!ta.length || !tb.length) return { score: 0, reasons: [] };
  const small = ta.length <= tb.length ? ta : tb, big = ta.length <= tb.length ? tb : ta;
  const used = new Set(); let M = 0, Ws = 0, Wb = big.reduce((a, t) => a + W(t), 0); let exact = 0, fuzzy = 0, abbr = 0; const pairs = [];
  for (const x of small) {
    Ws += W(x);
    let best = 0, bi = -1;
    for (let i = 0; i < big.length; i++) {
      if (used.has(i)) continue;
      let s = jw(x, big[i]);
      if (x.length === 1 && big[i][0] === x) s = Math.max(s, 0.8);
      else if (big[i].length === 1 && x[0] === big[i]) s = Math.max(s, 0.8);
      if (s > best) { best = s; bi = i; }
    }
    if (bi >= 0 && best >= 0.8) used.add(bi);
    const eff = best === 1 ? 1 : best >= 0.88 ? Math.pow(best, 2.5) : 0;
    M += eff * (bi >= 0 ? Math.min(W(x), W(big[bi])) : 0);
    if (best === 1) exact++; else if (best >= 0.88) fuzzy++;
    if (bi >= 0 && (x.length === 1 || big[bi].length === 1) && best < 1) abbr++;
    pairs.push([x, bi >= 0 ? big[bi] : '', best]);
  }
  const den = Ws + 0.3 * Math.max(0, Wb - Ws);
  let base = M / den;
  if (small.length === 1 && big.length > 1) base = Math.min(base, 0.8);   // tek tokenlı eşleşme zayıf kanıt
  const score = Math.round(Math.min(1, base) * 100);
  const extra = big.length - small.length;
  const reasons = [];
  if (exact === small.length && small.length === big.length) reasons.push('exact_all');
  else if (exact === small.length) reasons.push('subset|' + extra);
  else { if (exact) reasons.push('exact_n|' + exact); if (fuzzy) reasons.push('fuzzy_n|' + fuzzy); }
  if (abbr) reasons.push('abbr');
  return { score, reasons, pairs };
}

function orderDiffers(a, b) {
  const sa = a.join(' '), sb = b.join(' ');
  return sa !== sb && [...a].sort().join(' ') === [...b].sort().join(' ');
}

/* Liste girdileri için indeks. entries: [{id, names:[...], ...}] */
class NameIndex {
  constructor() { this.entries = []; this.byKey = new Map(); this.byImo = new Map(); this.tokenSets = []; this.keyTokens = new Map(); }
  add(entry) {
    const idx = this.entries.length;
    this.entries.push(entry);
    const tsets = [];
    for (const n of entry.names || entry.n || []) {
      const tk = tokens(n); if (!tk.length) continue; tsets.push(tk);
      for (const t of new Set(tk)) {
        for (const k of keys(t)) {
          let m = this.byKey.get(k); if (!m) { m = new Map(); this.byKey.set(k, m); }
          let s = m.get(t); if (!s) { s = []; m.set(t, s); }
          if (s[s.length - 1] !== idx) s.push(idx);
        }
      }
    }
    this.tokenSets[idx] = tsets;
    if (entry.imo) for (const i of [].concat(entry.imo)) { if (!this.byImo.has(i)) this.byImo.set(i, []); this.byImo.get(i).push(idx); }
  }
  candidates(tk) {
    const cand = new Map(); // idx -> hits
    for (const t of new Set(tk)) {
      if (t.length < 2) continue;
      const seen = new Set();
      for (const k of keys(t)) {
        const m = this.byKey.get(k); if (!m) continue;
        for (const [lt, list] of m) {
          if (seen.has(lt)) continue;
          const s = lt === t ? 1 : jw(t, lt);
          if (s >= 0.86) { seen.add(lt); for (const i of list) cand.set(i, (cand.get(i) || 0) + 1); }
        }
      }
    }
    return cand;
  }
  /* name ile eşleştir. opts: {threshold, limit, imo} */
  search(name, opts = {}) {
    const threshold = opts.threshold ?? 80, limit = opts.limit ?? 8;
    const out = [];
    if (opts.imo) {
      for (const i of [].concat(opts.imo)) for (const idx of this.byImo.get(String(i)) || []) out.push({ idx, score: 100, reasons: ['imo'], via: String(i), type: 'imo' });
    }
    const tk = tokens(name || '');
    if (tk.length) {
      const cand = this.candidates(tk);
      const minHits = tk.length >= 2 ? 1 : 1;
      let list = [...cand.entries()].filter(([, h]) => h >= minHits);
      if (list.length > 6000) list = list.sort((a, b) => b[1] - a[1]).slice(0, 6000);
      for (const [idx] of list) {
        let best = null;
        for (const ts of this.tokenSets[idx]) {
          const r = scoreTokens(tk, ts);
          if (!best || r.score > best.score) best = { ...r, other: ts };
        }
        if (best && best.score >= threshold) {
          const reasons = [...best.reasons];
          if (orderDiffers(tk, best.other)) reasons.push('order');
          out.push({ idx, score: best.score, reasons, via: best.other.join(' '), type: 'name' });
        }
      }
    }
    // idx başına en yüksek skor
    const m = new Map();
    for (const o of out) { const p = m.get(o.idx); if (!p || o.score > p.score) m.set(o.idx, o); }
    return [...m.values()].sort((a, b) => b.score - a.score).slice(0, limit).map(o => ({ entry: this.entries[o.idx], score: o.score, reasons: o.reasons, via: o.via, type: o.type }));
  }
}

function imoValid(s) {
  s = String(s || '').replace(/\D/g, ''); if (s.length !== 7) return false;
  let sum = 0; for (let i = 0; i < 6; i++) sum += +s[i] * (7 - i);
  return sum % 10 === +s[6];
}
function extractIMO(txt) {
  const out = new Set(); const re = /IMO[\s:#-]*([0-9]{7})\b/gi; let m;
  while ((m = re.exec(txt || ''))) out.add(m[1]);
  return [...out];
}

module.exports = { fold, normalize, tokens, jw, scoreTokens, NameIndex, imoValid, extractIMO };
