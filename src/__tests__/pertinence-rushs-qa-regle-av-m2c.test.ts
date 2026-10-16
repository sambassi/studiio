// Nouvelles fixtures — règle « une source voit le sujet, une autre une autre activité », étiquetées AVANT calcul.
import { describe, it } from 'vitest';
import { pertinenceRush } from '@/lib/creer/pertinence-rushs';
type C = [string, 'elevee' | 'moyenne' | 'faible', string[]];
const f = (cats: C[]) => ({ version: 2, categories: cats.map(([id, confiance, sources]) => ({ id, confiance, sources })), parole: 'probable', inconnus: [], source: 'qa', observations: { objets: [], lieu: null, action: null, personnes: null, categoriesVision: [], langue: 'fr', parole: null }, etapes: { vision: { etat: 'faite' }, transcription: { etat: 'faite' } }, usage: { tarifs: 'qa' } }) as any;
const vi_ = (id: string): C => [id, 'moyenne', ['vision']];
const pa = (id: string): C => [id, 'moyenne', ['parole']];
const VP = (id: string): C => [id, 'elevee', ['vision', 'parole']];
const S: Record<string, Record<string, string>> = {
  danse: { theme: 'danse', sujet: 'Cours de danse afro' }, yoga: { theme: 'yoga', sujet: 'Yoga du matin' }, fitness: { theme: 'fitness', sujet: 'Séance fitness du matin' },
  boxe: { theme: 'boxe', sujet: 'Les bases de la boxe' }, running: { theme: 'running', sujet: 'Débuter la course à pied' }, nutrition: { theme: 'nutrition', sujet: 'Manger mieux au quotidien' },
  finance: { theme: 'finance', sujet: 'Gérer son budget' }, beaute: { theme: 'beauté', sujet: 'Routine beauté du matin' }, coaching: { theme: 'coaching', sujet: 'Organiser sa semaine', objectif: 'productivité' },
};
// abusif = rush clairement pertinent/utile qui finit « à vérifier » (étiquette 'A' ou 'P' attendue, AV obtenu)
const F: Array<[string, string, any, string[]]> = [
  ['R01 danse : image danse, parole « entraînement »', 'danse', f([vi_('dance'), pa('workout')]), ['A', 'P']],
  ['R02 yoga : image yoga, parole méditation', 'yoga', f([vi_('yoga'), pa('meditation')]), ['A', 'P']],
  ['R03 fitness : image entraînement, parole nutrition', 'fitness', f([vi_('workout'), pa('healthy-food')]), ['A', 'P']],
  ['R04 boxe : image boxe, parole musculation', 'boxe', f([vi_('boxing'), pa('strength-training')]), ['A', 'P']],
  ['R05 danse : description danse, image entraînement', 'danse', f([['dance', 'moyenne', ['pexels-description']], vi_('workout')]), ['A', 'P']],
  ['R06 nutrition : image alimentation saine, parole cuisine', 'nutrition', f([vi_('healthy-food'), pa('cooking')]), ['A', 'P']],
  ['R07 yoga : image yoga, nom de fichier « cuisine »', 'yoga', f([vi_('yoga'), ['cooking', 'elevee', ['nom-fichier']]]), ['A']],
  ['R08 danse : image+parole danse, description cuisine', 'danse', f([VP('dance'), ['cooking', 'moyenne', ['pexels-description']]]), ['P']],
  ['R09 danse : image danse, parole finance', 'danse', f([vi_('dance'), pa('personal-finance')]), ['AV']],
  ['R10 running : image course, parole voyage', 'running', f([vi_('running'), pa('travel')]), ['AV']],
  ['R11 danse : image danse, métadonnées finance', 'danse', f([vi_('dance'), ['personal-finance', 'elevee', ['metadonnees']]]), ['AV']],
  ['R12 yoga : image yoga, requête Pexels boxe', 'yoga', f([vi_('yoga'), ['boxing', 'elevee', ['pexels-requete']]]), ['A']],
  ['R13 finance × course image+parole', 'finance', f([VP('running')]), ['H']],
  ['R14 beauté × danse image+parole', 'beaute', f([VP('dance')]), ['H']],
  ['R15 productivité × boxe image+parole', 'coaching', f([VP('boxing')]), ['H']],
  ['R16 finance × cuisine image+parole', 'finance', f([VP('cooking')]), ['H']],
  ['R17 finance × alimentation saine desc+image', 'finance', f([['healthy-food', 'elevee', ['pexels-description', 'vision']]]), ['H', 'AV']],
  ['R18 beauté × musculation desc+image', 'beaute', f([['strength-training', 'elevee', ['pexels-description', 'vision']]]), ['H']],
];
const code = (r: any) => r.niveau === 'pertinent' ? 'P' : r.niveau === 'hors_sujet' ? 'H' : r.niveau === 'inconnu' ? 'I' : r.aVerifier ? 'AV' : 'A';
describe('QA ter', () => { it('table', () => {
  const out: string[] = []; let ko = 0, fp = 0, abus = 0;
  for (const [n, s, fi, att] of F) {
    const r = pertinenceRush(fi, S[s]); const c = code(r);
    if (!att.includes(c)) ko++; if (!att.includes('H') && c === 'H') fp++; if (!att.includes('AV') && c === 'AV') abus++;
    out.push(`${att.includes(c) ? 'OK' : 'KO'} ${n} -> ${c} | ${r.raisons.join(' / ')}`);
  }
  out.push(`REGLE=${F.length} KO=${ko} FP_HS=${fp} AV_ABUSIFS=${abus}`);
  process.stdout.write('\n' + out.join('\n') + '\n');
}); });
