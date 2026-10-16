/**
 * M2-c — Fixtures QA bis (règle « même famille »), étiquetées avant calcul.
 * Décision produit : l'alimentation sert tout sujet de mouvement et
 * réciproquement → N31 fitness × cuisine et N33 cuisine × boxe = « partiel ».
 */
import { describe, it, expect } from 'vitest';
import { pertinenceRush, conceptsDuSujet } from '@/lib/creer/pertinence-rushs';
type C = [string, 'elevee' | 'moyenne' | 'faible', string[]];
const v2 = (cats: C[]) => ({ version: 2, categories: cats.map(([id, confiance, sources]) => ({ id, confiance, sources })), parole: 'probable', inconnus: [], source: 'qa', observations: { objets: [], lieu: null, action: null, personnes: null, categoriesVision: [], langue: 'fr', parole: null }, etapes: { vision: { etat: 'faite' }, transcription: { etat: 'faite' } }, usage: { tarifs: 'qa' } }) as any;
const VP = (id: string): C => [id, 'elevee', ['vision', 'parole']];
const LIEU = (id: string): C => [id, 'moyenne', ['vision']];
const S: Record<string, Record<string, string>> = {
  bienetre: { theme: 'bien-être', sujet: 'Prendre soin de soi au quotidien' },
  meditation: { theme: 'méditation', sujet: 'Méditer 5 minutes par jour' },
  sommeil: { theme: 'sommeil', sujet: 'Mieux dormir la nuit' },
  recup: { theme: 'récupération', sujet: 'Bien récupérer après le sport' },
  nutrition: { theme: 'nutrition', sujet: 'Manger mieux au quotidien' },
  nutriMuscu: { theme: 'nutrition', sujet: 'Que manger pour la musculation' },
  beaute: { theme: 'beauté', sujet: 'Routine beauté du matin' },
  beauteSport: { theme: 'beauté', sujet: 'Routine beauté après le sport' },
  coaching: { theme: 'coaching', sujet: 'Organiser sa semaine', objectif: 'productivité' },
  business: { theme: 'business', sujet: 'Trouver ses premiers clients' },
  finance: { theme: 'finance', sujet: 'Gérer son budget' },
  cuisine: { theme: 'cuisine', sujet: 'Curry de légumes facile' },
  cuisineSportif: { theme: 'cuisine', sujet: 'Recette pour sportifs après l’entraînement' },
  fitness: { theme: 'fitness', sujet: 'Séance fitness du matin' },
  boxe: { theme: 'boxe', sujet: 'Les bases de la boxe' },
  running: { theme: 'running', sujet: 'Débuter la course à pied' },
  yoga: { theme: 'yoga', sujet: 'Yoga du matin' },
  danse: { theme: 'danse', sujet: 'Cours de danse afro' },
};
// '!H' = utile indirectement : tout sauf hors_sujet ; 'H' = hors sujet attendu ; 'I' inconnu ; 'P' pertinent
const F: Array<[string, string, any, string]> = [
  ['N01 bien-être × yoga', 'bienetre', v2([VP('yoga')]), '!H'],
  ['N02 bien-être × danse', 'bienetre', v2([VP('dance')]), '!H'],
  ['N03 bien-être × étirements', 'bienetre', v2([VP('stretching')]), '!H'],
  ['N04 méditation × yoga', 'meditation', v2([VP('yoga')]), '!H'],
  ['N05 méditation × plein air seul', 'meditation', v2([LIEU('outdoor')]), '!H'],
  ['N06 sommeil × marche ville/plein air', 'sommeil', v2([LIEU('outdoor'), LIEU('city')]), '!H'],
  ['N07 sommeil × étirements', 'sommeil', v2([VP('stretching')]), '!H'],
  ['N08 sommeil × yoga', 'sommeil', v2([VP('yoga')]), '!H'],
  ['N09 récupération × étirements', 'recup', v2([VP('stretching')]), '!H'],
  ['N10 nutrition × entraînement', 'nutrition', v2([VP('workout')]), '!H'],
  ['N11 nutrition × salle de sport (lieu)', 'nutrition', v2([LIEU('gym')]), '!H'],
  ['N12 nutrition musculation × musculation', 'nutriMuscu', v2([VP('strength-training')]), 'P'],
  ['N13 nutrition × cuisine', 'nutrition', v2([VP('cooking')]), '!H'],
  ['N14 beauté × yoga', 'beaute', v2([VP('yoga')]), '!H'],
  ['N15 beauté × bien-être', 'beaute', v2([VP('wellness')]), '!H'],
  ['N16 beauté × alimentation saine', 'beaute', v2([VP('healthy-food')]), '!H'],
  ['N17 beauté × méditation', 'beaute', v2([VP('meditation')]), '!H'],
  ['N18 beauté après le sport × entraînement', 'beauteSport', v2([VP('workout')]), '!H'],
  ['N19 coaching productivité × finance', 'coaching', v2([VP('personal-finance')]), '!H'],
  ['N20 finance × productivité (bureau)', 'finance', v2([VP('productivity')]), '!H'],
  ['N21 cuisine × alimentation saine', 'cuisine', v2([VP('healthy-food')]), '!H'],
  ['N22 cuisine × récupération', 'cuisine', v2([VP('rest-recovery')]), '!H'],
  ['N23 cuisine × bien-être', 'cuisine', v2([VP('wellness')]), '!H'],
  ['N24 cuisine pour sportifs × entraînement', 'cuisineSportif', v2([VP('workout')]), '!H'],
  ['N25 cuisine pour sportifs × course', 'cuisineSportif', v2([VP('running')]), '!H'],
  ['N26 fitness × alimentation saine', 'fitness', v2([VP('healthy-food')]), '!H'],
  ['N27 boxe × récupération', 'boxe', v2([VP('rest-recovery')]), '!H'],
  ['N28 running × alimentation saine', 'running', v2([VP('healthy-food')]), '!H'],
  ['N29 yoga × bien-être', 'yoga', v2([VP('wellness')]), '!H'],
  ['N30 danse × récupération', 'danse', v2([VP('rest-recovery')]), '!H'],
  ['N31 fitness × cuisine (préparer son repas)', 'fitness', v2([VP('cooking')]), 'A'],
  ['N32 business non reconnu × productivité', 'business', v2([VP('productivity')]), 'I'],
  // Décision produit : cuisine × boxe n'est plus hors sujet (alimentation ↔ mouvement).
  ['N33 cuisine × boxe', 'cuisine', v2([VP('boxing')]), '!H'],
  ['N34 finance × yoga', 'finance', v2([VP('yoga')]), 'H'],
  ['N35 beauté × boxe', 'beaute', v2([VP('boxing')]), 'H'],
  ['N36 coaching productivité × danse', 'coaching', v2([VP('dance')]), 'H'],
];
const code = (r: any) => r.niveau === 'pertinent' ? 'P' : r.niveau === 'hors_sujet' ? 'H' : r.niveau === 'inconnu' ? 'I' : r.aVerifier ? 'AV' : 'A';
describe('QA bis', () => { it('table', () => {
  const out: string[] = []; let ko = 0, fp = 0, nUtiles = 0;
  for (const k of Object.keys(S)) out.push(`SUJET ${k} ${JSON.stringify(conceptsDuSujet(S[k]))}`);
  for (const [n, s, f, att] of F) {
    const r = pertinenceRush(f, S[s]); const c = code(r);
    const ok = att === '!H' ? c !== 'H' : c === att;
    if (att === '!H') nUtiles++;
    if (!ok) ko++; if (att !== 'H' && c === 'H') fp++;
    out.push(`${ok ? 'OK' : 'KO'} ${n} -> ${c} | ${r.raisons.join(' / ')}`);
  }
  out.push(`NOUVELLES=${F.length} KO=${ko} FP_HS=${fp} UTILES=${nUtiles}`);
  if (process.env.M2C_QA2) require('fs').writeFileSync(process.env.M2C_QA2, out.join('\n'));
  expect(fp).toBe(0);
  expect(out.filter((l) => l.startsWith('KO'))).toEqual([]);
}); });
