// Ajoute des lots de PROPOSITIONS IA (format { traductions:{clé:{t,c:"ia"}}, omis }) à messages/propositions/<langue>.json
// SANS écraser ce qui existe, et sans jamais toucher au catalogue publié. Ignore toute clé déjà traduite au catalogue.
//   node scripts/i18n/ajouter-propositions-ia.cjs <dossier-out> <langue>...
const fs = require('fs'); const path = require('path');
const [, , dossier, ...langues] = process.argv; const racine = path.resolve(__dirname, '..', '..');
const lire = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const aplatir = (o, p = '', out = {}) => { for (const k of Object.keys(o)) { const v = o[k]; const c = p ? `${p}.${k}` : k; if (v && typeof v === 'object') aplatir(v, c, out); else if (typeof v === 'string') out[c] = v; } return out; };
const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
const fr = aplatir(lire(path.join(racine, 'messages', 'fr.json')));
const vars = (t) => (t.match(/\{[A-Za-z_]\w*\}/g) || []).sort().join(',');
for (const l of langues) {
  const cat = aplatir(lire(path.join(racine, 'messages', `${l}.json`)));
  const pf = path.join(racine, 'messages', 'propositions', `${l}.json`); const props = lire(pf); let n = 0;
  for (const nom of fs.readdirSync(dossier).filter((x) => x.startsWith(`${l}-`) && x.endsWith('.json')).sort()) {
    for (const [k, e] of Object.entries(lire(path.join(dossier, nom)).traductions || {})) {
      if (!(k in fr) || !e || typeof e.t !== 'string' || !e.t.trim() || (cat[k] && cat[k].trim()) || vars(fr[k]) !== vars(e.t)) continue;
      if (!(k in props)) n += 1; props[k] = e.t.trim();
    }
  }
  fs.writeFileSync(pf, JSON.stringify(props, null, 1) + '\n');
  const lignes = ['cle;francais;proposition_ia;statut', ...Object.entries(props).map(([k, t]) => [k, fr[k] || '', t, 'proposition IA — à valider'].map(esc).join(';'))];
  fs.writeFileSync(path.join(racine, 'docs', 'langues-africaines', `${l}-propositions-ia.csv`), lignes.join('\n') + '\n');
  console.log(`${l} : +${n} propositions → ${Object.keys(props).length} (non publiées)`);
}
