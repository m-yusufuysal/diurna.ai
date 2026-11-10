'use strict';
/* Isteğe bağlı makine çevirisi — takılabilir sağlayıcılar (ortam değişkenleriyle yapılandırılır):
 *   llm: UM_LLM_BASE_URL / UM_LLM_API_KEY / UM_LLM_MODEL (OpenAI uyumlu; sözlük + ad/numara maskeleme) — yapılandırılmışsa varsayılan
 *   UM_TRANSLATE_PROVIDER = deepl | azure | google | libretranslate | argos | none   (boşsa: anahtarı tanımlı olan ilk sağlayıcı)
 *   deepl:  UM_DEEPL_KEY            ( ":fx" ile biten anahtar → api-free.deepl.com )
 *   azure:  UM_AZURE_TRANSLATOR_KEY, UM_AZURE_TRANSLATOR_REGION, [UM_AZURE_TRANSLATOR_ENDPOINT]
 *   google: UM_GOOGLE_TRANSLATE_KEY
 *   libretranslate / argos (kurum içi): UM_LIBRETRANSLATE_URL (örn. http://127.0.0.1:5000), [UM_LIBRETRANSLATE_KEY]  → veri kurum dışına çıkmaz
 *   Kamuya açık LibreTranslate yedeği (varsayılan KAPALI; metin üçüncü tarafa gider): UM_TRANSLATE_PUBLIC=1 [UM_TRANSLATE_PUBLIC_URL]
 * Gizlilik: müşteri/kurum verisi içerebilecek metinler (DD yanıtları, bülten taslağı) yalnızca KURUM İÇİ sağlayıcıya gönderilir
 * (aksi için UM_TRANSLATE_ALLOW_EXTERNAL_CONFIDENTIAL=1). Çeviriler önbelleğe alınır; kamuya açık metinler diskte, gizli olanlar yalnızca bellekte. */
const U = require('./util');
const store = require('./store');
const LLM = require('./llm'); const GL = require('./glossary');
const LANGS = { tr: 'tr', en: 'en', ar: 'ar' };
const CONFIDENTIAL = new Set(['dd', 'bulletin', 'task', 'note']);
const MAXTXT = 6000, MAXN = 20, MAXTOTAL = 24000, CAPF = 4000;
const memConf = new Map();
const env = k => (process.env[k] || '').trim();

