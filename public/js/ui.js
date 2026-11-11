import { h, raw, t, L, rel, fmtD, fmtDT, num, S, esc, api } from './core.js';
/* Simgeler: Lucide (ISC lisansı), 24px ızgara, tutarlı 1.5 çizgi kalınlığı. */
const P = d => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`);
export const icon = {
  panel: P("<rect width=\"7\" height=\"9\" x=\"3\" y=\"3\" rx=\"1\" /> <rect width=\"7\" height=\"5\" x=\"14\" y=\"3\" rx=\"1\" /> <rect width=\"7\" height=\"9\" x=\"14\" y=\"12\" rx=\"1\" /> <rect width=\"7\" height=\"5\" x=\"3\" y=\"16\" rx=\"1\" />"),
  bugun: P("<path d=\"M15 18h-5\" /> <path d=\"M18 14h-8\" /> <path d=\"M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2\" /> <rect width=\"8\" height=\"4\" x=\"10\" y=\"6\" rx=\"1\" />"),
  bulten: P("<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\" /> <path d=\"M14 2v5a1 1 0 0 0 1 1h5\" /> <path d=\"M10 9H8\" /> <path d=\"M16 13H8\" /> <path d=\"M16 17H8\" />"),
  base: P("<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\" /> <path d=\"M16 3.128a4 4 0 0 1 0 7.744\" /> <path d=\"M22 21v-2a4 4 0 0 0-3-3.87\" /> <circle cx=\"9\" cy=\"7\" r=\"4\" />"),
  kontrol: P("<path d=\"M3 7V5a2 2 0 0 1 2-2h2\" /> <path d=\"M17 3h2a2 2 0 0 1 2 2v2\" /> <path d=\"M21 17v2a2 2 0 0 1-2 2h-2\" /> <path d=\"M7 21H5a2 2 0 0 1-2-2v-2\" /> <circle cx=\"12\" cy=\"12\" r=\"3\" /> <path d=\"m16 16-1.9-1.9\" />"),
  ticaret: P("<path d=\"M12 2v2\" /> <path d=\"M12 9.189V13\" /> <path d=\"M19 12V6a2 2 0 00-2-2H7a2 2 0 00-2 2v6\" /> <path d=\"M19.38 19A11.6 11.6 0 0021 13l-8.188-3.639a2 2 0 00-1.624 0L3 13.001a11.6 11.6 0 002.81 7.76\" /> <path d=\"M2 20c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1\" />"),
  dd: P("<path d=\"M10 18v-7\" /> <path d=\"M11.119 2.205a2 2 0 0 1 1.762 0l7.84 3.846A.5.5 0 0 1 20.5 7h-17a.5.5 0 0 1-.22-.949z\" /> <path d=\"M14 18v-7\" /> <path d=\"M18 18v-7\" /> <path d=\"M3 22h18\" /> <path d=\"M6 18v-7\" />"),
  kaynaklar: P("<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20\" /> <path d=\"M2 12h20\" />"),
  globe: P("<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20\" /> <path d=\"M2 12h20\" />"),
  arsiv: P("<rect width=\"20\" height=\"5\" x=\"2\" y=\"3\" rx=\"1\" /> <path d=\"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8\" /> <path d=\"M10 12h4\" />"),
  denetim: P("<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\" /> <path d=\"m9 12 2 2 4-4\" />"),
  ayarlar: P("<path d=\"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915\" /> <circle cx=\"12\" cy=\"12\" r=\"3\" />"),
  yonetim: P("<path d=\"M14 17H5\" /> <path d=\"M19 7h-9\" /> <circle cx=\"17\" cy=\"17\" r=\"3\" /> <circle cx=\"7\" cy=\"7\" r=\"3\" />"),
  bell: P("<path d=\"M10.268 21a2 2 0 0 0 3.464 0\" /> <path d=\"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326\" />"),
  moon: P("<path d=\"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401\" />"),
  sun: P("<circle cx=\"12\" cy=\"12\" r=\"4\" /> <path d=\"M12 2v2\" /> <path d=\"M12 20v2\" /> <path d=\"m4.93 4.93 1.41 1.41\" /> <path d=\"m17.66 17.66 1.41 1.41\" /> <path d=\"M2 12h2\" /> <path d=\"M20 12h2\" /> <path d=\"m6.34 17.66-1.41 1.41\" /> <path d=\"m19.07 4.93-1.41 1.41\" />"),
  link: P("<path d=\"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71\" /> <path d=\"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71\" />"),
  ext: P("<path d=\"M15 3h6v6\" /> <path d=\"M10 14 21 3\" /> <path d=\"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6\" />"),
  print: P("<path d=\"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2\" /> <path d=\"M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6\" /> <rect x=\"6\" y=\"14\" width=\"12\" height=\"8\" rx=\"1\" />"),
  copy: P("<rect width=\"14\" height=\"14\" x=\"8\" y=\"8\" rx=\"2\" ry=\"2\" /> <path d=\"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2\" />"),
  dl: P("<path d=\"M12 15V3\" /> <path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" /> <path d=\"m7 10 5 5 5-5\" />"),
  mail: P("<path d=\"m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7\" /> <rect x=\"2\" y=\"4\" width=\"20\" height=\"16\" rx=\"2\" />"),
  check: P("<path d=\"M20 6 9 17l-5-5\" />"),
  menu: P("<path d=\"M4 5h16\" /> <path d=\"M4 12h16\" /> <path d=\"M4 19h16\" />"),
  shield: P("<path d=\"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z\" />"),
  ship: P("<path d=\"M12 2v2\" /> <path d=\"M12 9.189V13\" /> <path d=\"M19 12V6a2 2 0 00-2-2H7a2 2 0 00-2 2v6\" /> <path d=\"M19.38 19A11.6 11.6 0 0021 13l-8.188-3.639a2 2 0 00-1.624 0L3 13.001a11.6 11.6 0 002.81 7.76\" /> <path d=\"M2 20c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1s1.2 1 2.5 1c2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1\" />"),
  alert: P("<path d=\"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3\" /> <path d=\"M12 9v4\" /> <path d=\"M12 17h.01\" />"),
  lang: P("<path d=\"m5 8 6 6\"/><path d=\"m4 14 6-6 2-3\"/><path d=\"M2 5h12\"/><path d=\"M7 2h1\"/><path d=\"m22 22-5-10-5 10\"/><path d=\"M14 18h6\"/>"),
  database: P("<ellipse cx=\"12\" cy=\"5\" rx=\"9\" ry=\"3\"/><path d=\"M3 5v14a9 3 0 0 0 18 0V5\"/><path d=\"M3 12a9 3 0 0 0 18 0\"/>"),
  sparkle: P("<path d=\"M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z\"/><path d=\"M20 3v4\"/><path d=\"M22 5h-4\"/><path d=\"M4 17v2\"/><path d=\"M5 18H3\"/>"),
  gorevler: P("<path d=\"M13 5h8\" /> <path d=\"M13 12h8\" /> <path d=\"M13 19h8\" /> <path d=\"m3 17 2 2 4-4\" /> <path d=\"m3 7 2 2 4-4\" />"),
  raporlar: P("<path d=\"M3 3v16a2 2 0 0 0 2 2h16\" /> <path d=\"M18 17V9\" /> <path d=\"M13 17V5\" /> <path d=\"M8 17v-3\" />"),
  user: P("<path d=\"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2\" /> <circle cx=\"12\" cy=\"7\" r=\"4\" />"),
  logout: P("<path d=\"m16 17 5-5-5-5\" /> <path d=\"M21 12H9\" /> <path d=\"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4\" />"),
  help: P("<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3\" /> <path d=\"M12 17h.01\" />"),
  plus: P("<path d=\"M5 12h14\" /> <path d=\"M12 5v14\" />"),
  lock: P("<rect width=\"18\" height=\"11\" x=\"3\" y=\"11\" rx=\"2\" ry=\"2\" /> <path d=\"M7 11V7a5 5 0 0 1 10 0v4\" />"),
  up: P("<path d=\"m5 12 7-7 7 7\" /> <path d=\"M12 19V5\" />"),
  x: P("<path d=\"M18 6 6 18\" /> <path d=\"m6 6 12 12\" />"),
  circle: P("<circle cx=\"12\" cy=\"12\" r=\"10\" />"),
  done: P("<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"m16 9-5.5 5.5L8 12\" />"),
  clock: P("<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"M12 6v6l4 2\" />"),
  file: P("<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\" /> <path d=\"M14 2v5a1 1 0 0 0 1 1h5\" /> <path d=\"M10 9H8\" /> <path d=\"M16 13H8\" /> <path d=\"M16 17H8\" />"),
};
export const TYPES = ['ADD', 'UPD', 'DEL', 'GL', 'ENF', 'INFO'];
export const typeBadge = ty => h`<span class="badge ${ty}">${t('type.' + ty)}</span>`;
export const statusPill = (st, label) => { const c = st === 'ok' ? '' : st === 'degraded' || st === 'warn' || st === 'blocked' ? 'warn' : st === 'error' || st === 'err' ? 'err' : st === 'info' ? 'info' : 'idle'; return h`<span class="st ${c}"><i></i>${label || t('status.' + st)}</span>`; };
export const srcName = k => { const key = 'src.' + k; const v = t(key); if (v !== key) return v; const s = (S.status?.sources || []).find(x => x.key === k); return s?.name || (k || '').replace(/^os_/, 'OpenSanctions · '); };
export const trBtn = () => h`<button class="btn sm ghost trx-btn" type="button" data-trx-go>${icon.lang} ${t('tr.btn')}</button>`;
let trxInstalled = false;
/* Çeviri düğmesi: [data-trx=tür] kapsayıcı, .trx-src kaynak metinler (textarea ise value). Sonuç her kaynağın altına eklenir; orijinal görünür kalır. */
export function installTranslate() {
  if (trxInstalled) return; trxInstalled = true;
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-trx-go]'); if (!b) return;
    const box = b.closest('[data-trx]'); if (!box) return; e.preventDefault(); e.stopPropagation();
    if (box.querySelector('.trx-out')) { box.querySelectorAll('.trx-out').forEach(x => x.remove()); b.classList.remove('on'); return; }
    const srcs = [...box.querySelectorAll('.trx-src')].filter(x => (x.value ?? x.innerText ?? '').trim()); if (!srcs.length) return;
    const texts = srcs.map(x => (x.value ?? x.innerText).trim()); const old = b.innerHTML; b.disabled = true; b.textContent = t('tr.busy');
    const put = (el, node) => { const d = document.createElement('div'); d.className = 'trx-out'; d.appendChild(node); el.insertAdjacentElement('afterend', d); };
    try {
      const r = await api('/translate', { method: 'POST', body: { texts, target: S.lang, kind: box.dataset.trx } });
      srcs.forEach((el, i) => {
        const it = r.items?.[i] || {}; const tx = it.text; const wrap = document.createElement('div');
        const lab = document.createElement('div'); lab.className = 'trx-lab'; lab.textContent = `${r.ai ? t('tr.ai') : t('tr.machine')} · ${r.provider}${it.cached ? ' · ' + t('tr.cached') : ''} · ${t('tr.origAbove')}`;
        const body = document.createElement('div'); body.className = 'trx-body'; body.textContent = tx && !it.same && tx.trim() !== texts[i] ? tx : t('tr.same'); body.lang = S.lang; body.dir = S.lang === 'ar' ? 'rtl' : 'ltr';
        wrap.append(lab, body); put(el, wrap);
      }); b.classList.add('on');
    } catch (err) { const d = document.createElement('div'); d.className = 'trx-lab err'; d.textContent = err.message || t('tr.fail'); put(srcs[srcs.length - 1], d); }
    b.disabled = false; b.innerHTML = old;
  }, true);
}
export function baseBadge(it) {
  const b = it.baseCheck; if (!b) return h`<span class="muted">—</span>`;
  if (b.state === 'unavailable') return h`<span class="badge warn">${t('base.unavailable')}</span>`;
  if (b.state === 'none') return h`<span class="badge ok">${t('base.none')}</span>`;
  return h`<span class="badge err">${t('base.possible', { n: b.matches.length })}</span>`;
}
export function reasonText(code) { const [k, n] = String(code).split('|'); return t('reason.' + k, { n: n || '' }); }
export function liveDot() { const st = S.status; const ok = S.sseOk; const jobs = st?.jobs || []; const bad = jobs.filter(j => j.status === 'error' || j.status === 'blocked').length; return ok ? (bad ? 'warn' : '') : 'err'; }
export function debounce(fn, ms) { let tm; return (...a) => { clearTimeout(tm); tm = setTimeout(() => fn(...a), ms); }; }
export const down = (name, text, type = 'text/plain') => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type + ';charset=utf-8' })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); };
export async function copyText(text) { try { await navigator.clipboard.writeText(text); } catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); } }
export function modal(content, buttons, opts = {}) {
  return new Promise(res => {
    const el = document.createElement('div'); el.className = 'scrim'; el.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="modal-b" id="mb"></div><div class="modal-f" id="mf"></div></div>`;
    el.querySelector('#mb').innerHTML = content.toString();
    const f = el.querySelector('#mf');
    for (const b of buttons) { const bt = document.createElement('button'); bt.className = 'btn ' + (b.cls || ''); bt.textContent = b.label; bt.onclick = () => { const val = { v: b.value, form: Object.fromEntries([...el.querySelectorAll('[name]')].map(i => [i.name, i.type === 'checkbox' ? i.checked : i.value])) }; el.remove(); res(val); }; f.appendChild(bt); }
    el.addEventListener('click', e => { if (e.target === el) { el.remove(); res({ v: null }); } });
    document.body.appendChild(el); el.querySelector('input,textarea,button')?.focus(); try { opts.onOpen?.(el); } catch (e) { console.error(e); }
  });
}

