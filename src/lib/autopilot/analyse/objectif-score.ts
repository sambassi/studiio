/**
 * LOT 2B — ÉTAPE 4B : LA PERTINENCE D'UNE FENÊTRE POUR UN OBJECTIF.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE MODULE EST PUR — AUCUN RÉSEAU, AUCUNE BASE, AUCUNE HORLOGE, AUCUN `eval`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les mêmes entrées rendent toujours la même note. C'est ce qui permet à
 * l'identité d'un plan de dépendre de cette note sans jamais la recalculer
 * différemment — et de prouver le classement sur des valeurs plutôt que sur
 * des captures d'écran d'un montage.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CE QUE CETTE NOTE N'EST PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ce n'est PAS une note de qualité, et elle ne remplace jamais `scoreMontage`.
 * Elle répond à une seule question : « ce que montre cette fenêtre sert-il
 * l'intention déclarée ? » Un plan flou et mal cadré qui montre une foule est
 * très pertinent pour un objectif événementiel — et reste un mauvais plan.
 *
 * C'est `montage.ts` qui tient l'ordre des priorités, et il ne bouge pas :
 *
 *     VALIDITÉ TECHNIQUE  >  QUALITÉ  >  PERTINENCE OBJECTIF
 *
 * La pertinence ne départage QUE des fenêtres de même palier de qualité.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUN POIDS NE VIENT DU NAVIGATEUR, AUCUN TEXTE LIBRE N'EN EST UN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `objectifPrincipal`, `contexte`, `messagePrincipal` sont DESCRIPTIFS et ne
 * sont jamais lus ici. Seuls des identifiants d'un vocabulaire fermé —
 * `type`, `priorites`, `preuveSouhaitee` — choisissent des critères, et les
 * poids sont des constantes de ce fichier. Un moteur piloté par une phrase
 * est un moteur que n'importe qui reprogramme en écrivant dans un champ.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ CE QUI N'EST PAS UTILISÉ, ET POURQUOI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `signaux-v1` ne porte NI énergie par fenêtre, NI mouvement, NI réaction, NI
 * avant/après, NI preuve. L'étape 4A a établi pourquoi : le modèle ne voit
 * qu'une image fixe par instant, et les vignettes sont plus espacées qu'une
 * fenêtre n'est longue. Les priorités narratives qui les réclament — `energie`,
 * `ambiance`, `emotion`, `benefice`, `preuve`, `urgence`, `authenticite` — ne
 * sélectionnent donc AUCUN critère. Leur donner un critère approchant
 * fabriquerait une pertinence que rien n'a mesurée.
 */
import {
  TYPE_OBJECTIF_GENERIQUE, estObjectifGenerique, objectifCanonique,
  type ObjectifCommunication, type PrioriteNarrative, type PreuveSouhaitee,
  type TypeObjectif,
} from './objectif-communication';
import { VERSION_SIGNAUX, type SignauxFenetre } from './signaux-contrat';

// ───────────────────────────────────────────────────────────────────────────
// Les versions
// ───────────────────────────────────────────────────────────────────────────

/**
 * La version du moteur de notation.
 *
 * ⚠️ ELLE ENTRE DANS L'IDENTITÉ DU PLAN. Changer un poids change un
 * classement ; sans version, deux plans calculés par deux moteurs différents
 * partageraient un identifiant, et le second ne serait jamais calculé.
 */
export const VERSION_SCORING = 'objectif-score-v1' as const;

/** L'algorithme de plan qui LIT un objectif. Le générique reste `m3g-v2`. */
export const ALGORITHME_PLAN_OBJECTIF = 'm3g-v3' as const;

// ───────────────────────────────────────────────────────────────────────────
// Les critères — le vocabulaire FERMÉ des raisons
// ───────────────────────────────────────────────────────────────────────────

/**
 * Les raisons qu'une fenêtre peut porter.
 *
 * ⚠️ DES IDENTIFIANTS, JAMAIS UNE PHRASE. Ce sont eux qui répondront un jour
 * à « pourquoi ce passage a-t-il été choisi ? », et ils doivent pouvoir être
 * traduits, comptés et comparés. Une phrase produite par un modèle ne le
 * permettrait pas, et finirait par piloter une décision.
 */
export const RAISONS_OBJECTIF = [
  'groupe_visible', 'personne_seule', 'plan_large', 'plan_serre',
  'objet_mis_en_avant', 'mains_en_action', 'marque_visible',
  'texte_a_l_ecran', 'expression_souriante', 'parole_presente', 'parole_dense',
] as const;
export type RaisonObjectif = (typeof RAISONS_OBJECTIF)[number];