function config() {
  let p = env('UM_TRANSLATE_PROVIDER').toLowerCase();
  if (p === 'none') return { provider: 'none' };
  if (!p && LLM.info().configured) p = 'llm';
  if (!p) p = env('UM_DEEPL_KEY') ? 'deepl' : env('UM_AZURE_TRANSLATOR_KEY') ? 'azure' : env('UM_GOOGLE_TRANSLATE_KEY') ? 'google' : env('UM_LIBRETRANSLATE_URL') ? 'libretranslate' : env('UM_TRANSLATE_PUBLIC') === '1' ? 'public' : 'none';
  if (p === 'argos') p = 'libretranslate';
  const selfHosted = (p === 'libretranslate' && !!env('UM_LIBRETRANSLATE_URL')) || (p === 'llm' && LLM.info().onprem);
  return { provider: p, selfHosted };
}
function info() {
  const c = config(); const configured = c.provider !== 'none';
  return { configured, provider: configured ? (c.provider === 'public' ? 'LibreTranslate (public)' : c.provider === 'llm' ? 'LLM · ' + LLM.info().model : c.provider) : null, ai: c.provider === 'llm', selfHosted: !!c.selfHosted, allowConfidential: c.selfHosted || env('UM_TRANSLATE_ALLOW_EXTERNAL_CONFIDENTIAL') === '1', target: ['tr', 'en', 'ar'] };
}
async function post(url, body, headers = {}, timeout = 25000) {
  const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { method: 'POST', signal: ctrl.signal, headers: { 'Content-Type': 'application/json', 'User-Agent': U.UA, ...headers }, body: JSON.stringify(body) });
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch { }
    if (!r.ok) { const e = new Error(`Çeviri sağlayıcısı HTTP ${r.status}` + (j && (j.error || j.message) ? ': ' + String(j.error || j.message).slice(0, 160) : '')); e.status = r.status; throw e; }
    return j;
  } finally { clearTimeout(to); }
}
const PROVIDERS = {
  async deepl(texts, target) {
    const key = env('UM_DEEPL_KEY'); const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
    const j = await post(host + '/v2/translate', { text: texts, target_lang: target === 'en' ? 'EN-GB' : target.toUpperCase() }, { Authorization: 'DeepL-Auth-Key ' + key });
    return j.translations.map(x => ({ text: x.text, detected: (x.detected_source_language || '').toLowerCase() }));
  },
  async azure(texts, target) {
    const ep = env('UM_AZURE_TRANSLATOR_ENDPOINT') || 'https://api.cognitive.microsofttranslator.com';
    const j = await post(`${ep}/translate?api-version=3.0&to=${target}`, texts.map(Text => ({ Text })), { 'Ocp-Apim-Subscription-Key': env('UM_AZURE_TRANSLATOR_KEY'), 'Ocp-Apim-Subscription-Region': env('UM_AZURE_TRANSLATOR_REGION') });
    return j.map(x => ({ text: x.translations[0].text, detected: x.detectedLanguage?.language || '' }));
  },
  async google(texts, target) {
    const j = await post('https://translation.googleapis.com/language/translate/v2?key=' + encodeURIComponent(env('UM_GOOGLE_TRANSLATE_KEY')), { q: texts, target, format: 'text' });
    return j.data.translations.map(x => ({ text: x.translatedText, detected: x.detectedSourceLanguage || '' }));
  },
  async libretranslate(texts, target) {
    const base = (env('UM_LIBRETRANSLATE_URL') || env('UM_TRANSLATE_PUBLIC_URL') || 'https://libretranslate.com').replace(/\/+$/, '');
    const out = [];
    for (const q of texts) { const j = await post(base + '/translate', { q, source: 'auto', target, format: 'text', api_key: env('UM_LIBRETRANSLATE_KEY') || undefined }); out.push({ text: j.translatedText, detected: (j.detectedLanguage && (j.detectedLanguage.language || j.detectedLanguage)) || '' }); }
    return out;
  },
};
PROVIDERS.public = PROVIDERS.libretranslate;
const SYS = target => `You are a professional sanctions-and-compliance translator for banks. Translate the user's text into ${GL.LANGN[target]}.
Rules: (1) Output ONLY the translation, no notes. (2) Tokens like ⟦a⟧ are protected names, numbers, IDs or links: copy each EXACTLY as is, once per occurrence, never translate, reorder inside, add or drop them. (3) Keep meaning, tone and numbering; do not add or remove facts. (4) Use this glossary for consistent terminology:\n${GL.prompt(target)}\n(5) If the text is already in the target language, return it unchanged.`;
PROVIDERS.llm = async (texts, target) => {
  const out = [];
  for (const t of texts) {
    const m = LLM.mask(t); let res = null;
    for (let a = 0; a < 2 && !res; a++) {
      const r = await LLM.chat({ system: SYS(target) + (a ? '\nIMPORTANT: your previous answer altered or lost a ⟦x⟧ token. Copy every token exactly.' : ''), user: m.masked, temperature: 0, maxTokens: Math.min(4000, 400 + t.length * 2) });
      if (LLM.verify(m.masked, r.text, m.map)) res = LLM.unmask(r.text, m.map);
    }
    if (!res) { const e = new Error('Yapay zekâ çevirisi ad/numara bütünlüğünü koruyamadı; çıktı reddedildi. Lütfen tekrar deneyin veya başka sağlayıcı kullanın.'); e.code = 'integrity'; throw e; }
    out.push({ text: res, detected: '' });
  }
  return out;
};
const ckey = (p, target, text) => U.sha256(p + (p === 'llm' ? ':' + (LLM.cfg().model || '') : '') + '|' + target + '|' + text);

