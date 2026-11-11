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
