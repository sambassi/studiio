/**
 * Recherches stock DÉTERMINISTES — `construireRecherchesStock`.
 *
 * ⚠️ AUCUN APPEL IA. Studiio connaît déjà le sujet, l'objectif, le texte de
 * chaque séquence : un lexique de concepts (français → anglais, la langue où
 * Pexels/Unsplash répondent le mieux) suffit à proposer 3 à 5 recherches
 * pertinentes. Même entrée → mêmes suggestions, testable, gratuit.
 *
 * Les concepts sont rangés par CATÉGORIE (activité, personnes, qualité, lieu,
 * objet, style) : une recherche utile combine une activité avec un sujet
 * humain, pas une liste de mots au hasard.
 */
import { orientationDuFormat, type FormatStock, type OrientationStock, type TypeStock } from './types';

type Categorie = 'activite' | 'personnes' | 'qualite' | 'lieu' | 'objet' | 'style';

interface Concept {
  /** Mots français (sans accents, minuscules) qui l'évoquent. */
  mots: string[];
  en: string;
  categorie: Categorie;
  /** Forme « en action » d'une activité (dance → dancing). */
  gerondif?: string;
  /** Concepts implicites (Afroboost implique la danse). */
  implique?: string[];
  /** Ordre dans une combinaison d'activités : cardio avant dance. */
  rang?: number;
}

const CONCEPTS: Concept[] = [
  // Style / identité
  { mots: ['afroboost'], en: 'african', categorie: 'style', implique: ['dance', 'workout'] },
  { mots: ['afro', 'africain', 'africaine', 'africains', 'africaines', 'afrique'], en: 'african', categorie: 'style' },
  // Activités
  { mots: ['cardio', 'aerobic', 'aerobie'], en: 'cardio', categorie: 'activite', rang: 0 },
  { mots: ['danse', 'danses', 'danser', 'dansent', 'dansez', 'danseuse', 'danseur', 'danseurs', 'choregraphie', 'zumba'], en: 'dance', gerondif: 'dancing', categorie: 'activite', rang: 1 },
  { mots: ['yoga'], en: 'yoga', gerondif: 'doing yoga', categorie: 'activite', rang: 1 },
  { mots: ['meditation', 'mediter', 'respiration'], en: 'meditation', gerondif: 'meditating', categorie: 'activite', rang: 1 },
  { mots: ['course', 'courir', 'running', 'jogging', 'footing'], en: 'running', gerondif: 'running', categorie: 'activite', rang: 1 },
  { mots: ['musculation', 'muscu', 'halteres', 'haltere', 'renforcement'], en: 'strength training', gerondif: 'lifting weights', categorie: 'activite', rang: 1 },
  { mots: ['etirement', 'etirements', 'stretching', 'souplesse'], en: 'stretching', gerondif: 'stretching', categorie: 'activite', rang: 1 },
  { mots: ['velo', 'cyclisme', 'spinning'], en: 'cycling', gerondif: 'cycling', categorie: 'activite', rang: 1 },
  { mots: ['natation', 'nager', 'piscine'], en: 'swimming', gerondif: 'swimming', categorie: 'activite', rang: 1 },
  { mots: ['boxe', 'boxing'], en: 'boxing', gerondif: 'boxing', categorie: 'activite', rang: 1 },
  { mots: ['sport', 'sportif', 'sportive', 'entrainement', 'entrainer', 'exercice', 'exercices', 'seance', 'workout', 'fitness', 'transpirer'], en: 'workout', gerondif: 'working out', categorie: 'activite', rang: 2 },
  { mots: ['nutrition', 'alimentation', 'manger', 'repas', 'recette', 'fruits', 'legumes'], en: 'healthy food', gerondif: 'eating healthy', categorie: 'activite', rang: 2 },
  { mots: ['sommeil', 'dormir', 'recuperation', 'repos'], en: 'rest recovery', gerondif: 'resting', categorie: 'activite', rang: 2 },
  { mots: ['bien-etre', 'bienetre', 'sante', 'wellness'], en: 'wellness', categorie: 'activite', rang: 2 },
  // Personnes
  { mots: ['groupe', 'groupes', 'cours', 'classe', 'ensemble', 'collectif', 'communaute', 'equipe', 'participants', 'eleves'], en: 'group', categorie: 'personnes' },
  { mots: ['femme', 'femmes', 'fille', 'filles'], en: 'woman', categorie: 'personnes' },
  { mots: ['homme', 'hommes', 'garcon'], en: 'man', categorie: 'personnes' },
  { mots: ['coach', 'professeur', 'prof', 'instructeur', 'instructrice', 'animatrice', 'animateur'], en: 'fitness coach', categorie: 'personnes' },
  { mots: ['enfant', 'enfants', 'famille'], en: 'family', categorie: 'personnes' },
  // Qualités
  { mots: ['energie', 'energique', 'energiques', 'dynamique', 'intense', 'intensite', 'puissant', 'explosif'], en: 'energetic', categorie: 'qualite' },
  { mots: ['calme', 'detente', 'detendre', 'relaxation', 'stress', 'zen', 'serenite'], en: 'calm', categorie: 'qualite' },
  { mots: ['joie', 'joyeux', 'joyeuse', 'fun', 'plaisir', 'sourire', 'heureux', 'heureuse', 'fete'], en: 'happy', categorie: 'qualite' },
  { mots: ['motivation', 'motive', 'motivee', 'depassement'], en: 'motivated', categorie: 'qualite' },
  // Lieux
  { mots: ['plage', 'mer', 'ocean'], en: 'beach', categorie: 'lieu' },
  { mots: ['salle', 'gym', 'club'], en: 'gym', categorie: 'lieu' },
  { mots: ['studio'], en: 'studio', categorie: 'lieu' },
  { mots: ['parc', 'exterieur', 'nature', 'plein-air', 'foret'], en: 'outdoor', categorie: 'lieu' },
  { mots: ['ville', 'urbain', 'rue'], en: 'city', categorie: 'lieu' },
  { mots: ['maison', 'domicile', 'salon'], en: 'home', categorie: 'lieu' },
  // Objets
  { mots: ['casque', 'ecouteurs'], en: 'headphones', categorie: 'objet' },
  { mots: ['musique', 'rythme', 'beat'], en: 'music', categorie: 'objet' },
  { mots: ['eau', 'gourde', 'bouteille'], en: 'water bottle', categorie: 'objet' },
  { mots: ['tapis'], en: 'yoga mat', categorie: 'objet' },
];