async function translate(texts, target, kind = 'news', opts = {}) {
  target = LANGS[target]; if (!target) { const e = new Error('Desteklenmeyen hedef dil'); e.code = 'lang'; throw e; }
  texts = (Array.isArray(texts) ? texts : [texts]).map(x => String(x ?? '')); if (!texts.length || texts.length > MAXN || texts.some(t => t.length > MAXTXT) || texts.join('').length > MAXTOTAL) { const e = new Error('Metin çok uzun veya çok fazla.'); e.code = 'size'; throw e; }
  let c = config();
  if (c.provider === 'llm' && opts.aiAllowed === false) { const alt = env('UM_DEEPL_KEY') ? 'deepl' : env('UM_AZURE_TRANSLATOR_KEY') ? 'azure' : env('UM_GOOGLE_TRANSLATE_KEY') ? 'google' : env('UM_LIBRETRANSLATE_URL') ? 'libretranslate' : null; if (!alt) { const e = new Error('Bu kurum için yapay zekâ (harici LLM) kapalı. Yönetim → Güvenlik’ten açın veya kurum içi çeviri sağlayıcısı tanımlayın.'); e.code = 'ai_disabled'; throw e; } c = { provider: alt, selfHosted: alt === 'libretranslate' }; }
  if (c.provider === 'none') { const e = new Error('Çeviri sağlayıcısı yapılandırılmamış. Yönetici, ortam değişkenleriyle (UM_DEEPL_KEY, UM_AZURE_TRANSLATOR_KEY, UM_GOOGLE_TRANSLATE_KEY veya kurum içi UM_LIBRETRANSLATE_URL) bir sağlayıcı tanımlayabilir; kamuya açık LibreTranslate yedeği için UM_TRANSLATE_PUBLIC=1.'); e.code = 'not_configured'; throw e; }
  const conf = CONFIDENTIAL.has(kind);
  if (conf && !(c.selfHosted || env('UM_TRANSLATE_ALLOW_EXTERNAL_CONFIDENTIAL') === '1')) { const e = new Error('Bu içerik kurum verisi içerebileceğinden yalnızca kurum içinde barındırılan çeviri sağlayıcısına (LibreTranslate/Argos) gönderilir. Yönetici UM_LIBRETRANSLATE_URL tanımlamalıdır.'); e.code = 'confidential'; throw e; }
  const disk = conf ? null : store.readCache('translations.json', {}); const res = new Array(texts.length); const todo = [];
  texts.forEach((t, i) => {
    if (!t.trim()) { res[i] = { text: t, cached: true, same: true }; return; }
    const k = ckey(c.provider, target, t); const hit = conf ? memConf.get(k) : disk[k];
    if (hit) res[i] = { text: hit.t, detected: hit.d, cached: true, same: hit.s }; else todo.push(i);
  });
  if (todo.length) {
    const out = await PROVIDERS[c.provider](todo.map(i => texts[i]), target);
    todo.forEach((i, j) => { const o = out[j] || {}; const same = !!o.detected && o.detected.slice(0, 2) === target; res[i] = { text: o.text, detected: o.detected || '', cached: false, same }; const rec = { t: o.text, d: o.detected || '', s: same, ts: Date.now() }; const k = ckey(c.provider, target, texts[i]); if (conf) { if (memConf.size > 500) memConf.delete(memConf.keys().next().value); memConf.set(k, rec); } else disk[k] = rec; });
    if (!conf) { const ks = Object.keys(disk); if (ks.length > CAPF) for (const k of ks.sort((a, b) => disk[a].ts - disk[b].ts).slice(0, ks.length - CAPF)) delete disk[k]; store.writeCache('translations.json', disk); }
  }
  return { provider: c.provider === 'llm' ? 'LLM · ' + LLM.info().model : (c.provider === 'public' ? 'LibreTranslate (public)' : c.provider), ai: c.provider === 'llm', selfHosted: !!c.selfHosted, machine: true, target, items: res };
}
module.exports = { translate, info, config };
