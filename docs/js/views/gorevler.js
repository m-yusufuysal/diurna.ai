import { S, h, t, api, me, esc, rel, fmtDT, canWrite, toast, isManager } from '../core.js';
import { icon, tabsBar, emptyState, tip, modal, initials } from '../ui.js';
import { taskModal } from './bugun.js';
const TABS = [['', 'tsk.mine'], ['tumu', 'tsk.all'], ['bildirim', 'tsk.notifs']];
const hrs = ms => { const a = Math.abs(ms) / 3600e3; return a >= 24 ? `${Math.round(a / 24)}${t('unit.d')}` : `${Math.round(a * 10) / 10}${t('unit.h')}`; };
export default {
  async render(el, sub) {
    const head = h`<div class="page-head"><div><div class="eyebrow">${t('nav.gorevler')}</div><h1>${t('tsk.title')}</h1><p>${t('tsk.sub')}</p></div>${canWrite() ? h`<button class="btn pri" id="new">${icon.plus} ${t('task.new')}</button>` : ''}</div>${tabsBar('#/gorevler', TABS, sub || '')}`;
    if (sub === 'bildirim') {
      const n = await api('/notifications');
      el.innerHTML = head + h`<div class="card"><div class="card-b flush">${n.length ? n.map(x => h`<a class="row" href="${x.link || '#/bugun'}" style="padding:14px 20px;border-bottom:1px solid var(--line);color:inherit;text-decoration:none;${x.read ? 'opacity:.6' : ''}"><span class="badge ${x.kind.includes('match') || x.kind === 'sla_breach' ? 'err' : 'info'}">${t('rule.' + x.kind)}</span><div class="sp"><b class="small">${x.title}</b>${x.body ? h`<div class="xs muted">${x.body}</div>` : ''}</div><span class="xs muted">${rel(x.ts)}</span></a>`) : emptyState('notif.empty', 'notif.emptyHint', h`<a class="btn" href="#/ayarlarim/bildirim">${t('notif.rules')}</a>`)}</div></div>`;
      el.querySelector('#new')?.addEventListener('click', () => taskModal({ kind: 'manual' }).then(() => this.render(el, sub))); return;
    }
    const d = await api('/tasks'); const u = me(); const users = d.users; const all = sub === 'tumu';
    let list = d.tasks.filter(x => all || x.assignee === u.id); let showClosed = false;
    const draw = () => {
      const open = list.filter(x => x.status !== 'closed'), closed = list.filter(x => x.status === 'closed');
      el.innerHTML = head + h`<div class="grid g4" style="margin-bottom:18px"><div class="card stat" style="--c:var(--blue)"><div class="k">${t('tsk.open')}</div><div class="v">${open.length}</div></div><div class="card stat" style="--c:var(--amber)"><div class="k">${t('tsk.review')}</div><div class="v">${open.filter(x => x.status === 'review').length}</div></div><div class="card stat" style="--c:var(--red)"><div class="k">${t('tsk.breached')}</div><div class="v">${open.filter(x => x.sla.state === 'breached').length}</div></div><div class="card stat" style="--c:var(--green)"><div class="k">${t('tsk.closed')}</div><div class="v">${closed.length}</div></div></div>
      ${open.length ? h`<div class="stack">${open.map(card)}</div>` : emptyState('tsk.emptyT', all ? 'tsk.emptyAll' : 'tsk.emptyMine', canWrite() ? h`<button class="btn" id="new2">${t('task.new')}</button>` : '')}
      ${closed.length ? h`<div style="margin-top:20px"><button class="btn ghost" id="tc">${showClosed ? '▾' : '▸'} ${t('tsk.closedList', { n: closed.length })}</button>${showClosed ? h`<div class="stack" style="margin-top:10px">${closed.map(card)}</div>` : ''}</div>` : ''}`;
      wire();
    };
    const card = x => { const as = users.find(z => z.id === x.assignee); return h`<div class="card" data-t="${x.id}"><div class="card-b"><div class="row wrap" style="gap:10px"><span class="mono xs muted">${x.no}</span><span class="badge ${x.priority === 'critical' ? 'err' : x.priority === 'high' ? 'warn' : ''}">${t('prio.' + x.priority)}</span>${x.kind === 'hit' ? h`<span class="badge err">${t('tsk.kindHit')}</span>` : ''}${x.demo ? h`<span class="pdemo">DEMO</span>` : ''}<b class="sp">${x.title}</b><span class="sla ${x.sla.state}" title="SLA">${x.status === 'closed' ? t('sla.' + x.sla.state) : x.sla.state === 'breached' ? t('sla.late', { d: hrs(x.sla.left) }) : t('sla.left', { d: hrs(x.sla.left) })}</span></div>
      <div class="row wrap" style="margin-top:12px"><div style="min-width:170px"><label class="f">${t('task.status')}</label><select data-st ${canWrite() ? '' : 'disabled'}>${['open', 'review', 'closed'].map(s => h`<option value="${s}" ${x.status === s ? 'selected' : ''}>${t('tsk.s.' + s)}</option>`)}</select></div><div style="min-width:200px"><label class="f">${t('task.assignee')}</label><select data-as ${canWrite() ? '' : 'disabled'}><option value="">—</option>${users.filter(z => z.role !== 'Okuyucu').map(z => h`<option value="${z.id}" ${z.id === x.assignee ? 'selected' : ''}>${z.name.replace(/\s*\(DEMO\)/, '')}</option>`)}</select></div><span class="sp"></span><span class="xs muted">${t('tsk.created')} ${rel(x.createdAt)} · ${x.createdByName}${x.status === 'closed' && x.resolution ? ' · ' + t('res.' + x.resolution) : ''}</span></div>
      ${x.detail ? h`<div class="small muted" style="margin-top:8px">${x.detail}</div>` : ''}
      ${x.comments.length ? h`<div style="margin-top:8px">${x.comments.map(c => h`<div class="cmt"><b class="small">${c.byName}</b> <span class="xs muted">${rel(c.at)}</span><div>${c.text}</div></div>`)}</div>` : ''}
      ${canWrite() ? h`<div class="row" style="margin-top:8px"><input type="text" data-cm placeholder="${t('tsk.commentPh')}"><button class="btn sm" data-cs>${t('tsk.comment')}</button></div>` : ''}</div></div>`; };
    const wire = () => {
      el.querySelector('#new')?.addEventListener('click', () => taskModal({ kind: 'manual' }).then(() => this.render(el, sub))); el.querySelector('#new2')?.addEventListener('click', () => taskModal({ kind: 'manual' }).then(() => this.render(el, sub)));
      el.querySelector('#tc')?.addEventListener('click', () => { showClosed = !showClosed; draw(); });
      el.querySelectorAll('[data-t]').forEach(c => { const id = c.dataset.t; const x = list.find(z => z.id === id);
        const upd = async p => { try { const r = await api('/tasks/' + id, { method: 'PUT', body: p }); Object.assign(x, r); const i = d.tasks.findIndex(z => z.id === id); d.tasks[i] = r; draw(); } catch (e) { toast(t('common.error'), e.message); draw(); } };
        c.querySelector('[data-st]')?.addEventListener('change', async e => { if (e.target.value === 'closed') { const r = await modal(h`<h3>${t('tsk.closeTitle')}</h3><div style="margin-top:10px"><label class="f">${t('tsk.resolution')} ${tip('tsk.resTip')}</label><select name="res">${['done', 'false_positive', 'true_match', 'no_action'].map(k => h`<option value="${k}">${t('res.' + k)}</option>`)}</select></div><div style="margin-top:10px"><label class="f">${t('tsk.reason')}</label><textarea name="c"></textarea></div>`, [{ label: t('common.cancel'), value: false }, { label: t('tsk.close'), value: true, cls: 'ok' }]); if (!r.v) return draw(); await upd({ status: 'closed', resolution: r.form.res, comment: r.form.c || undefined }); } else await upd({ status: e.target.value }); });
        c.querySelector('[data-as]')?.addEventListener('change', e => upd({ assignee: e.target.value }));
        c.querySelector('[data-cs]')?.addEventListener('click', () => { const v = c.querySelector('[data-cm]').value.trim(); if (v) upd({ comment: v }); }); });
    };
    draw();
  },
  async live(type, el, sub) { if (['tasks', 'notify'].includes(type) && !el.querySelector('input:focus,textarea:focus')) await this.render(el, sub); },
};