const PAR_EN = new Map(CONCEPTS.map((c) => [c.en, c]));

function sansAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Les mots d'un texte, dans l'ordre (les tirets coupent : « cardio-danse » → cardio, danse). */
export function motsDe(texte: string): string[] {
  const propre = sansAccents(texte || '').replace(/bien-etre/g, 'bienetre').replace(/plein-air/g, 'pleinair');
  return propre.split(/[^a-z0-9]+/).filter(Boolean);
}

/** Les concepts reconnus, dans l'ordre d'apparition, sans doublon. */
export function conceptsDe(...textes: Array<string | null | undefined>): Concept[] {
  const vus = new Set<string>();
  const out: Concept[] = [];
  const ajouter = (c: Concept | undefined) => {
    if (!c || vus.has(c.en)) return;
    vus.add(c.en);
    out.push(c);
    for (const i of c.implique ?? []) ajouter(PAR_EN.get(i));
  };
  for (const t of textes) {
    for (const mot of motsDe(t || '')) {
      const n = mot === 'pleinair' ? 'plein-air' : mot === 'bienetre' ? 'bien-etre' : mot;
      ajouter(CONCEPTS.find((c) => c.mots.includes(n)));
    }
  }
  return out;
}

/** Le rôle d'une séquence (Créer) ou d'une phase de montage (Autopilote). */
export type RoleSequence = 'titre' | 'cartes' | 'video' | 'cta' | 'HOOK' | 'BUILD' | 'PEAK' | 'FOCUS' | 'CTA';
/** Ce que l'on cherche : un plan vidéo, une photo, un arrière-plan, un plan d'illustration. */
export type VisuelRecherche = 'video' | 'photo' | 'arriere-plan' | 'illustration';

export interface EntreeRecherchesStock {
  sujet?: string | null;
  objectif?: string | null;
  /** Texte de la séquence (titre, cartes, phrase de la voix…). */
  texte?: string | null;
  role?: RoleSequence | null;
  visuel?: VisuelRecherche | null;
  format?: FormatStock | null;
}

export interface RecherchesStock {
  requetes: string[];
  type: TypeStock;
  orientation: OrientationStock;
  /** Les intentions retenues (énergie, danse, groupe…) — pour expliquer la proposition. */
  intentions: string[];
}

