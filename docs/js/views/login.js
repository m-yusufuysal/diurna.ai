import { S, h, t, BRAND, api, loadStatus, setLang, LANGS, toast, gate, me } from '../core.js';
export default {
  async render(el) {
    let ticket = null;
    const draw = (err = '') => {
      el.innerHTML = h`<div class="loginwrap"><div class="loginart"><div class="brand" style="border:0;padding:0"><img class="wm" src="${BRAND.wordmarkLight}" alt="${t('app.name')}"><span class="desc">${t('app.descriptor')}</span></div><div><h1>${t('app.tagline')}</h1><div class="masthead-rule" style="width:56px;margin:18px 0;border-top:2px solid var(--accent);border-bottom:0;height:0;opacity:1"></div><p>${t('login.artSub')}</p></div><div class="xs" style="color:#8fa0bb">${t('login.secure')}</div></div>
      <div class="loginform"><div class="box"><div class="row" style="justify-content:space-between;margin-bottom:22px"><a href="#/" class="small">← ${t('login.back')}</a><div class="seg">${LANGS.map(l => h`<button data-lang="${l.code}" class="${S.lang === l.code ? 'on' : ''}">${l.label}</button>`)}</div></div>
      <h2 style="margin-bottom:6px">${ticket ? t('login.mfaTitle') : t('login.title')}</h2><p class="muted" style="margin:0 0 20px">${ticket ? t('login.mfaSub') : t('login.sub')}</p>
      ${err ? h`<div class="callout err" style="margin-bottom:14px">${err}</div>` : ''}
      <form id="lf" class="stack" autocomplete="on">${ticket ? h`<div><label class="f">${t('login.code')}</label><input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" autofocus maxlength="12" placeholder="123456"><div class="hint">${t('login.recoveryHint')}</div></div>` : h`<div><label class="f">${t('login.email')}</label><input type="text" name="email" autocomplete="username" autofocus></div><div><label class="f">${t('login.password')}</label><input type="password" name="password" autocomplete="current-password" ></div>`}
        <button class="btn pri" type="submit" style="justify-content:center">${t('login.submit')}</button></form>
      <div class="hint" style="margin-top:14px">${t('login.sso')} <span class="tag">SAML 2.0 / OIDC — ${t('common.placeholder')}</span></div>
      ${!ticket ? h`<div class="callout info" style="margin-top:18px"><b>${t('login.demoTitle')}</b><div class="small">${t('login.demoText')}</div></div>` : ''}</div></div></div>`.toString();
      el.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { setLang(b.dataset.lang); draw(); });
      el.querySelector('#lf').onsubmit = async e => {
        e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const btn = e.target.querySelector('button'); btn.disabled = true;
        try {
          const r = ticket ? await api('/auth/mfa', { method: 'POST', body: { ticket, code: f.code }, noRedirect: true }) : await api('/auth/login', { method: 'POST', body: f, noRedirect: true });
          if (r.mfaRequired) { ticket = r.ticket; draw(); return; }
          await loadStatus(); if (gate()) { location.hash = '#/ilk'; location.reload(); return; } S.notifs = me().role === 'Platform' ? [] : await api('/notifications'); if (S.status.prefs?.lang) setLang(S.status.prefs.lang); location.hash = me().role === 'Platform' ? '#/platform' : '#/bugun'; location.reload();
        } catch (er) { if (er.data?.error === 'expired') ticket = null; draw(er.message); }
      };
    };
    draw();
  },
};