/** Le seuil à partir duquel une fenêtre est dite « dense en parole ». */
export const DENSITE_PAROLE_DENSE = 0.5;

/**
 * Un critère : quand il S'APPLIQUE, et quand il est SATISFAIT.
 *
 * ⚠️ LA DISTINCTION EST TOUT LE FICHIER. « Je ne sais pas » n'est pas « non ».
 *
 * Une fenêtre dont la parole est `inconnue` — faute de transcription — n'est
 * PAS une fenêtre silencieuse : le critère de parole ne s'y applique tout
 * simplement pas, et la note se calcule sur les seuls critères applicables.
 * Compter `inconnue` comme un échec pénaliserait une fenêtre pour une donnée
 * que personne n'a mesurée, et un objectif « témoignage » écarterait
 * exactement les passages qu'il cherche.
 */
interface Critere {
  id: RaisonObjectif;
  applicable: (s: SignauxFenetre) => boolean;
  satisfait: (s: SignauxFenetre) => boolean;
}

/** Un champ de vision connu, ou rien à en dire. */
const vu = <T>(lire: (s: SignauxFenetre) => T | undefined, inconnu: T) => (
  (s: SignauxFenetre) => {
    const v = lire(s);
    return v !== undefined && v !== inconnu;
  }
);

const CRITERES: Record<RaisonObjectif, Critere> = {
  groupe_visible: {
    id: 'groupe_visible',
    applicable: vu((s) => s.vision?.personnes, 'indetermine'),
    satisfait: (s) => s.vision?.personnes === 'groupe' || s.vision?.personnes === 'foule',
  },
  personne_seule: {
    id: 'personne_seule',
    applicable: vu((s) => s.vision?.personnes, 'indetermine'),
    satisfait: (s) => s.vision?.personnes === 'une',
  },
  plan_large: {
    id: 'plan_large',
    applicable: vu((s) => s.vision?.echellePlan, 'indetermine'),
    satisfait: (s) => s.vision?.echellePlan === 'plan_large',
  },
  plan_serre: {
    id: 'plan_serre',
    applicable: vu((s) => s.vision?.echellePlan, 'indetermine'),
    satisfait: (s) => s.vision?.echellePlan === 'gros_plan',
  },
  objet_mis_en_avant: {
    id: 'objet_mis_en_avant',
    applicable: vu((s) => s.vision?.objetMisEnAvant, 'indetermine'),
    satisfait: (s) => s.vision?.objetMisEnAvant === 'oui',
  },
  mains_en_action: {
    id: 'mains_en_action',
    applicable: vu((s) => s.vision?.mainsEnAction, 'indetermine'),
    satisfait: (s) => s.vision?.mainsEnAction === 'oui',
  },
  marque_visible: {
    id: 'marque_visible',
    applicable: vu((s) => s.vision?.marqueVisible, 'indetermine'),
    satisfait: (s) => s.vision?.marqueVisible === 'oui',
  },
  texte_a_l_ecran: {
    id: 'texte_a_l_ecran',
    applicable: vu((s) => s.vision?.texteALEcran, 'indetermine'),
    satisfait: (s) => s.vision?.texteALEcran === 'oui',
  },
  expression_souriante: {
    id: 'expression_souriante',
    applicable: vu((s) => s.vision?.expression, 'indetermine'),
    satisfait: (s) => s.vision?.expression === 'souriante',
  },
  parole_presente: {
    id: 'parole_presente',
    // ⚠️ `inconnue` N'EST PAS `absente`. Voir l'en-tête de `Critere`.
    applicable: (s) => s.parole.etat !== 'inconnue',
    satisfait: (s) => s.parole.etat === 'presente',
  },
  parole_dense: {
    id: 'parole_dense',
    applicable: (s) => s.parole.densite !== null,
    satisfait: (s) => (s.parole.densite ?? 0) >= DENSITE_PAROLE_DENSE,
  },
};

// ───────────────────────────────────────────────────────────────────────────
// Le mapping objectif → critères
// ───────────────────────────────────────────────────────────────────────────

type Poids = Partial<Record<RaisonObjectif, number>>;

