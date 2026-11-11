'use strict';
/* İkincil kimlik doğrulayıcılar: doğum yılı/tarihi, kimlik/pasaport/vergi no, kripto adresi.
 * Ad eşleşmesi tek başına karar vermez: müşteri CSV'sindeki kimlik_no / dogum_yili alanları listedeki kayıtla doğrulanır.
 *  - Kimlik/adres BİREBİR eşleşirse: kesin eşleşme (ayrıca doğrudan arama ile bulunur; ad farklı yazılmış olsa bile).
 *  - Doğum yılı çelişirse (±1 yıl hoşgörü): puan düşürülür, “yob_conflict” gerekçesi eklenir; eşiğin altına inerse elenir (yanlış pozitif azalır).
 *  - Doğum yılı uyumluysa küçük bonus. İyi niyetli (good-guy) çiftler bastırılır ve denetim kaydına yazılır. */
const M = require('./match');
const YEAR = /\b(1[89]\d{2}|20[0-4]\d)\b/g;
const MON = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
function parseRemarks(rm) {
  const out = { dobs: [], ids: [], nat: [], wallets: [] }; rm = String(rm || ''); if (!rm) return out;
  for (const m of rm.matchAll(/DOB\s+([^;]+)/gi)) {
    const seg = m[1]; const full = /(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(seg);
    if (full && MON[full[2].toLowerCase()]) out.dobs.push(`${full[3]}-${MON[full[2].toLowerCase()]}-${full[1].padStart(2, '0')}`);
    for (const y of seg.match(YEAR) || []) if (!out.dobs.some(d => d.startsWith(y))) out.dobs.push(y);
  }
  for (const m of rm.matchAll(/(?:Passport|National ID No\.|Tax ID No\.|Registration ID|Identification Number|Cedula No\.|SSN|Driver's License No\.|Business Registration Number|Commercial Registry Number|Registration Number|Citizen ID|Government Gazette Number|Legal Entity Number|LEI)\s*(?:No\.?|Number)?\s*([A-Za-z0-9][A-Za-z0-9\-\/]{4,24})/gi)) out.ids.push(m[1]);
  for (const m of rm.matchAll(/Digital Currency Address\s*-\s*[A-Z0-9]+\s+([A-Za-z0-9]{20,})/g)) out.wallets.push(m[1]);
  for (const m of rm.matchAll(/nationality\s+([^;]+)/gi)) out.nat.push(m[1].trim());
  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])];
  return out;
}
const yearsOf = e => [...new Set([...(e.dobs || []), ...(e.dob ? [e.dob] : [])].map(d => +String(d).slice(0, 4)).filter(y => y > 1800))];
const custYear = c => { const m = String(c.yob || '').match(YEAR); return m ? +m[0] : null; };
/* hits: [{entry, score, reasons, ...}] → güncellenmiş, süzülmüş liste; dropped: elenenler (denetim için) */
function adjust(c, hits, { thresholdOf, goodGuys = [] } = {}) {
  const cy = custYear(c); const out = []; const dropped = [];
  for (const h of hits) {
    const e = h.entry; const x = { ...h, reasons: [...h.reasons] };
    if (goodGuys.some(g => g.customerId === c.id && g.src === e.s && g.entryId === e.id)) { dropped.push({ h, why: 'good_guy' }); continue; }
    const ey = yearsOf(e);
    if (cy && ey.length) {
      if (ey.some(y => Math.abs(y - cy) <= 1)) { x.score = Math.min(100, x.score + 4); x.reasons.push('yob'); }
      else { x.score = Math.max(0, x.score - 18); x.reasons.push('yob_conflict'); }
    }
    if (x.score < (thresholdOf ? thresholdOf(e.s) : 0)) { dropped.push({ h: x, why: 'yob_conflict' }); continue; }
    out.push(x);
  }
  return { hits: out.sort((a, b) => b.score - a.score), dropped };
}
const idsOf = c => [...new Set([c.taxId, ...(c.ids || [])].map(x => String(x || '').trim()).filter(x => M.idKey(x).length >= 6))];
module.exports = { parseRemarks, adjust, idsOf, yearsOf };
