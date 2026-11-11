import { S, h, t, BRAND, L, api, setLang, LANGS, toast, applyLang } from '../core.js';
import { icon } from '../ui.js';
const FEATS = [['bulletin', 'icon.bulten'], ['base', 'icon.base'], ['trade', 'icon.ticaret'], ['dd', 'icon.dd'], ['tasks', 'icon.gorevler'], ['live', 'icon.bell']];
export default {
  async render(el) {
    const draw = () => {
      el.innerHTML = h`
      <header class="lp-nav"><div class="in"><img src="${BRAND.wordmark}" height="30" alt="${t('app.name')}" style="height:30px;width:auto"><span class="muted xs" style="max-width:190px;line-height:1.3;border-inline-start:1px solid var(--line-2);padding-inline-start:14px">${t('app.descriptor')}</span><div class="sp"></div>
        <a class="l" href="#/durum">${t('lp.status')}</a><a class="l" href="#sec" data-go="sec">${t('lp.security')}</a>
        <div class="seg">${LANGS.map(l => h`<button data-lang="${l.code}" class="${S.lang === l.code ? 'on' : ''}">${l.label}</button>`)}</div><a class="btn pri" href="#/login">${t('lp.signin')}</a></div></header>
      <section class="lp-hero"><div class="in"><div><div class="eyebrow">${t('lp.eyebrow')}</div><div class="masthead-rule"></div><h1>${t('app.tagline')}</h1><p>${t('lp.sub')}</p><div class="row wrap"><a class="btn pri" href="#demo" data-go="demo">${t('lp.cta')}</a></div></div>
        <figure class="lp-shot" style="margin:0"><img src="brand/preview-bugun.png" alt="${t('lp.shotAlt')}" width="1440" height="900"></figure></div></section>
      <section class="lp-sec"><h2>${t('lp.featTitle')}</h2><p>${t('lp.featSub')}</p><div class="lp-feat">${FEATS.map(([k, ic]) => h`<div><h4>${icon[ic.replace('icon.', '')]}${t('lp.f.' + k)}</h4><p>${t('lp.f.' + k + '.d')}</p></div>`)}</div></section>
      <section class="lp-sec" style="padding-top:0"><div style="border-top:2px solid var(--ink);padding-top:22px"><h2>${t('lp.replaceTitle')}</h2><p class="muted" style="max-width:760px">${t('lp.replaceSub')}</p><div class="row wrap" style="gap:8px;margin-top:12px">${['OFAC', 'UK Sanctions List', 'EU FSF', 'UN SC', 'FATF', 'MASAK', 'Resmî Gazete', 'TARIC / GTİP', 'IMO'].map(x => h`<span class="tag">${x}</span>`)}</div></div></section>
      <section class="lp-sec" id="sec"><h2>${t('lp.secTitle')}</h2><p>${t('lp.secSub')}</p><div class="grid g3">${['reg', 'priv', 'host', 'crypto', 'access', 'audit'].map(k => h`<div style="border-top:1px solid var(--line-2);padding:14px 0 6px"><h4 style="font-family:var(--serif);font-size:16px">${t('lp.s.' + k)}</h4><p class="muted small" style="margin:6px 0 0">${t('lp.s.' + k + '.d')}</p></div>`)}</div></section>
      <section class="lp-sec" id="demo"><div class="grid g2" style="align-items:start"><div><h2>${t('lp.demoTitle')}</h2><p>${t('lp.demoSub')}</p></div>
        <form id="demoform" class="card" style="padding:24px"><div class="stack"><div><label class="f">${t('lp.name')}</label><input type="text" name="name" required maxlength="80"></div><div><label class="f">${t('lp.email')}</label><input type="text" name="email" required maxlength="120"></div><div class="grid g2"><div><label class="f">${t('lp.bank')}</label><input type="text" name="bank" maxlength="120"></div><div><label class="f">${t('lp.seats')}</label><input type="number" name="seats" min="1" max="2000"></div></div><div><label class="f">${t('lp.msg')}</label><textarea name="message" maxlength="800"></textarea></div><button class="btn pri" type="submit">${t('lp.send')}</button><div class="hint">${t('lp.kvkk')}</div></div></form></div></section>
      <footer class="lp-foot">© ${new Date().getFullYear()} ${t('app.name')} — ${t('lp.footer')}</footer>`.toString();
      el.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { setLang(b.dataset.lang); draw(); });
      el.querySelectorAll('[data-go]').forEach(a => a.onclick = e => { e.preventDefault(); document.getElementById(a.dataset.go)?.scrollIntoView({ behavior: 'smooth' }); });
      el.querySelector('#demoform').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); try { await api('/public/demo-request', { method: 'POST', body: { ...f, seats: +f.seats || null }, noRedirect: true }); toast(t('lp.sent'), ''); e.target.reset(); } catch (er) { toast(t('common.error'), er.message); } };
    };
    document.getElementById('app').classList.add('landing'); draw();
  },
};