/**
 * Ce que chaque TYPE d'objectif cherche à montrer.
 *
 * ⚠️ TOUS LES TYPES N'Y SONT PAS, ET C'EST LE POINT LE PLUS IMPORTANT DE CE
 * FICHIER.
 *
 * `abonnes`, `inscriptions`, `reservations`, `leads` et `engagement` sont des
 * intentions bien réelles — mais ce qui les distingue est ce qu'on DEMANDE au
 * spectateur, pas ce qu'on lui MONTRE. Rien, dans une image, ne dit qu'un
 * passage sert mieux une inscription qu'une réservation. Leur inventer deux
 * sélections différentes produirait deux montages différents pour une
 * distinction qui n'existe pas à l'image — et ferait payer deux plans là où
 * un seul est justifié. Ils restent donc sur `m3g-v2`, et leur différence
 * sera portée par le CTA, dans la couche de rendu.
 *
 * `personnalise` est la soupape déclarée du contrat : l'utilisateur décrit son
 * intention en toutes lettres, et le moteur retombe sur sa politique
 * générique. Router du texte libre serait exactement ce que
 * `objectif-communication` interdit.
 */
export const POLITIQUES_TYPE: Partial<Record<TypeObjectif, Poids>> = {
  evenement: { groupe_visible: 3, plan_large: 2, marque_visible: 1 },
  notoriete: { marque_visible: 3, texte_a_l_ecran: 1, expression_souriante: 1 },
  temoignage: {
    personne_seule: 3, parole_presente: 3, plan_serre: 2,
    parole_dense: 2, expression_souriante: 1,
  },
  education: {
    parole_presente: 3, parole_dense: 2, texte_a_l_ecran: 2, plan_serre: 1,
  },
  produit: { objet_mis_en_avant: 3, mains_en_action: 2, plan_serre: 1 },
  service: { mains_en_action: 2, personne_seule: 2, objet_mis_en_avant: 1 },
  ventes: { objet_mis_en_avant: 3, texte_a_l_ecran: 1, marque_visible: 1 },
  offre: { texte_a_l_ecran: 2, objet_mis_en_avant: 2, marque_visible: 1 },
  coulisses: { mains_en_action: 2, personne_seule: 1, marque_visible: 1 },
};

/**
 * Les PRIORITÉS NARRATIVES qui correspondent à un signal réellement relevé.
 *
 * Les absentes — `energie`, `ambiance`, `emotion`, `benefice`, `preuve`,
 * `urgence`, `authenticite` — ne sélectionnent rien. Voir l'en-tête.
 */
export const POLITIQUES_PRIORITE: Partial<Record<PrioriteNarrative, Poids>> = {
  foule: { groupe_visible: 3 },
  produit: { objet_mis_en_avant: 3 },
  demonstration: { mains_en_action: 3 },
  identite: { marque_visible: 3 },
  personnalite: { personne_seule: 2, plan_serre: 2 },
  information: { texte_a_l_ecran: 2, parole_presente: 2 },
  pedagogie: { parole_presente: 2, parole_dense: 2 },
};

/**
 * Les PREUVES SOUHAITÉES que l'analyse sait aujourd'hui reconnaître.
 *
 * `expertise`, `avant-apres` et `coulisses` n'en font pas partie : la
 * première est un jugement, les deux autres demandent une comparaison ou une
 * mise en scène que `signaux-v1` ne mesure pas.
 */
export const POLITIQUES_PREUVE: Partial<Record<PreuveSouhaitee, Poids>> = {
  temoignage: { personne_seule: 2, parole_presente: 3 },
  foule: { groupe_visible: 3 },
  demonstration: { mains_en_action: 3 },
  chiffres: { texte_a_l_ecran: 3 },
};

/**
 * Les poids effectifs d'un objectif, ou `null` s'il n'en a aucun.
 *
 * Les trois sources s'ADDITIONNENT : un objectif « produit » qui déclare la
 * priorité `demonstration` pèse davantage sur les mains qu'un « produit »
 * seul. Elles ne se remplacent pas — une priorité déclarée précise
 * l'intention, elle ne l'annule pas.
 */
export function poidsDeLObjectif(o: ObjectifCommunication): Poids | null {
  if (o.type === TYPE_OBJECTIF_GENERIQUE) return null;

  const total: Poids = {};
  const ajouter = (p: Poids | undefined) => {
    if (!p) return;
    for (const [cle, valeur] of Object.entries(p)) {
      const id = cle as RaisonObjectif;
      total[id] = (total[id] ?? 0) + (valeur ?? 0);
    }
  };

  ajouter(POLITIQUES_TYPE[o.type as TypeObjectif]);
  for (const p of o.priorites) ajouter(POLITIQUES_PRIORITE[p]);
  for (const p of o.preuveSouhaitee) ajouter(POLITIQUES_PREUVE[p]);

  return Object.keys(total).length > 0 ? total : null;
}

