// Eşleştirme kalitesi: etiketli çiftlerde (kayıtlı gerçek liste adları + el yapımı çok dilli çiftler) precision/recall. node scripts/match-eval.js [match.js yolu] [eşik]
const path = require('path'); const fs = require('fs');
const M = require(path.resolve(process.argv[2] || path.join(__dirname, '..', 'lib', 'match.js'))); const thr = +process.argv[3] || 85;
const pairs = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'match-pairs.json'), 'utf8'));
const score = (a, b) => (M.scoreNames || M.scoreTokens)(M.tokens(a), M.tokens(b)).score;
const stat = f => { let tp = 0, fp = 0, fn = 0, tn = 0; const miss = []; for (const p of pairs.filter(f)) { const hit = score(p.q, p.n) >= thr; if (p.y && hit) tp++; else if (p.y) { fn++; miss.push(p); } else if (hit) { fp++; miss.push(p); } else tn++; } return { tp, fp, fn, tn, precision: tp + fp ? +(tp / (tp + fp)).toFixed(3) : null, recall: tp + fn ? +(tp / (tp + fn)).toFixed(3) : null, miss }; };
const groups = { 'tümü': () => true, 'Arapça↔Latin (gerçek liste adları)': p => p.k.startsWith('ar-lat'), 'Latin zor negatifler': p => p.k === 'latin-hardneg', 'el yapımı çok dilli (TR/AR/RU/ZH/DE…)': p => p.k === 'hand' };
const out = {}; for (const [g, f] of Object.entries(groups)) { const s = stat(f); out[g] = { ...s, miss: undefined }; if (process.env.SHOW && g === 'tümü') console.log(JSON.stringify(s.miss.map(m => [m.q, m.n, m.y, score(m.q, m.n)]))); }
console.log(JSON.stringify(out, null, 1));
