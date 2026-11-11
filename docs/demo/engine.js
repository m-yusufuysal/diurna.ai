/* Otomatik üretildi (scripts/build-static-demo.js): lib/*.js saf modüllerinin tarayıcı paketi */
(function(){
"use strict";
const defs = {};
defs["match"] = function (module, exports, require, __dirname) {
'use strict';
/* Bulanık isim eşleştirme: Türkçe karakter katlama, unvan/şirket türü ekleri temizliği,
 * token-seti + Jaro-Winkler hizalama, ters sıra ve kısaltma toleransı, token-indeksli aday seçimi. */

const FOLD = { 'İ': 'i', 'I': 'i', 'ı': 'i', 'Ş': 's', 'ş': 's', 'Ğ': 'g', 'ğ': 'g', 'Ç': 'c', 'ç': 'c', 'Ö': 'o', 'ö': 'o', 'Ü': 'u', 'ü': 'u', 'ß': 'ss', 'Ø': 'o', 'ø': 'o', 'Æ': 'ae', 'æ': 'ae', 'Ł': 'l', 'ł': 'l', 'Đ': 'd', 'đ': 'd' };
// Hukuki şekil / unvan gürültüsü (eşleştirmede önemsiz)
const NOISE = new Set(['wll', 'spc', 'fzllc', 'ltdsti', 'pjsc', 'as', 'a', 's', 'anonim', 'sirketi', 'sirket', 'ltd', 'sti', 'limited', 'llc', 'l', 'c', 'fzco', 'fze', 'fzc', 'fzllc', 'inc', 'corp', 'corporation', 'co', 'company', 'gmbh', 'sa', 'jsc', 'ooo', 'pjsc', 'ojsc', 'zao', 'ao', 'bv', 'nv', 'pte', 'pvt', 'plc', 'the', 'and', 've', 'tic', 'san', 'ticaret', 'sanayi', 'ltdsti', 'org', 'sdn', 'bhd', 'lp', 'llp', 'dmcc', 'kg', 'ag', 'srl', 'spa', 'oy', 'ab', 'as', 'a.s', 'ic', 'dis', 'mr', 'mrs', 'ms', 'dr', 'bay', 'bayan', 'sayin', 'al', 'el', 'bin', 'ibn', 'abu']);
const NOISE_STRONG = new Set(['wll', 'spc', 'ooo', 'oao', 'zao', 'ag', 'kg', 'sarl', 'sas', 'bv', 'ltda', 'pvt', 'pty', 'as', 'a', 's', 'anonim', 'sirketi', 'sirket', 'ltd', 'sti', 'limited', 'llc', 'l', 'c', 'fzco', 'fze', 'fzc', 'inc', 'corp', 'corporation', 'co', 'company', 'gmbh', 'sa', 'jsc', 'ooo', 'pjsc', 'ojsc', 'zao', 'ao', 'bv', 'nv', 'pte', 'pvt', 'plc', 'the', 'and', 've', 'tic', 'san', 'ticaret', 'sanayi', 'sdn', 'bhd', 'lp', 'llp', 'dmcc', 'kg', 'ag', 'srl', 'spa', 'oy', 'ab', 'mr', 'mrs', 'ms', 'dr']);

let anyAscii = null; try { const m = require('any-ascii'); anyAscii = m.default || m.anyAscii || m; } catch { /* isteğe bağlı: yoksa yalnızca Latin + Arapça */ }
/* Arapça-yazı → Latin ünsüz iskeleti (Arapça, Farsça, Urduca). Kısa ünlüler yazılmadığı için yalnızca harf ünlüleri (ا و ي) yazılır;
 * karşılaştırma zaten ünsüz iskeletine dayanır (cons). Alef/hamza varyantları, ة/ه, ى/ي, tashkeel, tatweel ve Arapça-Hint rakamları normalleştirilir. */
const AR = { 'ا': 'a', 'أ': 'a', 'إ': 'a', 'آ': 'a', 'ٱ': 'a', 'ء': '', 'ؤ': 'u', 'ئ': 'i', 'ب': 'b', 'پ': 'p', 'ت': 't', 'ث': 'th', 'ج': 'j', 'چ': 'ch', 'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z', 'ژ': 'zh', 'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't', 'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ک': 'k', 'گ': 'g', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'ہ': 'h', 'ة': 'a', 'ۀ': 'a', 'ى': 'a', 'ں': 'n', 'ٹ': 't', 'ڈ': 'd', 'ڑ': 'r', 'ے': 'i' };
const AR_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
function arToLatin(str) {
  str = str.normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640\u06D6-\u06ED]/g, '').replace(/[\u0660-\u0669]/g, c => String(c.charCodeAt(0) - 0x660)).replace(/[\u06F0-\u06F9]/g, c => String(c.charCodeAt(0) - 0x6F0));
  return str.split(/(\s+)/).map(w => {
    if (!AR_RE.test(w)) return w; let out = '';
    const chars = [...w]; const art = chars.length > 3 && chars[0] === 'ا' && chars[1] === 'ل'; if (art) { out = 'al '; chars.splice(0, 2); }
    chars.forEach((ch, i) => { if (ch === 'و' || ch === 'ي' || ch === 'ی') out += i === 0 ? (ch === 'و' ? 'w' : 'y') : (ch === 'و' ? 'u' : 'i'); else if (AR[ch] !== undefined) out += AR[ch]; else out += /[\u0600-\u06FF]/.test(ch) ? '' : ch; });
    return out;
  }).join('');
}
function fold(s) {
  s = String(s || '');
  if (AR_RE.test(s)) s = arToLatin(s);
  let out = '', run = '';
  const flush = () => { if (run) { out += ' ' + anyAscii(run).replace(/[`'’ʼ]/g, '').replace(/([a-z])([A-Z])/g, '$1 $2') + ' '; run = ''; } };   // Kiril (ICAO/BGN), Yunanca, Çince (pinyin) vb.
  for (const ch of s) {
    if (FOLD[ch] !== undefined) { flush(); out += FOLD[ch]; }
    else if (anyAscii && ch.codePointAt(0) > 0x24F && !/[\u0300-\u036f]/.test(ch)) run += ch;
    else { flush(); out += ch; }
  }
  flush();
  return out.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
// "A.Ş." → "as", "L.L.C." → "llc"
function normalize(s) {
  let t = fold(s).replace(/[’'`ʼʻʿʾ´]/g, '');
  t = t.replace(/\b([a-z])\.(?=[a-z]\b|[a-z]\.)/g, '$1').replace(/\.(?=\s|$)/g, ' ');
  t = t.replace(/[^a-z0-9\u0400-\u04ff\u0600-\u06ff\s]/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}
/* Yaygın romanizasyon varyantları → tek kanonik biçim (Muhammad/Mohammed/Mehmet, Hussein/Hüseyin/Huseyn, Abdul/Abd al-, el-/al-/ul-, bin/ibn …) */
const VAR = Object.create(null);
for (const [canon, list] of Object.entries({
  muhammad: 'mohammed mohamed mohammad muhammed muhamed mohamad muhamad mehmet mahomet mohmed mohd muhd md', husayn: 'hussein husein hussain husain huseyin hosein hossein hossain hoseyn husayn husseyn huseyn huseynov',
  abd: 'abdul abdel abdal abdol abdu abdi abdoul abdull', ahmad: 'ahmed ahmet ahmat', ali: 'aly', yusuf: 'yousef youssef yusif yousuf yosef joseph yusuf', ibrahim: 'ibrahim ebrahim ibrahima', khalid: 'khaled halid halit', osman: 'othman uthman usman osmaan', omar: 'umar omer', mustafa: 'moustafa mostafa mustapha', mahmud: 'mahmoud mahmood mahmut', hasan: 'hassan hasen', sulayman: 'suleyman suleiman sulaiman suleman', salim: 'salem', rahman: 'rahmaan rehman', qaeda: 'qaida qaeda kaida kaeda alqaida', ismail: 'ismael ismayil esmail', sayyid: 'sayed said seyyid seyid syed saeed',
  al: 'el ul ol', bin: 'bn ben'
})) for (const v of list.split(' ')) VAR[v] = canon;
const KNOWN = new Set(Object.values(VAR));
const WEAK = new Set(['al', 'bin', 'ibn', 'bint', 'binti', 'abu', 'abd', 'ben', 'ould', 'van', 'von', 'de', 'der', 'den']);
const ABD_SUF = /^(abd|abdul|abdel|abdal|abdol|abdu)(rahman|rahim|aziz|karim|kareem|salam|latif|ghani|wahab|razzaq|qadir|qader|hamid|majid|nasser|nasir|halim|jabbar|malik|wahid|hadi|baset|basit|rauf|razak|muhsin|samad|ilah|illah|kader)$/;
function tokens(s) {
  const t = normalize(s).split(' ').filter(Boolean).flatMap(x => { const m = ABD_SUF.exec(x); return m ? ['abd', m[2]] : [x]; }).map(x => VAR[x] || x);
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
/* Transliterasyon/yazım varyantı toleransı: ünlüler (y dâhil) atılmış, çift harfler tekilleştirilmiş ünsüz iskeleti eşit + ilk harf aynı +
 * uzunluk ≥5 + düzenleme mesafesi ≤3 ise (Hüseyin ≈ Hossein ≈ Husain; Hasan ≠ Hussein: mesafe 4) belirteçler “yazım varyantı” sayılır (0.90). */
function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; let mn = i; for (let j = 1; j <= b.length; j++) { const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); cur[j] = v; if (v < mn) mn = v; } if (mn > max) return max + 1; prev = cur; }
  return prev[b.length];
}
/* Ses-benzeri ünsüz iskeleti: digraflar ve eşdeğer harfler (kh→h, gh→g, sh→s, th→t, dh→d, ph→f, ch→c, q/c→k, z→s, w→v, x→ks), ünlüler + y atılır, ikilemeler tekilleşir. */
const cons = t => t.replace(/kh/g, 'h').replace(/gh/g, 'g').replace(/sh/g, 's').replace(/th/g, 't').replace(/dh/g, 'd').replace(/ph/g, 'f').replace(/ch/g, 'c').replace(/x/g, 'ks').replace(/[qc]/g, 'k').replace(/z/g, 's').replace(/w/g, 'v').replace(/[aeiouy]/g, '').replace(/(.)\1+/g, '$1');
const collapse = t => t.replace(/ue/g, 'u').replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ss/g, 's').replace(/(.)\1+/g, '$1');   // Müller/Muller/Mueller, ß
function tokSim(a, b) {
  if (a === b) return 1;
  let j = jw(a, b); if (Math.min(a.length, b.length) <= 2) return Math.min(j, 0.8);
  if (KNOWN.has(a) && KNOWN.has(b)) return j;   // farklı bilinen adlar (hasan ≠ husayn) yazım varyantı sayılmaz
  const jc = jw(collapse(a), collapse(b)); if (jc > j) j = Math.min(jc, 0.97);
  if (j >= 0.9) return j;
  if (a.length >= 3 && b.length >= 3 && /^[a-z]+$/.test(a + b)) {
    const ca = cons(a), cb = cons(b);
    if (ca.length >= 2 && ca === cb) {
      const bare = !/[aeiou]/.test(a) || !/[aeiou]/.test(b);     // biri ünlüsüz (Arapça-yazı iskeleti): ünsüz iskeleti + ilk harf eşitliği yeterli
      if (bare && a[0] === b[0]) return Math.max(j, 0.96);
      const L = Math.max(a.length, b.length), d = lev(a, b, 3);
      if (cons(a[0]) === cons(b[0]) && (L >= 5 ? d <= 3 : d <= 1)) return Math.max(j, 0.92);
    }
  }
  return j;
}
// Soundex benzeri iskelet (aday seçimi için): ilk harf + ünsüzler (tekrarsız)
function skeleton(tok) { return cons(tok).slice(0, 3) || tok[0]; }
function keys(tok) { return [tok.slice(0, 3), 'k:' + skeleton(tok)]; }

const GENERIC = new Set(['shipping', 'services', 'service', 'trading', 'trade', 'group', 'holding', 'holdings', 'international', 'global', 'logistics', 'marine', 'maritime', 'energy', 'oil', 'gas', 'petroleum', 'industrial', 'industries', 'industry', 'general', 'import', 'export', 'bank', 'finance', 'financial', 'investment', 'investments', 'technology', 'technologies', 'systems', 'solutions', 'enterprises', 'enterprise', 'commercial', 'transport', 'transportation', 'lojistik', 'denizcilik', 'nakliyat', 'enerji', 'petrol', 'insaat', 'uluslararasi', 'dis', 'ic', 'grup', 'yatirim', 'gida', 'tekstil', 'madencilik', 'otomotiv', 'turizm']);
const WEAKW = new Set(['al', 'bin', 'ibn', 'bint', 'binti', 'abu', 'abd', 'ben', 'ould', 'van', 'von', 'de', 'der', 'den']);
const W = t => (GENERIC.has(t) || WEAKW.has(t) ? 0.35 : 1);

/* İki token listesi arasında 0-100 skor + gerekçe (ağırlıklı, simetrik Dice benzeri) */
function scoreTokens(ta, tb) {
  if (!ta.length || !tb.length) return { score: 0, reasons: [] };
  const small = ta.length <= tb.length ? ta : tb, big = ta.length <= tb.length ? tb : ta;
  const used = new Set(); let M = 0, Ws = 0, Wb = big.reduce((a, t) => a + W(t), 0); let exact = 0, fuzzy = 0, abbr = 0; const pairs = [];
  for (const x of small) {
    let best = 0, bi = -1;
    for (let i = 0; i < big.length; i++) {
      if (used.has(i)) continue;
      let s = tokSim(x, big[i]);
      if (x.length === 1 && big[i][0] === x) s = Math.max(s, 0.88);
      else if (big[i].length === 1 && x[0] === big[i]) s = Math.max(s, 0.88);
      if (s > best) { best = s; bi = i; }
    }
    if (bi >= 0 && best >= 0.8) used.add(bi);
    Ws += (bi >= 0 && best >= 0.88) ? Math.min(W(x), W(big[bi])) : W(x);   // yazım hatalı genel sözcük (Shiping) genel sözcük ağırlığıyla sayılır
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

/* Birleşik/ayrık yazım: “Abdul Rahman Al Sayed” ≈ “Abdulrahman Alsayed”, “Al Qaida” ≈ “Alqaida”, “Xi Jin Ping” ≈ “Xi Jinping”.
 * Zayıf belirteçler (al/bin/ibn …) atılıp tüm ad bitişik karşılaştırılır; yüksek benzerlik tek başına en çok 92 puan verir. */
function scoreNames(ta, tb) {
  const r = scoreTokens(ta, tb); if (r.score >= 92) return r;
  const jk = t => t.filter(x => !WEAKW.has(x)).map(x => x.length >= 6 && /^(al|el|ul)/.test(x) ? x.slice(2) : x).join('');
  const ja = jk(ta), jb = jk(tb);
  if (ja.length >= 5 && jb.length >= 5 && Math.abs(ja.length - jb.length) <= 1 && (ta.length !== tb.length || ta.join(' ') !== tb.join(' '))) {
    const s = tokSim(ja, jb); if (s >= 0.93) { const sc = Math.min(92, Math.round(s * 100) - 3); if (sc > r.score) return { ...r, score: sc, reasons: [...r.reasons, 'joined'] }; }
  }
  // Arapça-yazı kaynaklı (ünlüsüz) belirteç varsa: tüm adın ünsüz iskeleti eşitliği (Arapça↔Latin transliterasyon)
  const bareSide = ta.some(x => x.length > 2 && !/[aeiou]/.test(x)) || tb.some(x => x.length > 2 && !/[aeiou]/.test(x));
  if (bareSide && ja.length >= 6) { const ca = cons(ja), cb = cons(jb); if (ca.length >= 5 && ca === cb && ja[0] === jb[0] && r.score < 88) return { ...r, score: 88, reasons: [...r.reasons, 'skeleton'] }; }
  return r;
}
function orderDiffers(a, b) {
  const sa = a.join(' '), sb = b.join(' ');
  return sa !== sb && [...a].sort().join(' ') === [...b].sort().join(' ');
}

/* Liste girdileri için indeks. entries: [{id, names:[...], ...}] */
const idKey = v => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
class NameIndex {
  constructor() { this.entries = []; this.byKey = new Map(); this.byImo = new Map(); this.byId = new Map(); this.tokenSets = []; this.keyTokens = new Map(); }
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
    for (const i of [...(entry.ids || []), ...(entry.idno ? [entry.idno] : []), ...(entry.wallets || [])]) { const k = idKey(i); if (k.length >= 6) { if (!this.byId.has(k)) this.byId.set(k, []); this.byId.get(k).push(idx); } }
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
          const s = lt === t ? 1 : tokSim(t, lt);
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
    if (opts.ids) for (const i of [].concat(opts.ids)) { const k = idKey(i); if (k.length < 6) continue; for (const idx of this.byId.get(k) || []) out.push({ idx, score: 100, reasons: ['taxid'], via: String(i), type: 'id' }); }
    const tk = tokens(name || '');
    if (tk.length) {
      const cand = this.candidates(tk);
      const minHits = tk.length >= 2 ? 1 : 1;
      let list = [...cand.entries()].filter(([, h]) => h >= minHits);
      if (list.length > 6000) list = list.sort((a, b) => b[1] - a[1]).slice(0, 6000);
      for (const [idx] of list) {
        let best = null;
        for (const ts of this.tokenSets[idx]) {
          const r = scoreNames(tk, ts);
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

module.exports = { idKey, fold, normalize, tokens, jw, scoreTokens, scoreNames, tokSim, cons, NameIndex, imoValid, extractIMO };

};
defs["util"] = function (module, exports, require, __dirname) {
'use strict';
const crypto = require('crypto');

const F = require('./fetcher');
const UA = F.UA();

/* Tüm dış istekler lib/fetcher.js (robots.txt, host başına hız sınırı, geri çekilme) üzerinden gider. api:true = resmî toplu dosya/API (robots.txt uygulanmaz). */
async function fetchText(url, o = {}) { return F.text(url, o); }

function stripTags(h) {
  return decodeEntities(String(h || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\u00a0]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
function decodeEntities(s) {
  return String(s).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&#8217;|&rsquo;/g, '’').replace(/&#8211;|&ndash;/g, '–').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

const TR_MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const TR_DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
function pad(n) { return String(n).padStart(2, '0'); }
function isoDate(d) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
function todayISO(tz = 'Europe/Istanbul') {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return p; // YYYY-MM-DD
}
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return isoDate(d); }
function trDate(iso) { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${+d} ${TR_MONTHS[+m - 1]} ${y}`; }
function trDateShort(iso) { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}.${m}.${y}`; }
function trWeekday(iso) { return TR_DAYS[new Date(iso + 'T12:00:00Z').getUTCDay()]; }
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }
function dmyToISO(s) { const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec((s || '').trim()); return m ? `${m[3]}-${pad(+m[2])}-${pad(+m[1])}` : ''; }
function mdyToISO(s) { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((s || '').trim()); return m ? `${m[3]}-${pad(+m[1])}-${pad(+m[2])}` : ''; }
function rangeDays(endISO, n) { const out = []; for (let i = 0; i < n; i++) out.push(addDays(endISO, -i)); return out; }

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function uid(prefix = '') { return prefix + crypto.randomBytes(5).toString('hex'); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// Basit CSV ayrıştırıcı (tırnak, ; veya , ayırıcı otomatik)
function parseCSV(text, delim) {
  text = text.replace(/^\uFEFF/, '');
  if (!delim) {
    const first = text.split(/\r?\n/, 1)[0] || '';
    const cnt = c => (first.match(new RegExp('\\' + c, 'g')) || []).length;
    delim = cnt(';') > cnt(',') ? ';' : (cnt('\t') > cnt(',') ? '\t' : ',');
  }
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c === '\r') { /* skip */ }
    else f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  return rows;
}

// Koşullu istek: ETag / Last-Modified + içerik özeti. {changed, text, notModified}
async function fetchCond(url, key, { timeout = 60000, headers = {}, force = false, api = true, retries = 2 } = {}) {
  const store = require('./store');
  const cache = store.readCache('http-cache.json', {});
  const c = cache[key] || {};
  const h = { ...headers };
  if (!force) { if (c.etag) h['If-None-Match'] = c.etag; if (c.lm) h['If-Modified-Since'] = c.lm; }
  const r = await F.request(url, { timeout, headers: h, api, retries });
  if (r.status === 304) { cache[key] = { ...c, checkedAt: new Date().toISOString() }; store.writeCache('http-cache.json', cache); return { changed: false, notModified: true, etag: c.etag, lm: c.lm }; }
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  const buf = Buffer.from(await r.arrayBuffer());
  const hash = crypto.createHash('sha256').update(buf).digest('hex');
  const text = buf.toString('utf8');
  if (/Just a moment\.\.\.|Client Challenge/i.test(text.slice(0, 4000))) { const e = new Error('Bot koruması (JS doğrulaması) nedeniyle engellendi'); e.blocked = true; throw e; }
  const changed = force || hash !== c.hash;
  cache[key] = { etag: r.headers.get('etag') || '', lm: r.headers.get('last-modified') || '', hash, checkedAt: new Date().toISOString(), changedAt: (hash !== c.hash) ? new Date().toISOString() : c.changedAt, size: buf.length };
  store.writeCache('http-cache.json', cache);
  return { changed, text, buf, etag: cache[key].etag, lm: cache[key].lm, size: buf.length };
}

module.exports = { fetchCond, fetchText, stripTags, decodeEntities, TR_MONTHS, TR_DAYS, pad, isoDate, todayISO, addDays, trDate, trDateShort, trWeekday, daysBetween, dmyToISO, mdyToISO, rangeDays, sha256, uid, esc, parseCSV, UA };

};
defs["i18n"] = function (module, exports, require, __dirname) {
'use strict';
/* Sunucu tarafı metinler (bülten üretimi, ticaret notu). Yeni dil eklemek için aynı anahtarlarla yeni bir blok ekleyin. */
const D = {
  tr: {
    locale: 'tr-TR', langName: 'Türkçe',
    bulletinTitle: 'Günlük Yaptırım Bülteni', internal: 'Kurum İçi', affiliate: 'İştirak', draft: 'TASLAK – ONAYSIZ', approved: 'ONAYLANDI',
    review: 'İNCELEMEDE', preparedFor: 'Hazırlayan birim', date: 'Bülten tarihi', window: 'Tarama penceresi', days: 'gün', version: 'Versiyon',
    summaryTable: 'Özet tablo', colSource: 'Kaynak', colEvent: 'Olay', colAction: 'Aksiyon', colBase: 'Base tespiti', colDate: 'Tarih',
    noItems: 'Seçili pencerede bültene alınacak kayıt bulunmadı.', sourceLink: 'Resmî kaynak', analystNote: 'Analist notu',
    entities: 'İlgili kayıtlar', and: 've', moreEntities: 'diğer', noBase: 'Yok', yesBase: 'Var', pendingBase: 'Karar bekliyor',
    baseLine: 'Base tespiti', baseOverall: 'Base tespiti (genel)', baseYesText: 'Var', baseNoText: 'Yok',
    approvedBy: 'Onaylayan', preparedBy: 'Hazırlayan', approvedAt: 'Onay zamanı', integrity: 'Bütünlük özeti (SHA-256)',
    footerInternal: 'Kurum içi kullanım içindir; iştiraklerle paylaşılmaz.', footerAffiliate: 'Bu bülten bilgi amaçlıdır; kaynak linkleri resmî metinlere yönlendirir.',
    disclaimer: 'Bu bülten otomatik tarama ile hazırlanan taslağın analist tarafından incelenmiş hâlidir. Nihai karar ve sorumluluk analisttedir.',
    sourcesChecked: 'Taranan kaynaklar', statusOk: 'başarılı', statusDegraded: 'kısmi', statusError: 'hata', statusPending: 'bekliyor',
    types: { ADD: 'Ekleme', UPD: 'Güncelleme', DEL: 'Silme', GL: 'Genel lisans', ENF: 'Enforcement', INFO: 'Duyuru' },
    entTypes: { person: 'kişi', entity: 'kuruluş', vessel: 'gemi', aircraft: 'uçak' },
    srcNames: { ofac: 'OFAC (ABD)', uk: 'UK Sanctions List', eu: 'AB (EUR-Lex)', un: 'BM Güvenlik Konseyi', fatf: 'FATF' },
    actInternal: { check_base: 'Müşteri tabanıyla eşleştir (core sistem); tespiti incele, bültene yaz', no_extra: 'Ek kontrol gerekmez; değişen alanları gözden geçir', vessel_warn: 'Gemi uyarısı; iç listeden çıkar', flag_gl: 'Yeni lisansı işaretle; kapsamını değerlendir', info_enf: 'Karar özetini bilgi olarak ekle', info: 'Bilgi amaçlı' },
    actAffiliate: { check_base: 'Yeni listeleme: kendi tarama süreçlerinizde kontrol ediniz', no_extra: 'Ek kontrol gerekmez', vessel_warn: 'Silme: gemi kayıtları için dikkatli olunuz; iç listeyi güncelleyiniz', flag_gl: 'Yeni genel lisans: kapsamını değerlendiriniz', info_enf: 'Bilgi amaçlı', info: 'Bilgi amaçlı' },
    vesselWarn: 'Dikkat: listeden çıkarılan kayıtlar arasında gemi/IMO var.',
    matches: 'olası eşleşme', score: 'skor',
    reasons: { exact_all: 'tüm isim bileşenleri birebir', subset: 'kısa ismin tüm bileşenleri birebir (karşı tarafta {n} ek bileşen)', exact_n: '{n} bileşen birebir', fuzzy_n: '{n} bileşen yazım/harf çevirisi farkıyla benzer', abbr: 'kısaltma/baş harf benzerliği', order: 'ad/soyad sırası farklı', imo: 'IMO numarası birebir eşleşti' },
    // ticaret notu
    tradeNoteTitle: 'Ticaret finansmanı ön risk notu', riskLevels: { low: 'Düşük', medium: 'Orta', high: 'Yüksek', critical: 'Kritik' },
  },
  en: {
    locale: 'en-GB', langName: 'English',
    bulletinTitle: 'Daily Sanctions Bulletin', internal: 'Internal', affiliate: 'Affiliate', draft: 'DRAFT – NOT APPROVED', approved: 'APPROVED',
    review: 'IN REVIEW', preparedFor: 'Prepared by', date: 'Bulletin date', window: 'Look-back window', days: 'days', version: 'Version',
    summaryTable: 'Summary table', colSource: 'Source', colEvent: 'Event', colAction: 'Action', colBase: 'Customer-base finding', colDate: 'Date',
    noItems: 'No items to include in the selected window.', sourceLink: 'Official source', analystNote: 'Analyst note',
    entities: 'Related records', and: 'and', moreEntities: 'more', noBase: 'None', yesBase: 'Match', pendingBase: 'Decision pending',
    baseLine: 'Base finding', baseOverall: 'Base finding (overall)', baseYesText: 'Match found', baseNoText: 'No match',
    approvedBy: 'Approved by', preparedBy: 'Prepared by', approvedAt: 'Approved at', integrity: 'Integrity digest (SHA-256)',
    footerInternal: 'For internal use only; not to be shared with affiliates.', footerAffiliate: 'This bulletin is for information only; source links lead to the official texts.',
    disclaimer: 'This bulletin is an analyst-reviewed version of a draft produced by automated scanning. The final decision and responsibility rest with the analyst.',
    sourcesChecked: 'Sources scanned', statusOk: 'OK', statusDegraded: 'partial', statusError: 'error', statusPending: 'pending',
    types: { ADD: 'Addition', UPD: 'Update', DEL: 'Removal', GL: 'General licence', ENF: 'Enforcement', INFO: 'Notice' },
    entTypes: { person: 'individual', entity: 'entity', vessel: 'vessel', aircraft: 'aircraft' },
    srcNames: { ofac: 'OFAC (US)', uk: 'UK Sanctions List', eu: 'EU (EUR-Lex)', un: 'UN Security Council', fatf: 'FATF' },
    actInternal: { check_base: 'Screen against the customer base (core system); review the finding and record it', no_extra: 'No additional check required; review changed fields', vessel_warn: 'Vessel warning; remove from the internal list', flag_gl: 'Flag the new licence; assess its scope', info_enf: 'Add the decision summary as information', info: 'For information' },
    actAffiliate: { check_base: 'New designation: please screen in your own processes', no_extra: 'No additional check required', vessel_warn: 'Removal: take care with vessel records; update your internal list', flag_gl: 'New general licence: please assess its scope', info_enf: 'For information', info: 'For information' },
    vesselWarn: 'Attention: the removed records include a vessel / IMO number.',
    matches: 'possible match(es)', score: 'score',
    reasons: { exact_all: 'all name components identical', subset: 'all components of the shorter name identical ({n} extra component(s) on the other side)', exact_n: '{n} component(s) identical', fuzzy_n: '{n} component(s) similar (spelling / transliteration)', abbr: 'abbreviation / initial similarity', order: 'given/family name order differs', imo: 'IMO number matched exactly' },
    tradeNoteTitle: 'Trade finance pre-risk note', riskLevels: { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' },
  },
  ar: {
    locale: 'ar-AE', langName: 'العربية', dir: 'rtl',
    bulletinTitle: 'نشرة العقوبات اليومية', internal: 'داخلية', affiliate: 'للشركات التابعة', draft: 'مسودة – غير معتمدة', approved: 'معتمدة',
    review: 'قيد المراجعة', preparedFor: 'أعدّتها الإدارة', date: 'تاريخ النشرة', window: 'نافذة الفحص', days: 'يوم', version: 'النسخة',
    summaryTable: 'جدول موجز', colSource: 'المصدر', colEvent: 'الحدث', colAction: 'الإجراء', colBase: 'نتيجة فحص قاعدة العملاء', colDate: 'التاريخ',
    noItems: 'لا توجد عناصر لإدراجها في النافذة المحددة.', sourceLink: 'المصدر الرسمي', analystNote: 'ملاحظة المحلل',
    entities: 'السجلات ذات الصلة', and: 'و', moreEntities: 'أخرى', noBase: 'لا يوجد', yesBase: 'يوجد', pendingBase: 'القرار معلّق',
    baseLine: 'نتيجة قاعدة العملاء', baseOverall: 'نتيجة قاعدة العملاء (إجمالي)', baseYesText: 'يوجد تطابق', baseNoText: 'لا يوجد تطابق',
    approvedBy: 'اعتمدها', preparedBy: 'أعدّها', approvedAt: 'وقت الاعتماد', integrity: 'بصمة السلامة (SHA-256)',
    footerInternal: 'للاستخدام الداخلي فقط؛ لا تُشارَك مع الشركات التابعة.', footerAffiliate: 'هذه النشرة لأغراض الإعلام فقط؛ وتقود الروابط إلى النصوص الرسمية.',
    disclaimer: 'هذه النشرة نسخة راجعها المحلل من مسودة أُعدّت بالفحص الآلي. القرار النهائي والمسؤولية للمحلل.',
    sourcesChecked: 'المصادر المفحوصة', statusOk: 'ناجح', statusDegraded: 'جزئي', statusError: 'خطأ', statusPending: 'قيد الانتظار',
    types: { ADD: 'إضافة', UPD: 'تحديث', DEL: 'حذف', GL: 'ترخيص عام', ENF: 'إجراء إنفاذ', INFO: 'إعلان' },
    entTypes: { person: 'فرد', entity: 'كيان', vessel: 'سفينة', aircraft: 'طائرة' },
    srcNames: { ofac: 'OFAC (الولايات المتحدة)', uk: 'المملكة المتحدة (قائمة العقوبات)', eu: 'الاتحاد الأوروبي (EUR-Lex)', un: 'مجلس الأمن الدولي', fatf: 'مجموعة العمل المالي (FATF)' },
    actInternal: { check_base: 'طابقها مع قاعدة العملاء (النظام المصرفي الأساسي)؛ راجع النتيجة وسجّلها', no_extra: 'لا يلزم فحص إضافي؛ راجع الحقول المتغيرة', vessel_warn: 'تنبيه سفينة؛ أزلها من القائمة الداخلية', flag_gl: 'أشِّر على الترخيص الجديد وقيّم نطاقه', info_enf: 'أضف ملخص القرار للعلم', info: 'للعلم' },
    actAffiliate: { check_base: 'إدراج جديد: يرجى الفحص ضمن إجراءاتكم', no_extra: 'لا يلزم فحص إضافي', vessel_warn: 'حذف: انتبهوا لسجلات السفن وحدّثوا قائمتكم الداخلية', flag_gl: 'ترخيص عام جديد: يرجى تقييم نطاقه', info_enf: 'للعلم', info: 'للعلم' },
    vesselWarn: 'تنبيه: تتضمن السجلات المحذوفة سفينة / رقم IMO.',
    matches: 'تطابق(ات) محتملة', score: 'الدرجة',
    reasons: { exact_all: 'جميع مكوّنات الاسم متطابقة تمامًا', subset: 'جميع مكوّنات الاسم الأقصر متطابقة ({n} مكوّن إضافي في الطرف الآخر)', exact_n: '{n} مكوّن متطابق تمامًا', fuzzy_n: '{n} مكوّن متشابه (إملاء / نقل حرفي)', abbr: 'تشابه اختصار / حرف أول', order: 'ترتيب الاسم والعائلة مختلف', imo: 'تطابق رقم IMO تمامًا' },
    tradeNoteTitle: 'ملاحظة المخاطر الأولية لتمويل التجارة', riskLevels: { low: 'منخفض', medium: 'متوسط', high: 'مرتفع', critical: 'حرج' },
  },
};
function dict(lang) { return D[lang] || D.tr; }
function reason(lang, code) {
  const [k, n] = String(code).split('|'); const tpl = dict(lang).reasons[k] || k; return tpl.replace('{n}', n || '');
}
module.exports = { D, dict, reason, langs: Object.keys(D) };

};
defs["customers"] = function (module, exports, require, __dirname) {
'use strict';
/* Müşteri tabanı: CSV içe aktarma ve yerel indeks. Veri yalnızca bu bilgisayarda (data/state/customers.json) tutulur. */
const fs = require('fs'), path = require('path');
const store = require('./store');
const U = require('./util');
const M = require('./match');

const COL = {
  id: ['musteri_no', 'musteri no', 'müşteri no', 'customer_id', 'customer id', 'id', 'cif', 'no'],
  name: ['ad_unvan', 'ad unvan', 'ad/unvan', 'unvan', 'ünvan', 'ad', 'isim', 'name', 'full_name', 'customer_name', 'ad soyad'],
  type: ['tur', 'tür', 'type', 'musteri_turu', 'segment'],
  imo: ['imo', 'imo_no', 'imo no', 'imo numarasi'],
  country: ['ulke', 'ülke', 'country', 'uyruk'],
  taxId: ['kimlik_no', 'kimlik no', 'vkn', 'tckn', 'tax_id', 'id_number', 'vergi no'],
  yob: ['dogum_yili', 'doğum yılı', 'dogum yili', 'yob', 'birth_year'],
  owners: ['ortaklar', 'ortak', 'sahipler', 'ubo', 'owners', 'beneficial_owners', 'gercek_faydalanici'],
  branch: ['sube', 'şube', 'branch', 'sube_kodu'],
  aliases: ['diger_adlar', 'diğer adlar', 'alias', 'aliases', 'takma_ad', 'aka'],
};
let cache = { idx: null, stamp: null };

const FIELDS = ['id', 'name', 'type', 'imo', 'country', 'taxId', 'yob', 'aliases', 'owners', 'branch'];
const TEMPLATE = 'musteri_no;ad_unvan;tur;imo;ulke;kimlik_no;dogum_yili;diger_adlar;ortaklar;sube\r\nORNEK-001;Örnek Ticaret A.Ş.;kurum;;TR;1234567890;;Ornek Trading;Ali Örnek|Veli Örnek;b-1\r\nORNEK-002;Ayşe Örnek;kisi;;TR;;1980;;;b-1\r\nORNEK-003;M/V ÖRNEK GEMİ;gemi;9999999;PA;;;;;\r\n';
function readRows(text) {
  text = String(text || '').replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/, 1)[0] || ''; const sep = [';', ',', '\t', '|'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  return { rows: U.parseCSV(text, sep), sep };
}
function guessMapping(headRow) {
  const head = headRow.map(h => M.fold(h).trim().replace(/\s+/g, ' ')); const map = {};
  for (const [f, keys] of Object.entries(COL)) { for (const k of keys) { const i = head.indexOf(M.fold(k)); if (i >= 0) { map[f] = i; break; } } if (!(f in map)) map[f] = -1; }
  return map;
}
/* Önizleme: başlıklar, ayraç, tahmin edilen eşleme ve ilk satırlar */
function preview(text) {
  const { rows, sep } = readRows(text); if (rows.length < 1) throw new Error('empty');
  return { delimiter: sep, headers: rows[0], mapping: guessMapping(rows[0]), sample: rows.slice(1, 6), total: Math.max(0, rows.length - 1) };
}
function parse(text, filename, isSample, mapping) {
  const { rows } = readRows(text);
  if (rows.length < 2) throw Object.assign(new Error('CSV boş veya başlık satırı yok'), { code: 'empty' });
  const ix = { ...guessMapping(rows[0]), ...(mapping || {}) };
  if (ix.name == null || ix.name < 0) throw Object.assign(new Error('“Ad / Unvan” sütunu seçilmedi'), { code: 'no_name', headers: rows[0] });
  const out = [], errors = [], warnings = []; const ids = new Set();
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; if (row.every(c => !String(c).trim())) continue; const g = k => (ix[k] >= 0 && ix[k] != null ? (row[ix[k]] || '').trim() : '');
    const name = g('name'); if (!name) { errors.push({ row: r + 1, code: 'name_empty', value: '' }); continue; }
    if (name.length > 250) { errors.push({ row: r + 1, code: 'name_long', value: name.slice(0, 40) }); continue; }
    const t = M.fold(g('type')); const imo = g('imo').replace(/\D/g, '').slice(0, 7);
    if (g('imo') && !M.imoValid(imo)) warnings.push({ row: r + 1, code: 'imo_invalid', value: g('imo') });
    if (g('type') && !/gemi|vessel|ship|kurum|tuzel|entity|corp|sirket|company|org|kisi|gercek|person|individual/.test(t)) warnings.push({ row: r + 1, code: 'type_unknown', value: g('type') });
    let id = g('id') || 'R' + r; if (ids.has(id)) { warnings.push({ row: r + 1, code: 'id_dup', value: id }); id = id + '#' + r; } ids.add(id);
    const type = /gemi|vessel|ship/.test(t) ? 'vessel' : /kurum|tuzel|entity|corp|sirket|company|org/.test(t) ? 'entity' : /kisi|gercek|person|individual/.test(t) ? 'person' : (imo ? 'vessel' : '');
    out.push({ id, name, type, imo, country: g('country'), taxId: g('taxId'), yob: g('yob'), aliases: g('aliases') ? g('aliases').split(/[|,]/).map(s => s.trim()).filter(Boolean) : [], owners: g('owners') ? g('owners').split(/[|]/).map(s => s.replace(/%\s*\d+([.,]\d+)?/g, '').trim()).filter(Boolean).slice(0, 10) : [], branch: g('branch') });
  }
  return { meta: { filename: filename || 'musteri.csv', uploadedAt: new Date().toISOString(), count: out.length, sample: !!isSample, sha: U.sha256(text).slice(0, 12), skipped: errors.length, warned: warnings.length }, rows: out, errors: errors.slice(0, 200), warnings: warnings.slice(0, 200) };
}
function save(c) { store.saveCustomers({ meta: c.meta, rows: c.rows }); cache = { idx: null, stamp: null }; }
function loadSample() {
  const t = fs.readFileSync(path.join(__dirname, '..', 'data', 'sample-customers.csv'), 'utf8');
  const c = parse(t, 'ornek-musteriler.csv', true); save(c); return c;
}
function index() {
  const c = store.customers();
  if (cache.idx && cache.stamp === (c.meta && c.meta.uploadedAt)) return cache.idx;
  const ix = new M.NameIndex();
  for (const r of c.rows) { ix.add({ ...r, names: [r.name, ...r.aliases], imo: r.imo || undefined }); (r.owners || []).forEach((o, i) => ix.add({ id: r.id + '~o' + i, name: o, names: [o], type: r.type === 'vessel' ? 'vessel' : 'person', owner: true, parentId: r.id, parentName: r.name })); }
  cache = { idx: ix, stamp: c.meta && c.meta.uploadedAt };
  return ix;
}
function has() { return store.customers().rows.length > 0; }

/* Bir listeleme kaydını (isim + takma adlar + IMO) müşteri tabanıyla karşılaştır */
function checkEntity(ent, threshold) {
  const ix = index(); const res = new Map();
  const names = [ent.name, ...(ent.aliases || [])].filter(Boolean);
  const imo = (ent.imo || []).filter(Boolean);
  for (const n of names.length ? names : ['']) {
    for (const h of ix.search(n, { threshold, imo: imo.length ? imo : undefined, limit: 5 })) {
      const k = h.entry.id; const p = res.get(k);
      if (!p || h.score > p.score) res.set(k, { via: h.entry.owner ? 'owner' : undefined, ownerName: h.entry.owner ? h.entry.name : undefined, customerId: h.entry.parentId || h.entry.id, customerName: h.entry.parentName || h.entry.name, customerType: h.entry.type, customerImo: h.entry.imo, score: h.score, reasons: h.reasons, matchedOn: h.type === 'imo' ? ent.name : n, entity: ent.name });
    }
    if (imo.length && n !== names[0]) { /* IMO sadece bir kez aranır */ imo.length = 0; }
  }
  return [...res.values()].sort((a, b) => b.score - a.score);
}

module.exports = { preview, parse, TEMPLATE, FIELDS, save, loadSample, index, has, checkEntity };

};
defs["trade"] = function (module, exports, require, __dirname) {
'use strict';
const fs = require('fs'), path = require('path');
const L = require('./lists');
const M = require('./match');
const I = require('./i18n');
const store = require('./store');
const U = require('./util');

const data = n => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', n), 'utf8'));
let HS, VES, FATF, GATES, COUNTRIES;
function load() { if (!HS) { HS = data('hs-dataset.json'); VES = data('eu-vessels.json'); FATF = data('fatf.json'); GATES = data('border-gates.json'); } }
function countries() {
  if (COUNTRIES) return COUNTRIES;
  const tr = new Intl.DisplayNames(['tr'], { type: 'region' }), en = new Intl.DisplayNames(['en'], { type: 'region' });
  COUNTRIES = [];
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const c = String.fromCharCode(a, b); let e; try { e = en.of(c); } catch { continue; }
    if (!e || e === c || /Unknown Region/i.test(e)) continue;
    COUNTRIES.push({ iso: c, en: e, tr: tr.of(c) });
  }
  return COUNTRIES;
}
function findCountry(q) {
  q = (q || '').trim(); if (!q) return null; const f = M.fold(q).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const list = countries();
  const alias = { 'kuzey kore': 'KP', 'north korea': 'KP', dprk: 'KP', 'laos': 'LA', 'rusya': 'RU', 'russia': 'RU', 'iran': 'IR', 'suriye': 'SY', 'vietnam': 'VN', 'viet nam': 'VN', 'turkey': 'TR', 'turkiye': 'TR', 'birlesik arap emirlikleri': 'AE', 'uae': 'AE', 'bae': 'AE', 'abd': 'US', 'usa': 'US', 'ingiltere': 'GB', 'uk': 'GB', 'burma': 'MM', 'myanmar': 'MM' };
  if (alias[f]) return list.find(c => c.iso === alias[f]);
  let hit = list.find(c => c.iso.toLowerCase() === f) || list.find(c => M.fold(c.tr) === f || M.fold(c.en) === f);
  if (!hit && f.length >= 3) hit = list.find(c => M.fold(c.tr).startsWith(f) || M.fold(c.en).startsWith(f));
  return hit || null;
}
function fatfStatus(iso) {
  load(); if (FATF.black.some(c => c.iso === iso)) return 'black'; if (FATF.grey.some(c => c.iso === iso)) return 'grey'; return 'none';
}
function gatesFor(c) {
  load(); const tr = M.fold(c.tr).replace(/[^a-z]/g, '');
  const map = { irak: 'irak', iran: 'iran', suriye: 'suriye', gurcistan: 'gurcistan', bulgaristan: 'bulgaristan', yunanistan: 'yunanistan', nahcivan: 'nahcivan' };
  return GATES.gates.filter(g => M.fold(g.neighbour).replace(/[^a-z]/g, '') === tr || (c.iso === 'AZ' && /nahcivan/i.test(M.fold(g.neighbour))));
}

function checkHS(raw) {
  load();
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length < 2) return { input: raw, error: 'short' };
  const h4 = digits.slice(0, 4); const matches = [];
  for (const it of HS.items) {
    let rel = false, exact = false;
    if (it.chapter) { rel = digits.startsWith(it.digits); exact = false; }
    else if (it.h4 === h4) {
      rel = true;
      if (digits.length > 4 && it.digits.length > 4) { const n = Math.min(digits.length, it.digits.length); exact = digits.slice(0, n) === it.digits.slice(0, n); }
      else if (it.digits.length === 4) exact = true;     // başlığın tamamı kapsamda (ex yoksa)
    }
    if (rel) matches.push({ annex: it.annex, article: it.article, part: it.part, code: it.code, ex: it.ex, desc: it.desc, exact, chapter: it.chapter, level: it.digits.length });
  }
  // eklere göre grupla
  const g = new Map();
  for (const m of matches) { if (!g.has(m.annex)) g.set(m.annex, []); g.get(m.annex).push(m); }
  const groups = [...g.entries()].map(([annex, list]) => {
    const meta = HS.annexes[annex];
    const strong = list.some(x => x.exact && !(x.ex && x.level === 4));
    return { annex, article: meta.art, labelTr: meta.tr, kind: meta.kind, quote: meta.quote, items: list.slice(0, 30), total: list.length, strength: strong ? 'strong' : 'heading' };
  });
  return {
    input: raw, digits, h4, groups, hit: groups.length > 0, strongest: groups.some(x => x.strength === 'strong') ? 'strong' : groups.length ? 'heading' : 'none',
    links: { taric: `https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp?Lang=en&Taric=${encodeURIComponent((digits + '0000000000').slice(0, 10))}`, reg833: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A${HS.celex}`, reg428: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32022R0428', dualuse: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A02021R0821-20241108' },
  };
}

function checkIMO(raw) {
  load();
  const imo = String(raw || '').replace(/\D/g, '').slice(0, 7);
  if (imo.length !== 7) return { input: raw, error: 'format' };
  const eu = VES.vessels.filter(v => v.imo === imo);
  const lists = L.findByImo(imo);
  return {
    input: raw, imo, checksumOk: M.imoValid(imo), eu: eu.map(v => ({ ...v, annex: 'XLII', article: '3s', celex: VES.celex })), lists,
    listed: eu.length > 0 || lists.length > 0,
    listsReady: Object.keys(L.meta()).length > 0,
    links: { vesselfinder: `https://www.vesselfinder.com/tr/vessels/details/${imo}`, seasearcher: 'https://www.seasearcher.com/vessels/', ofacSearch: 'https://sanctionssearch.ofac.treas.gov/', ukSearch: 'https://search-uk-sanctions-list.service.gov.uk/', reg833: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A${VES.celex}` },
  };
}
function checkCountry(raw) {
  load();
  const c = findCountry(raw); if (!c) return { input: raw, error: 'unknown' };
  const st = fatfStatus(c.iso);
  return { input: raw, country: c, fatf: st, fatfDate: FATF.statementDateISO, gates: gatesFor(c), link: FATF.verifiedFrom };
}

/* Tek ekran ön risk özeti + analist notu taslağı */
function assess(body, lang) {
  load(); lang = lang || 'tr'; const T = I.dict(lang);
  const hs = (body.hs || []).filter(Boolean).map(checkHS);
  const imos = (body.imo || []).filter(Boolean).map(checkIMO);
  const ctrs = (body.countries || []).filter(Boolean).map(checkCountry);
  const names = (body.parties || []).filter(Boolean);
  const partyHits = names.map(n => ({ name: n, hits: L.orgIndex().search(n, { threshold: store.settings().matchThreshold, limit: 4 }).map(h => ({ score: h.score, reasons: h.reasons, entry: L.present(h.entry) })) }));
  let pts = 0; const flags = [];
  for (const h of hs) if (h.hit) { const strong = h.strongest === 'strong'; pts += strong ? 3 : 2; flags.push({ k: strong ? 'hs_strong' : 'hs_heading', input: h.input, annexes: h.groups.map(g => 'Ek ' + g.annex + ' (Md. ' + g.article + ')') }); }
  for (const v of imos) if (!v.error) { if (v.eu.length) { pts += 5; flags.push({ k: 'imo_eu', input: v.imo }); } if (v.lists.length) { pts += 5; flags.push({ k: 'imo_list', input: v.imo, lists: [...new Set(v.lists.map(x => x.srcLabel))] }); } if (!v.checksumOk) { pts += 1; flags.push({ k: 'imo_checksum', input: v.imo }); } }
  for (const c of ctrs) if (!c.error) { if (c.fatf === 'black') { pts += 5; flags.push({ k: 'fatf_black', input: c.country.en }); } else if (c.fatf === 'grey') { pts += 2; flags.push({ k: 'fatf_grey', input: c.country.en }); } }
  for (const p of partyHits) if (p.hits.length) { pts += 5; flags.push({ k: 'party', input: p.name, score: p.hits[0].score }); }
  const level = pts >= 5 ? 'critical' : pts >= 4 ? 'high' : pts >= 2 ? 'medium' : 'low';
  const note = draftNote({ hs, imos, ctrs, partyHits, flags, level }, lang, body);
  return { level, points: pts, flags, hs, imos, countries: ctrs, parties: partyHits, note, generatedAt: new Date().toISOString(), lang };
}
function draftNote(r, lang, body) {
  const tr = lang === 'tr'; const T = I.dict(lang); const L_ = [];
  L_.push(`${T.tradeNoteTitle} – ${U.trDateShort(U.todayISO(require('./platform').tz))}`);
  if (body.ref) L_.push(`${tr ? 'Referans / işlem' : 'Reference / transaction'}: ${body.ref}`);
  L_.push(`${tr ? 'Genel ön risk seviyesi' : 'Overall pre-risk level'}: ${T.riskLevels[r.level]}`);
  L_.push('');
  for (const h of r.hs) {
    if (h.error) continue;
    if (!h.hit) L_.push(tr ? `• GTİP/HS ${h.input} (ilk 4 hane ${h.h4}): AB Reg. 833/2014 ekleri taranan veri setinde eşleşme bulunmadı.` : `• HS ${h.input} (first 4 digits ${h.h4}): no match in the scanned Reg. 833/2014 annex dataset.`);
    else L_.push((tr ? `• GTİP/HS ${h.input} (ilk 4 hane ${h.h4}): ` : `• HS ${h.input} (first 4 digits ${h.h4}): `) + h.groups.map(g => `${tr ? 'Ek' : 'Annex'} ${g.annex} (${tr ? 'Md.' : 'Art.'} ${g.article}, ${g.strength === 'strong' ? (tr ? 'kod düzeyinde eşleşme' : 'code-level match') : (tr ? 'başlık düzeyinde, kısmi kapsam olabilir' : 'heading-level, partial coverage possible')})`).join('; ') + (tr ? '. Kesin tespit için CN/TARIC 8 hane ve ek metni doğrulanmalıdır.' : '. Confirm at CN/TARIC 8-digit level against the annex text.'));
  }
  for (const v of r.imos) {
    if (v.error) { L_.push(tr ? `• IMO ${v.input}: geçersiz biçim.` : `• IMO ${v.input}: invalid format.`); continue; }
    const hits = [];
    if (v.eu.length) hits.push(`AB Reg. 833/2014 ${tr ? 'Ek' : 'Annex'} XLII (${tr ? 'Md.' : 'Art.'} 3s) – ${v.eu[0].name}`);
    for (const l of v.lists) hits.push(`${l.srcLabel}: ${l.name}`);
    L_.push(hits.length ? `• IMO ${v.imo}: ${tr ? 'yaptırım listelerinde kayıt bulundu' : 'found on sanctions lists'} – ${hits.join('; ')}.` : (tr ? `• IMO ${v.imo}: indirilen resmî listelerde (OFAC/UK/AB Ek XLII) kayıt bulunmadı; VesselFinder/Seasearcher ile bayrak, sahip ve rota geçmişi ayrıca doğrulanmalıdır.` : `• IMO ${v.imo}: no entry in the downloaded official lists (OFAC/UK/EU Annex XLII); verify flag, ownership and voyage history with VesselFinder/Seasearcher.`));
  }
  for (const c of r.ctrs) {
    if (c.error) { L_.push(tr ? `• Ülke “${c.input}” tanınamadı.` : `• Country “${c.input}” not recognised.`); continue; }
    const nm = tr ? c.country.tr : c.country.en;
    L_.push(`• ${nm}: ` + (c.fatf === 'black' ? (tr ? 'FATF yüksek riskli yargı alanı (karşı tedbir çağrısı).' : 'FATF high-risk jurisdiction (call for action).') : c.fatf === 'grey' ? (tr ? 'FATF artırılmış izleme listesinde (gri liste).' : 'FATF increased-monitoring list (grey list).') : (tr ? 'FATF listelerinde yer almıyor.' : 'not on FATF lists.')) + ` (${tr ? 'FATF açıklama tarihi' : 'FATF statement'} ${c.fatfDate})`);
  }
  for (const p of r.partyHits) L_.push(p.hits.length ? `• ${tr ? 'Taraf' : 'Party'} “${p.name}”: ${tr ? 'olası liste eşleşmesi' : 'possible list match'} – ${p.hits[0].entry.srcLabel}: ${p.hits[0].entry.name} (${tr ? 'skor' : 'score'} ${p.hits[0].score}).` : `• ${tr ? 'Taraf' : 'Party'} “${p.name}”: ${tr ? 'OFAC/UK/AB/BM listelerinde eşleşme yok (World-Check ayrıca kontrol edilmelidir).' : 'no match on OFAC/UK/EU/UN lists (check World-Check separately).'}`);
  L_.push('');
  L_.push(tr ? 'Gerekçe: Yukarıdaki bulgular otomatik ön tarama sonucudur; nihai değerlendirme ve karar analisttedir.' : 'Rationale: the findings above are the result of an automated pre-screen; the final assessment and decision rest with the analyst.');
  return L_.join('\n');
}
function searchHS(q) {
  load(); const digits = String(q || '').replace(/\D/g, ''); const text = M.fold(q || '');
  const out = [];
  for (const it of HS.items) {
    if (digits.length >= 2 ? (it.digits.startsWith(digits) || digits.startsWith(it.digits.slice(0, 4))) : (text.length > 2 && M.fold(it.desc).includes(text))) out.push(it);
    if (out.length >= 80) break;
  }
  return out;
}
function meta() { load(); return { celex: HS.celex, generatedAt: HS.generatedAt, source: HS.source, itemCount: HS.items.length, annexes: Object.entries(HS.annexes).map(([k, v]) => ({ annex: k, article: v.art, tr: v.tr, kind: v.kind, count: HS.items.filter(i => i.annex === k).length })), vessels: VES.vessels.length }; }
module.exports = { checkHS, checkIMO, checkCountry, assess, searchHS, meta, fatf: () => { load(); return FATF; }, gates: () => { load(); return GATES; }, countries, findCountry, fatfStatus };

};
defs["dd"] = function (module, exports, require, __dirname) {
'use strict';
const store = require('./store');
const U = require('./util');
const M = require('./match');

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'or', 'in', 'on', 'for', 'is', 'are', 'be', 'by', 'with', 'your', 'you', 'please', 'confirm', 'does', 'do', 'has', 'have', 'what', 'which', 'any', 'that', 'this', 'as', 'at', 'it', 'its', 'related', 'answer', 'question', 'wolfsberg', 'briefly', 'bank', 'anonim', 'sirketi', 'qnb', 'yes', 'no', 'how', 'when', 'from', 'than', 'such', 'will', 'not', 'we', 'our', 'if', 'been']);
const toks = s => M.fold(s).replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(t => t.length > 2 && !STOP.has(t));
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function monthsBetween(iso, today) { const a = new Date(iso + 'T00:00:00Z'), b = new Date(today + 'T00:00:00Z'); return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + (b.getUTCDate() >= a.getUTCDate() ? 0 : -1) ; }
function validityStatus(v, settings) {
  const today = U.todayISO(require('./platform').tz); const max = +settings[v.maxMonthsKey] || 12;
  if (!v.date) return { ...v, state: 'unknown', maxMonths: max, dueOn: null, daysLeft: null };
  const d = new Date(v.date + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + max); const due = U.isoDate(d);
  const left = U.daysBetween(today, due);
  return { ...v, state: left < 0 ? 'expired' : left <= 45 ? 'expiring' : 'valid', maxMonths: max, dueOn: due, daysLeft: left, ageMonths: monthsBetween(v.date, today) };
}
function renderAnswer(a, ctx) {
  const dd = store.dd(); const s = store.settings();
  let t = a.answer;
  if (a.linkedTo === 'policy') {
    const v = dd.validity.find(x => x.id === 'policy');
    if (v && v.date) { const [y, m, d] = v.date.split('-'); t = `${MONTHS_EN[+m - 1]} ${y} (approval date: ${d}/${m}/${y}).`; } else t = '[policy approval date not set]';
  }
  const bank = (ctx && ctx.bank) || 'QNB Bank Anonim Sirketi', corr = (ctx && ctx.correspondent) || '[CORRESPONDENT]';
  return t.replace(/\{\{BANK\}\}/g, bank).replace(/\{\{CORRESPONDENT\}\}/g, corr);
}
function renderQuestion(q, ctx) { return q.replace(/\{\{BANK\}\}/g, (ctx && ctx.bank) || 'QNB Bank Anonim Sirketi').replace(/\{\{CORRESPONDENT\}\}/g, (ctx && ctx.correspondent) || '[CORRESPONDENT]'); }

function splitQuestions(text) {
  const raw = String(text || '').replace(/\r/g, '');
  let lines = raw.split('\n').map(s => s.trim()).filter(Boolean);
  // CSV ise ilk sütun/“question” sütunu
  if (lines.length > 1 && /^"?(question|soru)/i.test(lines[0])) { const rows = U.parseCSV(raw); const qi = rows[0].findIndex(h => /question|soru/i.test(h)); lines = rows.slice(1).map(r => (r[qi] || '').trim()).filter(Boolean); }
  const out = []; let cur = '';
  for (const l of lines) {
    const clean = l.replace(/^(\d+[.)]|[a-z][.)]|[-•*])\s+/i, '');
    if (/^(dear|hope|regards|following|thank)/i.test(clean)) continue;
    cur = cur ? cur + ' ' + clean : clean;
    if (/[?:]$/.test(clean) || /\b(yes\/no|yes or no)\b/i.test(clean) || clean.length > 140) { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out.filter(q => q.length > 12);
}
function suggest(question, ctx) {
  const dd = store.dd(); const qt = toks(question); if (!qt.length) return null;
  const qset = new Set(qt); let best = null;
  for (const a of dd.library) {
    const at = new Set([...toks(a.question), ...a.keywords.flatMap(toks)]);
    let inter = 0; for (const t of qset) if (at.has(t)) inter++;
    const score = inter / Math.sqrt(qset.size * at.size);
    // Wolfsberg soru numarası eşleşmesi
    let wb = 0; if (a.wolfsberg) { const n = a.wolfsberg.replace(/^Q/, '').toLowerCase(); const re = new RegExp('question\\s+' + n.replace('-', '[ ,&a-z]*'), 'i'); if (re.test(question)) wb = 0.15; }
    const sc = Math.min(1, score + wb);
    if (!best || sc > best.score) best = { lib: a, score: sc };
  }
  if (!best || best.score < 0.28) return { score: best ? Math.round(best.score * 100) : 0, matched: false };
  return { matched: true, score: Math.round(best.score * 100), id: best.lib.id, answer: renderAnswer(best.lib, ctx), libStatus: best.lib.status, category: best.lib.category };
}
function draft(text, ctx, name) {
  const qs = splitQuestions(text);
  const rows = qs.map((q, i) => { const s = suggest(q, ctx); return { n: i + 1, question: q, suggestion: s, answer: s && s.matched ? s.answer : '', decision: '' }; });
  return { id: 'D' + U.uid(), name: name || 'Anket', createdAt: new Date().toISOString(), ctx, rows };
}
function overview() {
  const dd = store.dd(); const s = store.settings();
  return { ...dd, validity: dd.validity.map(v => validityStatus(v, s)), library: dd.library.map(a => ({ ...a, rendered: renderAnswer(a, {}) })) };
}
module.exports = { overview, validityStatus, renderAnswer, draft, suggest, splitQuestions, renderQuestion };

};
/* Tarayıcı motoru çekirdeği (build-static-demo.js, lib/*.js saf modüllerinin sonuna ekler).
 * Node bağımlılıklarını (fs, path, crypto, fetcher, store, lists, platform) taklit eder; sunucu mantığı AYNEN çalışır. */
const ENG = {
  base: '', files: {}, listMeta: {}, entries: [], index: null, ready: null,
  settings: { matchThreshold: 85, fourEyes: true, policyReviewMonths: 12, boardListMaxAgeMonths: 12, shareholdingMaxAgeMonths: 12, listsEnabled: [] },
  dd: null, customers: { meta: null, rows: [] }, blocklist: [],
};
function hex(s, n) { let out = ''; for (let k = 0; out.length < n; k++) { let h = 0x811c9dc5 ^ (k * 0x9e3779b1); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } out += (h >>> 0).toString(16).padStart(8, '0'); } return out.slice(0, n); }
const SRC_LABEL = { internal: 'Kurum içi liste', ofac: 'OFAC SDN', uk: 'UK Sanctions List', un: 'BM Konsolide', eu: 'AB Konsolide', tr: 'MASAK (OpenSanctions)', ofacc: 'OFAC Consolidated (non-SDN)', csl: 'BIS / ABD Ticaret CSL', ca: 'Kanada SEMA', ch: 'İsviçre SECO' };
const PAGE = { ofacc: 'https://ofac.treasury.gov/consolidated-sanctions-list-non-sdn-lists', csl: 'https://www.trade.gov/consolidated-screening-list', ca: 'https://www.international.gc.ca/world-monde/international_relations-relations_internationales/sanctions/consolidated-consolide.aspx?lang=eng', ch: 'https://www.sesam.search.admin.ch/sesam-search-web/pages/search.xhtml' };
const TYPE_LABEL = { p: 'Kişi', e: 'Kuruluş', v: 'Gemi', a: 'Hava aracı' };
function entryUrl(e) {
  if (e.s === 'ofac') return 'https://sanctionssearch.ofac.treas.gov/Details.aspx?id=' + e.id;
  if (e.s === 'uk') return 'https://search-uk-sanctions-list.service.gov.uk/';
  if (e.s === 'un') return 'https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list';
  if (e.s === 'eu') return e.url || 'https://www.sanctionsmap.eu/';
  return PAGE[e.s] || '';
}
function present(e) { return { src: e.s, srcLabel: SRC_LABEL[e.s] || e.s, id: e.id, name: e.n[0], aliases: e.n.slice(1, 6), type: TYPE_LABEL[e.t], program: e.c, listed: e.d || '', updated: e.u || '', imo: e.imo || [], url: entryUrl(e), vessel: e.v || null, ref: e.ref || e.un || '' }; }
const L = {
  DEFS: {}, SRC_LABEL, TYPE_LABEL, present, entryUrl,
  meta: () => ENG.listMeta,
  findByImo(imo) { imo = String(imo); return ENG.entries.filter(e => e.imo && e.imo.includes(imo)).map(present); },
  orgIndex() {
    const en = new Set(ENG.settings.listsEnabled && ENG.settings.listsEnabled.length ? ENG.settings.listsEnabled : Object.keys(ENG.listMeta));
    return { search(name, opts = {}) { const limit = opts.limit ?? 8; return ENG.index.search(name, { ...opts, limit: limit * 3 }).filter(h => en.has(h.entry.s)).slice(0, limit); } };
  },
  totalCount: () => ENG.entries.length,
};
const stubs = {
  fs: { readFileSync(p) { const b = String(p).split('/').pop(); if (b in ENG.files) return ENG.files[b]; const e = new Error('ENOENT ' + p); e.code = 'ENOENT'; throw e; }, existsSync: p => String(p).split('/').pop() in ENG.files },
  path: { join: (...a) => a.join('/').replace(/\/+/g, '/'), basename: p => String(p).split('/').pop(), resolve: (...a) => a.join('/') },
  crypto: {
    createHash() { let s = ''; return { update(x) { s += typeof x === 'string' ? x : ''; return this; }, digest() { return hex(s, 64); } }; },
    randomBytes(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return { toString: () => [...a].map(b => b.toString(16).padStart(2, '0')).join('') }; },
  },
  fetcher: { UA: () => 'Diurna-demo', text() { throw new Error('demo'); }, request() { throw new Error('demo'); } },
  platform: { tz: 'Europe/Istanbul' },
  lists: L,
  store: {
    settings: () => ENG.settings, dd: () => ENG.dd, saveDD: d => { ENG.dd = d; }, customers: () => ENG.customers, saveCustomers: c => { ENG.customers = c; },
    orgId: () => 'demo', blocklist: () => ENG.blocklist, runAs: (id, fn) => fn(),
  },
};
const cache = {};
function req(name) {
  name = String(name).replace(/^\.\//, '');
  if (stubs[name]) return stubs[name];
  if (cache[name]) return cache[name].exports;
  if (!defs[name]) throw new Error('demo: modül yok: ' + name);
  const m = { exports: {} }; cache[name] = m; defs[name](m, m.exports, req, '/lib'); return m.exports;
}
const tick = () => new Promise(r => setTimeout(r, 0));
/* Veri dosyaları + liste indeksi (ilk taramada tembel yüklenir) */
async function init(base, onProgress) {
  if (ENG.ready) return ENG.ready;
  ENG.ready = (async () => {
    ENG.base = base; const get = async (f, txt) => { const r = await fetch(base + f); if (!r.ok) throw new Error(f + ' ' + r.status); return txt ? r.text() : r.json(); };
    const idx = await get('lists/index.json'); ENG.listMeta = idx.meta || {};
    for (const f of ['hs-dataset.json', 'border-gates.json', 'fatf.json', 'eu-vessels.json', 'jurisdictions.json', 'sample-customers.csv']) { try { ENG.files[f] = await get(f, true); } catch { } }
    const M = req('match'); ENG.index = new M.NameIndex(); const srcs = Object.keys(idx.counts); let done = 0;
    const lists = await Promise.all(srcs.map(s => get('lists/' + s + '.json')));
    const total = srcs.reduce((a, s) => a + idx.counts[s], 0);
    for (const l of lists) { let n = 0; for (const e of l.entries) { ENG.entries.push(e); ENG.index.add(e); if (++n % 1500 === 0) { done += 1500; onProgress && onProgress(Math.min(1, done / total)); await tick(); } } }
    onProgress && onProgress(1);
    return ENG;
  })();
  return ENG.ready;
}
window.DemoEngine = { ENG, req, init, L, present };

})();
