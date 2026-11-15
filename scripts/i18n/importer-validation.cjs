// Réimporte les corrections d'un relecteur natif (CSV exporté par fusionner-africaines.cjs / exporter-relecture.cjs).
//   node scripts/i18n/importer-validation.cjs <langue> <fichier.csv>
// Colonnes attendues : cle;francais;traduction[;…]. Une traduction VIDE retire l'entrée (retour au français).
// Les variables {x} du français doivent être conservées : sinon la ligne est refusée.
const fs = require('fs'); const path = require('path');
const [, , langue, fichier] = process.argv;
if (!langue || !fichier) { console.error('usage : importer-validation.cjs <langue> <fichier.csv>'); process.exit(2); }
const racine = path.resolve(__dirname, '..', '..');
const cat = path.join(racine, 'messages', `${langue}.json`);
const catalogue = JSON.parse(fs.readFileSync(cat, 'utf8'));
const fr = (function aplatir(o, p = '', out = {}) { for (const k of Object.keys(o)) { const v = o[k]; const c = p ? `${p}.${k}` : k; if (v && typeof v === 'object') aplatir(v, c, out); else if (typeof v === 'string') out[c] = v; } return out; })(JSON.parse(fs.readFileSync(path.join(racine, 'messages', 'fr.json'), 'utf8')));
const vars = (t) => (t.match(/\{[A-Za-z_]\w*\}/g) || []).sort().join(',');
function lireCsv(texte) { // CSV ; avec guillemets doublés
  const lignes = []; let l = []; let c = ''; let q = false;
  for (let i = 0; i < texte.length; i += 1) { const ch = texte[i];
    if (q) { if (ch === '"' && texte[i + 1] === '"') { c += '"'; i += 1; } else if (ch === '"') q = false; else c += ch; }
    else if (ch === '"') q = true; else if (ch === ';') { l.push(c); c = ''; } else if (ch === '\n') { l.push(c); lignes.push(l); l = []; c = ''; } else if (ch !== '\r') c += ch; }
  if (c || l.length) { l.push(c); lignes.push(l); } return lignes;
}
function poser(o, chemin, valeur) { const p = chemin.split('.'); let n = o; for (let i = 0; i < p.length - 1; i += 1) { if (typeof n[p[i]] !== 'object' || n[p[i]] === null) n[p[i]] = {}; n = n[p[i]]; } if (valeur === null) delete n[p[p.length - 1]]; else n[p[p.length - 1]] = valeur; }
let ok = 0; let retirees = 0; let refusees = 0;
for (const [cle, , trad] of lireCsv(fs.readFileSync(fichier, 'utf8')).slice(1)) {
  if (!(cle in fr)) { refusees += 1; console.log('clé inconnue :', cle); continue; }
  const t = (trad || '').trim();
  if (!t) { poser(catalogue, cle, null); retirees += 1; continue; }
  if (vars(fr[cle]) !== vars(t)) { refusees += 1; console.log('variables différentes, refusée :', cle); continue; }
  poser(catalogue, cle, t); ok += 1;
}
fs.writeFileSync(cat, JSON.stringify(catalogue, null, 2) + '\n');
console.log(`${langue} : ${ok} traductions importées, ${retirees} retirées, ${refusees} refusées`);
