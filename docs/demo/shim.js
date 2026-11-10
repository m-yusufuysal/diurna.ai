/* Diurna – GitHub Pages DEMO katmanı.
 * Sunucu yok: tarayıcı içinde fetch('/api/…') ve EventSource çağrılarını yanıtlar.
 *  - Okuma (GET): docs/demo/data/api.json içindeki anlık görüntü (demo kurumu, örnek müşteri/görev verisi; gerçek kişi/müşteri verisi YOK).
 *  - Eşleştirme/arama/CSV taraması/ticaret kontrolü/DD: sunucudaki AYNI saf modüller (match, customers, trade, dd) tarayıcıda, gerçek resmî liste anlık görüntüsüne karşı çalışır.
 *  - Yazma işlemleri bellekte tutulur (sayfayı yenileyince sıfırlanır). Gerçek e-posta/AI/çeviri/ödeme/imza gibi sunucu işlevleri kapalıdır.
 *  - Giriş: her bilgi kabul edilir (parola doğrulaması yoktur). */
(function () {
  'use strict';
  const BASE = new URL('.', document.currentScript.src).href, DATA = BASE + 'data/';
  const realFetch = window.fetch.bind(window);
  const LS = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { } };
  const lang = () => LS('um.lang') || document.documentElement.lang || 'tr';
  const MSG = {
    banner: { tr: 'Demo — veriler anlık görüntü', en: 'Demo — data is a snapshot', ar: 'عرض تجريبي — البيانات لقطة ثابتة' },
    off: { tr: 'Bu işlem demo sürümünde kapalı (yalnızca anlık görüntü). Canlı sürümde çalışır.', en: 'This action is disabled in the demo (snapshot only). It works in the live product.', ar: 'هذا الإجراء معطّل في النسخة التجريبية (لقطة فقط). يعمل في النسخة الحيّة.' },
    ai: { tr: 'Demo: yapay zekâ özellikleri canlı sürümde, kurumun kendi/onayladığı model uç noktasıyla çalışır; demoda kapalıdır.', en: 'Demo: AI features run in the live product against the bank\'s own/approved model endpoint; they are off in the demo.', ar: 'عرض تجريبي: ميزات الذكاء الاصطناعي تعمل في النسخة الحيّة مع نموذج البنك المعتمد؛ وهي معطّلة هنا.' },
    tr: { tr: '[Demo] Çeviri canlı sürümde yapay zekâ + sözlükle yapılır.', en: '[Demo] Translation is done by AI + glossary in the live product.', ar: '[تجريبي] تتم الترجمة في النسخة الحيّة بالذكاء الاصطناعي مع قاموس.' },
    loading: { tr: 'Resmî listeler yükleniyor…', en: 'Loading official lists…', ar: 'جارٍ تحميل القوائم الرسمية…' },
    dl: { tr: 'Demo: bu dosya canlı sürümde üretilir.', en: 'Demo: this file is generated in the live product.', ar: 'تجريبي: يُنشأ هذا الملف في النسخة الحيّة.' },
  };
  const m = k => MSG[k][lang()] || MSG[k].en;

  /* ───── yardımcılar ───── */
  const clone = o => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  const uid = () => Math.random().toString(36).slice(2, 8);
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  const text = (s, ct = 'text/plain; charset=utf-8') => new Response(s, { status: 200, headers: { 'content-type': ct } });
  const off = (key = 'off', code = 403) => json({ error: 'demo', message: m(key) }, code);

  /* ───── veri ───── */
  let DB = null; const dbP = realFetch(DATA + 'api.json').then(r => r.json()).then(d => { DB = d; prep(); return d; });
  const Q = { in: LS('demo.out') !== '1' };
  function prep() {
    DB['/tasks'] = DB['/tasks'] || { tasks: [], users: [] };
    DB['/notifications'] = DB['/notifications'] || [];
    DB['/me/watchlist'] = DB['/me/watchlist'] || [];
    DB['/blocklist'] = DB['/blocklist'] || [];
    DB['/trade/notes'] = DB['/trade/notes'] || [];
    /* kapsam dışı: faturalama / ödeme / fiyat */
    const st = DB['/status']; st.billingAlert = null; if (st.org) { delete st.org.plan; delete st.org.seats; }
    delete DB['/billing']; DB['/public/plans'] = {};
    if (DB['/roi']) Object.assign(DB['/roi'], { subscriptionMonth: null, netMonth: null, roiMultiple: null, plan: null, seats: null });
    const E = window.DemoEngine.ENG; E.settings = Object.assign(E.settings, clone(DB['/settings/full'] || {}));
    E.dd = clone(DB['/dd']); E.customers = { meta: clone(DB['/customers']?.meta), rows: clone(DB['/customers']?.sample || []) };
  }
  const E = () => window.DemoEngine.ENG, Eng = () => window.DemoEngine;

  /* ───── motor yükleme (ilk taramada) ───── */
  let overlay = null;
  function showOverlay(p) {
    if (!overlay) { overlay = document.createElement('div'); overlay.className = 'demo-load'; document.body.appendChild(overlay); }
    overlay.innerHTML = `<div><b>${m('loading')}</b><i><u style="width:${Math.round(p * 100)}%"></u></i></div>`;
  }
  async function engine() {
    await dbP; if (!window.__demoEngineStarted) { window.__demoEngineStarted = true; }
    const p = Eng().init(DATA, pr => showOverlay(pr));
    if (!E().entries.length) showOverlay(0);
    try { await p; } finally { if (overlay) { overlay.remove(); overlay = null; } }
    return Eng();
  }

  /* ───── eşleştirme (server.js / screening.js ile aynı mantık) ───── */
  const thrOf = b => +b.threshold || E().settings.matchThreshold || 85;
  function runMatch(threshold) {
    const D = Eng(), ix = D.L.orgIndex(), cust = E().customers; if (!cust.rows.length) { DB['/match'] = null; return null; }
    const t0 = Date.now(); const hits = []; threshold = threshold || E().settings.matchThreshold || 85;
    for (const c of cust.rows) {
      const found = ix.search(c.name, { threshold, imo: c.imo ? [c.imo] : undefined, limit: 6 }); const extra = [];
      for (const a of c.aliases || []) extra.push(...ix.search(a, { threshold, limit: 3 }));
      const seen = new Map(); for (const h of [...found, ...extra]) { const k = h.entry.s + h.entry.id; if (!seen.has(k) || seen.get(k).score < h.score) seen.set(k, h); }
      const list = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 6);
      if (list.length) hits.push({ customer: { id: c.id, name: c.name, type: c.type, imo: c.imo, country: c.country }, matches: list.map(h => ({ score: h.score, reasons: h.reasons, via: h.via, how: h.type, entry: D.present(h.entry) })) });
    }
    hits.sort((a, b) => b.matches[0].score - a.matches[0].score);
    const run = { at: new Date().toISOString(), ms: Date.now() - t0, threshold, screened: cust.rows.length, hitCount: hits.length, customersSha: cust.meta?.sha, lists: D.L.meta(), hits, sample: !!cust.meta?.sample };
    DB['/match'] = run; return run;
  }
  const hitRow = h => ({ score: h.score, how: h.type, reasons: h.reasons, name: h.entry.n[0], src: h.entry.s, id: h.entry.id, program: h.entry.c || '', url: Eng().present(h.entry).url });

  /* ───── Veri motoru (varlık araması) – liste anlık görüntüsünden ───── */
  let FOLDED = null;
  const SRCL = () => Eng().L.SRC_LABEL;
  const view = e => ({ key: e.s + ':' + e.id, src: e.s, srcLabel: SRCL()[e.s] || e.s, id: e.id, name: e.n[0], aliases: e.n.slice(1, 8), type: e.t, typeLabel: Eng().L.TYPE_LABEL[e.t], programme: e.c, listed: e.d || '', updated: e.u || '', imo: e.imo || [], ref: e.ref || e.un || '', country: e.cty || '', firstSeen: e.d || (E().listMeta[e.s]?.changedAt || '').slice(0, 10) || null, lastSeen: (DB.__meta.takenAt || '').slice(0, 10), removed: null, url: Eng().present(e).url });
  function entSearch(q) {
    const M = Eng().req('match'); if (!FOLDED) FOLDED = E().entries.map(e => e.n.map(M.fold).join(' | '));
    const toks = M.fold(q.q || '').trim().split(/\s+/).filter(Boolean); const out = [];
    for (let i = 0; i < E().entries.length; i++) {
      const e = E().entries[i]; if (q.src && e.s !== q.src) continue; if (q.type && e.t !== q.type) continue; if (q.status === 'removed') continue;
      if (q.programme && !(e.c || '').toLowerCase().includes(q.programme.toLowerCase())) continue;
      if (toks.length && !toks.every(t => FOLDED[i].includes(t))) continue; out.push(e);
    }
    return { total: out.length, items: out.slice(+q.offset || 0, (+q.offset || 0) + (+q.limit || 50)).map(view) };
  }
  function entGet(key) {
    const e = E().entries.find(x => x.s + ':' + x.id === key); if (!e) return null; const M = Eng().req('match'); const f = M.fold(e.n[0]);
    const rel = E().entries.filter(x => x !== e && ((e.imo && x.imo && x.imo.some(i => e.imo.includes(i))) || (M.fold(x.n[0]) === f && x.t === e.t))).slice(0, 12).map(view);
    return { entity: view(e), aliases: e.n, related: rel, history: [] };
  }

  /* ───── yönlendirici ───── */
  function bulletinKey(id, q) { return `/bulletins/${id}/render?version=${q.get('version') || 'internal'}&lang=${q.get('lang') || 'tr'}&format=${q.get('format') || 'html'}`; }
  function taskView(t) { const left = t.dueAt ? new Date(t.dueAt) - Date.now() : null; t.sla = { state: t.status === 'closed' ? 'closed' : left != null && left < 0 ? 'breached' : 'ok', left }; return t; }
  const me = () => DB['/status'].user;

  async function handle(method, path, q, body) {
    const db = await dbP; const bq = body || {};
    /* — kimlik — */
    if (path === '/auth/login' && method === 'POST') { Q.in = true; LS('demo.out', '0'); return json({ user: me(), org: db['/status'].org, csrf: 'demo' }); }
    if (path === '/auth/logout') { Q.in = false; LS('demo.out', '1'); return json({ ok: true }); }
    if (path === '/auth/mfa') return json({ user: me(), org: db['/status'].org, csrf: 'demo' });
    if (path === '/public/brand') { const b = clone(db['/public/brand']); for (const k of ['logo', 'wordmark', 'wordmarkLight']) if (typeof b[k] === 'string') b[k] = b[k].replace(/^\//, ''); return json(b); }
    if (path === '/public/plans' || path === '/public/status') return json(db[path]);
    if (path === '/public/demo-request') return json({ ok: true });
    if (!Q.in) return json({ error: 'auth', message: 'Oturum gerekli' }, 401);

    if (method === 'GET') {
      if (path === '/status') {
        const s = clone(db['/status']); s.csrf = 'demo'; s.counts = s.counts || {};
        s.counts.notifications = db['/notifications'].filter(n => !n.read).length; s.counts.tasks = db['/tasks'].tasks.filter(t => t.assignee === me().id && t.status !== 'closed').length;
        return json(s);
      }
      if (path === '/customers') { const c = E().customers; return json({ meta: c.meta, sample: c.rows.slice(0, 200), total: c.rows.length }); }
      if (path === '/tasks') { db['/tasks'].tasks.forEach(taskView); return json(db['/tasks']); }
      if (path === '/hs') { await engine(); return json({ items: Eng().req('trade').searchHS(q.get('q')), meta: Eng().req('trade').meta() }); }
      if (path === '/entities') { await engine(); return json(entSearch(Object.fromEntries(q))); }
      if (path.startsWith('/entities/') && path !== '/entities/stats' && path !== '/entities/feed') { await engine(); const d = entGet(decodeURIComponent(path.slice(10))); return d ? json(d) : json({ error: 'not_found' }, 404); }
      const rm = /^\/bulletins\/([\w-]+)\/render$/.exec(path);
      if (rm) { const r = db[bulletinKey(rm[1], q)] || db[bulletinKey(db['/bulletins/today'].id, q)]; return r ? text(r.__text, r.__ct) : json({ error: 'not_found' }, 404); }
      if (path === '/me/report') { return json(db['/me/report?lang=' + (q.get('lang') || 'tr')] || db['/me/report?lang=tr']); }
      if (path === '/templates/customers.csv') return text(db[path].__text, 'text/csv; charset=utf-8');
      const full = path + (q.toString() ? '?' + q.toString() : '');
      const v = db[full] !== undefined ? db[full] : db[path];
      if (v !== undefined) return v && v.__text !== undefined ? text(v.__text, v.__ct) : json(clone(v));
      return json({ error: 'not_found' }, 404);
    }

    /* — yazma: bellekte — */
    if (path === '/me/prefs') { const p = db['/status'].prefs = Object.assign(db['/status'].prefs || {}, bq); return json(p); }
    if (path === '/notifications/read') { db['/notifications'].forEach(n => n.read = true); return json({ ok: true }); }
    if (path === '/tasks' && method === 'POST') {
      const T = db['/tasks'].tasks; const n = Math.max(0, ...T.map(t => +(String(t.no).split('-')[1]) || 0)) + 1;
      const t = { id: 'T' + uid(), no: 'G-' + String(n).padStart(4, '0'), title: String(bq.title || '').slice(0, 200), kind: bq.kind || 'manual', ref: bq.ref || null, status: 'open', resolution: '', priority: bq.priority || 'normal', assignee: bq.assignee || me().id, branchId: me().branchId, createdBy: me().id, createdByName: me().name, createdAt: new Date().toISOString(), dueAt: bq.dueAt || new Date(Date.now() + 24 * 3600e3).toISOString(), closedAt: null, comments: [], detail: bq.detail || '' };
      T.unshift(t); return json(taskView(t));
    }
    let mm = /^\/tasks\/([\w-]+)$/.exec(path);
    if (mm && method === 'PUT') {
      const t = db['/tasks'].tasks.find(x => x.id === mm[1]); if (!t) return json({ error: 'not_found' }, 404);
      for (const k of ['title', 'priority', 'assignee', 'dueAt', 'detail', 'resolution']) if (bq[k] !== undefined) t[k] = bq[k];
      if (bq.comment) t.comments.push({ at: new Date().toISOString(), by: me().name, text: String(bq.comment).slice(0, 2000) });
      if (bq.status) { t.status = bq.status; t.closedAt = bq.status === 'closed' ? new Date().toISOString() : null; }
      return json(taskView(t));
    }
    if (path === '/me/watchlist' && method === 'POST') { if (!bq.value) return json({ error: 'bad' }, 422); const w = { id: 'W' + uid(), type: bq.type || 'name', value: String(bq.value).slice(0, 120), note: bq.note || '', createdAt: new Date().toISOString() }; db['/me/watchlist'].unshift(w); return json(w); }
    mm = /^\/me\/watchlist\/([\w-]+)$/.exec(path); if (mm && method === 'DELETE') { db['/me/watchlist'] = db['/me/watchlist'].filter(x => x.id !== mm[1]); return json({ ok: true }); }
    if (path === '/blocklist' && method === 'POST') { const b = { id: 'B' + uid(), name: String(bq.name || '').slice(0, 160), type: bq.type || 'entity', imo: bq.imo || '', note: bq.note || '', createdAt: new Date().toISOString() }; db['/blocklist'].unshift(b); E().blocklist = db['/blocklist']; return json(b); }
    mm = /^\/blocklist\/([\w-]+)$/.exec(path); if (mm && method === 'DELETE') { db['/blocklist'] = db['/blocklist'].filter(x => x.id !== mm[1]); return json({ ok: true }); }
    if (path === '/settings' && method === 'PUT') {
      const merge = (a, b) => { for (const k of Object.keys(b)) a[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' ? merge(a[k], b[k]) : b[k]; return a; };
      delete bq.smtp; merge(db['/settings/full'], bq); merge(db['/status'].settings, bq); merge(E().settings, bq); return json(db['/settings/full']);
    }
    if (path === '/org/branches' && method === 'PUT') { db['/org/branches'].branches = bq.branches || db['/org/branches'].branches; return json(db['/org/branches']); }
    if (path === '/roi' && method === 'PUT') return json(db['/roi']);
    mm = /^\/bulletins\/([\w-]+)$/.exec(path);
    if (mm && method === 'PUT') { const b = db['/bulletins/today']; Object.assign(b, bq, { id: b.id }); return json(b); }
    mm = /^\/bulletins\/([\w-]+)\/(submit|approve|reject|reopen)$/.exec(path);
    if (mm) {
      const b = db['/bulletins/today']; const s = { submit: 'pending', approve: 'approved', reject: 'draft', reopen: 'draft' }[mm[2]]; b.status = s;
      (b.approvals = b.approvals || []).push({ at: new Date().toISOString(), by: me().name, action: mm[2] }); return json(b);
    }

    /* — tarayıcıda çalışan sunucu mantığı — */
    if (path === '/csv/preview') { const D = await engine(); try { return json(D.req('customers').preview(bq.csv || '')); } catch (e) { return json({ error: 'csv', message: e.message }, 400); } }
    if (path === '/screen' && method === 'POST') {
      const D = await engine(); const hits = D.L.orgIndex().search(bq.name || '', { threshold: thrOf(bq), limit: 12, imo: bq.imo ? [String(bq.imo).replace(/\D/g, '')] : undefined }).map(h => ({ score: h.score, reasons: h.reasons, how: h.type, entry: D.present(h.entry) }));
      return json({ hits, lists: D.L.meta() });
    }
    if (path === '/screen/batch') {
      const D = await engine(); const thr = thrOf(bq);
      try {
        const c = D.req('customers').parse(bq.csv || '', bq.filename, false, bq.mapping); if (c.rows.length > 20000) return json({ error: 'too_many', message: 'En fazla 20.000 satır' }, 413);
        const idx = D.L.orgIndex(); const out = []; let hitRows = 0;
        for (const r of c.rows) {
          const hits = idx.search(r.name, { threshold: thr, limit: 3, imo: r.imo ? [r.imo] : undefined }).map(hitRow);
          if (!hits.length && r.aliases.length) for (const al of r.aliases) for (const h of idx.search(al, { threshold: thr, limit: 2 })) hits.push({ ...hitRow(h), how: 'alias' });
          if (hits.length) hitRows++; out.push({ id: r.id, name: r.name, imo: r.imo, type: r.type, hits: hits.slice(0, 3) });
        }
        return json({ total: c.rows.length, hitRows, threshold: thr, results: out, errors: c.errors, warnings: c.warnings, lists: D.L.meta(), at: new Date().toISOString() });
      } catch (e) { return json({ error: e.code || 'csv', message: e.message }, 400); }
    }
    if (path === '/customers' && method === 'POST') {
      const D = await engine();
      try {
        const c = D.req('customers').parse(bq.csv || '', bq.filename, false, bq.mapping);
        if (bq.dryRun) return json({ meta: c.meta, errors: c.errors, warnings: c.warnings, preview: c.rows.slice(0, 8) });
        if (!c.rows.length) return json({ error: 'empty', errors: c.errors, message: 'İçe aktarılacak geçerli satır yok' }, 422);
        E().customers = { meta: c.meta, rows: c.rows }; runMatch(); return json({ meta: c.meta, errors: c.errors, warnings: c.warnings });
      } catch (e) { return json({ error: e.code || 'csv', message: e.message }, 400); }
    }
    if (path === '/customers/sample') { const D = await engine(); const c = D.req('customers').loadSample(); runMatch(); return json({ meta: c.meta }); }
    if (path === '/customers' && method === 'DELETE') { E().customers = { meta: null, rows: [] }; DB['/match'] = null; return json({ ok: true }); }
    if (path === '/match/run') { await engine(); return json(runMatch(+bq.threshold || undefined)); }
    if (path === '/screen/ownership') {
      const D = await engine(); const thr = thrOf(bq); const owners = (Array.isArray(bq.owners) ? bq.owners : []).slice(0, 50);
      const rows = owners.map(o => { const pct = Math.max(0, Math.min(100, +o.pct || 0)); const hits = D.L.orgIndex().search(String(o.name || ''), { threshold: thr, limit: 3 }).map(h => ({ score: h.score, entry: D.present(h.entry) })); return { name: String(o.name || '').slice(0, 160), pct, hits }; });
      const direct = rows.filter(r => r.hits.length).reduce((a, r) => a + r.pct, 0);
      return json({ rows, aggregatePct: direct, level: direct >= 50 ? 'block' : direct >= 25 ? 'edd' : rows.some(r => r.hits.length) ? 'review' : 'clear', note: 'Pratik ilk sürüm: yalnızca girilen doğrudan/dolaylı pay yüzdeleri toplanır; sahiplik grafı (zincirleme çarpma) yoktur.' });
    }
    if (path === '/adverse') return json({ error: 'external_lookups_disabled', message: m('off') }, 403);
    if (path === '/trade/check') { const D = await engine(); const I = D.req('i18n'); try { return json(D.req('trade').assess(bq, I.langs.includes(bq.lang) ? bq.lang : 'tr')); } catch (e) { return json({ error: 'bad', message: e.message }, 400); } }
    if (path === '/trade/notes' && method === 'POST') { const r = { id: 'T' + uid(), at: new Date().toISOString(), by: me().name, ref: String(bq.ref || '').slice(0, 100), level: bq.level, note: String(bq.note || '').slice(0, 8000), input: bq.input }; db['/trade/notes'].unshift(r); return json(r); }
    if (path.startsWith('/dd')) {
      const D = await engine(), DD = D.req('dd'), dd = E().dd; mm = /^\/dd\/(validity|library|docs|draft)(?:\/([\w-]+))?$/.exec(path); const today = new Date().toISOString().slice(0, 10);
      if (mm) {
        if (mm[1] === 'validity') { const v = dd.validity.find(x => x.id === mm[2]); if (!v) return json({}, 404); v.date = bq.date || null; if (bq.owner != null) v.owner = bq.owner; if (bq.note != null) v.note = bq.note; return json(DD.overview()); }
        if (mm[1] === 'library' && method === 'PUT') {
          const a = dd.library.find(x => x.id === mm[2]); if (!a) return json({}, 404);
          if (bq.answer != null && bq.answer !== a.answer) { (a.history = a.history || []).push({ at: new Date().toISOString(), by: me().name, answer: a.answer }); a.answer = String(bq.answer).slice(0, 4000); a.status = 'draft'; a.approvedOn = null; }
          if (bq.approve) { a.status = 'approved'; a.approvedOn = today; a.approvedBy = me().name; } if (bq.owner != null) a.owner = bq.owner; return json(DD.overview());
        }
        if (mm[1] === 'library' && method === 'POST') { dd.library.push({ id: 'c-' + uid(), category: bq.category || 'Genel', wolfsberg: bq.wolfsberg || '', question: String(bq.question || '').slice(0, 1000), answer: String(bq.answer || '').slice(0, 4000), keywords: [], owner: me().name, approvedOn: null, status: 'draft', reviewMonths: 12, linkedTo: null, params: [], history: [] }); return json(DD.overview()); }
        if (mm[1] === 'docs') { const x = dd.docs.find(z => z.id === mm[2]); if (!x) return json({}, 404); x.status = bq.status; x.updatedAt = new Date().toISOString(); return json(DD.overview()); }
        if (mm[1] === 'draft' && method === 'POST') { const d = DD.draft(bq.text, { correspondent: bq.correspondent || '[CORRESPONDENT]', bank: bq.bank }, bq.name); dd.drafts = [d, ...(dd.drafts || [])].slice(0, 30); return json(d); }
        if (mm[1] === 'draft' && method === 'PUT') { const d = (dd.drafts || []).find(x => x.id === mm[2]); if (!d) return json({}, 404); d.rows = bq.rows || d.rows; d.updatedAt = new Date().toISOString(); return json(d); }
      }
    }
    if (path === '/translate') { const items = (bq.texts || []).map(x => ({ text: m('tr') + '\n' + String(x).slice(0, 400), same: false, cached: false })); return json({ ai: false, provider: 'demo', items }); }
    if (path.startsWith('/ai/')) return json({ label: 'Demo', text: '', insufficient: true, message: m('ai') });
    return off();
  }

  /* ───── fetch / EventSource / indirme bağlantıları ───── */
  window.fetch = async function (input, init) {
    let url; try { url = new URL(typeof input === 'string' ? input : input.url, location.href); } catch { return realFetch(input, init); }
    const i = url.pathname.indexOf('/api/'); if (i < 0 || url.origin !== location.origin) return realFetch(input, init);
    let body = null; try { body = init && init.body ? JSON.parse(init.body) : null; } catch { }
    try { return await handle(((init && init.method) || 'GET').toUpperCase(), url.pathname.slice(i + 4), url.searchParams, body); }
    catch (e) { console.error('[demo]', e); return json({ error: 'demo', message: String(e && e.message || e) }, 500); }
  };
  window.EventSource = function () { const es = { readyState: 1, close() { }, addEventListener() { }, removeEventListener() { }, onopen: null, onerror: null }; setTimeout(() => es.onopen && es.onopen({}), 50); return es; };
  const toast = msg => { let h = document.querySelector('.toasts'); if (!h) { h = document.createElement('div'); h.className = 'toasts'; document.body.appendChild(h); } const el = document.createElement('div'); el.className = 'toast'; el.innerHTML = '<b>Demo</b><span></span>'; el.lastChild.textContent = msg; h.appendChild(el); setTimeout(() => el.remove(), 5000); };
  document.addEventListener('click', async e => {
    const a = e.target.closest && e.target.closest('a[href]'); if (!a) return; let u; try { u = new URL(a.getAttribute('href'), location.href); } catch { return; }
    const i = u.pathname.indexOf('/api/'); if (i < 0 || u.origin !== location.origin) return;
    e.preventDefault(); e.stopPropagation(); const db = await dbP; const p = u.pathname.slice(i + 4);
    const dl = (name, txt, type) => { const x = document.createElement('a'); x.href = URL.createObjectURL(new Blob([txt], { type })); x.download = name; x.click(); setTimeout(() => URL.revokeObjectURL(x.href), 3000); };
    if (p === '/templates/customers.csv') return dl('musteri-sablonu.csv', '\uFEFF' + db[p].__text.replace(/^\uFEFF/, ''), 'text/csv');
    if (p === '/audit.csv') return dl('denetim-izi.csv', db[p].__text, 'text/csv');
    if (p === '/export/audit.json' || p === '/export/my-data.json') return dl(p.split('/').pop(), JSON.stringify(db[p], null, 2), 'application/json');
    toast(m('dl'));
  }, true);

  /* Bülten önizlemesi: iframe src=/api/… → srcdoc (sunucu yok) */
  const frame = async (f, u) => { try { const r = await window.fetch(u); f.srcdoc = await r.text(); } catch { } };
  const d = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');
  Object.defineProperty(HTMLIFrameElement.prototype, 'src', { configurable: true, get: d.get, set(v) { if (String(v).includes('/api/')) frame(this, String(v)); else d.set.call(this, v); } });
  new MutationObserver(() => document.querySelectorAll('iframe[data-src]').forEach(f => { const u = f.dataset.src; f.removeAttribute('data-src'); frame(f, u); })).observe(document.documentElement, { childList: true, subtree: true });

  /* ───── şerit + stil ───── */
  function chrome() {
    const st = document.createElement('style');
    st.textContent = `.demo-pill{position:fixed;left:50%;transform:translateX(-50%);bottom:12px;z-index:9999;display:flex;gap:8px;align-items:center;background:rgba(11,31,58,.92);color:#E9E3D1;font:500 12px/1 'IBM Plex Sans',system-ui,sans-serif;padding:8px 12px;border-radius:999px;border:1px solid rgba(198,161,91,.55);box-shadow:0 4px 18px rgba(11,31,58,.25);letter-spacing:.01em;pointer-events:none}
.demo-pill b{color:#C6A15B;font-weight:600;letter-spacing:.08em;font-size:10.5px}.demo-pill small{opacity:.7;font-size:11px}
.demo-load{position:fixed;inset:0;z-index:10000;background:rgba(11,31,58,.55);display:flex;align-items:center;justify-content:center}.demo-load>div{background:#FBF8EF;color:#0B1F3A;padding:22px 28px;border-radius:10px;min-width:280px;font:500 14px 'IBM Plex Sans',system-ui,sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.3)}.demo-load i{display:block;height:4px;background:#e6dfcb;border-radius:2px;margin-top:14px;overflow:hidden}.demo-load u{display:block;height:100%;background:#C6A15B;transition:width .2s}
#pricing,a[data-go=pricing],a[href$='/yonetim/faturalama'],a[href='#/platform']{display:none!important}
@media print{.demo-pill{display:none}}`;
    document.head.appendChild(st);
    const pill = document.createElement('div'); pill.className = 'demo-pill'; pill.setAttribute('role', 'note'); document.body.appendChild(pill);
    const draw = async () => { const d = await dbP.catch(() => null); const at = d && d.__meta ? new Date(d.__meta.takenAt).toLocaleDateString(lang() === 'tr' ? 'tr-TR' : lang() === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''; pill.innerHTML = `<b>DEMO</b><span>${m('banner')}</span>${at ? `<small>· ${at}</small>` : ''}`; };
    draw(); new MutationObserver(draw).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  }
  const guard = () => { if (/^#\/(yonetim\/faturalama|platform)/.test(location.hash)) location.hash = '#/yonetim'; };
  window.addEventListener('hashchange', guard); guard();
  if (document.body) chrome(); else document.addEventListener('DOMContentLoaded', chrome);
  /* Giriş formunu demo bilgileriyle doldur (her bilgi kabul edilir) */
  new MutationObserver(() => { const f = document.querySelector('#lf input[name=email], #lf input[type=email]'); if (f && !f.value && !f.dataset.demo) { f.dataset.demo = 1; f.value = 'demo@diurna.example'; const p = document.querySelector('#lf input[type=password]'); if (p) p.value = 'demo-demo-demo'; } }).observe(document.documentElement, { childList: true, subtree: true });
})();
