import { S, h, t, L, api, me, esc, rel, fmtD, fmtDT, num } from '../core.js';
import motor from './motor.js';
import { icon, tabsBar, emptyState, tip, statusPill, srcName, trBtn } from '../ui.js';
const TABS = [['', 'src.dir'], ['durum', 'src.status'], ['fatf', 'src.tabFatf'], ['kapilar', 'src.gates'], ['mevzuat', 'src.reg'], ['motor', 'src.engine']];
const head = sub => h`<div class="page-head"><div><div class="eyebrow">${t('nav.kaynaklar')}</div><h1>${t('src.title')}</h1><p>${t('src.sub')}</p></div></div>${tabsBar('#/kaynaklar', TABS, sub || '')}`;
const BCLS = { ok: 'ok', on_demand: 'info', partial: 'warn', blocked: 'err', pending: '', off_admin: '', off_license: '', off_platform: '', link: '', data: '', info: '', external: '' };
const staticState = a => ({ link: 'link', data: 'data', info: 'info', external: 'external' })[a] || 'link';
function badge(i, stt) {
  const st = (i.key && stt[i.key]) || { state: staticState(i.auto) }; const c = BCLS[st.state] ?? '';
  const sub = st.total ? ` ${st.ok}/${st.total}` : '';
  return h`<span class="badge ${c}"${st.lastOk ? h` title="${t('src.lastOk')}: ${fmtDT(st.lastOk)}"` : ''}>${t('src.st.' + st.state)}${sub}</span>`;
}
function note(i, stt, isAdmin) {
  const st = (i.key && stt[i.key]) || null; if (!st) return '';
  const bits = [];
  if (st.state === 'off_admin') bits.push(isAdmin ? h`<a href="#/yonetim/listeler">${t('src.how.admin')} →</a>` : h`${t('src.how.askAdmin')}`);
  if (st.notInScope) bits.push(isAdmin ? h`${t('src.how.scope')} <a href="#/yonetim/listeler">${t('src.how.scopeGo')} →</a>` : t('src.how.scope') + ' ' + t('src.how.askAdmin'));
  if (st.state === 'off_license') bits.push(t('src.how.license'));
  if (st.state === 'off_platform') bits.push(t('src.how.platform'));
  if (st.failed?.length) bits.push(st.failed.map(f => h`${f.name}${f.kind ? ' – ' + t('st.why.' + f.kind) : ''}`).reduce((a, x, n) => n ? [...a, '; ', x] : [x], []));
  else if (['partial', 'blocked'].includes(st.state) && st.kind) bits.push(t('st.why.' + st.kind));
  if (st.lastOk && ['ok', 'partial'].includes(st.state)) bits.push(t('src.lastOk') + ': ' + rel(st.lastOk));
  return bits.length ? h`<div class="xs muted srcnote">${bits.map((b, n) => n ? h` · ${b}` : h`${b}`)}</div>` : '';
}
export default {
  async render(el, sub) {
    if (sub === 'motor') return motor(el, head('motor')); if (sub === 'durum') return status(el); if (sub === 'fatf') return fatf(el); if (sub === 'kapilar') return gates(el); if (sub === 'mevzuat') return reg(el);
    const d = await api('/sources');
    const stt = d.states || {};
    el.innerHTML = head('') + d.directory.groups.map(g => h`<div class="card" style="margin-bottom:18px"><div class="card-h"><h3>${L(g)}</h3></div><div class="card-b flush">${g.items.map(i => h`<div class="srcrow"><div class="srcname"><a href="${i.url}" target="_blank" rel="noopener noreferrer"><b>${i.name}</b> ↗</a></div><div class="srcbadge">${badge(i, stt)}</div><div class="srcdesc small muted">${L(i.scope)}${note(i, stt, d.isAdmin)}</div></div>`)}</div></div>`).join('');
  },
  async live(type, el, sub) { if (sub === 'durum' && ['jobs', 'scan', 'lists'].includes(type)) await status(el); },
};
async function status(el) {
  const d = await api('/sources'); const jobs = S.status.jobs; const lm = d.lists;
  el.innerHTML = head('durum') + h`<div class="callout info" style="margin-bottom:16px">${t('src.autoNote', { n: S.status.platform.pollNewsMinutes, l: S.status.platform.pollListsMinutes })}</div>
  <div class="card"><div class="card-h"><h3>${t('src.jobs')}</h3></div><div class="card-b flush"><table class="tbl"><thead><tr><th>${t('src.source')}</th><th>${t('common.status')}</th><th>${t('src.lastOk')}</th><th>${t('src.lastChange')}</th><th>${t('src.next')}</th><th>${t('src.every')}</th></tr></thead><tbody>${jobs.map(j => h`<tr><td><b>${j.label}</b><div class="xs muted">${t('src.kind.' + j.kind)}</div></td><td>${(() => { const m = j.kind === 'list' ? lm[j.key] : null; const deg = m && m.ok === false && m.lastError; return statusPill(deg ? 'warn' : j.status === 'idle' || j.status === 'ok' ? 'ok' : j.status === 'running' ? 'info' : 'err', deg ? t('st.cacheServed') : t('st.' + j.status)); })()}${j.lastError ? h`<div class="xs" style="color:var(--red)">${j.lastError.slice(0, 80)}</div>` : (j.kind === 'list' && lm[j.key]?.ok === false && lm[j.key]?.lastError ? h`<div class="xs" style="color:#8a6a1c">${lm[j.key].lastError.slice(0, 80)} · ${t('st.cached')}</div>` : '')}</td><td class="small">${rel(j.lastOk)}</td><td class="small">${rel(j.lastChange)}</td><td class="small">${j.nextRun ? rel(j.nextRun) : '—'}</td><td class="small">${j.everyMin} ${t('unit.min')}</td></tr>`)}</tbody></table></div></div>
  <div class="card" style="margin-top:18px"><div class="card-h"><h3>${t('src.lists')}</h3></div><div class="card-b flush"><table class="tbl"><thead><tr><th>${t('src.list')}</th><th>${t('src.records')}</th><th>${t('src.fetched')}</th><th>${t('src.checked')}</th></tr></thead><tbody>${Object.entries(lm).map(([k, v]) => h`<tr><td><b>${d.listDefs[k]?.label || k}</b></td><td>${num(v.count)}</td><td class="small">${rel(v.fetchedAt)}</td><td class="small">${rel(v.checkedAt)}</td></tr>`)}</tbody></table></div></div>`;
  try { const m = await api('/masak/recon'); const rows = Object.values(m.sections || {}); if (rows.length) el.insertAdjacentHTML('beforeend', h`<div class="card" style="margin-top:18px"><div class="card-h"><h3>${t('src.masakRecon')}</h3></div><div class="card-b flush"><table class="tbl"><thead><tr><th>${t('src.list')}</th><th>${t('src.masakOfficial')}</th><th>${t('src.masakParsed')}</th><th>${t('common.status')}</th><th>${t('src.checked')}</th></tr></thead><tbody>${rows.map(r => h`<tr><td><b>${r.label}</b><div class="xs muted">${r.file.slice(0, 60)}…</div></td><td>${num(r.officialRows)}</td><td>${num(r.parsed)}</td><td>${statusPill(r.match ? 'ok' : 'warn', r.match ? '✓' : '≠')}</td><td class="small">${rel(r.checkedAt)}</td></tr>`)}</tbody></table></div></div>`.toString()); } catch { }
}
async function fatf(el) {
  const f = await api('/fatf'); const col = (title, arr, cls) => h`<div class="card"><div class="card-h"><h3>${title}</h3><span class="badge ${cls}">${arr.length}</span></div><div class="card-b">${arr.map(c => h`<span class="chip" style="margin:3px;cursor:default">${S.lang === 'tr' ? c.tr : c.en}</span>`)}</div></div>`;
  el.innerHTML = head('fatf') + h`<div class="callout" style="margin-bottom:16px"><b>${f.statementTitle}</b><div class="small">${t('src.fatfVerified', { d: fmtD(f.verifiedOn) })} · <a href="${f.verifiedFrom}" target="_blank" rel="noopener noreferrer">FATF ↗</a></div></div><div class="grid g2">${col(t('src.fatfBlack'), f.black, 'err')}${col(t('src.fatfGrey'), f.grey, 'warn')}</div><p class="hint" style="margin-top:12px">${t('src.fatfNote')}</p>`;
}
async function gates(el) {
  const m = await api('/trade/meta'); const g = m.gates;
  el.innerHTML = head('kapilar') + h`<div class="card"><div class="card-b flush"><div class="tbl-wrap" style="max-height:640px"><table class="tbl tight"><thead><tr><th>#</th><th>${t('gate.name')}</th><th>${t('gate.prov')}</th><th>${t('gate.nb')}</th><th>${t('common.status')}</th></tr></thead><tbody>${g.gates.map(x => h`<tr><td>${x.no}</td><td><b>${x.name}</b></td><td>${x.province}</td><td>${x.neighbour}</td><td><span class="badge ${x.active ? 'ok' : ''}">${x.active ? t('gate.active') : t('gate.inactive')}</span></td></tr>`)}</tbody></table></div></div></div><p class="hint">${t('gate.src')}: udybelgesi.com</p>`;
}
async function reg(el) {
  const R = await api('/reference'); const sel = S.status.settings.jurisdictions || ['TR'];
  el.innerHTML = head('mevzuat') + h`<div class="callout" style="margin-bottom:16px">${L(R.disclaimer)}</div>${R.jurisdictions.filter(j => sel.includes(j.code)).map(j => h`<div class="card" data-trx="regulation" style="margin-bottom:18px"><div class="card-h"><h3>${L(j.name)}</h3><span class="tag">${j.code}</span><span class="sp"></span>${trBtn()}</div><div class="card-b"><div class="grid g3"><div><h4>${t('reg.regulators')}</h4>${j.regulators.map(r => h`<div class="small" style="margin:6px 0"><a href="${r.url}" target="_blank" rel="noopener noreferrer"><b>${r.abbr}</b></a> — ${r.name}<div class="xs muted trx-src">${r.role}</div></div>`)}</div><div><h4>${t('reg.laws')}</h4>${j.laws.map(l => h`<div class="small" style="margin:6px 0"><b>${l.ref}</b> — <span class="trx-src">${l.title}</span></div>`)}</div><div><h4>${t('reg.lists')}</h4>${j.lists.map(l => h`<div class="small" style="margin:6px 0"><a href="${l.url}" target="_blank" rel="noopener noreferrer"><b>${l.name}</b> ↗</a><div class="xs muted">${l.authority}</div><div class="xs muted trx-src">${l.note}</div></div>`)}<div class="xs muted trx-src" style="margin-top:8px">${j.dataProtection}</div></div></div></div></div>`)}${isAdminLink()}`;
}
const isAdminLink = () => S.status.perms.admin ? h`<a class="btn" href="#/yonetim/mevzuat">${t('reg.configure')}</a>` : '';
