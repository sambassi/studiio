/**
 * M2-c — Fixtures de la QA INDÉPENDANTE (étiquetées avant calcul), reprises
 * telles quelles : chaque verdict dans l'ensemble attendu, 0 faux « hors sujet ».
 */
import { describe, it, expect } from 'vitest';
import { pertinenceRush, evaluerPertinenceRushs, pertinenceRushsPourMetadata, conceptsDuSujet } from '@/lib/creer/pertinence-rushs';

type C = [string, 'elevee' | 'moyenne' | 'faible', string[]];
const v1 = (cats: C[], x: { contradiction?: true } = {}) => ({ version: 1, categories: cats.map(([id, confiance, sources]) => ({ id, confiance, sources })), parole: 'inconnu', inconnus: [], source: 'qa', ...x }) as any;
const v2 = (cats: C[], x: { contradiction?: true } = {}) => ({ ...v1(cats, x), version: 2, observations: { objets: [], lieu: null, action: null, personnes: null, categoriesVision: [], langue: 'fr', parole: null }, etapes: { vision: { etat: 'faite' }, transcription: { etat: 'faite' } }, usage: { tarifs: 'qa' } }) as any;

const S = {
  nutrition: { theme: 'nutrition', sujet: '5 aliments pour mieux manger', objectif: 'manger sainement au quotidien' },
  danse: { theme: 'danse afro', sujet: 'Cours de danse afro débutant' },
  fitness: { theme: 'fitness', sujet: 'Séance fitness du matin' },
  finance: { theme: 'finance personnelle', sujet: 'Épargner 100 euros par mois' },
  coachingProd: { theme: 'coaching', sujet: 'Organiser sa semaine de travail', objectif: 'gagner en productivité' },
  coachingBiz: { theme: 'coaching business', sujet: 'Trouver ses premiers clients' },
  cuisine: { theme: 'cuisine', sujet: 'Curry de légumes facile', objectif: 'cuisiner vite' },
  yoga: { theme: 'yoga', sujet: 'Yoga du matin en 10 minutes' },
  boxe: { theme: 'boxe', sujet: 'Les bases de la boxe' },
  bienetre: { theme: 'bien-être', sujet: 'Prendre soin de soi au quotidien' },
  running: { theme: 'running', sujet: 'Débuter la course à pied' },
  sommeil: { theme: 'sommeil', sujet: 'Mieux dormir et récupérer' },
  immo: { theme: 'immobilier', sujet: 'Acheter son premier appartement' },
} as const;

