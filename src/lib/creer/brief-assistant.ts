/**
 * L'ASSISTANT DE BRIEF — ce qui aide à remplir les quatre champs du brief
 * (objectif, message, public, CTA) EN FONCTION DU THÈME choisi.
 *
 * ⚠️ MODULE PUR, AUCUN APPEL IA. Les propositions sont des listes rédigées
 * par thème (et des modèles pour un thème écrit à la main) : même entrée →
 * mêmes propositions, gratuit, testable. Rien n'est généré ni facturé.
 *
 * ⚠️ JAMAIS D'ÉCRASEMENT SILENCIEUX. `remplirBrief` ne remplit que les champs
 * vides ; `suggestionChamp` ne rend jamais le texte déjà présent et rend
 * `null` quand il n'a rien d'autre — l'appelant garde alors le texte tel quel.
 *
 * La COHÉRENCE (`analyserCoherenceBrief`) compare le domaine de chaque champ
 * (sport, finance, nutrition…) à celui du ou des thèmes : un objectif « remplir
 * ma salle de sport » sous le thème Finance est signalé — jamais bloqué.
 */
import { BRIEF_KEYS, BRIEF_PLACEHOLDERS, type BriefKey, type VideoBrief } from '@/lib/creer/brief';
import { THEMES, themeLabel } from '@/lib/themes';

// ─────────────────────────────────────────────────────────────────────────
// Domaines — reconnus par mots-clés (minuscules, sans accents)
// ─────────────────────────────────────────────────────────────────────────

export type DomaineBrief =
  | 'sport' | 'danse' | 'finance' | 'nutrition' | 'cuisine' | 'sommeil' | 'stress'
  | 'hydratation' | 'beaute' | 'productivite' | 'voyage' | 'motivation';

/** Le nom du domaine dans « … semble parler de {libellé} ». */
export const LIBELLE_DOMAINE: Record<DomaineBrief, string> = {
  sport: 'sport', danse: 'danse', finance: 'finance', nutrition: 'nutrition', cuisine: 'cuisine',
  sommeil: 'sommeil', stress: 'stress', hydratation: 'hydratation', beaute: 'beauté',
  productivite: 'productivité', voyage: 'voyage', motivation: 'motivation',
};

const MOTS_DOMAINE: Record<DomaineBrief, string[]> = {
  sport: ['sport', 'sports', 'sportif', 'sportive', 'sportifs', 'gym', 'fitness', 'musculation', 'muscu', 'entrainement',
    'entrainements', 'workout', 'cardio', 'abdos', 'crossfit', 'halteres', 'jogging', 'running', 'courir', 'athlete', 'muscles'],
  danse: ['danse', 'danses', 'danser', 'danseur', 'danseuse', 'danseurs', 'choregraphie', 'zumba', 'afroboost', 'salsa', 'kizomba'],
  finance: ['argent', 'budget', 'budgets', 'epargne', 'epargner', 'finance', 'finances', 'financier', 'financiere', 'financiers', 'financieres',
    'investir', 'investissement', 'investissements', 'dette', 'dettes', 'banque', 'salaire', 'depenses', 'economiser',
    'economies', 'bourse', 'crypto', 'retraite', 'impots', 'patrimoine', 'revenus'],
  nutrition: ['nutrition', 'alimentation', 'manger', 'repas', 'proteines', 'calories', 'regime', 'legumes', 'fruits', 'nutriments', 'vitamines'],
  cuisine: ['cuisine', 'cuisiner', 'recette', 'recettes', 'plat', 'plats', 'chef', 'gastronomie', 'ingredients'],
  sommeil: ['sommeil', 'dormir', 'nuit', 'nuits', 'insomnie', 'sieste', 'recuperation', 'recuperer', 'repos', 'endormissement'],
  stress: ['stress', 'stresse', 'anxiete', 'mental', 'meditation', 'mediter', 'respiration', 'zen', 'burnout', 'serenite', 'emotions'],
  hydratation: ['hydratation', 'hydrater', 'hydrate', 'boire', 'eau', 'gourde', 'deshydratation'],
  beaute: ['beaute', 'peau', 'maquillage', 'soin', 'soins', 'cheveux', 'skincare', 'cosmetique', 'cosmetiques', 'teint'],
  productivite: ['productivite', 'productif', 'productive', 'organisation', 'organiser', 'procrastination', 'concentration',
    'taches', 'agenda', 'focus', 'efficacite', 'routine'],
  voyage: ['voyage', 'voyages', 'voyager', 'vacances', 'destination', 'destinations', 'avion', 'hotel', 'valise', 'tourisme', 'itineraire'],
  motivation: ['motivation', 'motiver', 'motive', 'motivee', 'discipline', 'depassement', 'mindset', 'confiance', 'perseverance'],
};