/** Un plan vidéo pour le rôle « vidéo » et les phases de montage ; une photo sinon. */
export function visuelParDefaut(role?: RoleSequence | null): VisuelRecherche {
  if (!role) return 'video';
  if (role === 'titre' || role === 'cartes' || role === 'cta') return 'arriere-plan';
  return 'video';
}

const MAX_REQUETES = 5;
const MAX_MOTS = 4;

function borner(q: string): string {
  const mots = q.split(/\s+/).filter(Boolean);
  // Pas de mot répété (« dance dance workout »).
  const uniques = mots.filter((m, i) => mots.indexOf(m) === i);
  return uniques.slice(0, MAX_MOTS).join(' ').trim();
}

export function construireRecherchesStock(e: EntreeRecherchesStock): RecherchesStock {
  const visuel = e.visuel ?? visuelParDefaut(e.role);
  const type: TypeStock = visuel === 'video' ? 'video' : 'photo';
  const orientation = orientationDuFormat(e.format ?? '9:16');

  // Le texte de la séquence passe d'abord : c'est lui qui décrit le plan.
  const concepts = conceptsDe(e.texte, e.sujet, e.objectif);
  const de = (cat: Categorie) => concepts.filter((c) => c.categorie === cat);
  const activites = de('activite').sort((a, b) => (a.rang ?? 1) - (b.rang ?? 1));
  const principale = activites.find((a) => a.en !== 'workout' && a.en !== 'cardio') ?? activites[0];
  const personnes = de('personnes');
  const qualite = de('qualite')[0];
  const lieu = de('lieu')[0];
  const objet = de('objet').find((o) => o.en !== 'music');
  const style = de('style')[0];
  const humain = personnes[0];

  const q: string[] = [];
  const pousser = (s: string) => {
    const b = borner(s);
    if (b && !q.includes(b)) q.push(b);
  };

  if (principale) {
    // 1. Style + activité + sujet humain : « african dance workout group ».
    pousser([style?.en, principale.en, principale.en === 'workout' ? '' : 'workout', humain?.en].filter(Boolean).join(' '));
    // 2. Combinaison d'activités : « cardio dance fitness ».
    if (activites.length > 1) pousser(`${activites.slice(0, 2).map((a) => a.en).join(' ')} fitness`);
    // 3. Qualité + sujet : « energetic group workout ».
    if (qualite) pousser(`${qualite.en} ${humain?.en ?? ''} ${principale.en === 'dance' ? 'workout' : principale.en}`);
    // 4. Une personne en action : « woman dancing headphones ».
    const personne = personnes.find((p) => p.en === 'woman' || p.en === 'man')?.en ?? 'woman';
    pousser(`${personne} ${principale.gerondif ?? principale.en} ${objet?.en ?? lieu?.en ?? ''}`);
    // 5. Le cours en mouvement : « fitness class movement ».
    if (humain?.en === 'group') pousser(`${principale.en === 'dance' ? 'dance' : 'fitness'} class movement`);
    if (lieu) pousser(`${principale.en} ${lieu.en}`);
  }

  // Rôle de la séquence : l'accroche cherche un plan serré, le CTA des visages souriants.
  if (e.role === 'cta' || e.role === 'CTA') pousser(`happy ${humain?.en ?? 'people'} ${principale?.en ?? 'fitness'}`);
  if (visuel === 'arriere-plan') pousser(`${principale?.en ?? 'fitness'} ${lieu?.en ?? 'studio'} background`);

  if (q.length === 0) {
    // Rien de reconnu : les mots du sujet, tels quels (souvent déjà en anglais ou un nom propre).
    const bruts = motsDe(`${e.sujet ?? ''} ${e.objectif ?? ''}`).filter((m) => m.length > 2).slice(0, 3).join(' ');
    pousser(bruts || 'fitness lifestyle');
  }

  const intentions = [style, principale, ...activites.filter((a) => a !== principale), humain, qualite, lieu, objet]
    .filter((c): c is Concept => !!c)
    .map((c) => c.en);

  return { requetes: q.slice(0, MAX_REQUETES), type, orientation, intentions: Array.from(new Set(intentions)) };
}

/** Mots-clés anglais d'une requête — sert au classement par pertinence. */
export function motsCles(requete: string): string[] {
  return motsDe(requete).filter((m) => m.length > 2 && !['and', 'the', 'with', 'class'].includes(m));
}