/* sekmeler: base = '#/modül', items = [[anahtar, i18n-anahtar]] */
export const tabsBar = (base, items, active, cnt = {}) => h`<div class="tabs" role="tablist">${items.map(([k, lab]) => h`<a href="${base}${k ? '/' + k : ''}" role="tab" class="tabl ${((active || '') === k) ? 'on' : ''}">${t(lab)}${cnt[k] ? h` <span class="cntb">${cnt[k]}</span>` : ''}</a>`)}</div>`;
/* boş durum: başlık + yönlendirme + isteğe bağlı eylem */
export const emptyState = (titleKey, textKey, actions = '') => h`<div class="empty"><b>${t(titleKey)}</b><div style="max-width:460px;margin:0 auto 14px">${t(textKey)}</div>${actions}</div>`;
/* ipucu (tooltip): ? simgesi */
export const tip = key => h`<span class="tip" tabindex="0" aria-label="${t(key)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.500 9.500a2.500 2.500 0 114 2c-.9.600-1.500 1.100-1.500 2.200M12 17v.01"/></svg><span class="tipb">${t(key)}</span></span>`;
export const initials = n => (n || '?').replace(/\(.*?\)/g, '').trim().split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase();
export function sparkline(data, w = 120, hgt = 32) { const mx = Math.max(1, ...data); const pts = data.map((v, i) => `${(i / Math.max(1, data.length - 1) * w).toFixed(1)},${(hgt - 3 - v / mx * (hgt - 6)).toFixed(1)}`).join(' '); return raw(`<svg width="${w}" height="${hgt}" viewBox="0 0 ${w} ${hgt}"><polyline fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" points="${pts}"/></svg>`); }
export function lineChart(months, series, w = 720, hgt = 240) {
  const pad = { l: 34, r: 10, t: 12, b: 26 }; const mx = Math.max(5, ...series.flatMap(s => s.data)); const colors = ['#34577F', '#A5362F', '#2E6B52', '#94650F', '#5A5080', '#6C7280'];
  const X = i => pad.l + i / Math.max(1, months.length - 1) * (w - pad.l - pad.r), Y = v => pad.t + (1 - v / mx) * (hgt - pad.t - pad.b);
  let g = ''; for (let i = 0; i <= 4; i++) { const v = Math.round(mx * i / 4); g += `<line x1="${pad.l}" x2="${w - pad.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${pad.l - 6}" y="${Y(v) + 4}" text-anchor="end" font-size="10" fill="var(--muted)">${v}</text>`; }
  months.forEach((m, i) => { if (i % 2 === 0 || months.length < 8) g += `<text x="${X(i)}" y="${hgt - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">${m.slice(2)}</text>`; });
  series.forEach((s, k) => { g += `<polyline fill="none" stroke="${colors[k % 6]}" stroke-width="2.2" stroke-linejoin="round" points="${s.data.map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ')}"/>`; });
  return raw(`<svg viewBox="0 0 ${w} ${hgt}" width="100%" role="img">${g}</svg><div class="legend">${series.map((s, k) => `<span><i style="background:${colors[k % 6]}"></i>${esc(s.name)} <b>${s.total}</b></span>`).join('')}</div>`);
}
export function barRows(rows, key, cls = '') { const mx = Math.max(1, ...rows.map(r => r[key])); return rows.map(r => `<div class="barrow"><span>${esc(r.label)}</span><div class="bar"><i style="width:${(r[key] / mx * 100).toFixed(1)}%"></i></div><b>${r[key]}</b></div>`).join(''); }
export const confirmBox = async (title, text, okLabel, cls = 'pri') => (await modal(h`<h3>${title}</h3><p class="muted">${text}</p>`, [{ label: t('common.cancel'), value: false }, { label: okLabel || t('common.ok'), value: true, cls }])).v === true;

