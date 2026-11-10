import { S, h, t, api, rel } from '../core.js';
export default {
  async render(el) {
    const d = await api('/public/status', { noRedirect: true });
    el.innerHTML = h`<div class="page" style="max-width:900px"><a href="#/" class="small">← ${t('login.back')}</a><div class="page-head" style="margin-top:12px"><div><div class="eyebrow">${t('status.eyebrow')}</div><h1>${t('status.title')}</h1><p>${t('status.sub')}</p></div><span class="badge ${d.overall === 'operational' ? 'ok' : 'warn'}" style="font-size:14px;padding:6px 16px">${t('status.' + d.overall)}</span></div>
    <div class="card"><div class="card-b flush"><table class="tbl"><thead><tr><th>${t('status.component')}</th><th>${t('status.state')}</th><th>${t('status.lastOk')}</th><th>24h</th><th>7d</th></tr></thead><tbody>${d.components.map(c => h`<tr><td><b>${c.label}</b><div class="xs muted">${t('status.' + c.kind)}</div></td><td><span class="st ${c.status === 'ok' || c.status === 'idle' ? '' : 'warn'}"><i></i>${c.status === 'ok' || c.status === 'idle' ? t('status.operational') : t('status.degraded')}</span></td><td class="small">${rel(c.lastOk)}</td><td>${c.uptime24h ?? '—'}${c.uptime24h != null ? '%' : ''}</td><td>${c.uptime7d ?? '—'}${c.uptime7d != null ? '%' : ''}</td></tr>`)}</tbody></table></div></div><p class="hint">${t('status.note')}</p></div>`.toString();
  },
};
