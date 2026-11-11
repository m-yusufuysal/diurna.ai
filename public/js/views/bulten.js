import { S, h, raw, t, L, api, me, esc, rel, fmtD, fmtDT, fmtLong, canWrite, canApprove, toast, } from '../core.js';
import { icon, typeBadge, baseBadge, srcName, tabsBar, emptyState, tip, modal, debounce, copyText, confirmBox, down, trBtn, aiBtn } from '../ui.js';
const STEPS = ['draft', 'review', 'approved'];
export default {
  async render(el, sub) {
    if (sub === 'arsiv') return archive(el);
    const b = await api('/bulletins/today'); if (b.affiliateOnly) return affiliateToday(el, b);
    const live = await api('/items'); const liveMap = new Map(live.items.map(i => [i.id, i]));
    let ver = 'internal', lang = b.lang || S.lang; let cur = b;
    const locked = () => cur.status === 'approved'; const u = me();
    const save = debounce(async patch => { try { cur = await api('/bulletins/' + cur.id, { method: 'PUT', body: patch }); paintHead(); paintPreview(); } catch (e) { toast(t('common.error'), e.message); } }, 600);
    const act = async (a, body = {}) => { try { cur = await api(`/bulletins/${cur.id}/${a}`, { method: 'POST', body }); toast(t('bul.done.' + a), ''); draw(); } catch (e) { toast(t('common.error'), e.data?.message || (e.data?.errors ? t('bul.errors') : e.message)); } };
    const paintHead = () => { const c = el.querySelector('#bhead'); if (c) c.innerHTML = head().toString(); wireHead(); };
    const head = () => h`<div class="stepper">${STEPS.map((s, i) => h`<div class="step ${cur.status === s ? 'on' : STEPS.indexOf(cur.status) > i ? 'done' : ''}"><b>${i + 1}</b>${t('bul.st.' + s)}</div>`)}</div>
      <div class="row wrap" style="margin-top:14px">
        ${!locked() && canWrite() && cur.status === 'draft' ? h`<button class="btn pri" data-a="submit">${t('bul.submit')}</button>` : ''}
        ${cur.status !== 'approved' && canApprove() ? h`<button class="btn ok" data-a="approve" ${cur.status === 'draft' && S.status.settings.fourEyes ? 'title="' + t('bul.fourEyesHint') + '"' : ''}>${t('bul.approve')}</button>` : ''}
        ${cur.status === 'review' && canApprove() ? h`<button class="btn danger" data-a="reject">${t('bul.reject')}</button>` : ''}
        ${cur.status === 'approved' && canApprove() ? h`<button class="btn" data-a="reopen">${t('bul.reopen')}</button>` : ''}
        <span class="sp"></span>
        <button class="btn" id="exp">${icon.dl} ${t('bul.exportHtml')}</button><button class="btn" id="prt">${icon.print} ${t('bul.print')}</button><button class="btn" id="cpy">${icon.copy} ${t('bul.copy')}</button></div>
      ${cur.errors?.length && cur.status !== 'approved' ? h`<div class="callout" style="margin-top:12px"><b>${t('bul.toApprove')}</b><ul style="margin:6px 0 0;padding-inline-start:18px">${cur.errors.map(e => h`<li class="small">${e.code === 'empty' ? t('bul.err.empty') : t('bul.err.base') + ': ' + e.title}</li>`)}</ul></div>` : ''}
      ${cur.status === 'approved' ? h`<div class="callout ok" style="margin-top:12px">${t('bul.approvedBy')}: <b>${cur.approvals.at(-1)?.by}</b> · ${fmtDT(cur.approvals.at(-1)?.at)} · <span class="mono xs">SHA-256 ${cur.contentHash?.slice(0, 16)}…</span></div>` : ''}`;
    const wireHead = () => {
      el.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
        const a = b.dataset.a; let body = {};
        if (a === 'approve' || a === 'reject' || a === 'reopen') { const r = await modal(h`<h3>${t('bul.' + a)}</h3><div style="margin-top:10px"><label class="f">${t('bul.comment')}${a === 'approve' ? '' : ' *'}</label><textarea name="comment"></textarea></div>${a === 'approve' ? h`<div class="hint">${t('bul.approveConfirm')}</div>` : ''}`, [{ label: t('common.cancel'), value: false }, { label: t('bul.' + a), value: true, cls: a === 'approve' ? 'ok' : 'pri' }]); if (!r.v) return; if (a !== 'approve' && !r.form.comment.trim()) return toast(t('bul.commentReq'), ''); body = { comment: r.form.comment }; }
        await act(a, body);
      });
      el.querySelector('#exp')?.addEventListener('click', async () => { const html = await api(`/bulletins/${cur.id}/render?version=${ver}&lang=${lang}&format=html&log=1`); down(`bulten-${cur.date}-${ver}-${lang}.html`, html, 'text/html'); });
      el.querySelector('#prt')?.addEventListener('click', () => { const f = el.querySelector('iframe.prev'); f?.contentWindow?.print(); });
      el.querySelector('#cpy')?.addEventListener('click', async () => { const txt = await api(`/bulletins/${cur.id}/render?version=${ver}&lang=${lang}&format=text&log=1`); await copyText(txt); toast(t('bul.copied'), ''); });
    };
    const paintPreview = () => { const f = el.querySelector('iframe.prev'); if (f) f.src = `/api/bulletins/${cur.id}/render?version=${ver}&lang=${lang}&format=html&_=${Date.now()}`; };
    const draw = () => {
      el.innerHTML = h`<div class="page-head"><div><div class="eyebrow">${fmtLong(cur.date)}</div><h1>${t('bul.title')}</h1><p>${t('bul.sub')}</p></div></div>
      ${tabsBar('#/bulten', [['', 'bul.tabToday'], ['arsiv', 'bul.tabArchive']], '')}
      <div class="card" style="margin-bottom:18px"><div class="card-b" id="bhead">${head()}</div></div>
      <div class="split"><div><div class="row" style="margin-bottom:12px"><h3 class="sp">${t('bul.items')} (${cur.items.filter(i => i.included).length}/${cur.items.length})</h3></div>
      ${cur.items.length ? h`<div class="stack">${cur.items.map(i => { const lv = liveMap.get(i.itemId); const sug = lv?.baseCheck; const rel2 = ['ADD', 'DEL'].includes(i.type); return h`<div class="bi ${i.type}" data-ai-box data-trx="bulletin" data-item="${i.itemId}" style="${i.included ? '' : 'opacity:.55'}"><div class="row wrap" style="gap:8px"><label class="check"><input type="checkbox" data-inc ${i.included ? 'checked' : ''} ${locked() || !canWrite() ? 'disabled' : ''}></label><span class="badge ${i.type}">${t('type.' + i.type)}</span><b class="small">${srcName(i.src)}</b><span class="muted xs">${fmtD(i.date)}</span><span class="sp"></span>${trBtn()}${canWrite() && !locked() ? aiBtn('bulletin', { itemId: i.itemId }, { accept: `[data-item='${i.itemId}'] [data-note]` }) : ''}<a class="xs" href="${i.url}" target="_blank" rel="noopener noreferrer">${t('item.source')} ↗</a></div>
        <div class="trx-src" style="margin:6px 0 2px;font-weight:600">${i.edit.title || i.title}</div>${i.entityTotal ? h`<div class="xs muted">${(i.entities || []).slice(0, 3).map(e => e.name).join(', ')}${i.entityTotal > 3 ? ' +' + (i.entityTotal - 3) : ''}</div>` : ''}${i.vesselWarning ? h`<div class="xs" style="color:var(--amber);font-weight:600">⚠ ${t('item.vesselWarn')}</div>` : ''}
        ${rel2 ? h`<div class="row wrap" style="margin-top:10px;gap:8px"><b class="small">${t('bul.baseFinding')}</b>${tip('bul.baseTip')}<div class="seg2"><button class="chip ${i.base.decision === 'yok' ? 'on' : ''}" data-base="yok" ${locked() || !canWrite() ? 'disabled' : ''}>${t('bul.base.yok')}</button><button class="chip ${i.base.decision === 'var' ? 'on' : ''}" data-base="var" ${locked() || !canWrite() ? 'disabled' : ''}>${t('bul.base.var')}</button></div>${sug ? h`<span class="xs muted">${t('bul.suggest')}: ${sug.state === 'possible' ? t('base.possible', { n: sug.matches.length }) : sug.state === 'none' ? t('base.none') : t('base.unavailable')}</span>` : ''}</div>` : ''}
        <input type="text" data-note placeholder="${t('bul.notePh')}" value="${esc(i.note || '')}" style="margin-top:8px" ${locked() || !canWrite() ? 'disabled' : ''}></div>`; })}</div>` : emptyState('bul.emptyT', 'bul.emptyD')}
      <div class="stack" style="margin-top:16px"><div><label class="f">${t('bul.intro')}</label><textarea id="intro" ${locked() || !canWrite() ? 'disabled' : ''}>${esc(cur.intro || '')}</textarea></div><div><label class="f">${t('bul.outro')}</label><textarea id="outro" ${locked() || !canWrite() ? 'disabled' : ''}>${esc(cur.outro || '')}</textarea></div></div></div>
      <div class="sticky" style="position:sticky;top:76px"><div class="row wrap" style="margin-bottom:12px"><div class="seg2">${['internal', 'affiliate'].map(v => h`<button class="chip ${ver === v ? 'on' : ''}" data-ver="${v}">${t('bul.v.' + v)}</button>`)}</div><span class="sp"></span><div class="seg">${['tr', 'en', 'ar'].map(l => h`<button class="${lang === l ? 'on' : ''}" data-bl="${l}">${l.toUpperCase()}</button>`)}</div></div>
      ${ver === 'affiliate' ? h`<div class="hint" style="margin-bottom:8px">${t('bul.affHint')}</div>` : ''}<iframe class="prev" sandbox="allow-same-origin allow-modals" title="preview" src="/api/bulletins/${cur.id}/render?version=${ver}&lang=${lang}&format=html"></iframe></div></div>`.toString();
      wireHead();
      el.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => { ver = b.dataset.ver; draw(); });
      el.querySelectorAll('[data-bl]').forEach(b => b.onclick = () => { lang = b.dataset.bl; save({ lang, keepStatus: true }); draw(); });
      el.querySelectorAll('[data-item]').forEach(row => { const id = row.dataset.item;
        row.querySelector('[data-inc]')?.addEventListener('change', e => save({ items: [{ itemId: id, included: e.target.checked }], keepStatus: true }));
        row.querySelectorAll('[data-base]').forEach(b => b.onclick = () => { save({ items: [{ itemId: id, base: { decision: b.dataset.base, note: '' } }], keepStatus: true }); row.querySelectorAll('[data-base]').forEach(x => x.classList.toggle('on', x === b)); });
        row.querySelector('[data-note]')?.addEventListener('input', e => save({ items: [{ itemId: id, note: e.target.value }], keepStatus: true })); });
      el.querySelector('#intro')?.addEventListener('input', e => save({ intro: e.target.value, keepStatus: true })); el.querySelector('#outro')?.addEventListener('input', e => save({ outro: e.target.value, keepStatus: true }));
    };
    draw();
  },
  async live(type, el, sub) { if (['scan', 'lists'].includes(type) && !sub && !el.querySelector('textarea:focus,input:focus')) await this.render(el, sub); },
};
async function archive(el) {
  const list = await api('/bulletins'); const aff = list.length && list[0].affiliateOnly || me().role === 'Okuyucu';
  el.innerHTML = h`<div class="page-head"><div><div class="eyebrow">${t('nav.bulten')}</div><h1>${t('bul.tabArchive')}</h1><p>${t('bul.archSub')}</p></div></div>${tabsBar('#/bulten', [['', 'bul.tabToday'], ['arsiv', 'bul.tabArchive']], 'arsiv')}
  <div class="card"><div class="card-b flush">${list.length ? h`<table class="tbl"><thead><tr><th>${t('common.date')}</th><th>${t('common.status')}</th>${aff ? '' : h`<th>${t('bul.baseFinding')}</th>`}<th>${t('bul.items')}</th><th>${t('bul.approvedBy')}</th><th>SHA-256</th><th></th></tr></thead><tbody>${list.map(b => h`<tr><td><b>${fmtD(b.date)}</b></td><td><span class="badge ${b.status === 'approved' ? 'ok' : b.status === 'review' ? 'warn' : ''}">${t('bul.st.' + b.status)}</span></td>${aff ? '' : h`<td>${t('bul.base.' + (b.overall === 'var' ? 'var' : b.overall === 'yok' ? 'yok' : 'pending'))}</td>`}<td>${b.items}</td><td class="small">${aff ? (b.approvedAt ? fmtDT(b.approvedAt) : '—') : b.approvals.map(a => a.by).join(', ') || '—'}</td><td class="mono xs">${b.contentHash?.slice(0, 12) || '—'}</td><td class="right nowrap">${aff ? '' : h`<a class="btn sm" target="_blank" href="/api/bulletins/${b.id}/render?version=internal&format=html">${t('bul.v.internal')}</a> `}<a class="btn sm" target="_blank" href="/api/bulletins/${b.id}/render?version=affiliate&format=html">${t('bul.v.affiliate')}</a></td></tr>`)}</tbody></table>` : emptyState('bul.archEmptyT', 'bul.archEmptyD', h`<a class="btn pri" href="#/bulten">${t('today.prepBulletin')}</a>`)}</div></div>`.toString();
}

