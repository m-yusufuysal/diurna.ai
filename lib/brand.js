'use strict';
/* Marka yapılandırması (config/brand.json). Tek yerden değişir. */
const fs = require('fs'), path = require('path');
const FILE = path.join(__dirname, '..', 'config', 'brand.json');
let cache = null, mt = 0;
function get() { try { const m = fs.statSync(FILE).mtimeMs; if (!cache || m !== mt) { cache = JSON.parse(fs.readFileSync(FILE, 'utf8')); mt = m; } } catch { cache = cache || { name: { tr: 'Diurna', en: 'Diurna', ar: 'Diurna' }, colors: {} }; } return cache; }
const name = (lang = 'tr') => get().name[lang] || get().name.en || get().name.tr;
const short = (lang = 'tr') => (get().shortName || get().name)[lang] || name(lang);
function css() { const c = get().colors || {}; return `:root{${c.navy ? `--navy:${c.navy};` : ''}${c.navy2 ? `--navy-2:${c.navy2};` : ''}${c.accent ? `--accent:${c.accent};` : ''}}[data-theme=dark]{${c.accentDark ? `--accent:${c.accentDark};` : ''}}`; }
module.exports = { get, name, short, css };
