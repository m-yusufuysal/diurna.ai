'use strict';
/* Yapay zekâ özellikleri (tümü insan onaylı taslak; yalnızca verilen kaynaklara dayanır; her satır [kaynak] atfı taşır).
 * Atıf doğrulaması: kaynak listesinde olmayan atıf, atıfsız satır ya da kaynaklarda bulunmayan sayı içeren satır ATILIR.
 * Kayıt: audit.json'a üst veri + özet (SHA-256), tam istem/çıktı kiracıya özel ai-log.json'a (en çok 300). */
const fs = require('fs'); const path = require('path');
const LLM = require('./llm'); const GL = require('./glossary'); const store = require('./store'); const U = require('./util');
const err = (code, message) => Object.assign(new Error(message), { code });
function status() {
  const i = LLM.info(); const s = store.settings(); const st = s.ai?.enabled;
  const enabled = i.configured && (st === true || (st == null && i.onprem));
  return { configured: i.configured, onprem: i.onprem, model: i.model, endpoint: i.endpoint, setting: st ?? null, enabled };
}
function allowed() {
  const st = status();
  if (!st.configured) throw err('not_configured', 'Yapay zekâ sağlayıcısı yapılandırılmamış. Yönetici UM_LLM_BASE_URL, UM_LLM_API_KEY ve UM_LLM_MODEL ortam değişkenlerini tanımlamalıdır (OpenAI, Azure OpenAI, xAI veya kurum içi vLLM/Ollama).');
  if (!st.enabled) throw err('ai_disabled', 'Bu kurum için yapay zekâ (harici LLM) kapalı. Yönetim → Güvenlik bölümünden bir yönetici açabilir (veri yerleşimi politikası).');
  return st;
}
const digits = s => s.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
function ground(text, ids, srcAll) {
  const hay = digits(srcAll); const kept = []; let dropped = 0;
  for (const raw of text.split('\n')) {
    const l = raw.trim(); if (!l) { if (kept.length && kept[kept.length - 1] !== '') kept.push(''); continue; }
    if (/^#{1,4}\s/.test(l)) { kept.push(l); continue; }
    const cites = [...l.matchAll(/\[([A-Za-z0-9_.:-]+)\]/g)].map(m => m[1]);
    if (!cites.length || cites.some(c => !ids.has(c))) { dropped++; continue; }
    const body = digits(l.replace(/\[[^\]]*\]/g, '').replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ''));
    const nums = body.match(/\d[\d.,/]*/g) || [];
    if (nums.some(n => !hay.includes(n.replace(/[.,/]+$/, '')))) { dropped++; continue; }
    kept.push(l);
  }
  return { text: kept.join('\n').trim(), dropped };
}
const BASE = lang => `You are a drafting assistant for bank sanctions-compliance analysts. Write in ${GL.LANGN[lang]}.
HARD RULES: (1) Use ONLY facts present in SOURCES. Never invent names, dates, numbers, legal citations, programmes, outcomes or recommendations of fact. (2) Output bullet lines starting with "- ". EVERY line must end with one or more source citations in square brackets, e.g. [n1][n2], using only the given source ids. (3) Copy names, IDs, IMO numbers and numbers exactly as in SOURCES. (4) You only draft; a human decides. Phrase any action as a suggestion to verify ("consider checking…"), not as a decision. (5) If the sources are insufficient, output exactly: INSUFFICIENT.
Terminology glossary:\n${GL.prompt(lang)}`;
const NOINFO = { tr: 'Kaynaklar bu istek için yetersiz; taslak üretilmedi.', en: 'The sources are insufficient for this request; no draft was produced.', ar: 'المصادر غير كافية لهذا الطلب؛ لم يُنشأ مسودة.' };
function logAI(user, task, ref, sys, usr, out, meta) {
  try {
    const f = path.join(store.orgDir(), 'ai-log.json'); let a = []; try { a = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { }
    const id = 'AI' + U.uid().slice(0, 6); a.unshift({ id, ts: new Date().toISOString(), user: user?.name || 'sistem', task, ref, model: meta.model, system: sys, prompt: usr, output: out, ...meta.extra });
    fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(a.slice(0, 300)));
    store.logAudit(user, 'ai.' + task, ref || '', `model=${meta.model}; istem#${U.sha256(sys + usr).slice(0, 10)}; çıktı#${U.sha256(out).slice(0, 10)}; ${out.length} krk; atılan satır=${meta.extra.dropped ?? 0}; kayıt=${id}`);
    return id;
  } catch (e) { console.error('ai-log', e.message); return null; }
}
async function run({ user, task, ref, sources, instruction, lang = 'tr', maxTokens = 900 }) {
  allowed(); lang = GL.LANGN[lang] ? lang : 'tr';
  if (!sources.length) return { text: '', insufficient: true, message: NOINFO[lang], sources: [], label: label(lang) };
  const sys = BASE(lang) + '\nTASK: ' + instruction; const usr = 'SOURCES:\n' + sources.map(s => `[${s.id}] ${s.text}`).join('\n\n');
  const r = await LLM.chat({ system: sys, user: usr, temperature: 0.1, maxTokens });
  const ids = new Set(sources.map(s => s.id)); const raw = r.text;
  if (raw.trim() === 'INSUFFICIENT') { logAI(user, task, ref, sys, usr, raw, { model: r.model, extra: { dropped: 0, insufficient: true } }); return { text: '', insufficient: true, message: NOINFO[lang], sources: [], label: label(lang) }; }
  const g = ground(raw, ids, sources.map(s => s.text).join('\n'));
  const used = sources.filter(s => new RegExp('\\[' + s.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\]').test(g.text));
  const logId = logAI(user, task, ref, sys, usr, raw, { model: r.model, extra: { dropped: g.dropped, kept: g.text.split('\n').filter(Boolean).length } });
  if (!g.text) return { text: '', insufficient: true, message: NOINFO[lang], dropped: g.dropped, sources: [], label: label(lang), logId };
  return { text: g.text, dropped: g.dropped, sources: used.map(s => ({ id: s.id, title: s.title, url: s.url, meta: s.meta })), model: r.model, label: label(lang), logId };
}
const label = lang => ({ tr: 'Yapay zekâ taslağı — insan onayı gerekir; kaynakları doğrulayın', en: 'AI draft — requires human review; verify the sources', ar: 'مسودة بالذكاء الاصطناعي — تتطلب مراجعة بشرية؛ تحقّق من المصادر' }[lang]);
const itemSrc = (it, id) => ({ id, title: it.title, url: it.url, meta: `${it.source || it.srcKey || ''} · ${it.date || ''}`, text: `${it.title}. Type: ${it.type}. Date: ${it.date}. Source: ${it.source || it.srcKey}. ${typeof it.summary === 'string' ? it.summary : (it.summary?.en || it.summary?.tr || '')} ${(it.entities || []).slice(0, 8).map(e => `Entity: ${e.name}${e.imo?.length ? ' IMO ' + e.imo.join(',') : ''}${e.program ? ' programme ' + e.program : ''}`).join('; ')}` });

/* 1) Günün özeti */
const summary = ({ user, items, lang }) => run({ user, task: 'summary', ref: 'bugun', lang, sources: items.slice(0, 20).map((it, i) => itemSrc(it, 'n' + (i + 1))), instruction: 'Write the daily briefing: at most 6 bullets, most important first (new designations, delistings, general licences, enforcement). Mention counts only if derivable from the sources.' });
/* 2) Bülten kalemi taslağı */
const bulletinDraft = ({ user, item, lang }) => run({ user, task: 'bulletin', ref: item.id, lang, maxTokens: 500, sources: [itemSrc(item, 'n1')], instruction: 'Draft the analyst note for a daily bulletin entry: 2-4 bullets (what happened, who/what is affected, what the analyst should verify next). No decisions.' });
/* 3) Eşleşme açıklaması */
const explainHit = ({ user, query, entry, score, reasons, lang }) => run({ user, task: 'hit', ref: String(entry?.id || ''), lang, maxTokens: 500, sources: [
  { id: 'Q', title: 'Aranan', text: `Searched/customer record: ${query?.name || ''}${query?.imo ? ' IMO ' + query.imo : ''}${query?.country ? ' country ' + query.country : ''}${query?.type ? ' type ' + query.type : ''}` },
  { id: 'L1', title: entry?.name, url: entry?.url, meta: entry?.srcLabel, text: `List entry: ${entry?.name}. Aliases: ${(entry?.aliases || []).join('; ') || 'none'}. List: ${entry?.srcLabel}. Type: ${entry?.type}. Programme: ${entry?.program || 'n/a'}. Listed: ${entry?.listed || 'n/a'}. IMO: ${(entry?.imo || []).join(',') || 'n/a'}. Match score ${score}. Match reasons: ${(reasons || []).map(r => typeof r === 'string' ? r : JSON.stringify(r)).join('; ')}.` }],
  instruction: 'Explain in 3-5 bullets why the search matched this list entry (name similarity, alias, identifier) and what the analyst should verify to confirm or discard it (e.g. date of birth, nationality, ID number, address, ownership) — only mention checks relevant to fields absent from the sources.' });
/* 4) Mevzuat özeti (EUR-Lex / Federal Register) */
async function regSummary({ user, item, lang }) {
  let body = ''; try { if (item.url && /^https:\/\//.test(item.url)) { const html = await U.fetchText(item.url, { timeout: 30000, retries: 0 }); body = U.stripTags(html).replace(/\s+/g, ' ').trim(); } } catch { }
  const base = typeof item.summary === 'string' ? item.summary : (item.summary?.en || item.summary?.tr || '');
  if (body.length < 300) body = `${item.title}. ${base}`;
  const chunks = body.slice(0, 16000).match(/[^]{1,900}(?:\s|$)/g) || [body];
  return run({ user, task: 'regulation', ref: item.id, lang, maxTokens: 1000, sources: chunks.slice(0, 18).map((c, i) => ({ id: 'p' + (i + 1), title: item.title, url: item.url, meta: item.source || '', text: c.trim() })),
    instruction: 'Summarise this regulation/notice: first bullet = purpose and scope; then bullets for each key article/section/annex (name its number exactly as written), obligations, effective dates and who is affected. Cite the paragraph ids.' });
}
/* 5) DD yanıt taslağı — yalnızca onaylı kütüphaneden */
const tk = s => new Set((s.toLowerCase().match(/[a-zçğıöşü0-9]{3,}/g) || []));
async function ddDraft({ user, question, lang }) {
  const q = tk(question); const lib = (store.dd().library || []).filter(a => a.status === 'approved');
  const sc = lib.map(a => { const t = tk(a.question + ' ' + (a.keywords || []).join(' ') + ' ' + a.answer); let n = 0; for (const x of q) if (t.has(x)) n++; return [n / Math.sqrt(q.size * t.size || 1), a]; }).filter(x => x[0] > 0.04).sort((a, b) => b[0] - a[0]).slice(0, 4);
  return run({ user, task: 'dd', ref: question.slice(0, 60), lang, maxTokens: 700, sources: sc.map(([, a]) => ({ id: 'L' + a.id, title: a.question, meta: `${a.category} · onaylı`, text: `Approved question: ${a.question}\nApproved answer: ${a.answer}` })),
    instruction: 'Draft an answer to the correspondent-bank questionnaire QUESTION using only the approved library answers in SOURCES. If no approved answer covers it, output INSUFFICIENT. Do not add facts.' + `\nQUESTION: ${question}` });
}
/* 6) Ticaret kontrolü analist notu */
function flat(o, p = '', out = []) { if (out.length > 60) return out; if (Array.isArray(o)) o.slice(0, 12).forEach((v, i) => flat(v, p + '[' + i + ']', out)); else if (o && typeof o === 'object') for (const k of Object.keys(o)) flat(o[k], p ? p + '.' + k : k, out); else if (o !== null && o !== undefined && o !== '' && o !== false) out.push(`${p}: ${o}`); return out; }
const tradeNote = ({ user, result, ref, lang }) => run({ user, task: 'trade', ref: ref || 'ticaret', lang, maxTokens: 700, sources: flat(result).slice(0, 40).map((t, i) => ({ id: 't' + (i + 1), title: 'Ticaret kontrolü', meta: '', text: t })),
  instruction: 'Write a short analyst note for this trade-finance check: overall level, the factors that drove it (HS code restrictions, vessel/IMO hits, FATF/high-risk countries, border gates) and suggested follow-up checks. Only state what the results show.' });
/* 7) E-posta: günün özeti bloğu (önbellekli) */
async function dailyBlock(items, lang) {
  const st = status(); if (!st.enabled) return null; const day = U.todayISO('UTC'); const f = path.join(store.orgDir(), 'ai-cache.json'); let c = {}; try { c = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { }
  const key = day + '|' + lang + '|' + U.sha256(items.slice(0, 20).map(i => i.id).join(',')).slice(0, 8); if (c.key === key && c.res) return c.res;
  const res = await summary({ user: { name: 'sistem', role: '-' }, items, lang }); if (res.text) { fs.writeFileSync(f, JSON.stringify({ key, res })); } return res.text ? res : null;
}
module.exports = { status, allowed, ground, run, summary, bulletinDraft, explainHit, regSummary, ddDraft, tradeNote, dailyBlock, label };
