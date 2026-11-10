import { S, h, raw, t, tz, BRAND, gate, loadBrand, api, loadStatus, me, setLang, setTheme, applyLang, LANGS, routes, route, startLive, onLive, toast, rel, L, esc, isAdmin } from './core.js';
import { icon, liveDot, debounce, initials, installTranslate, installAI } from './ui.js';
import landing from './views/landing.js';
import login from './views/login.js';
import bugun from './views/bugun.js';
import bulten from './views/bulten.js';
import kontrol from './views/kontrol.js';
import gorevler from './views/gorevler.js';
import raporlar from './views/raporlar.js';
import kaynaklar from './views/kaynaklar.js';
import yonetim from './views/yonetim.js';
import ayarlarim from './views/ayarlarim.js';
import durum from './views/durum.js';
import ilk from './views/ilk.js';
import platform from './views/platform.js';

const PUBLIC = new Set(['', 'login', 'durum', 'ilk']);
route('ilk', ilk); route('platform', platform); route('', landing); route('login', login); route('durum', durum);
route('bugun', bugun); route('bulten', bulten); route('kontrol', kontrol); route('gorevler', gorevler); route('raporlar', raporlar); route('kaynaklar', kaynaklar); route('yonetim', yonetim); route('ayarlarim', ayarlarim);
const NAV_PLATFORM = [['nav.g3', ['platform', 'nav.platform']]];
const isPlatform = () => me().role === 'Platform';
const loadNotifs = async () => (isPlatform() || gate() ? [] : api('/notifications'));
const home = () => (gate() ? '#/ilk' : isPlatform() ? '#/platform' : '#/bugun');
const NAV = [['nav.g1', ['bugun', 'nav.bugun'], ['bulten', 'nav.bulten'], ['gorevler', 'nav.gorevler']], ['nav.g2', ['kontrol', 'nav.kontrol']], ['nav.g3', ['raporlar', 'nav.raporlar'], ['kaynaklar', 'nav.kaynaklar'], ['yonetim', 'nav.yonetim', 'admin']]];
let cleanup = null, current = null, lastActive = Date.now(), lastPing = Date.now();

