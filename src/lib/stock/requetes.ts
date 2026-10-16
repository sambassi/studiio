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
  /**
   * Libellé FRANÇAIS montré à l'écran (la requête envoyée reste anglaise).
   * Activité : le nom (« Danse ») ; personnes/qualité/lieu/objet : un
   * complément (« en groupe », « énergique », « en salle », « avec un casque »).
   */
  fr: string;
  /** Activité « en action », en français (« qui danse »). */
  frAction?: string;
  /** Personne : le nom seul (« Femme »). */
  frNom?: string;
  /**
   * Activité HORS SPORT (finance, cuisine…) : jamais suffixée de « workout »
   * ni de « fitness », et son arrière-plan est son décor, pas un studio.
   */
  horsSport?: boolean;
  decor?: string;
  decorFr?: string;
}

const CONCEPTS: Concept[] = [
  // Style / identité
  { mots: ['afroboost'], en: 'african', fr: 'afro', categorie: 'style', implique: ['dance', 'workout'] },
  { mots: ['afro', 'africain', 'africaine', 'africains', 'africaines', 'afrique'], en: 'african', fr: 'afro', categorie: 'style' },
  // Activités
  { mots: ['cardio', 'aerobic', 'aerobie'], en: 'cardio', fr: 'Cardio', frAction: 'qui fait du cardio', categorie: 'activite', rang: 0 },
  { mots: ['danse', 'danses', 'danser', 'dansent', 'dansez', 'danseuse', 'danseur', 'danseurs', 'choregraphie', 'zumba'], en: 'dance', fr: 'Danse', frAction: 'qui danse', gerondif: 'dancing', categorie: 'activite', rang: 1 },
  { mots: ['yoga'], en: 'yoga', fr: 'Yoga', frAction: 'qui fait du yoga', gerondif: 'doing yoga', categorie: 'activite', rang: 1 },
  { mots: ['meditation', 'mediter', 'respiration'], en: 'meditation', fr: 'Méditation', frAction: 'qui médite', gerondif: 'meditating', categorie: 'activite', rang: 1 },
  { mots: ['course', 'courir', 'court', 'courent', 'courez', 'running', 'jogging', 'footing'], en: 'running', fr: 'Course à pied', frAction: 'qui court', gerondif: 'running', categorie: 'activite', rang: 1 },
  { mots: ['musculation', 'muscu', 'halteres', 'haltere', 'renforcement'], en: 'strength training', fr: 'Musculation', frAction: 'qui soulève des poids', gerondif: 'lifting weights', categorie: 'activite', rang: 1 },
  { mots: ['etirement', 'etirements', 'stretching', 'souplesse'], en: 'stretching', fr: 'Étirements', frAction: 'qui s’étire', gerondif: 'stretching', categorie: 'activite', rang: 1 },
  { mots: ['velo', 'cyclisme', 'spinning'], en: 'cycling', fr: 'Vélo', frAction: 'à vélo', gerondif: 'cycling', categorie: 'activite', rang: 1 },
  { mots: ['natation', 'nager', 'nage', 'nagent', 'piscine'], en: 'swimming', fr: 'Natation', frAction: 'qui nage', gerondif: 'swimming', categorie: 'activite', rang: 1 },
  { mots: ['boxe', 'boxing'], en: 'boxing', fr: 'Boxe', frAction: 'qui boxe', gerondif: 'boxing', categorie: 'activite', rang: 1 },
  { mots: ['sport', 'sportif', 'sportive', 'entrainement', 'entrainer', 'exercice', 'exercices', 'seance', 'workout', 'fitness', 'transpirer'], en: 'workout', fr: 'Entraînement', frAction: 'qui s’entraîne', gerondif: 'working out', categorie: 'activite', rang: 2 },
  { mots: ['nutrition', 'alimentation', 'manger', 'repas', 'recette', 'fruits', 'legumes'], en: 'healthy food', fr: 'Alimentation saine', frAction: 'qui mange sainement', gerondif: 'eating healthy', categorie: 'activite', rang: 2 },
  { mots: ['sommeil', 'dormir', 'recuperation', 'repos'], en: 'rest recovery', fr: 'Récupération', frAction: 'au repos', gerondif: 'resting', categorie: 'activite', rang: 2 },
  { mots: ['bien-etre', 'bienetre', 'sante', 'wellness'], en: 'wellness', fr: 'Bien-être', categorie: 'activite', rang: 2 },
  // Activités hors sport — les thèmes qui ne parlent pas d'entraînement.
  { mots: ['finance', 'finances', 'financier', 'financiere', 'argent', 'budget', 'epargne', 'epargner', 'economiser', 'economies', 'investir', 'investissement', 'banque', 'salaire', 'depenses'], en: 'personal finance', fr: 'Finance', frAction: 'qui gère son budget', gerondif: 'managing money', categorie: 'activite', rang: 1, horsSport: true, decor: 'desk', decorFr: 'au bureau' },
  { mots: ['beaute', 'beauty', 'skincare', 'maquillage', 'peau', 'cosmetique'], en: 'skincare', fr: 'Beauté', frAction: 'qui prend soin de sa peau', gerondif: 'doing skincare', categorie: 'activite', rang: 1, horsSport: true, decor: 'bathroom', decorFr: 'dans la salle de bain' },
  { mots: ['cuisine', 'cuisiner', 'food', 'plat', 'plats', 'chef'], en: 'cooking', fr: 'Cuisine', frAction: 'qui cuisine', gerondif: 'cooking', categorie: 'activite', rang: 1, horsSport: true, decor: 'kitchen', decorFr: 'en cuisine' },
  { mots: ['voyage', 'voyages', 'voyager', 'travel', 'vacances', 'destination', 'tourisme'], en: 'travel', fr: 'Voyage', frAction: 'en voyage', gerondif: 'traveling', categorie: 'activite', rang: 1, horsSport: true, decor: 'landscape', decorFr: 'en paysage' },
  { mots: ['productivite', 'productivity', 'productif', 'productive', 'organisation', 'organiser', 'procrastination', 'concentration'], en: 'productivity', fr: 'Productivité', frAction: 'concentrée au travail', gerondif: 'working focused', categorie: 'activite', rang: 1, horsSport: true, decor: 'office', decorFr: 'au bureau' },
  // Personnes
  { mots: ['groupe', 'groupes', 'cours', 'classe', 'ensemble', 'collectif', 'communaute', 'equipe', 'participants', 'eleves'], en: 'group', fr: 'en groupe', frNom: 'Groupe', categorie: 'personnes' },
  { mots: ['femme', 'femmes', 'fille', 'filles'], en: 'woman', fr: 'au féminin', frNom: 'Femme', categorie: 'personnes' },
  { mots: ['homme', 'hommes', 'garcon'], en: 'man', fr: 'au masculin', frNom: 'Homme', categorie: 'personnes' },
  { mots: ['coach', 'professeur', 'prof', 'instructeur', 'instructrice', 'animatrice', 'animateur'], en: 'fitness coach', fr: 'avec un coach', frNom: 'Coach sportif', categorie: 'personnes' },
  { mots: ['enfant', 'enfants', 'famille'], en: 'family', fr: 'en famille', frNom: 'Famille', categorie: 'personnes' },
  // Qualités
  { mots: ['energie', 'energique', 'energiques', 'dynamique', 'intense', 'intensite', 'puissant', 'explosif'], en: 'energetic', fr: 'énergique', categorie: 'qualite' },
  { mots: ['calme', 'detente', 'detendre', 'relaxation', 'stress', 'zen', 'serenite'], en: 'calm', fr: 'au calme', categorie: 'qualite' },
  { mots: ['joie', 'joyeux', 'joyeuse', 'fun', 'plaisir', 'sourire', 'heureux', 'heureuse', 'fete'], en: 'happy', fr: 'dans la bonne humeur', categorie: 'qualite' },
  { mots: ['motivation', 'motive', 'motivee', 'depassement'], en: 'motivated', fr: 'plein d’énergie', categorie: 'qualite' },
  // Lieux
  { mots: ['plage', 'mer', 'ocean'], en: 'beach', fr: 'à la plage', categorie: 'lieu' },
  { mots: ['salle', 'gym', 'club'], en: 'gym', fr: 'en salle', categorie: 'lieu' },
  { mots: ['studio'], en: 'studio', fr: 'en studio', categorie: 'lieu' },
  { mots: ['parc', 'exterieur', 'nature', 'plein-air', 'foret'], en: 'outdoor', fr: 'en plein air', categorie: 'lieu' },
  { mots: ['ville', 'urbain', 'rue'], en: 'city', fr: 'en ville', categorie: 'lieu' },
  { mots: ['maison', 'domicile', 'salon'], en: 'home', fr: 'à la maison', categorie: 'lieu' },
  // Objets
  { mots: ['casque', 'ecouteurs'], en: 'headphones', fr: 'avec un casque', categorie: 'objet' },
  { mots: ['musique', 'rythme', 'beat'], en: 'music', fr: 'en musique', categorie: 'objet' },
  { mots: ['eau', 'gourde', 'bouteille'], en: 'water bottle', fr: 'avec une gourde', categorie: 'objet' },
  { mots: ['tapis'], en: 'yoga mat', fr: 'sur un tapis', categorie: 'objet' },
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

/**
 * M2-a — Un concept de la taxonomie FERMÉE ci-dessus, tel qu'une fiche de
 * contenu le cite. `id` = la forme anglaise du concept (`healthy-food`,
 * `dance`…), unique et stable ; aucune autre catégorie n'existe.
 */
export interface ConceptReconnu {
  id: string;
  categorie: Categorie;
  /** Libellé français déjà montré à l'écran (« Danse », « Femme », « à la plage »). */
  libelle: string;
}

const idDuConcept = (c: Concept) => c.en.replace(/\s+/g, '-');

/** Les identifiants de la taxonomie fermée (validation d'une fiche relue). */
export const IDS_CONCEPTS: ReadonlySet<string> = new Set(CONCEPTS.map(idDuConcept));

/** Le concept d'un identifiant de la taxonomie fermée, ou `null`. */
export function conceptParId(id: string): ConceptReconnu | null {
  const c = CONCEPTS.find((x) => idDuConcept(x) === id && !x.implique) ?? CONCEPTS.find((x) => idDuConcept(x) === id);
  return c ? { id, categorie: c.categorie, libelle: c.frNom ?? c.fr } : null;
}

/**
 * Concepts reconnus dans un texte LIBRE, français OU anglais (titre de page
 * Pexels, requête envoyée au fournisseur, nom de fichier).
 *
 * Français : exactement `conceptsDe` (mêmes mots, mêmes implications).
 * Anglais : la forme anglaise DÉJÀ portée par chaque concept (`en`,
 * `gerondif`), mot pour mot et contiguë — « healthy food », « dancing ».
 * Aucune implication côté anglais : « african » ne fait pas danser une photo.
 * Pure, déterministe, sans IA.
 */
export function conceptsReconnus(...textes: Array<string | null | undefined>): ConceptReconnu[] {
  const out = new Map<string, ConceptReconnu>();
  const ajouter = (c: Concept) => {
    const id = idDuConcept(c);
    if (!out.has(id)) out.set(id, { id, categorie: c.categorie, libelle: c.frNom ?? c.fr });
  };
  for (const t of textes) {
    const mots = motsDe(t || '');
    if (!mots.length) continue;
    // (position, rang, concept) : l'ordre du texte, le français avant l'anglais à égalité.
    const trouves: Array<[number, number, Concept]> = [];
    mots.forEach((mot, i) => {
      const n = mot === 'pleinair' ? 'plein-air' : mot === 'bienetre' ? 'bien-etre' : mot;
      const c = CONCEPTS.find((x) => x.mots.includes(n));
      if (!c) return;
      trouves.push([i, 0, c]);
      for (const imp of c.implique ?? []) { const ci = PAR_EN.get(imp); if (ci) trouves.push([i, 1, ci]); }
    });
    const chaine = ` ${mots.join(' ')} `;
    for (const c of CONCEPTS) {
      if (c.implique) continue; // `afroboost` : implication propre au mot français
      for (const forme of [c.en, c.gerondif]) {
        if (!forme) continue;
        const k = chaine.indexOf(` ${motsDe(forme).join(' ')} `);
        if (k >= 0) { trouves.push([chaine.slice(0, k + 1).trim().split(' ').filter(Boolean).length, 2, c]); break; }
      }
    }
    trouves.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [, , c] of trouves) ajouter(c);
  }
  return [...out.values()];
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

/**
 * Une suggestion telle que l'écran la montre : un LIBELLÉ français, et la
 * REQUÊTE anglaise réellement envoyée au moteur (la langue où les banques
 * d'images répondent le mieux). L'utilisateur ne voit jamais la seconde.
 */
export interface SuggestionStock {
  libelle: string;
  requete: string;
}

export interface RecherchesStock {
  /** Requêtes anglaises — inchangées, lues par les appelants historiques. */
  requetes: string[];
  /** Les mêmes, dans le même ordre, avec leur libellé français. */
  suggestions: SuggestionStock[];
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
  // ⚠️ LE BRIEF N'EST QU'UN CONTEXTE SECONDAIRE. Dès que le texte ou le sujet
  // nomment une activité, l'objectif ne peut plus en imposer une autre, ni un
  // lieu, ni un style : il ne précise que les personnes et le ton. Sinon un
  // objectif « remplir ma salle de sport » donnait des médias de salle de
  // sport à une vidéo Finance. Sans activité au texte ni au sujet, le brief
  // reste la seule piste — il compte alors entièrement, comme avant.
  const primaires = conceptsDe(e.texte, e.sujet);
  const duBrief = conceptsDe(e.objectif);
  const primaireAUneActivite = primaires.some((c) => c.categorie === 'activite');
  const concepts = primaireAUneActivite
    ? [...primaires, ...duBrief.filter((c) => (c.categorie === 'personnes' || c.categorie === 'qualite') && !primaires.includes(c))]
    : conceptsDe(e.texte, e.sujet, e.objectif);
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
  const libelles: string[] = [];
  const pousser = (s: string, libelle: string) => {
    const b = borner(s);
    if (b && !q.includes(b)) {
      q.push(b);
      libelles.push(majuscule(libelle.replace(/\s+/g, ' ').trim()));
    }
  };

  if (principale) {
    const estEntrainement = principale.en === 'workout';
    const horsSport = !!principale.horsSport;
    // 1. Style + activité + sujet humain : « african dance workout group ».
    pousser(
      [style?.en, principale.en, estEntrainement || horsSport ? '' : 'workout', humain?.en].filter(Boolean).join(' '),
      [principale.fr, style ? style.fr : !estEntrainement && !horsSport ? 'fitness' : '', humain?.fr].filter(Boolean).join(' '),
    );
    // 2. Combinaison d'activités : « cardio dance fitness ».
    if (activites.length > 1) {
      const [a1, a2] = activites;
      const sport = !a1.horsSport && !a2.horsSport;
      pousser(`${activites.slice(0, 2).map((a) => a.en).join(' ')}${sport ? ' fitness' : ''}`, `${a1.fr} et ${a2.fr.toLowerCase()}`);
    }
    // 3. Qualité + sujet : « energetic group workout ».
    if (qualite) {
      pousser(
        `${qualite.en} ${humain?.en ?? ''} ${principale.en === 'dance' ? 'workout' : principale.en}`,
        `${principale.en === 'dance' ? 'Entraînement' : principale.fr} ${qualite.fr} ${humain?.fr ?? ''}`,
      );
    }
    // 4. Une personne en action : « woman dancing headphones ».
    const personneC = personnes.find((p) => p.en === 'woman' || p.en === 'man');
    const personne = personneC?.en ?? 'woman';
    const complement = objet ?? lieu;
    pousser(
      `${personne} ${principale.gerondif ?? principale.en} ${complement?.en ?? ''}`,
      `${personneC?.frNom ?? 'Femme'} ${principale.frAction ?? principale.fr.toLowerCase()} ${complement?.fr ?? ''}`,
    );
    // 5. Le cours en mouvement : « fitness class movement ».
    if (humain?.en === 'group' && !horsSport) {
      pousser(
        `${principale.en === 'dance' ? 'dance' : 'fitness'} class movement`,
        principale.en === 'dance' ? 'Cours collectif de danse' : 'Cours collectif',
      );
    }
    if (lieu) pousser(`${principale.en} ${lieu.en}`, `${principale.fr} ${lieu.fr}`);
  }

  // Rôle de la séquence : l'accroche cherche un plan serré, le CTA des visages souriants.
  if (e.role === 'cta' || e.role === 'CTA') {
    pousser(`happy ${humain?.en ?? 'people'} ${principale?.en ?? 'fitness'}`, `Visages souriants ${humain?.en === 'group' ? 'en groupe' : ''}`);
  }
  if (visuel === 'arriere-plan') {
    pousser(
      `${principale?.en ?? 'fitness'} ${lieu?.en ?? principale?.decor ?? 'studio'} background`,
      `Fond ${(principale?.fr ?? 'fitness').toLowerCase()} ${lieu?.fr ?? principale?.decorFr ?? 'en studio'}`,
    );
  }

  if (q.length === 0) {
    // Rien de reconnu : les mots du sujet, tels quels (souvent déjà en anglais ou un nom propre).
    const bruts = motsDe(`${e.sujet ?? ''} ${e.objectif ?? ''}`).filter((m) => m.length > 2).slice(0, 3).join(' ');
    const lisible = (e.sujet ?? '').trim();
    pousser(bruts || 'fitness lifestyle', bruts ? (lisible && lisible.length <= 40 ? lisible : bruts) : 'Sport et bien-être');
  }

  const intentions = [style, principale, ...activites.filter((a) => a !== principale), humain, qualite, lieu, objet]
    .filter((c): c is Concept => !!c)
    .map((c) => c.en);

  const requetes = q.slice(0, MAX_REQUETES);
  // Deux libellés identiques pour deux requêtes : le second se distingue.
  const vus = new Set<string>();
  const suggestions = requetes.map((requete, i) => {
    let libelle = libelles[i];
    if (vus.has(libelle.toLowerCase())) libelle = `${libelle} (${i + 1})`;
    vus.add(libelle.toLowerCase());
    return { libelle, requete };
  });
  return { requetes, suggestions, type, orientation, intentions: Array.from(new Set(intentions)) };
}

function majuscule(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Petits mots français qui ne disent rien à une banque d'images. */
const MOTS_VIDES = new Set([
  'avec', 'pour', 'dans', 'les', 'des', 'une', 'qui', 'sur', 'par', 'est', 'sont', 'son', 'ses', 'aux', 'du', 'de', 'la', 'le',
  'un', 'et', 'en', 'au', 'ou', 'pas', 'plus', 'tres', 'fait', 'font', 'photo', 'photos', 'video', 'videos', 'image', 'images',
]);

/**
 * Saisie LIBRE de l'utilisateur (souvent en français) → requête anglaise.
 *
 * Même lexique que les suggestions (`conceptsDe`), aucun appel IA : « femme
 * qui danse » → « woman dancing ». Les mots non reconnus (nom propre, mot
 * déjà anglais) sont gardés tels quels ; rien de reconnu → le texte brut.
 */
export function traduireRequete(texte: string): string {
  const brut = (texte || '').trim();
  const concepts = conceptsDe(brut);
  if (concepts.length === 0) return brut;
  const connus = new Set(concepts.flatMap((c) => c.mots));
  const inconnus = motsDe(brut).filter((m) => m.length > 2 && !connus.has(m) && !MOTS_VIDES.has(m));
  const personne = concepts.find((c) => c.categorie === 'personnes');
  const activite = concepts.find((c) => c.categorie === 'activite');
  const parties: string[] = [];
  // Une personne ET une activité : la forme en action (« woman dancing »).
  if (personne && activite && personne.en !== 'group') parties.push(personne.en, activite.gerondif ?? activite.en);
  for (const c of concepts) {
    if (personne && activite && personne.en !== 'group' && (c === personne || c === activite)) continue;
    // `implique` (Afroboost → dance) n'est pas un mot de la saisie : on le garde quand même, il précise.
    parties.push(c.en);
  }
  parties.push(...inconnus);
  const mots = parties.join(' ').split(/\s+/).filter(Boolean);
  return mots.filter((m, i) => mots.indexOf(m) === i).slice(0, 6).join(' ');
}

/** Mots-clés anglais d'une requête — sert au classement par pertinence. */
export function motsCles(requete: string): string[] {
  return motsDe(requete).filter((m) => m.length > 2 && !['and', 'the', 'with', 'class'].includes(m));
}
