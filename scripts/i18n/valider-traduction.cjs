// Contrôle un lot traduit : node scripts/i18n/valider-traduction.cjs <lot-francais.json> <lot-traduit.json> <langue>
const fs = require('fs');
const [, , fichierFr, fichierTr, langue] = process.argv;
const fr = JSON.parse(fs.readFileSync(fichierFr, 'utf8'));
let tr; try { tr = JSON.parse(fs.readFileSync(fichierTr, 'utf8')); } catch (e) { console.log('JSON INVALIDE', e.message); process.exit(2); }
const vars = (t) => (t.match(/\{[A-Za-z_][\w]*\}/g) || []).sort().join(',');
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const FOURNISSEURS = /\b(heygen|d-id|did\b|elevenlabs|openai|runway|kling|veo|sora|luma|pika|midjourney|dall-?e|anthropic|claude|gpt|zernio|pexels|pixabay|stripe)\b/i;
const FR_MOTS = /\b(le|la|les|des|du|une?|et|est|vous|votre|vos|nous|pour|avec|sur|dans|cette|ces|aucun|aucune|ajouter|supprimer|enregistrer|annuler)\b/i;
const pb = [];
for (const k of Object.keys(fr)) {
  const t = tr[k];
  if (typeof t !== 'string' || !t.trim()) { pb.push(['manquante', k]); continue; }
  if (vars(fr[k]) !== vars(t)) pb.push(['variables', k, fr[k], t]);
  if (EMOJI.test(t) && !EMOJI.test(fr[k])) pb.push(['emoji ajouté', k, t]);
  const fo = FOURNISSEURS.exec(t); if (fo && !FOURNISSEURS.test(fr[k])) pb.push(['fournisseur ajouté', k, t]);
  if (['en', 'de', 'sw', 'ht'].includes(langue) && fr[k].length > 25 && fr[k].split(' ').length >= 4 && t === fr[k]) pb.push(['laissé en français', k, t]);
  if (['en', 'de'].includes(langue) && FR_MOTS.test(t) && /[éèêàùç]/i.test(t)) pb.push(['français restant', k, t]);
  if (t.length > fr[k].length * 3 + 20) pb.push(['beaucoup trop long', k, t.slice(0, 60)]);
}
for (const k of Object.keys(tr)) if (!(k in fr)) pb.push(['clé inconnue', k]);
console.log(`${Object.keys(fr).length} clés, ${pb.length} problème(s)`);
pb.slice(0, 40).forEach((p) => console.log('  ', p.map((x) => String(x).slice(0, 90)).join(' | ')));
process.exit(pb.length ? 1 : 0);
