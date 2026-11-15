// Fusionne les lots de PROPOSITIONS IA validés dans messages/propositions/<langue>.json ({clé: texte}) — JAMAIS dans le catalogue publié.
// Les propositions ne s'affichent qu'en aperçu administrateur ; elles ne deviennent visibles que par approbation dans /admin/traductions.
//   node scripts/i18n/fusionner-ia.cjs <dossier-out> <langue>...
const fs = require('fs'); const path = require('path');
const [, , dossier, ...langues] = process.argv;
const racine = path.resolve(__dirname, '..', '..');
const lire = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const aplatir = (o, p = '', out = {}) => { for (const k of Object.keys(o)) { const v = o[k]; const c = p ? `${p}.${k}` : k; if (v && typeof v === 'object') aplatir(v, c, out); else if (typeof v === 'string') out[c] = v; } return out; };
const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
const fr = aplatir(lire(path.join(racine, 'messages', 'fr.json')));
for (const l of langues) {
  const deja = aplatir(lire(path.join(racine, 'messages', `${l}.json`)));
  const sortie = {}; const lignes = ['cle;francais;proposition_ia;statut'];
  for (const nom of fs.readdirSync(dossier).filter((x) => x.startsWith(`${l}-`) && x.endsWith('.json')).sort()) {
    const lot = lire(path.join(dossier, nom));
    for (const [k, e] of Object.entries(lot.traductions || {})) {
      if (!(k in fr) || !e || typeof e.t !== 'string' || !e.t.trim() || (deja[k] && deja[k].trim())) continue;
      sortie[k] = e.t.trim(); lignes.push([k, fr[k], e.t.trim(), 'proposition IA — à valider'].map(esc).join(';'));
    }
  }
  fs.writeFileSync(path.join(racine, 'messages', 'propositions', `${l}.json`), JSON.stringify(sortie, null, 1) + '\n');
  fs.writeFileSync(path.join(racine, 'docs', 'langues-africaines', `${l}-propositions-ia.csv`), lignes.join('\n') + '\n');
  console.log(`${l} : ${Object.keys(sortie).length} propositions IA (non publiées)`);
}
