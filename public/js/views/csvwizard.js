import { h, t, api, toast, esc } from '../core.js';
import { modal } from '../ui.js';
const FIELDS = ['name', 'id', 'type', 'imo', 'country', 'taxId', 'yob', 'aliases', 'owners', 'branch'];
export const readFile = f => new Promise((ok, no) => { if (!f) return no(new Error('no file')); if (f.size > 10e6) return no(new Error(t('csv.tooBig'))); if (!/\.(csv|txt)$/i.test(f.name)) return no(new Error(t('csv.type'))); const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(new Error('read')); r.readAsText(f, 'utf-8'); });
/* Sihirbaz: dosya → sütun eşleme → doğrulama → onay. mode: 'customers' | 'batch' */
export async function csvWizard(file, mode) {
  const text = await readFile(file); const pv = await api('/csv/preview', { method: 'POST', body: { csv: text } });
  if (text.includes('\u0000')) throw new Error(t('csv.binary'));
  let mapping = { ...pv.mapping };
  for (;;) {
    const r = await modal(h`<h3>${t('csv.mapTitle')}</h3><p class="muted small">${t('csv.mapSub', { f: file.name, n: pv.total })}</p>
    <div class="grid g2" style="gap:10px">${FIELDS.map(f => h`<div><label class="f">${t('csv.f.' + f)}${f === 'name' ? ' *' : ''}</label><select name="${f}"><option value="-1">— ${t('csv.none')} —</option>${pv.headers.map((hd, i) => h`<option value="${i}" ${mapping[f] === i ? 'selected' : ''}>${hd}</option>`)}</select></div>`)}</div>
    <div class="tbl-wrap" style="margin-top:14px;max-height:170px"><table class="tbl tight"><thead><tr>${pv.headers.map(x => h`<th>${x}</th>`)}</tr></thead><tbody>${pv.sample.map(r => h`<tr>${pv.headers.map((_, i) => h`<td class="xs">${r[i] || ''}</td>`)}</tr>`)}</tbody></table></div>`,
      [{ label: t('common.cancel'), value: false }, { label: t('csv.check'), value: true, cls: 'pri' }]);
    if (!r.v) return null;
    mapping = Object.fromEntries(FIELDS.map(f => [f, +r.form[f]])); if (mapping.name < 0) { toast(t('csv.needName'), ''); continue; }
    if (mode === 'batch') return { text, mapping, filename: file.name };
    const dry = await api('/customers', { method: 'POST', body: { csv: text, filename: file.name, mapping, dryRun: true } });
    const rep = await modal(h`<h3>${t('csv.reportTitle')}</h3><div class="grid g3" style="margin:12px 0"><div class="card stat" style="--c:var(--green)"><div class="k">${t('csv.valid')}</div><div class="v">${dry.meta.count}</div></div><div class="card stat" style="--c:var(--red)"><div class="k">${t('csv.skipped')}</div><div class="v">${dry.meta.skipped}</div></div><div class="card stat" style="--c:var(--amber)"><div class="k">${t('csv.warnings')}</div><div class="v">${dry.meta.warned}</div></div></div>
    ${dry.errors.length || dry.warnings.length ? h`<div class="tbl-wrap" style="max-height:220px"><table class="tbl tight"><thead><tr><th>${t('csv.row')}</th><th>${t('csv.issue')}</th><th>${t('csv.value')}</th></tr></thead><tbody>${[...dry.errors.map(e => ({ ...e, k: 'err' })), ...dry.warnings.map(e => ({ ...e, k: 'warn' }))].slice(0, 60).map(e => h`<tr><td>${e.row}</td><td><span class="badge ${e.k}">${t('csv.c.' + e.code)}</span></td><td class="xs">${e.value}</td></tr>`)}</tbody></table></div>` : h`<div class="callout ok">${t('csv.allGood')}</div>`}
    <p class="hint">${t('csv.privacy')}</p>`, [{ label: t('csv.back'), value: 'back' }, { label: t('csv.import', { n: dry.meta.count }), value: true, cls: 'ok' }]);
    if (rep.v === 'back') continue; if (!rep.v) return null;
    return { text, mapping, filename: file.name };
  }
}
export const dropZone = (id, label, hint) => h`<div class="drop" id="${id}" tabindex="0" role="button"><b>${label}</b><div class="small">${hint}</div><input type="file" accept=".csv,.txt,text/csv" hidden></div>`;
export function wireDrop(el, id, onFile) {
  const z = el.querySelector('#' + id); if (!z) return; const inp = z.querySelector('input');
  z.onclick = () => inp.click(); z.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') inp.click(); };
  inp.onchange = () => inp.files[0] && onFile(inp.files[0]); z.ondragover = e => { e.preventDefault(); z.classList.add('over'); }; z.ondragleave = () => z.classList.remove('over');
  z.ondrop = e => { e.preventDefault(); z.classList.remove('over'); e.dataTransfer.files[0] && onFile(e.dataTransfer.files[0]); };
}
