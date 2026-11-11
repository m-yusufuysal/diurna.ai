import { S, h, raw, t, L, api, me, esc, rel, fmtD, fmtLong, num, hilite, canWrite, isManager, toast } from '../core.js';
import { icon, typeBadge, baseBadge, srcName, statusPill, tabsBar, emptyState, tip, modal, trBtn, aiBtn, readBtn } from '../ui.js';

export function itemCard(it, kws, opts = {}) {
  const ents = (it.entities || []).slice(0, 3); const more = (it.entities || []).length - ents.length;
  return h`<article data-ai-box class="bi ${it.type} ${opts.lead ? 'lead' : ''}" data-id="${it.id}" data-trx="news"><div class="kick"><span class="badge ${it.type}">${t('type.' + it.type)}</span><b>${srcName(it.srcKey)}</b><span>${fmtD(it.date)}</span><span class="sp"></span>${it.baseCheck ? baseBadge(it) : ''}</div>
  <${opts.lead ? 'h2' : 'h3'} class="bi-h trx-src">${hilite(it.title, kws)}</${opts.lead ? 'h2' : 'h3'}>
  ${L(it.summary) ? h`<div class="trx-src ${opts.lead ? 'lede' : 'small muted'}">${hilite(L(it.summary), kws)}</div>` : ''}
  ${ents.length ? h`<div style="margin-top:6px">${ents.map(e => h`<div class="entity"><span class="tag">${t('ent.' + e.type)}</span><b>${e.name}</b>${e.imo?.length ? h`<span class="mono muted">IMO ${e.imo.join(', ')}</span>` : ''}${e.program ? h`<span class="muted xs">${e.program}</span>` : ''}</div>`)}${more > 0 ? h`<div class="xs muted">+${more}</div>` : ''}</div>` : ''}
  ${it.baseCheck?.state === 'possible' ? h`<div class="callout err" style="margin-top:8px;padding:8px 12px"><b class="small">${t('base.possible', { n: it.baseCheck.matches.length })}</b> — ${it.baseCheck.matches.slice(0, 2).map(m => `${m.customerName} (${m.score})`).join('; ')}</div>` : ''}
  ${it.vesselWarning ? h`<div class="callout" style="margin-top:8px;padding:8px 12px"><b class="small">${t('item.vesselWarn')}</b></div>` : ''}
  <div class="row wrap" style="margin-top:10px">${readBtn(it.id)}<a class="btn sm ghost" href="${it.url}" target="_blank" rel="noopener noreferrer">${icon.ext} ${t('rd.orig')}</a>${canWrite() && !opts.noTask ? h`<button class="btn sm" data-task="${it.id}">${icon.plus} ${t('item.task')}</button>` : ''}${trBtn()}${['eu', 'fr', 'rg'].includes(it.srcKey) ? aiBtn('regulation', { itemId: it.id }, { label: t('ai.btn.regulation') }) : ''}<span class="sp"></span><span class="xs muted">${t('item.seen')} ${rel(it.firstSeen)}</span></div></article>`;
}
export async function taskModal(prefill = {}) {
  const d = await api('/tasks'); const meu = me();
  const r = await modal(h`<h3>${t('task.new')}</h3><div class="stack" style="margin-top:12px"><div><label class="f">${t('task.title')}</label><input type="text" name="title" value="${prefill.title || ''}" maxlength="200"></div><div class="grid g2"><div><label class="f">${t('task.assignee')}</label><select name="assignee">${d.users.filter(u => u.role !== 'Okuyucu').map(u => h`<option value="${u.id}" ${u.id === meu.id ? 'selected' : ''}>${u.name}</option>`)}</select></div><div><label class="f">${t('task.priority')} ${tip('task.priorityTip')}</label><select name="priority">${['normal', 'high', 'critical'].map(p => h`<option value="${p}">${t('prio.' + p)}</option>`)}</select></div></div></div>`, [{ label: t('common.cancel'), value: false }, { label: t('task.create'), value: true, cls: 'pri' }]);
  if (!r.v || !r.form.title.trim()) return null;
  const x = await api('/tasks', { method: 'POST', body: { ...r.form, kind: prefill.kind || 'item', ref: prefill.ref } }); toast(t('task.created'), x.no); return x;
}
export const wireTasks = (el, items) => el.querySelectorAll('[data-task]').forEach(b => b.onclick = async () => { const it = items.find(i => i.id === b.dataset.task); if (it) { await taskModal({ title: it.title.slice(0, 120), ref: { itemId: it.id } }); } });

