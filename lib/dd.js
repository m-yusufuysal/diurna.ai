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