/* Okuyucu / iştirak rolü: yalnızca ONAYLI bültenin iştirak sürümü. İç sürüm ve base tespiti hiç yüklenmez (sunucu da 403 verir). */
async function affiliateToday(el, b) {
  let lang = b.lang || S.lang;
  const draw = () => {
    el.innerHTML = h`<div class="page-head"><div><div class="eyebrow">${t('nav.bulten')}</div><h1>${t('bul.affTitle')}</h1><p>${t('bul.affSub')}</p></div></div>${tabsBar('#/bulten', [['', 'bul.tabToday'], ['arsiv', 'bul.tabArchive']], '')}
    ${b.none ? emptyState('bul.affNoneT', 'bul.affNoneD') : h`<div class="row wrap" style="margin-bottom:10px"><span class="badge ok">${t('bul.st.approved')}</span><span class="small muted">${fmtD(b.date)}${b.isToday ? '' : ' · ' + t('bul.affOlder')}</span><span class="sp"></span><div class="seg2">${['tr', 'en', 'ar'].map(l => h`<button class="chip ${lang === l ? 'on' : ''}" data-bl="${l}">${l.toUpperCase()}</button>`)}</div> <button class="btn" id="exp">${icon.dl} ${t('bul.exportHtml')}</button><button class="btn" id="prt">${icon.print} ${t('bul.print')}</button></div>
    <iframe class="prev" style="width:100%;min-height:70vh" sandbox="allow-same-origin allow-modals" title="preview" src="/api/bulletins/${b.id}/render?version=affiliate&lang=${lang}&format=html"></iframe>`}`.toString();
    el.querySelectorAll('[data-bl]').forEach(x => x.onclick = () => { lang = x.dataset.bl; draw(); });
    el.querySelector('#exp')?.addEventListener('click', async () => { const html = await api(`/bulletins/${b.id}/render?version=affiliate&lang=${lang}&format=html&log=1`); down(`bulten-${b.date}-affiliate-${lang}.html`, html, 'text/html'); });
    el.querySelector('#prt')?.addEventListener('click', () => el.querySelector('iframe.prev')?.contentWindow?.print());
  };
  draw();
}