const parse = () => { const [a, b] = (location.hash.replace(/^#\//, '') || '').split('?')[0].split('/'); return [a || '', b || '']; };
const root = () => document.getElementById('app');

function shell() {
  const st = S.status, u = me(); const unread = (S.notifs || []).filter(n => !n.read).length; const jobs = st?.jobs || [];
  const lastOk = jobs.map(j => j.lastOk).filter(Boolean).sort().pop(); const bad = jobs.filter(j => ['error', 'blocked'].includes(j.status)).length;
  const nav = (isPlatform() ? NAV_PLATFORM : NAV).map(([g, ...items]) => [g, items.filter(n => n[2] !== 'admin' || isAdmin())]).filter(g => g[1].length);
  const now = new Date(); const doy = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(now.getFullYear(), 0, 0)) / 864e5);
  const dateLong = new Intl.DateTimeFormat(S.lang === 'tr' ? 'tr-TR' : S.lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz() }).format(now);
  root().innerHTML = h`
  <a class="skip" href="#view">${t('a11y.skip')}</a>
  <div class="shell">
    <aside class="side" id="side">
      <div class="brand"><img class="wm" src="${BRAND.wordmarkLight}" alt="${t('app.name')}"><span class="desc">${t('app.descriptor')}</span><span class="org">${esc(st?.org?.name || '')}</span></div>
      <nav class="nav" aria-label="Main">${nav.map(([g, items]) => h`<div class="grp">${t(g)}</div>${items.map(([k, lab]) => h`<a href="#/${k}" data-r="${k}">${icon[k]}<span>${t(lab)}</span>${k === 'gorevler' && st?.counts?.tasks ? h`<span class="cnt">${st.counts.tasks}</span>` : ''}</a>`)}`)}</nav>
      <div class="side-foot">
        <div class="live"><span class="dot ${liveDot()}"></span><b style="color:#E9E3D1">${S.sseOk ? t('live.on') : t('live.off')}</b></div>
        <div style="margin-top:6px">${t('live.lastUpdate')}: <b style="color:#E9E3D1">${lastOk ? rel(lastOk) : '—'}</b></div>
        <div>${bad ? t('live.issues', { n: bad }) : t('live.allOk')}</div>
        <div style="margin-top:8px;opacity:.7">v${esc(st?.version || '')}</div>
      </div>
    </aside>
    <div class="main">
      ${st?.org?.demo ? h`<div class="banner no-print"><span class="pdemo">DEMO</span> ${t('demo.banner')}</div>` : ''}
      ${st?.billingAlert ? h`<div class="banner stale no-print" role="alert">${icon.alert}<span><b>${t(st.billingAlert.kind === 'overdue' ? 'bil.alertOverdue' : 'bil.alertDue', { n: st.billingAlert.invoice, d: st.billingAlert.daysOverdue ?? st.billingAlert.days, g: st.billingAlert.graceLeft ?? 0 })}</b> <a href="#/yonetim/faturalama">${t('bil.alertGo')}</a></span></div>` : ''}
      ${st?.health && !st.health.ok ? h`<div class="banner stale no-print" role="alert">${icon.alert}<span><b>${t('health.banner', { n: st.health.bad.length })}</b> ${st.health.bad.slice(0, 3).map(b => b.label).join(', ')}${st.health.bad.length > 3 ? '…' : ''} — ${t('health.bannerD')} <a href="#/kaynaklar/durum">${t('health.view')}</a></span></div>` : ''}
      <header class="top no-print">
        <button class="iconbtn menu-btn" id="menu" aria-label="Menu">${icon.menu}</button>
        <div class="crumb"><b id="crumb"></b></div><div class="tdate"><span>${esc(dateLong)}</span><span class="ed">${t('top.edition', { n: doy })}</span></div><div class="sp"></div>
        <div class="regime"><span class="dot ${bad ? 'warn' : ''}"></span>${bad ? t('live.issues', { n: bad }) : t('live.allOk')}${lastOk ? h` · ${t('live.lastUpdate')} ${rel(lastOk)}` : ''}</div>
        <div class="seg" role="group" aria-label="Language">${LANGS.map(l => h`<button data-lang="${l.code}" class="${S.lang === l.code ? 'on' : ''}" title="${l.name}">${l.label}</button>`)}</div>
        <button class="iconbtn" id="theme" title="${t('top.theme')}" aria-label="${t('top.theme')}">${S.theme === 'dark' ? icon.sun : icon.moon}</button>
        <div class="rel"><button class="iconbtn" id="bell" title="${t('top.notifs')}" aria-label="${t('top.notifs')}">${icon.bell}${unread ? h`<span class="badge-n">${unread}</span>` : ''}</button><div id="bellpop"></div></div>
        <div class="rel"><button class="userbtn" id="userbtn" aria-haspopup="menu"><span class="avatar">${initials(u.name)}</span><span style="text-align:start"><b>${u.name.replace(/\s*\(DEMO\)/, '')}</b><small>${t('role.' + u.role)}</small></span></button><div id="userpop"></div></div>
      </header>
      <main class="page" id="view" tabindex="-1"></main>
    </div>
  </div><div class="toasts" aria-live="polite"></div>`.toString();
  document.querySelectorAll('[data-lang]').forEach(b => b.onclick = async () => { setLang(b.dataset.lang); try { await api('/me/prefs', { method: 'PUT', body: { lang: b.dataset.lang } }); } catch { } full(); });
  document.getElementById('theme').onclick = () => { setTheme(S.theme === 'dark' ? 'light' : 'dark'); full(); };
  document.getElementById('menu').onclick = () => document.getElementById('side').classList.toggle('open');
  document.getElementById('bell').onclick = e => { e.stopPropagation(); toggleBell(); };
  document.getElementById('userbtn').onclick = e => { e.stopPropagation(); toggleUser(); };
  document.querySelectorAll('.nav a').forEach(a => a.addEventListener('click', () => document.getElementById('side').classList.remove('open')));
}
document.addEventListener('click', () => { const a = document.getElementById('bellpop'), b = document.getElementById('userpop'); if (a) a.innerHTML = ''; if (b) b.innerHTML = ''; });
function toggleBell() {
  const el = document.getElementById('bellpop'); if (el.innerHTML) { el.innerHTML = ''; return; }
  const list = (S.notifs || []).slice(0, 10);
  el.innerHTML = h`<div class="pop"><div class="row" style="padding:14px 16px;border-bottom:1px solid var(--line)"><b class="sp">${t('top.notifs')}</b><button class="btn sm ghost" id="markread">${t('notif.markRead')}</button></div>
  ${list.length ? list.map(n => h`<a class="it" href="${n.link || '#/gorevler'}" style="color:inherit;text-decoration:none;${n.read ? 'opacity:.65' : ''}"><div><div class="small"><b>${t('rule.' + n.kind)}</b> · ${rel(n.ts)}</div><div class="small">${n.title}</div>${n.body ? h`<div class="xs muted">${n.body}</div>` : ''}</div></a>`) : h`<div class="empty"><b>${t('notif.empty')}</b>${t('notif.emptyHint')}</div>`}
  <div style="padding:10px 16px"><a href="#/ayarlarim/bildirim" class="small">${t('notif.rules')} →</a></div></div>`.toString();
  el.querySelector('.pop').onclick = e => e.stopPropagation();
  document.getElementById('markread')?.addEventListener('click', async () => { await api('/notifications/read', { method: 'POST' }); S.notifs = S.notifs.map(n => ({ ...n, read: true })); shell(); mark(); });
}
function toggleUser() {
  const el = document.getElementById('userpop'); if (el.innerHTML) { el.innerHTML = ''; return; }
  const u = me();
  el.innerHTML = h`<div class="pop" style="width:260px"><div style="padding:14px 16px;border-bottom:1px solid var(--line)"><b>${u.name}</b><div class="xs muted">${u.email}</div></div>
  ${isPlatform() ? '' : h`<a class="it" href="#/ayarlarim" style="color:inherit;text-decoration:none">${icon.user}<span>${t('user.settings')}</span></a>`}
  <a class="it" href="#/ayarlarim/guvenlik" style="color:inherit;text-decoration:none">${icon.lock}<span>${t('user.security')}</span></a>
  <a class="it" href="#/durum" style="color:inherit;text-decoration:none">${icon.globe}<span>${t('user.status')}</span></a>
  <a class="it" id="logout" href="#/login" style="color:inherit;text-decoration:none">${icon.logout}<span>${t('user.logout')}</span></a></div>`.toString();
  el.querySelector('.pop').onclick = e => e.stopPropagation();
  el.querySelector('#logout').onclick = async e => { e.preventDefault(); try { await api('/auth/logout', { method: 'POST' }); } catch { } S.status = null; S.csrf = ''; location.hash = '#/login'; };
}
function mark() { const [r] = parse(); document.querySelector('.top')?.classList.toggle('is-front', r === 'bugun'); document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('on', a.dataset.r === r)); const c = document.getElementById('crumb'); if (c) c.textContent = t('nav.' + r); document.title = `${t('nav.' + r)} · ${t('app.name')}`; }
async function renderView() {
  const [r, sub] = parse(); const pub = PUBLIC.has(r);
  if (cleanup) { try { cleanup(); } catch { } cleanup = null; }
  if (!pub && !S.status) { try { await loadStatus(); S.notifs = await loadNotifs(); startLiveOnce(); } catch { location.hash = '#/login'; return; } }
  if (!pub && gate()) { location.hash = '#/ilk'; return; }
  if (!pub && isPlatform() && r !== 'platform' && r !== 'ayarlarim') { location.hash = '#/platform'; return; }
  if (r === 'platform' && S.status && !isPlatform()) { location.hash = '#/bugun'; return; }
  const mod = routes[r] || routes.bugun; current = mod;
  if (pub) { root().innerHTML = '<div id="view"></div><div class="toasts"></div>'; if (r === 'login' && S.status) { location.hash = home(); return; } }
  else if (!document.getElementById('view') || !document.querySelector('.shell')) shell();
  mark(); S.route = r;
  const el = document.getElementById('view');
  try { cleanup = await mod.render(el, sub) || null; } catch (e) {
    console.error(e);
    if (e.data?.error === 'mfa_enrollment_required' || e.data?.error === 'password_change_required') { await loadStatus().catch(() => { }); location.hash = '#/ilk'; return; }
    el.innerHTML = h`<div class="callout err"><b>${t('common.error')}</b><br>${e.message}</div>`.toString();
  }
  window.scrollTo(0, 0);
}
async function full() { if (S.status) { try { await loadStatus(); S.notifs = await loadNotifs(); } catch { } } document.getElementById('app').innerHTML = ''; await renderView(); }
installTranslate(); installAI();
let liveOn = false; function startLiveOnce() { if (liveOn) return; liveOn = true; startLive(); }
const softRefresh = debounce(async type => {
  if (!S.status) return; const [r] = parse(); if (PUBLIC.has(r)) return;
  try { await loadStatus(); S.notifs = await loadNotifs(); } catch { return; }
  const keep = document.getElementById('view'); shell(); document.getElementById('view').replaceWith(keep); mark();
  if (current?.live) { try { await current.live(type, keep, parse()[1]); } catch (e) { console.error(e); } }
}, 700);

