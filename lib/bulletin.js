'use strict';
const store = require('./store');
const U = require('./util');
const I = require('./i18n');
const scan = require('./scan');
const esc = U.esc;

function localDate(iso, lang) { const d = new Date(iso + 'T12:00:00Z'); return new Intl.DateTimeFormat(I.dict(lang).locale, { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long', timeZone: 'UTC' }).format(d); }
function shortDate(iso) { return U.trDateShort(iso); }
const FORBIDDEN_AFFILIATE = [/base tespiti/i, /customer[- ]base/i, /base finding/i, /müşteri tabanı/i, /baseCheck/i];

function snapshotItem(it) {
  return {
    itemId: it.id, included: !(it.type === 'INFO' && it.srcKey !== 'fatf' && !it.keywords.length), src: it.srcKey, source: it.source, date: it.date, type: it.type, rule: it.rule,
    title: it.title, summary: it.summary, url: it.url, method: it.method, keywords: it.keywords, ojRef: it.ojRef,
    entities: (it.entities || []).slice(0, 40).map(e => ({ name: e.name, type: e.type, imo: e.imo, program: e.program, aliases: (e.aliases || []).slice(0, 4) })), entityTotal: (it.entities || []).length,
    vesselWarning: !!it.vesselWarning,
    auto: it.baseCheck ? { state: it.baseCheck.state, matches: it.baseCheck.matches.slice(0, 6) } : null,
    base: { decision: '', note: '' },   // 'var' | 'yok' | ''
    edit: { title: '', summary: '' }, note: '',
  };
}
function create(date, user, lang) {
  const bulls = store.bulletins();
  const s = store.settings();
  const b = {
    id: 'B' + date.replace(/-/g, '') + '-' + U.uid().slice(0, 4), date, lang: lang || 'tr', status: 'draft', createdAt: new Date().toISOString(), createdBy: user?.name || 'sistem',
    lookback: s.lookbackDays, intro: '', outro: '', items: scan.items().filter(i => i.date >= scan.orgWindow().start).map(snapshotItem), approvals: [], history: [], autoSynced: new Date().toISOString(),
  };
  bulls.push(b); store.saveBulletins(bulls); return b;
}
/* Taslak durumundaki bülten, yeni gelen öğelerle kendiliğinden güncellenir */
function syncDraft(b) {
  if (b.status !== 'draft') return false;
  const have = new Set(b.items.map(i => i.itemId)); let added = 0;
  const s = store.settings();
  for (const it of scan.items()) if (!have.has(it.id) && it.date >= scan.orgWindow().start) { b.items.push(snapshotItem(it)); added++; }
  // otomatik base sonucu güncel kalsın (analist kararı korunur)
  const live = new Map(scan.items().map(i => [i.id, i]));
  for (const bi of b.items) { const l = live.get(bi.itemId); if (l && l.baseCheck) bi.auto = { state: l.baseCheck.state, matches: l.baseCheck.matches.slice(0, 6) }; }
  if (added) b.autoSynced = new Date().toISOString();
  return added;
}
function todayBulletin(user) {
  const s = store.settings(); const date = scan.orgWindow().end;
  const all = store.bulletins();
  let b = all.find(x => x.date === date && x.status !== 'approved') || all.find(x => x.date === date);
  if (!b) return create(date, user);
  if (b.status === 'draft') { const n = syncDraft(b); if (n) store.saveBulletins(all); }
  return b;
}
function baseState(bi) {
  if (!['ADD', 'DEL'].includes(bi.type)) return null;
  if (bi.base.decision) return bi.base.decision;       // 'var' | 'yok'
  return null;
}
function validateForApproval(b) {
  const errs = [];
  for (const i of b.items) if (i.included && ['ADD', 'DEL'].includes(i.type) && !i.base.decision) errs.push({ code: 'base_missing', itemId: i.itemId, title: i.edit.title || i.title });
  if (!b.items.some(i => i.included)) errs.push({ code: 'empty' });
  return errs;
}
function hashOf(b) { return U.sha256(JSON.stringify({ d: b.date, i: b.items.filter(x => x.included), intro: b.intro, outro: b.outro, lang: b.lang })); }

function overallBase(b) {
  const rel = b.items.filter(i => i.included && ['ADD', 'DEL'].includes(i.type));
  if (!rel.length) return { state: 'none_items' };
  if (rel.some(i => i.base.decision === 'var')) return { state: 'var' };
  if (rel.every(i => i.base.decision === 'yok')) return { state: 'yok' };
  return { state: 'pending' };
}
function entLine(e, T) {
  return `${e.name}${e.imo && e.imo.length ? ' (IMO ' + e.imo.join(', ') + ')' : ''} [${T.entTypes[e.type] || e.type}]`;
}
function entitySummary(it, T) {
  const list = it.entities.slice(0, 6).map(e => entLine(e, T));
  const more = it.entityTotal - list.length;
  return list.join('; ') + (more > 0 ? ` … +${more} ${T.moreEntities}` : '');
}
function itemText(it, lang) { const x = it.edit.summary || it.summary; return typeof x === 'object' ? (x[lang] || x.tr) : x; }
function itemTitle(it) { return it.edit.title || it.title; }
function baseWord(bi, T) { return bi.base.decision === 'var' ? T.yesBase : bi.base.decision === 'yok' ? T.noBase : T.pendingBase; }

/* Bülten modeli → HTML / metin. version: 'internal' | 'affiliate' */
function render(b, version, lang, format, opts = {}) {
  lang = lang || b.lang || 'tr'; const T = I.dict(lang); const internal = version === 'internal';
  const items = b.items.filter(i => i.included);
  const statusLabel = b.status === 'approved' ? T.approved : b.status === 'review' ? T.review : T.draft;
  const act = (i) => (internal ? T.actInternal : T.actAffiliate)[i.rule] || '';
  const bySrc = {}; for (const i of items) (bySrc[i.src] = bySrc[i.src] || []).push(i);
  const order = ['ofac', 'uk', 'eu', 'un', 'fatf'].filter(k => bySrc[k]);
  const s = store.settings(); const ob = overallBase(b);
  const approval = b.approvals[b.approvals.length - 1];
  const versionLabel = internal ? T.internal : T.affiliate;
  const hash = b.contentHash || hashOf(b);

  if (format === 'text') {
    const L = [];
    L.push(`${T.bulletinTitle.toUpperCase()} – ${versionLabel.toUpperCase()}`);
    L.push(`${s.institution} · ${T.preparedFor}: ${s.department}`);
    L.push(`${T.date}: ${localDate(b.date, lang)}   [${statusLabel}]`);
    if (b.intro && (internal || !FORBIDDEN_AFFILIATE.some(re => re.test(b.intro)))) { L.push(''); L.push(b.intro); }
    if (internal) { L.push(''); L.push(`${T.baseOverall}: ${ob.state === 'var' ? T.baseYesText : ob.state === 'yok' ? T.baseNoText : ob.state === 'none_items' ? T.baseNoText + ' (' + (lang === 'tr' ? 'yeni listeleme yok' : 'no new designations') + ')' : T.pendingBase}`); }
    if (!items.length) { L.push(''); L.push(T.noItems); }
    for (const k of order) {
      L.push(''); L.push(`■ ${T.srcNames[k]}`);
      for (const it of bySrc[k]) {
        L.push(`• [${T.types[it.type]}] ${shortDate(it.date)} – ${itemTitle(it)}`);
        const txt = itemText(it, lang); if (txt) L.push(`  ${txt}`);
        if (it.entities.length) L.push(`  ${T.entities}: ${entitySummary(it, T)}`);
        L.push(`  ${T.colAction}: ${act(it)}`);
        if (internal && ['ADD', 'DEL'].includes(it.type)) L.push(`  ${T.baseLine}: ${baseWord(it, T)}${it.base.note ? ' – ' + it.base.note : ''}`);
        if (it.vesselWarning) L.push(`  ⚠ ${T.vesselWarn}`);
        if (it.note && (internal || !FORBIDDEN_AFFILIATE.some(re => re.test(it.note)))) L.push(`  ${T.analystNote}: ${it.note}`);
        L.push(`  ${T.sourceLink}: ${it.url}`);
      }
    }
    if (b.outro && (internal || !FORBIDDEN_AFFILIATE.some(re => re.test(b.outro)))) { L.push(''); L.push(b.outro); }
    L.push(''); L.push(T.disclaimer);
    L.push(internal ? T.footerInternal : T.footerAffiliate);
    if (approval) L.push(`${T.approvedBy}: ${approval.by} (${approval.role}) – ${approval.at.slice(0, 16).replace('T', ' ')}`);
    return L.join('\n');
  }

  // HTML (bağımsız, yazdırılabilir)
  const css = `
  :root{--navy:#0B1F3A;--cream:#f5f3ed;--ink:#17212f;--muted:#5d6a7c;--line:#e3dfd2;--accent:#c58a1b;--green:#1d6b4f;--red:#a63a3a}
  *{box-sizing:border-box}body{font-family:'IBM Plex Sans','Segoe UI',Arial,sans-serif;color:var(--ink);background:#fff;margin:0;padding:32px;line-height:1.5;font-size:13.5px}
  .sheet{max-width:900px;margin:0 auto}.hd{border-bottom:3px solid var(--navy);padding-bottom:14px;margin-bottom:18px;display:flex;justify-content:space-between;gap:20px;align-items:flex-end}
  h1{font-family:'Source Serif 4',Georgia,serif;font-size:26px;margin:0;color:var(--navy)}h2{font-family:'Source Serif 4',Georgia,serif;font-size:17px;color:var(--navy);margin:22px 0 8px;border-bottom:1px solid var(--line);padding-bottom:4px}
  .meta{color:var(--muted);font-size:12.5px}.pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11.5px;font-weight:600;border:1px solid var(--line);background:var(--cream)}
  .pill.draft{background:#fdf2dc;color:#8a5a00;border-color:#efd9a6}.pill.ok{background:#e3f3ec;color:var(--green);border-color:#bfe0d1}
  table{width:100%;border-collapse:collapse;margin:8px 0}th,td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--line);vertical-align:top;font-size:12.5px}th{background:var(--cream);color:var(--navy);font-weight:600}
  .it{border:1px solid var(--line);border-left:4px solid var(--navy);border-radius:6px;padding:10px 14px;margin:9px 0;page-break-inside:avoid}
  .it.ADD{border-left-color:var(--red)}.it.DEL{border-left-color:var(--accent)}.it.UPD{border-left-color:#3b6ea5}.it.GL{border-left-color:var(--green)}
  .tag{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}.t{font-weight:600;margin:2px 0}.kv{color:var(--ink);font-size:12.5px;margin-top:3px}.kv b{color:var(--navy)}
  .base{margin-top:4px;padding:4px 8px;background:var(--cream);border-radius:4px;display:inline-block;font-size:12.5px}.warn{color:var(--red);font-weight:600}
  .wm{position:fixed;top:42%;left:6%;font-size:68px;color:rgba(197,138,27,.13);transform:rotate(-18deg);font-weight:700;letter-spacing:.08em;pointer-events:none;white-space:nowrap}
  .ft{margin-top:26px;border-top:1px solid var(--line);padding-top:10px;color:var(--muted);font-size:11.5px}a{color:#1b4f8f}
  @media print{body{padding:0}.wm{position:fixed}}`;
  const sumRows = items.map(i => `<tr><td>${esc(T.srcNames[i.src])}</td><td>${esc(T.types[i.type])} · ${esc(shortDate(i.date))}</td><td>${esc(act(i))}</td>${internal ? `<td>${['ADD', 'DEL'].includes(i.type) ? esc(baseWord(i, T)) : '—'}</td>` : ''}</tr>`).join('');
  let sections = '';
  for (const k of order) {
    sections += `<h2>${esc(T.srcNames[k])}</h2>`;
    for (const it of bySrc[k]) {
      const txt = itemText(it, lang);
      sections += `<div class="it ${esc(it.type)}"><div class="tag">${esc(T.types[it.type])} · ${esc(shortDate(it.date))}</div><div class="t">${esc(itemTitle(it))}</div>`
        + (txt ? `<div>${esc(txt)}</div>` : '')
        + (it.entities.length ? `<div class="kv"><b>${esc(T.entities)}:</b> ${esc(entitySummary(it, T))}</div>` : '')
        + `<div class="kv"><b>${T.colAction}:</b> ${esc(act(it))}</div>`
        + (internal && ['ADD', 'DEL'].includes(it.type) ? `<div class="base"><b>${esc(T.baseLine)}:</b> ${esc(baseWord(it, T))}${it.base.note ? ' – ' + esc(it.base.note) : ''}</div>` : '')
        + (it.vesselWarning ? `<div class="warn">⚠ ${esc(T.vesselWarn)}</div>` : '')
        + (it.note && (internal || !FORBIDDEN_AFFILIATE.some(re => re.test(it.note))) ? `<div class="kv"><b>${esc(T.analystNote)}:</b> ${esc(it.note)}</div>` : '')
        + `<div class="kv"><b>${esc(T.sourceLink)}:</b> <a href="${esc(it.url)}">${esc(it.url)}</a></div></div>`;
    }
  }
  const baseTxt = ob.state === 'var' ? T.baseYesText : ob.state === 'yok' ? T.baseNoText : ob.state === 'none_items' ? T.baseNoText + ' (' + (lang === 'tr' ? 'yeni listeleme yok' : 'no new designations') + ')' : T.pendingBase;
  const html = `<!doctype html><html lang="${lang}" dir="${T.dir || 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(T.bulletinTitle)} – ${esc(b.date)} – ${esc(versionLabel)}</title><style>${css}</style></head><body>
  ${b.status !== 'approved' ? `<div class="wm">${esc(T.draft)}</div>` : ''}
  <div class="sheet"><div class="hd"><div><div class="meta">${esc(s.institution)} · ${esc(s.department)}</div><h1>${esc(T.bulletinTitle)}</h1><div class="meta">${esc(localDate(b.date, lang))} · ${esc(T.version)}: <b>${esc(versionLabel)}</b></div></div><div><span class="pill ${b.status === 'approved' ? 'ok' : 'draft'}">${esc(statusLabel)}</span></div></div>
  ${b.intro && (internal || !FORBIDDEN_AFFILIATE.some(re => re.test(b.intro))) ? `<p>${esc(b.intro)}</p>` : ''}
  ${internal ? `<p><span class="base"><b>${esc(T.baseOverall)}:</b> ${esc(baseTxt)}</span></p>` : ''}
  ${items.length ? `<h2>${esc(T.summaryTable)}</h2><table><thead><tr><th>${esc(T.colSource)}</th><th>${esc(T.colEvent)}</th><th>${esc(T.colAction)}</th>${internal ? `<th>${esc(T.colBase)}</th>` : ''}</tr></thead><tbody>${sumRows}</tbody></table>` : `<p>${esc(T.noItems)}</p>`}
  ${sections}
  ${b.outro && (internal || !FORBIDDEN_AFFILIATE.some(re => re.test(b.outro))) ? `<p>${esc(b.outro)}</p>` : ''}
  <div class="ft"><div>${esc(T.disclaimer)}</div><div>${esc(internal ? T.footerInternal : T.footerAffiliate)}</div>
  ${approval ? `<div>${esc(T.approvedBy)}: <b>${esc(approval.by)}</b> (${esc(approval.role)}) · ${esc(T.approvedAt)}: ${esc(approval.at.slice(0, 16).replace('T', ' '))} UTC</div>` : ''}
  <div>${esc(T.integrity)}: <code>${esc(hash.slice(0, 32))}</code> · ID ${esc(b.id)}</div></div></div></body></html>`;
  if (!internal) assertAffiliateClean(html, b);
  return html;
}
function assertAffiliateClean(out, b) {
  for (const re of FORBIDDEN_AFFILIATE) if (re.test(out)) {
    // kaynak metninde (başlık/özet) kendiliğinden geçen ifadeleri hariç tutmak için yalnızca kalıp kontrolü: şablon kaynaklıysa hata
    const m = re.exec(out); const ctx = out.slice(Math.max(0, m.index - 40), m.index + 60);
    const inSource = b.items.some(i => re.test(i.title + ' ' + (i.edit.title || '') + ' ' + (i.edit.summary || '') + ' ' + JSON.stringify(i.summary) + ' ' + (i.note || '')));
    if (!inSource) throw new Error('İştirak bülteninde base bilgisi bulundu: ' + ctx);
  }
}
module.exports = { create, syncDraft, todayBulletin, render, validateForApproval, hashOf, overallBase, snapshotItem, FORBIDDEN_AFFILIATE };
