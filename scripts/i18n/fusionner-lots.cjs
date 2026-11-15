// Fusionne les lots traduits (out/<langue>-NN.json) dans messages/<langue>.json.
//   node scripts/i18n/fusionner-lots.cjs <dossier-out> <langue>...
const fs = require('fs'); const path = require('path');
const [, , dossier, ...langues] = process.argv;
const racine = path.resolve(__dirname, '..', '..');
function poser(o, chemin, valeur) { const p = chemin.split('.'); let n = o; for (let i = 0; i < p.length - 1; i += 1) { if (typeof n[p[i]] !== 'object' || n[p[i]] === null) n[p[i]] = {}; n = n[p[i]]; } n[p[p.length - 1]] = valeur; }
for (const l of langues) {
  const f = path.join(racine, 'messages', `${l}.json`);
  const cat = JSON.parse(fs.readFileSync(f, 'utf8'));
  let n = 0;
  for (const nom of fs.readdirSync(dossier).filter((x) => x.startsWith(`${l}-`) && x.endsWith('.json')).sort()) {
    const lot = JSON.parse(fs.readFileSync(path.join(dossier, nom), 'utf8'));
    for (const [k, v] of Object.entries(lot)) { if (typeof v === 'string' && v.trim()) { poser(cat, k, v); n += 1; } }
  }
  fs.writeFileSync(f, JSON.stringify(cat, null, 2) + '\n');
  console.log(`${l} : ${n} clés fusionnées`);
}