(async () => {
  applyLang(); await loadBrand(); window.addEventListener('hashchange', renderView);
  try { await loadStatus(); S.notifs = await loadNotifs(); startLiveOnce(); if (S.status.prefs?.lang && !localStorage.getItem('um.lang')) { setLang(S.status.prefs.lang); } } catch { S.status = null; }
  const [r] = parse(); if (!r && S.status) location.hash = home(); else await renderView();
  const syncLive = () => { const dt = document.querySelector('.side-foot .dot'); if (dt) { dt.className = 'dot ' + liveDot(); const lb = dt.parentElement?.querySelector('b'); if (lb) lb.textContent = S.sseOk ? t('live.on') : t('live.off'); } };
  onLive((type, d) => {
    if (type === 'notify') { toast(t('rule.' + d.kind), String(d.title).slice(0, 160)); }
    if (type === 'conn') { const dt = document.querySelector('.side-foot .dot'); if (dt) { dt.className = 'dot ' + liveDot(); const lb = dt.parentElement?.querySelector('b'); if (lb) lb.textContent = S.sseOk ? t('live.on') : t('live.off'); } return; }
    softRefresh(type);
  });
  syncLive(); setInterval(syncLive, 2000);
  // boşta oturum kapatma (sunucu da zorlar) + etkin kullanıcı için oturumu canlı tut
  for (const ev of ['click', 'keydown', 'pointermove']) document.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true });
  setInterval(async () => {
    if (!S.status) return; const idle = (S.status.settings?.security?.idleMinutes || 30) * 60e3; const now = Date.now();
    if (now - lastActive > idle) { try { await api('/auth/logout', { method: 'POST' }); } catch { } S.status = null; S.csrf = ''; location.hash = '#/login'; toast(t('sec.idleOut'), ''); return; }
    if (now - lastPing > idle / 3 && now - lastActive < idle / 3) { lastPing = now; try { await api('/status'); } catch { } }
  }, 20000);
})();