export default {
  async render(el, sub) {
    const tab = sub === 'tumu' ? 'tumu' : '';
    const [d, st] = await Promise.all([api('/me/today'), tab ? api('/items') : null]);
    const u = me(); const w = d.window; const hr = new Date().getHours(); const greet = hr < 12 ? t('today.morning') : hr < 18 ? t('today.afternoon') : t('today.evening');
    const wl = await api('/me/watchlist'); const onbDone = localStorage.getItem('um.onb') === '1';
    const steps = [[S.status.customersLoaded, 'onb.customers', '#/kontrol/base'], [wl.length > 0, 'onb.watch', '#/ayarlarim/izleme'], [!!u.mfa, 'onb.mfa', '#/ayarlarim/guvenlik'], [!!d.todayBulletin, 'onb.bulletin', '#/bulten']];
    const showOnb = !onbDone && steps.some(s => !s[0]);
    let kws = st?.keywords || []; let items = tab ? st.items : d.items; let typeF = 'ALL';
    const jobs = S.status.jobs || []; const lastOk = jobs.map(j => j.lastOk).filter(Boolean).sort().pop(); const _n = new Date(); const ed = Math.floor((Date.UTC(_n.getFullYear(), _n.getMonth(), _n.getDate()) - Date.UTC(_n.getFullYear(), 0, 0)) / 864e5);
    const draw = () => {
      const list = (typeF === 'ALL' ? items : items.filter(i => i.type === typeF));
      const lead = list.find(i => i.baseCheck?.state === 'possible') || list[0]; const rest = list.filter(i => i !== lead);
      el.innerHTML = h`
      <section class="front">
        <div class="front-top"><b>${fmtLong(w.end)}</b><span>${t('top.edition', { n: ed })}</span><span class="sp"></span><span>${t('live.lastUpdate')}: <b>${lastOk ? rel(lastOk) : '—'}</b></span></div>
        <div class="front-body"><div><h1 class="front-h">${greet}, ${u.name.replace(/\s*\(DEMO\)/, '').split(' ')[0]}</h1><p class="stand">${t('today.summary', { n: d.total, t: d.tasks.length, w: d.watchHits.length })}</p>
          <div class="front-act">${u.role !== 'Okuyucu' ? h`<a class="btn pri" href="#/bulten">${d.todayBulletin?.status === 'approved' ? t('today.viewBulletin') : t('today.prepBulletin')}</a>` : h`<a class="btn pri" href="#/bulten">${t('today.viewBulletin')}</a>`}<a class="btn" href="#/gorevler">${d.tasks.length ? d.tasks.length + ' ' : ''}${t('today.myTasks')}</a></div></div>
          <dl class="numstrip"><div><dd>${d.total}</dd><dt>${t('today.developments')}</dt></div><div class="${d.watchHits.length ? 'alert' : ''}"><dd>${d.watchHits.length}</dd><dt>${t('today.watchHits')}</dt></div><div><dd>${d.tasks.length}</dd><dt>${t('today.myTasks')}</dt></div><div><dd>${d.unread}</dd><dt>${t('today.unread')}</dt></div></dl></div>
      </section>
      ${showOnb ? h`<div class="onb"><b>${t('today.onbLabel')}</b>${steps.map(s => h`<a class="s ${s[0] ? 'done' : ''}" href="${s[2]}">${s[0] ? icon.check : icon.circle}${t(s[1])}</a>`)}<span class="sp"></span><button class="btn sm ghost" id="onbx">${t('onb.dismiss')}</button></div>` : ''}
      <div class="grid g-main" style="margin-top:22px"><div>
        ${tabsBar('#/bugun', [['', 'today.tabMine'], ['tumu', 'today.tabAll']], tab)}
        <div class="row wrap" style="margin-bottom:6px;align-items:flex-end"><div class="seg2">${['ALL', 'ADD', 'UPD', 'DEL', 'GL', 'ENF', 'INFO'].map(k => h`<button class="chip ${typeF === k ? 'on' : ''}" data-f="${k}">${k === 'ALL' ? t('common.all') : t('type.' + k)}${k !== 'ALL' ? ' ' + items.filter(i => i.type === k).length : ''}</button>`)}</div><span class="sp"></span><span class="muted xs">${tab ? t('today.allHint') : t('today.mineHint')} ${tip('today.mineTip')}</span></div>
        <div data-ai-box class="ai-sum"><div class="row">${aiBtn('summary', { ids: list.slice(0, 20).map(x => x.id) }, { label: t('ai.btn.summary') })}<span class="xs muted">${t('ai.sumHint')}</span></div></div>
        ${list.length ? h`<div class="stack feed" style="margin-top:14px">${itemCard(lead, kws, { lead: true })}</div>${rest.length ? h`<div class="sec-label">${t('today.further')}</div><div class="cols2"><div class="stack feed">${rest.filter((_, i) => i % 2 === 0).map(i => itemCard(i, kws))}</div><div class="stack feed">${rest.filter((_, i) => i % 2 === 1).map(i => itemCard(i, kws))}</div></div>` : ''}` : emptyState('today.emptyT', tab ? 'today.emptyAll' : 'today.emptyMine', h`<a class="btn" href="#/bugun/tumu">${t('today.tabAll')}</a> <a class="btn" href="#/ayarlarim/bildirim">${t('today.editSubs')}</a>`)}
      </div><aside class="rail">
        <section class="rail-sec"><div class="rail-h"><span>${t('today.todo')}</span></div>${d.todo.length ? d.todo.map(x => h`<div class="rail-row"><span class="badge ${x.k === 'sla' ? 'err' : x.k === 'approve' ? 'warn' : 'info'}">${t('todo.' + x.k)}</span><span class="sp">${x.title}</span></div>`) : h`<div class="rail-row muted">${t('today.todoEmpty')}</div>`}</section>
        <section class="rail-sec"><div class="rail-h"><span>${t('today.watchTitle')}</span><a href="#/ayarlarim/izleme">${t('common.manage')}</a></div>${d.watchHits.length ? d.watchHits.slice(0, 4).map(x => h`<div class="rail-row" style="display:block"><b>${x.item.title.slice(0, 80)}</b><div class="xs muted">${x.matches.map(m => t('wl.' + m.type) + ': ' + m.value).join(' · ')}</div></div>`) : h`<div class="rail-row muted">${wl.length ? t('today.watchNone') : t('today.watchEmpty')}</div>`}</section>
        <section class="rail-sec"><div class="rail-h"><span>${t('today.sources')}</span><a href="#/kaynaklar/durum">${t('common.details')}</a></div>${(S.status.sources || []).filter(s => !s.infoOnly).map(s => h`<div class="rail-row"><b class="sp">${s.code}</b><span class="xs muted">${rel(s.lastOk)}</span>${statusPill(s.status, t('st.' + (s.status || 'pending')))}</div>`)}<div class="hint">${t('today.autoNote', { n: S.status.platform.pollNewsMinutes })}</div></section>
      </aside></div>`.toString();
      el.querySelector('#onbx')?.addEventListener('click', () => { localStorage.setItem('um.onb', '1'); el.querySelector('#onbx').closest('.onb').remove(); });
      el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { typeF = b.dataset.f; draw(); });
      wireTasks(el, items);
    };
    draw();
  },
  async live(type, el, sub) { if (['scan', 'lists', 'match', 'tasks', 'notify'].includes(type)) { await this.render(el, sub); } },
};