/**
 * Domaines VOISINS : un brief qui parle de l'un n'est pas hors sujet sous
 * l'autre (la récupération après le sport, l'eau pendant l'effort, la recette
 * d'un plat équilibré…). La motivation, elle, va avec tout.
 */
const VOISINS: Record<DomaineBrief, DomaineBrief[]> = {
  sport: ['danse', 'hydratation', 'sommeil', 'nutrition'],
  danse: ['sport', 'hydratation'],
  finance: ['productivite'],
  nutrition: ['cuisine', 'hydratation', 'sport'],
  cuisine: ['nutrition'],
  sommeil: ['stress', 'sport'],
  stress: ['sommeil', 'productivite'],
  hydratation: ['nutrition', 'sport', 'danse', 'beaute'],
  beaute: ['hydratation', 'nutrition'],
  productivite: ['stress', 'finance'],
  voyage: [],
  motivation: [],
};

const DOMAINE_DU_THEME: Record<string, DomaineBrief> = {
  sommeil: 'sommeil', nutrition: 'nutrition', energie: 'sport', stress: 'stress', danse: 'danse',
  motivation: 'motivation', eau: 'hydratation', beauty: 'beaute', finance: 'finance',
  productivity: 'productivite', food: 'cuisine', travel: 'voyage',
};

