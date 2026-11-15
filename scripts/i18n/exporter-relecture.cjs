// Exporte les traductions d'une langue pour relecture par un locuteur natif.
//   node scripts/i18n/exporter-relecture.cjs sw > relecture-sw.csv
// Colonnes : clé ; français ; traduction. Corriger ensuite DANS messages/<langue>.json.
const fs = require('fs'); const path = require('path');
const langue = process.argv[2];
if (!langue) { console.error('usage : exporter-relecture.cjs <langue>'); process.exit(2); }
const lire = (l) => JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'messages', `${l}.json`), 'utf8'));
const aplatir = (o, p = '', out = {}) => { for (const k of Object.keys(o)) { const v = o[k]; const c = p ? `${p}.${k}` : k; if (v && typeof v === 'object') aplatir(v, c, out); else if (typeof v === 'string') out[c] = v; } return out; };
const fr = aplatir(lire('fr')); const tr = aplatir(lire(langue));
const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
console.log('cle;francais;traduction');
for (const k of Object.keys(fr)) console.log([k, fr[k], tr[k] || ''].map(esc).join(';'));
