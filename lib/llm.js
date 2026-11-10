'use strict';
/* OpenAI uyumlu sohbet istemcisi (OpenAI, Azure OpenAI, xAI, kurum içi vLLM/Ollama). SDK yok.
 * UM_LLM_BASE_URL (örn. https://api.openai.com/v1, https://api.x.ai/v1, http://ollama:11434/v1), UM_LLM_API_KEY, UM_LLM_MODEL,
 * [UM_LLM_AZURE_API_VERSION → Azure OpenAI: {base}/openai/deployments/{model}/chat/completions], [UM_LLM_ONPREM=1 → kurum içi say].
 * Koruma: adlar/numaralar/IMO/referanslar modele HİÇ gönderilmez; ⟦a⟧ jetonlarıyla maskelenir, dönüşte tam eşleşme doğrulanır. */
const env = k => (process.env[k] || '').trim();
function cfg() {
  let base = env('UM_LLM_BASE_URL').replace(/\/+$/, ''); const key = env('UM_LLM_API_KEY'); const model = env('UM_LLM_MODEL');
  if (!base && key) base = 'https://api.openai.com/v1';
  return { base, key, model: model || (base.includes('api.openai.com') ? 'gpt-4o-mini' : ''), azure: env('UM_LLM_AZURE_API_VERSION') };
}
function isOnPrem(base) {
  if (env('UM_LLM_ONPREM') === '1') return true; if (!base) return false;
  let h = ''; try { h = new URL(base).hostname; } catch { return false; }
  return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1)/.test(h) || /\.(local|internal|lan)$/.test(h) || h === 'host.docker.internal' || !h.includes('.');
}
function info() { const c = cfg(); const configured = !!(c.base && c.model && (c.key || isOnPrem(c.base))); return { configured, onprem: configured && isOnPrem(c.base), model: configured ? c.model : null, endpoint: configured ? (new URL(c.base).host) : null, azure: !!c.azure }; }
async function chat({ system, user, temperature = 0.1, maxTokens = 1500, timeoutMs = 90000 }) {
  const c = cfg(); const i = info();
  if (!i.configured) { const e = new Error('Yapay zekâ sağlayıcısı yapılandırılmamış. Yönetici UM_LLM_BASE_URL, UM_LLM_API_KEY ve UM_LLM_MODEL ortam değişkenlerini (OpenAI, Azure OpenAI, xAI veya kurum içi vLLM/Ollama) tanımlamalıdır.'); e.code = 'not_configured'; throw e; }
  const url = c.azure ? `${c.base}/openai/deployments/${encodeURIComponent(c.model)}/chat/completions?api-version=${encodeURIComponent(c.azure)}` : `${c.base}/chat/completions`;
  const headers = { 'Content-Type': 'application/json', 'User-Agent': require('./util').UA }; if (c.key) headers[c.azure ? 'api-key' : 'Authorization'] = c.azure ? c.key : 'Bearer ' + c.key;
  const body = { model: c.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature, max_tokens: maxTokens }; if (c.azure) delete body.model;
  let last;
  for (let a = 0; a < 2; a++) {
    const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal }); const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch { }
      if (r.status === 429 || r.status >= 500) { last = new Error(`Yapay zekâ sağlayıcısı HTTP ${r.status}`); await new Promise(z => setTimeout(z, 1500 * (a + 1))); continue; }
      if (!r.ok) { const e = new Error(`Yapay zekâ sağlayıcısı HTTP ${r.status}` + (j?.error?.message ? ': ' + String(j.error.message).slice(0, 160) : '')); e.code = 'provider'; throw e; }
      const text = j?.choices?.[0]?.message?.content; if (typeof text !== 'string') { const e = new Error('Yapay zekâ sağlayıcısından beklenmeyen yanıt'); e.code = 'provider'; throw e; }
      return { text: text.trim(), model: c.model, usage: j.usage || null };
    } catch (e) { if (e.code === 'provider') throw e; last = e.name === 'AbortError' ? new Error('Yapay zekâ sağlayıcısı zaman aşımına uğradı') : e; }
    finally { clearTimeout(to); }
  }
  last.code = last.code || 'provider'; throw last;
}
/* ── Maskeleme: rakam içeren her sözcük (IMO, referans, tarih, madde no), URL/e-posta ve verilen adlar ── */
const tid = n => { let s = ''; n++; while (n > 0) { n--; s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26); } return '⟦' + s + '⟧'; };
function mask(text, names = []) {
  const vals = []; const idx = new Map(); const tok = v => { if (!idx.has(v)) { idx.set(v, tid(vals.length)); vals.push(v); } return idx.get(v); };
  let out = String(text);
  for (const n of [...new Set(names.map(x => String(x || '').trim()).filter(x => x.length > 2))].sort((a, b) => b.length - a.length)) out = out.split(n).join(tok(n));
  out = out.replace(/https?:\/\/[^\s)]*[^\s).,;]|[\w.+-]+@[\w-]+\.[\w.-]+/g, m => tok(m));
  out = out.replace(/\b(?:[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ&.'-]{1,}\s+)+[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ&.'-]{1,}\b/g, m => tok(m));
  out = out.replace(/[\p{L}\p{N}][\p{L}\p{N}./,:\/-]*\p{N}[\p{L}\p{N}./,:\/-]*|\p{N}/gu, m => { const t = m.match(/[.,:\/-]+$/); const core = t ? m.slice(0, -t[0].length) : m; return tok(core) + (t ? t[0] : ''); });
  return { masked: out, map: vals.map((v, i) => [tid(i), v]) };
}
const count = (s, t) => s.split(t).length - 1;
function verify(masked, out, map) { for (const [t] of map) if (count(masked, t) !== count(out, t)) return false; return !(out.match(/⟦[a-z]+⟧/g) || []).some(t => !map.find(m => m[0] === t)); }
function unmask(out, map) { let r = out; for (const [t, v] of map) r = r.split(t).join(v); return r; }
module.exports = { cfg, info, isOnPrem, chat, mask, verify, unmask };