/* ───── Yapay zekâ düğmeleri: [data-ai=tür] ───── */
export const aiBtn = (kind, data = {}, opts = {}) => h`<button class="btn sm ghost ai-btn" type="button" data-ai="${kind}" data-ai-data="${JSON.stringify(data)}" ${opts.from ? h`data-ai-from="${JSON.stringify(opts.from)}"` : ''} ${opts.accept ? h`data-ai-accept="${opts.accept}"` : ''}>${icon.sparkle} ${opts.label || t('ai.btn.' + kind)}</button>`;
let aiInstalled = false;
export function installAI() {
  if (aiInstalled) return; aiInstalled = true;
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-ai]'); if (!b) return; e.preventDefault(); e.stopPropagation();
    const box = b.closest('[data-ai-box]') || b.parentElement; const old = box.querySelector(':scope > .ai-out'); if (old) { old.remove(); return; }
    let body = {}; try { body = JSON.parse(b.dataset.aiData || '{}'); } catch { }
    if (b.dataset.aiFrom) { try { for (const [k, sel] of Object.entries(JSON.parse(b.dataset.aiFrom))) { const x = document.querySelector(sel); body[k] = x ? (x.value ?? x.innerText) : ''; } } catch { } }
    body.lang = S.lang; const out = document.createElement('div'); out.className = 'ai-out'; out.textContent = t('ai.busy'); box.appendChild(out); const orig = b.innerHTML; b.disabled = true;
    try {
      const r = await api('/ai/' + b.dataset.ai, { method: 'POST', body });
      out.textContent = ''; const lab = document.createElement('div'); lab.className = 'ai-lab'; lab.textContent = `${r.label}${r.model ? ' · ' + r.model : ''}`; out.appendChild(lab);
      if (r.insufficient || !r.text) { const d = document.createElement('div'); d.className = 'small'; d.textContent = r.message || t('ai.none'); out.appendChild(d); }
      else {
        const src = new Map((r.sources || []).map(s => [s.id, s])); const ul = document.createElement('ul'); ul.className = 'ai-list';
        for (const line of r.text.split('\n')) { if (!line.trim()) continue; const li = document.createElement('li'); const parts = line.replace(/^\s*[-*•]\s*/, '').split(/(\[[A-Za-z0-9_.:-]+\])/);
          for (const p of parts) { const m = /^\[([A-Za-z0-9_.:-]+)\]$/.exec(p); if (m && src.get(m[1])?.url) { const a = document.createElement('a'); a.className = 'cite'; a.href = src.get(m[1]).url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = p; li.appendChild(a); } else if (m) { const s = document.createElement('span'); s.className = 'cite'; s.textContent = p; li.appendChild(s); } else li.appendChild(document.createTextNode(p)); }
          ul.appendChild(li); }
        out.appendChild(ul); if (r.dropped) { const d = document.createElement('div'); d.className = 'xs muted'; d.textContent = t('ai.dropped', { n: r.dropped }); out.appendChild(d); }
        if (r.sources?.length) { const sd = document.createElement('div'); sd.className = 'xs muted ai-src'; sd.textContent = t('ai.sources') + ': '; r.sources.forEach((s, i) => { const a = document.createElement(s.url ? 'a' : 'span'); if (s.url) { a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; } a.textContent = `[${s.id}] ${(s.title || '').slice(0, 70)}`; sd.appendChild(a); if (i < r.sources.length - 1) sd.appendChild(document.createTextNode(' · ')); }); out.appendChild(sd); }
        const row = document.createElement('div'); row.className = 'row'; row.style.marginTop = '8px'; const plain = r.text.split('\n').map(l => l.replace(/^\s*[-*•]\s*/, '').replace(/\s*\[[A-Za-z0-9_.:-]+\]/g, '').trim()).filter(Boolean).join('\n');
        const cp = document.createElement('button'); cp.type = 'button'; cp.className = 'btn sm'; cp.textContent = t('bul.copy'); cp.onclick = () => { navigator.clipboard?.writeText(plain); cp.textContent = t('bul.copied'); }; row.appendChild(cp);
        if (b.dataset.aiAccept) { const ac = document.createElement('button'); ac.type = 'button'; ac.className = 'btn sm pri'; ac.textContent = t('ai.accept'); ac.onclick = () => { const x = document.querySelector(b.dataset.aiAccept); if (x) { x.value = plain; x.dispatchEvent(new Event('input', { bubbles: true })); x.dispatchEvent(new Event('change', { bubbles: true })); ac.textContent = t('ai.accepted'); ac.disabled = true; } }; row.appendChild(ac); }
        out.appendChild(row);
      }
    } catch (err) { out.textContent = ''; const d = document.createElement('div'); d.className = 'ai-lab err'; d.textContent = err.message || t('ai.fail'); out.appendChild(d); }
    b.disabled = false; b.innerHTML = orig;
  }, true);
}