// ───────────────────────────────────────────────────────────────────────────
// La note
// ───────────────────────────────────────────────────────────────────────────

/** Trois décimales, `-0` ramené à `0`. Le même arrondi que partout ailleurs. */
export function arrondirNote(n: number): number {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

export interface NoteObjectif {
  /**
   * La pertinence, entre 0 et 1 inclus. `null` quand AUCUN critère ne
   * s'applique : la fenêtre n'est pas « peu pertinente », on ne sait rien
   * d'elle, et les deux ne se traitent pas pareil.
   */
  score: number | null;
  /** Les critères SATISFAITS, dans l'ordre du vocabulaire. */
  raisons: RaisonObjectif[];
  /** Combien de critères ont pu être évalués sur cette fenêtre. */
  criteresApplicables: number;
  /** Combien l'objectif en demandait au total. */
  criteresDemandes: number;
}

export const NOTE_INCONNUE: NoteObjectif = Object.freeze({
  score: null, raisons: Object.freeze([]) as unknown as RaisonObjectif[],
  criteresApplicables: 0, criteresDemandes: 0,
});

/**
 * Note une fenêtre pour un objectif.
 *
 * ⚠️ LA NOTE EST NORMALISÉE SUR LES SEULS CRITÈRES APPLICABLES.
 *
 * Une fenêtre sans transcription est jugée sur ce qui se voit, et pas
 * pénalisée pour ce qu'on n'a pas écouté. C'est la seule normalisation qui
 * traite `inconnue` autrement qu'`absente` — et c'est pour cela qu'elle
 * existe.
 */
export function noterFenetre(
  o: ObjectifCommunication, s: SignauxFenetre | null,
): NoteObjectif {
  const poids = poidsDeLObjectif(o);
  if (!poids || !s) return { ...NOTE_INCONNUE };

  const demandes = Object.keys(poids).length;
  let total = 0;
  let obtenu = 0;
  let applicables = 0;
  const raisons: RaisonObjectif[] = [];

  // ⚠️ L'ORDRE DU VOCABULAIRE, PAS CELUI DE L'OBJET. Parcourir les clés de
  // `poids` ferait dépendre l'ordre des raisons de l'ordre d'insertion, donc
  // l'empreinte du plan de l'ordre de saisie de l'utilisateur.
  for (const id of RAISONS_OBJECTIF) {
    const p = poids[id];
    if (p === undefined) continue;
    const critere = CRITERES[id];
    if (!critere.applicable(s)) continue;
    applicables += 1;
    total += p;
    if (critere.satisfait(s)) {
      obtenu += p;
      raisons.push(id);
    }
  }

  if (applicables === 0 || total === 0) {
    return { score: null, raisons: [], criteresApplicables: 0, criteresDemandes: demandes };
  }
  return {
    score: arrondirNote(obtenu / total),
    raisons,
    criteresApplicables: applicables,
    criteresDemandes: demandes,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// La qualité — des PALIERS, et non un mélange
// ───────────────────────────────────────────────────────────────────────────

/**
 * La largeur d'un palier de qualité, sur l'échelle 0–100 de `scoreMontage`.
 *
 * ⚠️ POURQUOI DES PALIERS, ET NON UNE SOMME PONDÉRÉE.
 *
 * `0,7 × qualite + 0,3 × objectif` est le réflexe, et c'est un piège : avec
 * n'importe quels coefficients, une pertinence maximale finit par rattraper
 * un écart de qualité, et personne ne sait dire lequel. Le montage se met
 * alors à retenir un plan flou parce qu'il montre un logo.
 *
 * Un palier rend la garantie VÉRIFIABLE plutôt que probable : une fenêtre
 * d'un palier inférieur ne passe JAMAIS devant une fenêtre d'un palier
 * supérieur, quelle que soit sa pertinence. L'objectif ne départage que des
 * fenêtres de qualité comparable — ce qui est exactement le pouvoir qu'on
 * veut lui donner, et pas un de plus.
 *
 * Vingt points, soit cinq paliers : assez large pour que deux notes voisines
 * (78 et 81) restent départageables par l'objectif, assez étroit pour qu'un
 * écart franc (45 contre 85) reste imbattable.
 */
export const PALIER_QUALITE = 20;

export function palierDeQualite(scoreMontage: number): number {
  return Math.floor(Math.max(0, Math.min(100, scoreMontage)) / PALIER_QUALITE);
}

// ───────────────────────────────────────────────────────────────────────────
// La politique de plan
// ───────────────────────────────────────────────────────────────────────────

/** Ce dont la politique a besoin pour trancher. Pas un `ClipMaterialise`. */
export interface FenetreANoter {
  rang: number;
  scoreMontage: number | null;
  signaux: SignauxFenetre | null;
}

/** Pourquoi la politique objective n'a pas été retenue. `null` = elle l'est. */
export type MotifPolitique =
  | 'objectif_generique'
  | 'objectif_sans_mapping'
  | 'qualite_absente'
  | 'signaux_absents'
  | 'notes_indisponibles'
  | 'objectif_sans_effet';

export interface PolitiquePlan {
  /** `m3g-v2` ou `m3g-v3.<empreinte>`. C'est ce qui va en base. */
  algorithmePlan: string;
  objectiveAware: boolean;
  motif: MotifPolitique | null;
  /** L'ordre de remplissage décidé, par `rang`. Toujours renseigné. */
  ordreRangs: number[];
  /** Les notes, indexées par `rang` — pour l'explicabilité. */
  notes: Record<number, NoteObjectif>;
}

/**
 * L'ordre de remplissage historique : celui de `rang`, et rien d'autre.
 *
 * `rang` porte déjà le classement de M3-C — score décroissant, puis instant
 * croissant. C'est l'ordre de `m3g-v2`.
 */
function ordreHistorique(fenetres: readonly FenetreANoter[]): number[] {
  return [...fenetres].sort((a, b) => a.rang - b.rang).map((f) => f.rang);
}

/**
 * L'ordre objective-aware : PALIER DE QUALITÉ D'ABORD, pertinence ensuite.
 *
 * Trois clés, dans cet ordre et jamais dans un autre :
 *
 *   1. le palier de qualité, décroissant — la garantie dure ;
 *   2. la pertinence pour l'objectif, décroissante — le seul pouvoir donné
 *      à l'intention déclarée ;
 *   3. le `rang`, croissant — le départage historique, qui rend l'ordre
 *      totalement déterministe même à pertinence égale.
 */
function ordreObjectif(
  fenetres: readonly FenetreANoter[], notes: Record<number, NoteObjectif>,
): number[] {
  return [...fenetres]
    .sort((a, b) => {
      const pa = palierDeQualite(a.scoreMontage ?? 0);
      const pb = palierDeQualite(b.scoreMontage ?? 0);
      if (pa !== pb) return pb - pa;
      const na = notes[a.rang]?.score ?? 0;
      const nb = notes[b.rang]?.score ?? 0;
      if (na !== nb) return nb - na;
      return a.rang - b.rang;
    })
    .map((f) => f.rang);
}

/**
 * Une empreinte déterministe et courte — FNV-1a sur 64 bits, en deux moitiés.
 *
 * ⚠️ PAS DE `crypto`, ET C'EST DÉLIBÉRÉ. Ce module doit rester lisible par
 * l'écran autant que par le moteur, comme `objectif-communication` et
 * `profil-creatif` qui s'en passent explicitement. Une empreinte n'a ici
 * aucun rôle de sécurité : elle sépare des identités, elle ne protège rien.
 * Soixante-quatre bits séparent sans peine les quelques plans d'un jeu de
 * clips.
 */
export function empreinte(texte: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < texte.length; i += 1) {
    const c = texte.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/**
 * Décide la politique de plan, et rend l'ordre de remplissage.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES CINQ CONDITIONS DE `m3g-v3`, ET POURQUOI LA CINQUIÈME EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. un objectif non générique ;
 *   2. qui sélectionne au moins un critère ;
 *   3. dont TOUTES les fenêtres portent une note de qualité ;
 *   4. dont TOUTES les fenêtres portent une note de pertinence ;
 *   5. et dont l'ordre obtenu DIFFÈRE de l'ordre historique.
 *
 * ⚠️ LA CINQUIÈME N'EST PAS UNE OPTIMISATION. Sans elle, un objectif qui ne
 * change rien produirait tout de même un `algorithme_plan` différent, donc un
 * `montage_plan_id` différent, donc un plan RECALCULÉ et RESTOCKÉ identique
 * au précédent. L'utilisateur paierait un second calcul pour le même montage,
 * et rien dans la réponse ne le lui dirait. C'est la panne muette exacte que
 * le versionnement de `m3g-v2` a été écrit pour fermer.
 *
 * ⚠️ LA COUVERTURE EXIGÉE EST TOTALE, et ce n'est pas un pourcentage inventé.
 * Un jeu porte au plus six clips. Une seule fenêtre sans relevé n'a aucune
 * place juste dans un classement : la mettre au fond la punirait d'une donnée
 * manquante, la mettre en tête l'en récompenserait. Tant qu'une fenêtre n'est
 * pas comparable aux autres, le classement entier est arbitraire — et
 * `m3g-v2`, qui ne prétend rien savoir, reste la bonne réponse.
 */
export function politiqueDePlan(
  fenetres: readonly FenetreANoter[],
  objectif: ObjectifCommunication | null | undefined,
  algorithmeGenerique: string,
): PolitiquePlan {
  const historique = ordreHistorique(fenetres);
  const generique = (motif: MotifPolitique): PolitiquePlan => ({
    algorithmePlan: algorithmeGenerique,
    objectiveAware: false,
    motif,
    ordreRangs: historique,
    notes: {},
  });

  if (!objectif || estObjectifGenerique(objectif)) return generique('objectif_generique');
  if (!poidsDeLObjectif(objectif)) return generique('objectif_sans_mapping');
  if (fenetres.length === 0) return generique('signaux_absents');
  if (fenetres.some((f) => f.scoreMontage === null)) return generique('qualite_absente');
  if (fenetres.some((f) => f.signaux === null)) return generique('signaux_absents');

  const notes: Record<number, NoteObjectif> = {};
  for (const f of fenetres) notes[f.rang] = noterFenetre(objectif, f.signaux);
  if (fenetres.some((f) => notes[f.rang].score === null)) {
    return generique('notes_indisponibles');
  }

  const ordre = ordreObjectif(fenetres, notes);
  const identique = ordre.length === historique.length
    && ordre.every((r, i) => r === historique[i]);
  if (identique) {
    // L'objectif n'aurait rien changé : on ne bat pas monnaie d'un nouvel
    // identifiant pour un plan qui sera le même à la seconde près.
    return { ...generique('objectif_sans_effet'), notes };
  }

  // ─────────────────────────────────────────────────────────────────────
  // L'IDENTITÉ, ENCODÉE DANS `algorithme_plan`
  // ─────────────────────────────────────────────────────────────────────
  //
  // ⚠️ POURQUOI PAS UNE COLONNE DE PLUS.
  //
  // Une colonne `objectif_canonique` serait plus lisible — et exigerait une
  // migration ET la reconstruction de `rush_montage_plans_identite_unique`.
  // Tant qu'elle n'est pas appliquée, le code écrirait dans une colonne
  // absente : M3-G tomberait en production, entièrement, pour une
  // fonctionnalité éteinte. Le dépôt connaît déjà ce genre de panne, il la
  // nomme `socle_absent`.
  //
  // `algorithme_plan` répond DÉJÀ à la question « comment le plan a-t-il été
  // décidé ? », et une politique paramétrée par un objectif EST une autre
  // politique. L'index unique existant porte donc l'idempotence sans qu'une
  // ligne de SQL change, et les plans `m3g-v2` déjà écrits gardent leur
  // identifiant.
  //
  // Ce qui entre dans l'empreinte, et pourquoi chaque terme y est :
  //   • la version du moteur    — un poids qui change change un classement ;
  //   • la version des signaux  — `signaux-v2` mesurerait autre chose ;
  //   • l'objectif canonique    — deux intentions, deux plans ;
  //   • les notes RÉELLEMENT obtenues — deux relevés différents peuvent
  //     donner deux classements, même sous un objectif identique.
  const canonique = [
    VERSION_SCORING,
    VERSION_SIGNAUX,
    objectifCanonique(objectif),
    fenetres
      .map((f) => f.rang)
      .sort((a, b) => a - b)
      .map((r) => `${r}:${notes[r].score}:${notes[r].raisons.join('+') || 'aucune'}`)
      .join(';'),
  ].join('|');

  return {
    algorithmePlan: `${ALGORITHME_PLAN_OBJECTIF}.${empreinte(canonique)}`,
    objectiveAware: true,
    motif: null,
    ordreRangs: ordre,
    notes,
  };
}
