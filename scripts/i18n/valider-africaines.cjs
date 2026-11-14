// Contrôle un lot ln/wo/bm/bas : node scripts/i18n/valider-africaines.cjs <entrée.json> <sortie.json> <langue>
// Format de sortie attendu : { "traductions": { clé: { t, c: "h"|"m", s } }, "omis": [clé…] }
// Les clés omises ne sont PAS des erreurs : elles resteront en français dans l'application.
const fs = require('fs');
const [, , fEntree, fSortie, langue] = process.argv;
const fr = JSON.parse(fs.readFileSync(fEntree, 'utf8'));
let out; try { out = JSON.parse(fs.readFileSync(fSortie, 'utf8')); } catch (e) { console.log('JSON INVALIDE', e.message); process.exit(2); }
const tr = out.traductions || {}; const omis = new Set(out.omis || []);
const vars = (t) => (t.match(/\{[A-Za-z_][\w]*\}/g) || []).sort().join(',');
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const FOURN = /\b(heygen|d-id|elevenlabs|openai|runway|kling|veo|sora|luma|pika|midjourney|dall-?e|anthropic|claude|gpt|zernio|pexels|pixabay|stripe)\b/i;
const MOTS_FR = /\b(le|la|les|des|du|une?|est|vous|votre|vos|nous|pour|avec|sur|dans|cette|ces|aucun|aucune|ajouter|supprimer|enregistrer|annuler|créer|générer)\b/i;
const pb = [];
let h = 0, m = 0;
for (const k of Object.keys(tr)) {
  if (!(k in fr)) { pb.push(['clé inconnue', k]); continue; }
  const e = tr[k];
  if (!e || typeof e.t !== 'string' || !e.t.trim()) { pb.push(['traduction vide (omets plutôt)', k]); continue; }
  if (!['h', 'm'].includes(e.c)) { pb.push(['confiance invalide (h ou m ; sinon omets)', k, e.c]); continue; }
  if (e.c === 'h') h += 1; else m += 1;
  if (!e.s || typeof e.s !== 'string') pb.push(['source manquante', k]);
  if (vars(fr[k]) !== vars(e.t)) pb.push(['variables', k, fr[k], e.t]);
  if (EMOJI.test(e.t) && !EMOJI.test(fr[k])) pb.push(['emoji ajouté', k]);
  if (FOURN.test(e.t) && !FOURN.test(fr[k])) pb.push(['fournisseur ajouté', k]);
  const mots = fr[k].trim().split(/\s+/).length;
  if (mots >= 3 && e.t.trim() === fr[k].trim()) pb.push(['identique au français (omets plutôt)', k]);
  if (mots >= 3 && MOTS_FR.test(e.t) && /[éèêàùç]/.test(e.t) && !/ɛ|ɔ|ŋ|ɲ|ñ|ë/.test(e.t)) pb.push(['mots français dans la traduction', k, e.t]);
}
for (const k of Object.keys(fr)) if (!(k in tr) && !omis.has(k)) pb.push(['ni traduite ni listée dans omis', k]);
console.log(`${Object.keys(fr).length} clés : ${h} h, ${m} m, ${Object.keys(fr).length - h - m} omises, ${pb.length} problème(s)`);
pb.slice(0, 40).forEach((p) => console.log('  ', p.map((x) => String(x).slice(0, 90)).join(' | ')));
process.exit(pb.length ? 1 : 0);