// attendu : P pertinent, A partiel, AV partiel+aVerifier, H hors_sujet, I inconnu ; tableau = un parmi ; '!H' = tout sauf hors_sujet
const F: Array<{ n: string; s: keyof typeof S; f: any; att: string[]; famille: 'direct' | 'indirect' | 'hs2' | 'hs1' | 'piege' | 'vide' }> = [
  { n: '01 nutrition / pexels desc+fichier healthy-food', s: 'nutrition', f: v1([['healthy-food', 'elevee', ['pexels-description', 'nom-fichier']]]), att: ['P'], famille: 'direct' },
  { n: '02 yoga / vision+parole yoga (M2-b)', s: 'yoga', f: v2([['yoga', 'elevee', ['vision', 'parole']]]), att: ['P'], famille: 'direct' },
  { n: '03 boxe / desc+vision boxing', s: 'boxe', f: v2([['boxing', 'elevee', ['pexels-description', 'vision']]]), att: ['P'], famille: 'direct' },
  { n: '04 cuisine / vision+parole cooking', s: 'cuisine', f: v2([['cooking', 'elevee', ['vision', 'parole']]]), att: ['P'], famille: 'direct' },
  { n: '05 danse / vision+parole dance, flou M1 (qualité ignorée)', s: 'danse', f: v2([['dance', 'elevee', ['vision', 'parole']]]), att: ['P'], famille: 'direct' },
  { n: '06 running / desc+vision running + lieu city', s: 'running', f: v2([['running', 'elevee', ['pexels-description', 'vision']], ['city', 'moyenne', ['vision']]]), att: ['P'], famille: 'direct' },
  { n: '07 fitness / vision workout seule (1 source forte)', s: 'fitness', f: v2([['workout', 'moyenne', ['vision']]]), att: ['A', 'P'], famille: 'direct' },
  { n: '08 nutrition / marché : vision healthy-food (fruits) seule', s: 'nutrition', f: v2([['healthy-food', 'moyenne', ['vision']], ['city', 'moyenne', ['vision']]]), att: ['A', 'P'], famille: 'indirect' },
  { n: '09 nutrition / marché : seulement lieu ville', s: 'nutrition', f: v2([['city', 'moyenne', ['vision']]]), att: ['I', 'A'], famille: 'indirect' },
  { n: '10 nutrition / préparation : cooking vision+parole', s: 'nutrition', f: v2([['cooking', 'elevee', ['vision', 'parole']]]), att: ['A', 'P'], famille: 'indirect' },
  { n: '11 fitness / vestiaire : lieu gym + gourde', s: 'fitness', f: v2([['gym', 'moyenne', ['vision']], ['water-bottle', 'moyenne', ['vision']]]), att: ['A'], famille: 'indirect' },
  { n: '12 coaching prod / bureau : productivity vision+parole', s: 'coachingProd', f: v2([['productivity', 'elevee', ['vision', 'parole']]]), att: ['P'], famille: 'direct' },
  { n: '13 finance / bureau : productivity vision+parole', s: 'finance', f: v2([['productivity', 'elevee', ['vision', 'parole']]]), att: ['A'], famille: 'indirect' },
  { n: '14 danse / public applaudit : musique + ville', s: 'danse', f: v2([['music', 'moyenne', ['vision', 'parole']], ['city', 'moyenne', ['vision']]]), att: ['A', 'I'], famille: 'indirect' },
  { n: '15 running / plein air : outdoor+city', s: 'running', f: v2([['outdoor', 'moyenne', ['vision']], ['city', 'moyenne', ['vision']]]), att: ['A'], famille: 'indirect' },
  { n: '16 boxe / muscu vision+parole (famille)', s: 'boxe', f: v2([['strength-training', 'elevee', ['vision', 'parole']]]), att: ['A'], famille: 'indirect' },
  { n: '17 bien-être / soin peau vision+parole (affinité)', s: 'bienetre', f: v2([['skincare', 'elevee', ['vision', 'parole']]]), att: ['A'], famille: 'indirect' },
  { n: '18 bien-être / cuisine saine (vision+parole cooking)', s: 'bienetre', f: v2([['cooking', 'elevee', ['vision', 'parole']]]), att: ['A', 'AV'], famille: 'indirect' },
  { n: '19 sommeil / routine du soir soin peau', s: 'sommeil', f: v2([['skincare', 'elevee', ['vision', 'parole']], ['home', 'moyenne', ['vision']]]), att: ['A', 'AV'], famille: 'indirect' },
  { n: '20 fitness / danse vision+parole (famille)', s: 'fitness', f: v2([['dance', 'elevee', ['vision', 'parole']]]), att: ['A'], famille: 'indirect' },
  { n: '21 finance / danse vision+parole', s: 'finance', f: v2([['dance', 'elevee', ['vision', 'parole']]]), att: ['H'], famille: 'hs2' },
  // Décision produit (QA bis) : l'alimentation sert tout sujet de mouvement → « activité voisine ».
  { n: '22 yoga / cuisine desc+vision', s: 'yoga', f: v2([['cooking', 'elevee', ['pexels-description', 'vision']]]), att: ['A'], famille: 'indirect' },
  { n: '23 boxe / finance desc+métadonnées', s: 'boxe', f: v1([['personal-finance', 'elevee', ['pexels-description', 'metadonnees']]]), att: ['H'], famille: 'hs2' },
  // Décision produit (QA bis) : cuisine × boxe = partiel, jamais hors sujet.
  { n: '24 cuisine / boxe vision+parole', s: 'cuisine', f: v2([['boxing', 'elevee', ['vision', 'parole']]]), att: ['A'], famille: 'indirect' },
  { n: '25 nutrition / finance vision seule', s: 'nutrition', f: v2([['personal-finance', 'moyenne', ['vision']]]), att: ['AV'], famille: 'hs1' },
  { n: '26 danse / voyage desc seule', s: 'danse', f: v1([['travel', 'moyenne', ['pexels-description']]]), att: ['AV'], famille: 'hs1' },
  { n: '27 finance / nom fichier "danse" seul', s: 'finance', f: v1([['dance', 'elevee', ['nom-fichier']]]), att: ['I'], famille: 'piege' },
  { n: '28 finance / nom fichier + vision danse (1 source réelle)', s: 'finance', f: v2([['dance', 'elevee', ['nom-fichier', 'vision']]]), att: ['AV'], famille: 'hs1' },
  { n: '29 danse / nom fichier "danse" seul', s: 'danse', f: v1([['dance', 'elevee', ['nom-fichier']]]), att: ['I'], famille: 'piege' },
  { n: '30 danse / requête Pexels seule', s: 'danse', f: v1([['dance', 'elevee', ['pexels-requete']]]), att: ['I'], famille: 'piege' },
  { n: '31 danse / requête contredite par description cuisine', s: 'danse', f: v1([['dance', 'faible', ['pexels-requete']], ['cooking', 'moyenne', ['pexels-description']]], { contradiction: true }), att: ['AV'], famille: 'piege' },
  { n: '32 danse / requête dance + desc cooking + métadonnées cooking + contradiction', s: 'danse', f: v1([['dance', 'faible', ['pexels-requete']], ['cooking', 'elevee', ['pexels-description', 'metadonnees']]], { contradiction: true }), att: ['AV'], famille: 'piege' },
  { n: '33 nutrition / métadonnées = titre seules', s: 'nutrition', f: v1([['healthy-food', 'elevee', ['metadonnees']]]), att: ['A', 'I'], famille: 'piege' },
  { n: '34 nutrition / métadonnées + nom fichier = titre', s: 'nutrition', f: v1([['healthy-food', 'elevee', ['metadonnees', 'nom-fichier']]]), att: ['A', 'I'], famille: 'piege' },
  { n: '35 danse / vision danse vs parole cuisine', s: 'danse', f: v2([['dance', 'moyenne', ['vision']], ['cooking', 'moyenne', ['parole']]]), att: ['AV'], famille: 'piege' },
  { n: '36 fiche vide', s: 'danse', f: v1([]), att: ['I'], famille: 'vide' },
  { n: '37 fiche null (M2-b et M2-a absentes)', s: 'danse', f: null, att: ['I'], famille: 'vide' },
  { n: '38 M2-b absente : v1 fichier+métadonnées danse', s: 'danse', f: v1([['dance', 'elevee', ['nom-fichier', 'metadonnees']]]), att: ['A', 'I'], famille: 'piege' },
  { n: '39 sujet immobilier non reconnu', s: 'immo', f: v2([['cooking', 'elevee', ['vision', 'parole']]]), att: ['I'], famille: 'vide' },
  { n: '40 coaching business non reconnu', s: 'coachingBiz', f: v2([['productivity', 'elevee', ['vision', 'parole']]]), att: ['I', 'A', 'P'], famille: 'vide' },
  { n: '41 danse / confiance faible partout (cuisine)', s: 'danse', f: v2([['cooking', 'faible', ['vision', 'parole']]]), att: ['I'], famille: 'piege' },
  { n: '42 running / cuisine 2 sources + décor ville', s: 'running', f: v2([['cooking', 'elevee', ['vision', 'parole']], ['city', 'moyenne', ['vision']]]), att: ['A', 'AV', 'H'], famille: 'hs2' },
  { n: '43 yoga / plage seule', s: 'yoga', f: v2([['beach', 'moyenne', ['vision']]]), att: ['A'], famille: 'indirect' },
  { n: '44 cuisine / nutrition desc+vision (affinité)', s: 'cuisine', f: v2([['healthy-food', 'elevee', ['pexels-description', 'vision']]]), att: ['A', 'P'], famille: 'indirect' },
];

