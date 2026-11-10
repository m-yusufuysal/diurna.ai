import { S, h, t, BRAND, api, loadStatus, setLang, LANGS, gate, me, toast } from '../core.js';
import { copyText } from '../ui.js';
/* İlk giriş: (1) geçici parolayı değiştir, (2) MFA kur. Sunucu bu iki adım bitmeden başka hiçbir API'ye izin vermez. */
export default {
  async render(el) {
    try { if (!S.status) await loadStatus(); } catch { location.hash = '#/login'; return; }
    const done = () => { location.hash = me().role === 'Platform' ? '#/platform' : '#/bugun'; location.reload(); };
    if (!gate()) return done();
    let mfa = null, recovery = null, err = '', ok = false;
    const frame = body => h`<div class="loginwrap"><div class="loginart"><div class="brand" style="border:0;padding:0"><img class="wm" src="${BRAND.wordmarkLight}" alt="${t('app.name')}"><span class="desc">${t('app.descriptor')}</span></div><div><h1>${t('first.art')}</h1><div class="masthead-rule" style="width:56px;margin:18px 0;border-top:2px solid var(--accent);border-bottom:0;height:0;opacity:1"></div><p>${t('first.artSub')}</p></div><div class="xs" style="color:#8fa0bb">${t('login.secure')}</div></div>
      <div class="loginform"><div class="box"><div class="row" style="justify-content:flex-end;margin-bottom:18px"><div class="seg">${LANGS.map(l => h`<button data-lang="${l.code}" class="${S.lang === l.code ? 'on' : ''}">${l.label}</button>`)}</div></div>${body}</div></div></div>`;
    const steps = () => { const g = gate(); return h`<div class="row small" style="gap:10px;margin-bottom:16px"><span class="badge ${g === 'pw' ? '' : 'ok'}">1 · ${t('first.s1')}</span><span class="badge ${g === 'mfa' || recovery ? '' : ''}" style="${g === 'pw' ? 'opacity:.55' : ''}">2 · ${t('first.s2')}</span></div>`; };
    const draw = async () => {
      const g = gate(); let body;
      if (recovery) body = h`<h2>${t('mfa.recovery')}</h2><p class="muted">${t('mfa.recoveryHint')}</p><div class="code" id="rc">${recovery.join('\n')}</div><div class="row" style="margin-top:14px"><button class="btn" id="cp" type="button">${t('common.copy')}</button><span class="sp"></span><button class="btn pri" id="go">${t('first.continue')}</button></div>`;
      else if (g === 'pw') body = h`${steps()}<h2 style="margin-bottom:6px">${t('first.pwTitle')}</h2><p class="muted" style="margin:0 0 16px">${t('first.pwSub')}</p>${err ? h`<div class="callout err" style="margin-bottom:14px">${err}</div>` : ''}
        <form id="pf" class="stack"><div><label class="f">${t('first.temp')}</label><input type="password" name="current" autocomplete="current-password" autofocus></div><div><label class="f">${t('pw.new')}</label><input type="password" name="next" autocomplete="new-password"><div class="hint">${t('pw.policy')}</div></div><div><label class="f">${t('first.repeat')}</label><input type="password" name="again" autocomplete="new-password"></div><button class="btn pri" type="submit" style="justify-content:center">${t('pw.change')}</button></form>`;
      else if (g === 'mfa') { if (!mfa) mfa = await api('/me/mfa/begin', { method: 'POST' }); body = h`${steps()}<h2 style="margin-bottom:6px">${t('first.mfaTitle')}</h2><p class="muted" style="margin:0 0 14px">${t('first.mfaSub')}</p>${err ? h`<div class="callout err" style="margin-bottom:14px">${err}</div>` : ''}<p class="small">${t('mfa.step1')}</p><div class="code" style="word-break:break-all">${mfa.secret}</div><details class="adv"><summary>otpauth URI</summary><div class="code" style="word-break:break-all;font-size:11px">${mfa.uri}</div></details>
        <form id="mf" class="stack" style="margin-top:14px"><div><label class="f">${t('mfa.step2')}</label><input type="text" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" autofocus></div><button class="btn pri" type="submit" style="justify-content:center">${t('mfa.confirm')}</button></form>`; }
      el.innerHTML = frame(body).toString(); err = '';
      el.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { setLang(b.dataset.lang); draw(); });
      el.querySelector('#cp')?.addEventListener('click', () => copyText(recovery.join('\n'))); el.querySelector('#go')?.addEventListener('click', done);
      el.querySelector('#pf')?.addEventListener('submit', async e => {
        e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); if (f.next !== f.again) { err = t('first.mismatch'); return draw(); }
        try { await api('/me/password', { method: 'POST', body: { current: f.current, next: f.next } }); await loadStatus(); if (!gate()) return done(); draw(); } catch (er) { err = er.message + (er.data?.issues ? ' (' + er.data.issues.join(', ') + ')' : ''); draw(); }
      });
      el.querySelector('#mf')?.addEventListener('submit', async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); try { const r = await api('/me/mfa/confirm', { method: 'POST', body: { code: f.code } }); recovery = r.recovery; await loadStatus(); draw(); } catch (er) { err = er.message; draw(); } });
    };
    await draw();
  },
};