function normaliser(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function mots(s: string): string[] {
  return normaliser(s).split(/[^a-z0-9]+/).filter(Boolean);
}

/** Les domaines évoqués par un texte, dans l'ordre d'apparition. */
export function domainesDe(texte: string | null | undefined): DomaineBrief[] {
  const out: DomaineBrief[] = [];
  for (const m of mots(texte ?? '')) {
    for (const d of Object.keys(MOTS_DOMAINE) as DomaineBrief[]) {
      if (MOTS_DOMAINE[d].includes(m) && !out.includes(d)) out.push(d);
    }
  }
  return out;
}

/** Le thème normalisé (l'id ou le `topic` d'un thème connu), sinon le texte rogné. */
function themeConnu(sujet: string) {
  return THEMES.find((t) => t.topic === sujet || t.id === sujet) ?? null;
}

/** Les domaines d'un thème : celui du thème connu, sinon ceux de son texte (thème personnalisé). */
export function domainesDuSujet(sujet: string | null | undefined): DomaineBrief[] {
  const s = (sujet ?? '').trim();
  if (!s) return [];
  const connu = themeConnu(s);
  if (connu) return [DOMAINE_DU_THEME[connu.topic] ?? DOMAINE_DU_THEME[connu.id]].filter(Boolean) as DomaineBrief[];
  return domainesDe(s);
}

// ─────────────────────────────────────────────────────────────────────────
// Profils de thème — placeholders et suggestions
// ─────────────────────────────────────────────────────────────────────────

export interface ProfilBrief {
  /** Le libellé du thème, tel que l'écran le montre. */
  libelle: string;
  /**
   * Thème écrit à la main : les propositions REPRENNENT ses mots dans des
   * modèles — aucune compréhension prétendue au-delà. L'écran le dit.
   */
  personnalise: boolean;
  placeholders: Record<BriefKey, string>;
  suggestions: Record<BriefKey, string[]>;
}

const CTA_COMMUNS = ['Commence maintenant', 'Enregistre cette vidéo', 'Découvre la suite'];
const PUBLIC_COMMUN = ['Débutants', 'Jeunes adultes', 'Grand public'];

/** Exemples rédigés par thème : objectif, message, public, CTA. */
const PROFILS: Record<string, Omit<ProfilBrief, 'libelle'>> = {
  finance: {
    placeholders: {
      objectif: 'Ex. : apprendre à mieux gérer son budget',
      message: 'Ex. : gérer son argent est une compétence qui s’apprend',
      public: 'Ex. : jeunes adultes qui veulent mieux gérer leur budget',
      cta: 'Ex. : commence par une petite action aujourd’hui',
    },
    suggestions: {
      objectif: ['Éduquer sur l’épargne', 'Expliquer un concept financier', 'Donner des conseils budget', 'Inciter à mieux gérer son argent', 'Aider les débutants à mieux gérer leur argent'],
      message: ['De petites habitudes financières peuvent changer beaucoup de choses', 'Gérer son argent est une compétence qui s’apprend', 'Épargner un peu chaque mois vaut mieux que rien', 'Un budget clair rend plus libre, pas plus contraint'],
      public: ['Jeunes adultes', 'Débutants en finance', 'Entrepreneurs', 'Parents', 'Grand public'],
      cta: ['Commence maintenant', 'Enregistre cette vidéo', 'Découvre la suite', 'Apprends à mieux gérer ton argent', 'Commence par une petite action aujourd’hui'],
    },
  },
  danse: {
    placeholders: {
      objectif: 'Ex. : donner envie de venir danser',
      message: 'Ex. : la danse, c’est du sport qui fait du bien au moral',
      public: 'Ex. : adultes qui veulent bouger dans la bonne humeur',
      cta: 'Ex. : réserve ton cours d’essai',
    },
    suggestions: {
      objectif: ['Donner envie de venir danser', 'Faire découvrir un style de danse', 'Montrer l’ambiance d’un cours', 'Partager un pas facile à reproduire'],
      message: ['La danse, c’est du sport qui fait du bien au moral', 'Pas besoin d’être doué pour commencer', 'On progresse vite quand on s’amuse', 'Danser ensemble, c’est déjà se sentir mieux'],
      public: ['Débutants en danse', 'Adultes actifs', 'Passionnés de danse', 'Femmes qui veulent bouger', 'Grand public'],
      cta: ['Réserve ton cours d’essai', 'Essaie ce pas aujourd’hui', 'Viens danser avec nous', 'Enregistre cette vidéo'],
    },
  },
  nutrition: {
    placeholders: {
      objectif: 'Ex. : aider à manger plus équilibré au quotidien',
      message: 'Ex. : bien manger, ce n’est pas se priver',
      public: 'Ex. : actifs pressés qui veulent mieux manger',
      cta: 'Ex. : teste cette astuce à ton prochain repas',
    },
    suggestions: {
      objectif: ['Aider à manger plus équilibré', 'Expliquer un réflexe nutrition simple', 'Casser une idée reçue sur l’alimentation', 'Donner une astuce repas facile'],
      message: ['Bien manger, ce n’est pas se priver', 'De petits changements dans l’assiette font une grande différence', 'L’équilibre se construit repas après repas'],
      public: ['Actifs pressés', 'Sportifs', 'Parents', 'Débutants', 'Grand public'],
      cta: ['Teste cette astuce à ton prochain repas', 'Enregistre cette vidéo', 'Partage-la à quelqu’un qui en a besoin', 'Découvre la suite'],
    },
  },
  energie: {
    placeholders: {
      objectif: 'Ex. : donner envie de bouger plus chaque jour',
      message: 'Ex. : quelques minutes de cardio suffisent pour se sentir mieux',
      public: 'Ex. : adultes actifs qui manquent de temps',
      cta: 'Ex. : bouge 10 minutes aujourd’hui',
    },
    suggestions: {
      objectif: ['Donner envie de bouger plus', 'Proposer un exercice cardio simple', 'Montrer qu’on peut s’entraîner sans matériel', 'Motiver à reprendre le sport'],
      message: ['Quelques minutes de cardio suffisent pour se sentir mieux', 'L’énergie vient en bougeant', 'La régularité compte plus que l’intensité'],
      public: ['Adultes actifs', 'Débutants', 'Sportifs', 'Personnes qui reprennent le sport', 'Grand public'],
      cta: ['Bouge 10 minutes aujourd’hui', 'Essaie cet exercice maintenant', 'Enregistre cette vidéo', 'Commence maintenant'],
    },
  },
  sommeil: {
    placeholders: {
      objectif: 'Ex. : aider à mieux dormir',
      message: 'Ex. : un bon sommeil se prépare dès le soir',
      public: 'Ex. : personnes fatiguées qui dorment mal',
      cta: 'Ex. : essaie cette routine ce soir',
    },
    suggestions: {
      objectif: ['Aider à mieux dormir', 'Expliquer l’importance de la récupération', 'Partager une routine du soir', 'Casser une idée reçue sur le sommeil'],
      message: ['Un bon sommeil se prépare dès le soir', 'Récupérer, c’est aussi progresser', 'Moins d’écrans le soir, plus de sommeil'],
      public: ['Personnes qui dorment mal', 'Sportifs', 'Actifs stressés', 'Parents', 'Grand public'],
      cta: ['Essaie cette routine ce soir', 'Enregistre cette vidéo', 'Découvre la suite', 'Partage-la à quelqu’un de fatigué'],
    },
  },
  stress: {
    placeholders: {
      objectif: 'Ex. : aider à mieux gérer le stress',
      message: 'Ex. : respirer quelques minutes peut tout changer',
      public: 'Ex. : actifs sous pression',
      cta: 'Ex. : prends 2 minutes pour respirer',
    },
    suggestions: {
      objectif: ['Aider à mieux gérer le stress', 'Partager un exercice de respiration', 'Normaliser le fait de faire une pause', 'Donner une astuce anti-stress'],
      message: ['Respirer quelques minutes peut tout changer', 'Prendre soin de son mental n’est pas un luxe', 'Une pause n’est pas du temps perdu'],
      public: ['Actifs sous pression', 'Étudiants', 'Parents', 'Entrepreneurs', 'Grand public'],
      cta: ['Prends 2 minutes pour respirer', 'Enregistre cette vidéo', 'Essaie dès maintenant', 'Partage-la à quelqu’un qui en a besoin'],
    },
  },
  motivation: {
    placeholders: {
      objectif: 'Ex. : donner l’élan de passer à l’action',
      message: 'Ex. : chaque petit pas compte',
      public: 'Ex. : personnes qui veulent se lancer',
      cta: 'Ex. : commence aujourd’hui',
    },
    suggestions: {
      objectif: ['Donner l’élan de passer à l’action', 'Encourager à ne pas abandonner', 'Partager un déclic', 'Célébrer les petits progrès'],
      message: ['Chaque petit pas compte', 'La discipline bat la motivation', 'Commencer imparfait vaut mieux que ne jamais commencer'],
      public: ['Personnes qui veulent se lancer', 'Jeunes adultes', 'Entrepreneurs', 'Sportifs', 'Grand public'],
      cta: ['Commence aujourd’hui', 'Enregistre cette vidéo', 'Partage-la à quelqu’un qui en a besoin', 'Découvre la suite'],
    },
  },
  eau: {
    placeholders: {
      objectif: 'Ex. : rappeler l’importance de bien s’hydrater',
      message: 'Ex. : boire assez d’eau change l’énergie de toute la journée',
      public: 'Ex. : actifs qui oublient de boire',
      cta: 'Ex. : bois un verre d’eau maintenant',
    },
    suggestions: {
      objectif: ['Rappeler l’importance de bien s’hydrater', 'Donner une astuce pour boire plus', 'Expliquer les signes de déshydratation'],
      message: ['Boire assez d’eau change l’énergie de la journée', 'La soif arrive après la déshydratation', 'Une gourde à portée de main, c’est la moitié du chemin'],
      public: ['Actifs qui oublient de boire', 'Sportifs', 'Étudiants', 'Grand public'],
      cta: ['Bois un verre d’eau maintenant', 'Enregistre cette vidéo', 'Partage-la à un proche', 'Découvre la suite'],
    },
  },
  beauty: {
    placeholders: {
      objectif: 'Ex. : partager une routine beauté simple',
      message: 'Ex. : prendre soin de soi passe par des gestes simples',
      public: 'Ex. : personnes qui veulent une routine rapide',
      cta: 'Ex. : teste cette routine ce soir',
    },
    suggestions: {
      objectif: ['Partager une routine beauté simple', 'Expliquer un geste de soin', 'Casser une idée reçue beauté', 'Présenter un soin naturel'],
      message: ['Prendre soin de soi passe par des gestes simples', 'Une belle peau commence par une bonne routine', 'Moins de produits, mieux choisis'],
      public: ['Débutantes en skincare', 'Actives pressées', 'Jeunes adultes', 'Grand public'],
      cta: ['Teste cette routine ce soir', 'Enregistre cette vidéo', 'Partage-la à une amie', 'Découvre la suite'],
    },
  },
  productivity: {
    placeholders: {
      objectif: 'Ex. : aider à mieux organiser sa journée',
      message: 'Ex. : être productif, c’est choisir ce qui compte',
      public: 'Ex. : entrepreneurs et indépendants',
      cta: 'Ex. : essaie cette méthode demain matin',
    },
    suggestions: {
      objectif: ['Aider à mieux organiser sa journée', 'Partager une méthode anti-procrastination', 'Expliquer comment prioriser', 'Donner une astuce de concentration'],
      message: ['Être productif, c’est choisir ce qui compte', 'Une tâche à la fois va plus loin', 'Planifier 5 minutes fait gagner des heures'],
      public: ['Entrepreneurs', 'Étudiants', 'Indépendants', 'Actifs débordés', 'Grand public'],
      cta: ['Essaie cette méthode demain matin', 'Enregistre cette vidéo', 'Commence maintenant', 'Découvre la suite'],
    },
  },
  food: {
    placeholders: {
      objectif: 'Ex. : partager une recette simple et rapide',
      message: 'Ex. : bien cuisiner n’a pas besoin d’être compliqué',
      public: 'Ex. : personnes qui cuisinent en semaine',
      cta: 'Ex. : teste cette recette ce soir',
    },
    suggestions: {
      objectif: ['Partager une recette simple', 'Donner une astuce de cuisine', 'Montrer un plat en moins de 15 minutes', 'Faire découvrir un ingrédient'],
      message: ['Bien cuisiner n’a pas besoin d’être compliqué', 'Les bons produits font la moitié du travail', 'Cuisiner maison, c’est plus simple qu’on le croit'],
      public: ['Cuisiniers débutants', 'Familles', 'Étudiants', 'Gourmands', 'Grand public'],
      cta: ['Teste cette recette ce soir', 'Enregistre cette vidéo', 'Partage-la à un gourmand', 'Découvre la suite'],
    },
  },
  travel: {
    placeholders: {
      objectif: 'Ex. : donner envie de découvrir une destination',
      message: 'Ex. : voyager autrement, c’est possible même avec un petit budget',
      public: 'Ex. : jeunes voyageurs',
      cta: 'Ex. : enregistre cette destination',
    },
    suggestions: {
      objectif: ['Donner envie de découvrir une destination', 'Partager une astuce de voyage', 'Aider à préparer sa valise', 'Montrer un lieu méconnu'],
      message: ['Voyager autrement, c’est possible', 'Les plus beaux souvenirs viennent des détours', 'Bien préparé, on voyage plus léger'],
      public: ['Jeunes voyageurs', 'Familles', 'Voyageurs à petit budget', 'Grand public'],
      cta: ['Enregistre cette destination', 'Partage-la à ton compagnon de voyage', 'Découvre la suite', 'Prépare ton prochain départ'],
    },
  },
};

function majuscule(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Un thème écrit à la main : des modèles qui reprennent SES mots. */
function profilPersonnalise(sujet: string): Omit<ProfilBrief, 'libelle'> {
  const s = sujet.trim().replace(/\s+/g, ' ');
  const bas = s.charAt(0).toLowerCase() + s.slice(1);
  return {
    placeholders: {
      objectif: `Ex. : donner des conseils concrets sur ${bas}`,
      message: `Ex. : ${bas}, ça s’apprend pas à pas`,
      public: `Ex. : personnes qui s’intéressent à ${bas}`,
      cta: 'Ex. : commence par une petite action aujourd’hui',
    },
    suggestions: {
      objectif: [`Donner des conseils concrets sur ${bas}`, `Expliquer simplement ${bas}`, `Partager une astuce sur ${bas}`, `Casser une idée reçue sur ${bas}`],
      message: [`${majuscule(bas)}, ça s’apprend pas à pas`, `Une petite action sur ${bas} change beaucoup de choses`, `${majuscule(bas)} : la régularité fait la différence`],
      public: [`Personnes qui s’intéressent à ${bas}`, ...PUBLIC_COMMUN],
      cta: [...CTA_COMMUNS, 'Partage-la à quelqu’un que ça aidera'],
    },
  };
}

/**
 * Le profil d'aide des sujets choisis : celui du PREMIER sujet (le thème
 * principal). Aucun sujet → `null` : l'écran garde ses exemples d'avant.
 */
export function profilBrief(sujets: ReadonlyArray<string> | string | null | undefined): ProfilBrief | null {
  const liste = (Array.isArray(sujets) ? sujets : [sujets]).map((s) => (s ?? '').trim()).filter(Boolean) as string[];
  const premier = liste[0];
  if (!premier) return null;
  const connu = themeConnu(premier);
  const base = connu ? PROFILS[connu.topic] ?? PROFILS[connu.id] : null;
  return { libelle: themeLabel(premier), personnalise: !base, ...(base ?? profilPersonnalise(premier)) };
}

/** Les exemples (placeholders) à montrer : ceux du thème, sinon ceux d'avant. */
export function placeholdersBrief(sujets: ReadonlyArray<string> | string | null | undefined): Record<BriefKey, string> {
  return profilBrief(sujets)?.placeholders ?? BRIEF_PLACEHOLDERS;
}

function memeTexte(a: string | null | undefined, b: string | null | undefined): boolean {
  const n = (s: string | null | undefined) => normaliser(s ?? '').replace(/[^a-z0-9]+/g, ' ').trim();
  return n(a) === n(b);
}

/**
 * UNE suggestion pour un champ : liée au thème, DIFFÉRENTE du texte présent.
 * `rang` fait tourner les propositions d'un clic à l'autre. `null` : rien de
 * pertinent — l'appelant ne touche pas au champ.
 */
export function suggestionChamp(
  sujets: ReadonlyArray<string> | string | null | undefined,
  cle: BriefKey,
  actuel: string | null | undefined,
  rang = 0,
): string | null {
  const profil = profilBrief(sujets);
  if (!profil) return null;
  const candidates = profil.suggestions[cle].filter((c) => !memeTexte(c, actuel));
  if (candidates.length === 0) return null;
  const i = ((rang % candidates.length) + candidates.length) % candidates.length;
  return candidates[i];
}

/** Les suggestions rapides d'un champ (boutons sous le champ). */
export function suggestionsRapides(sujets: ReadonlyArray<string> | string | null | undefined, cle: BriefKey, max = 5): string[] {
  return (profilBrief(sujets)?.suggestions[cle] ?? []).slice(0, max);
}

/**
 * « M'aider à remplir » : un brief complet et cohérent avec le thème — mais
 * SEULS LES CHAMPS VIDES sont remplis. `remplis` liste ce qui a changé ;
 * vide → rien à faire (tout est déjà saisi, ou aucun thème).
 */
export function remplirBrief(
  sujets: ReadonlyArray<string> | string | null | undefined,
  brief: VideoBrief,
): { brief: VideoBrief; remplis: BriefKey[] } {
  const profil = profilBrief(sujets);
  if (!profil) return { brief, remplis: [] };
  // Le brief type du thème : la proposition la plus complète de chaque liste
  // (la dernière pour l'objectif et le CTA, rédigées en phrase entière).
  const propose: Record<BriefKey, string> = {
    objectif: profil.suggestions.objectif[profil.suggestions.objectif.length - 1],
    message: profil.suggestions.message[0],
    public: profil.suggestions.public[0],
    cta: profil.suggestions.cta[profil.suggestions.cta.length - 1],
  };
  const suivant: VideoBrief = { ...brief };
  const remplis: BriefKey[] = [];
  for (const cle of BRIEF_KEYS) {
    if ((brief[cle] ?? '').trim()) continue;
    suivant[cle] = propose[cle];
    remplis.push(cle);
  }
  return { brief: remplis.length ? suivant : brief, remplis };
}

// ─────────────────────────────────────────────────────────────────────────
// Cohérence
// ─────────────────────────────────────────────────────────────────────────

export interface ConflitBrief {
  champ: BriefKey;
  domaine: DomaineBrief;
  /** « Votre objectif semble parler de sport alors que le thème sélectionné est Finance. » */
  message: string;
}

export interface CoherenceBrief {
  /** 0..100 ; `null` quand rien ne peut être comparé (aucun thème reconnu, brief vide). */
  score: number | null;
  niveau: 'bonne' | 'a-verifier' | 'indeterminee';
  conflits: ConflitBrief[];
  /** Le libellé du thème comparé (« Finance », « les thèmes sélectionnés »). */
  sujet: string | null;
}

const POIDS: Record<BriefKey, number> = { objectif: 35, message: 30, public: 15, cta: 20 };

const NOM_CHAMP: Record<BriefKey, string> = {
  objectif: 'Votre objectif',
  message: 'Votre message',
  public: 'Votre public visé',
  cta: 'Votre appel à l’action',
};

/** Seuil sous lequel le brief est « à vérifier » même sans contradiction franche. */
export const SEUIL_COHERENCE = 60;

/**
 * Compare chaque champ au(x) thème(s) : un champ qui ne parle QUE d'un
 * domaine étranger au thème (ni le thème, ni un domaine voisin) est un
 * conflit. Un champ neutre (« Jeunes adultes ») n'en est jamais un.
 */
export function analyserCoherenceBrief(
  sujets: ReadonlyArray<string> | string | null | undefined,
  brief: VideoBrief,
): CoherenceBrief {
  const liste = (Array.isArray(sujets) ? sujets : [sujets]).map((s) => (s ?? '').trim()).filter(Boolean) as string[];
  const domainesTheme = Array.from(new Set(liste.flatMap((s) => domainesDuSujet(s))));
  const libelleSujet = liste.length === 0 ? null : liste.length === 1 ? themeLabel(liste[0]) : 'les thèmes sélectionnés';
  const remplis = BRIEF_KEYS.filter((k) => (brief[k] ?? '').trim());
  if (domainesTheme.length === 0 || remplis.length === 0) {
    return { score: null, niveau: 'indeterminee', conflits: [], sujet: libelleSujet };
  }
  const universel = domainesTheme.includes('motivation');
  const compatibles = new Set<DomaineBrief>(domainesTheme.flatMap((d) => [d, ...VOISINS[d]]));
  compatibles.add('motivation');
  const conflits: ConflitBrief[] = [];
  let obtenu = 0;
  let total = 0;
  for (const cle of remplis) {
    const doms = domainesDe(brief[cle]);
    total += POIDS[cle];
    if (doms.length === 0) { obtenu += POIDS[cle] * 0.75; continue; }
    if (universel || doms.some((d) => compatibles.has(d))) { obtenu += POIDS[cle]; continue; }
    const domaine = doms[0];
    const theme = liste.length === 1 ? `le thème sélectionné est ${libelleSujet}` : `les thèmes sélectionnés sont ${liste.map(themeLabel).join(', ')}`;
    conflits.push({ champ: cle, domaine, message: `${NOM_CHAMP[cle]} semble parler de ${LIBELLE_DOMAINE[domaine]} alors que ${theme}.` });
  }
  const score = Math.round((obtenu / total) * 100);
  return {
    score,
    niveau: conflits.length > 0 || score < SEUIL_COHERENCE ? 'a-verifier' : 'bonne',
    conflits,
    sujet: libelleSujet,
  };
}