/* Uygulama içi okuyucu: öğenin TAM metni (sunucu önbelleği; düz metin paragraflar). Çevir + YZ özeti okuyucuda; “Orijinal kaynak” bağlantısı isteğe bağlıdır. */
export const readBtn = (id, cls = 'pri') => h`<button class="btn sm ${cls}" type="button" data-read="${id}">${icon.doc || icon.ext} ${t('rd.read')}</button>`;
let rdInstalled = false;
export function installReader() {
  if (rdInstalled) return; rdInstalled = true;
  document.addEventListener('click', e => { const b = e.target.closest('[data-read]'); if (!b) return; e.preventDefault(); openReader(b.dataset.read); }, true);
}
export async function openReader(id) {
  const shell = h`<div class="rd" data-trx="news"><div class="rd-head"><div class="row wrap"><span class="badge" id="rd-src"></span><span class="small muted" id="rd-date"></span><span class="sp"></span><a class="btn sm ghost" id="rd-orig" target="_blank" rel="noopener noreferrer" hidden>${icon.ext} ${t('rd.orig')}</a></div><h2 class="rd-title trx-src" id="rd-title">${t('rd.loading')}</h2></div><div data-ai-box class="rd-tools"><div class="row wrap">${trBtn()}${aiBtn('article', { id }, { label: t('rd.aiSum') })}<span class="sp"></span><span class="xs muted" id="rd-meta"></span></div></div><div id="rd-note"></div><div class="rd-body" id="rd-body"><div class="muted">${t('rd.loading')}</div></div></div>`;
  modal(shell, [{ label: t('common.close'), value: true, cls: 'pri' }], { onOpen: async root => {
    root.querySelector('.modal')?.classList.add('reader'); const q = sel => root.querySelector(sel);
    try {
      const a = await api('/reader/' + encodeURIComponent(id));
      q('#rd-src').textContent = a.source || ''; q('#rd-date').textContent = a.date ? fmtD(a.date) : ''; q('#rd-title').textContent = a.title || ''; if (a.url) { const o = q('#rd-orig'); o.href = a.url; o.hidden = false; }
      const body = q('#rd-body'); body.textContent = '';
      if (a.status === 'full') { q('#rd-meta').textContent = `${t('rd.full')} · ${num(a.chars)} ${t('rd.chars')}${a.fetchedAt ? ' · ' + rel(a.fetchedAt) : ''}`; }
      else { const n = q('#rd-note'); n.className = 'callout'; n.style.margin = '12px 0'; const b = document.createElement('b'); b.textContent = a.status === 'excerpt' ? t('rd.partial') : t('rd.failed'); const r = document.createElement('div'); r.className = 'small'; r.textContent = `${t('rd.reason')}: ${a.reason || '—'}`; n.append(b, r); }
      const paras = a.paragraphs?.length ? a.paragraphs : (a.excerpt ? [a.excerpt] : []);
      if (!paras.length) { body.textContent = t('rd.none'); return; }
      for (const ptxt of paras.slice(0, 400)) { const p = document.createElement(ptxt.length < 120 && !/[.!?:;,]$/.test(ptxt) ? 'h4' : 'p'); p.className = 'trx-src rd-p'; p.textContent = ptxt; body.appendChild(p); }
    } catch (err) { q('#rd-title').textContent = t('rd.failed'); q('#rd-body').textContent = err.message || ''; }
  } });
}