const code = (r: any) => r.niveau === 'pertinent' ? 'P' : r.niveau === 'hors_sujet' ? 'H' : r.niveau === 'inconnu' ? 'I' : r.aVerifier ? 'AV' : 'A';

describe('QA M2-c fixtures', () => {
  it('table', () => {
    const lignes: string[] = []; let ko = 0, fp = 0, pAtt = 0, pOk = 0;
    for (const s of Object.keys(S)) lignes.push(`SUJET ${s}: ${JSON.stringify(conceptsDuSujet(S[s as keyof typeof S]))}`);
    for (const x of F) {
      const r = pertinenceRush(x.f, S[x.s], { cle: 'k' });
      const c = code(r);
      const ok = x.att.includes(c);
      if (!ok) ko++;
      if ((x.famille === 'direct' || x.famille === 'indirect' || x.famille === 'hs1' || x.famille === 'piege' || x.famille === 'vide') && c === 'H') fp++;
      if (x.att.includes('P') && x.att.length === 1) { pAtt++; if (c === 'P') pOk++; }
      lignes.push(`${ok ? 'OK' : 'KO'} ${x.n} -> ${c} s=${r.score} | ${r.raisons.join(' / ')}`);
    }
    lignes.push(`TOTAL=${F.length} KO=${ko} FP_HS=${fp} PERTINENT=${pOk}/${pAtt}`);
    if (process.env.M2C_QA) require('fs').writeFileSync(process.env.M2C_QA, lignes.join('\n'));
    expect(fp).toBe(0);
    expect(lignes.filter((l) => l.startsWith('KO'))).toEqual([]);
    // Qualité : aucune dépendance M1
    const r1 = pertinenceRush(F[4].f, S.danse); expect(r1.niveau).toBe('pertinent');
    // métadonnée sans fiche informative -> null
    expect(pertinenceRushsPourMetadata(evaluerPertinenceRushs([{ cle: 'a', fiche: null }], S.danse))).toBeNull();
    const m = pertinenceRushsPourMetadata(evaluerPertinenceRushs([{ cle: 'https://minio.x/bucket/u/a.mp4', fiche: F[1].f }], S.yoga));
    expect(m!.rushs[0].cle).toBe('/bucket/u/a.mp4');
  });
});
