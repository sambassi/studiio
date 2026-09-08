/**
 * A_3e1 — LA BIBLIOTHÈQUE CRÉATIVE PERSONNELLE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ ELLE NE VIT PAS DANS LE PROFIL CRÉATIF, ET C'EST STRUCTURANT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `profilCreatifCanonique` alimente l'identité du rendu : deux profils
 * différents produisent deux fichiers différents. Y ranger les favoris ferait
 * qu'un cœur cliqué invaliderait tous les montages déjà calculés du compte —
 * une préférence d'affichage qui refait des vidéos.
 *
 * La bibliothèque est donc un FRÈRE de `profilCreatif` dans `design_style`,
 * exactement comme `objectifParDefaut`. Elle se lit et s'écrit seule, elle
 * n'entre dans aucune empreinte.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ UN FAVORI RÉFÈRE TOUJOURS UN IDENTIFIANT QUI EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le jour où un effet quitte un catalogue, les comptes qui l'avaient en
 * favori portent un identifiant mort. Il est RETIRÉ à la lecture, sans
 * erreur : un profil ne doit pas devenir illisible parce qu'un look a été
 * renommé.
 *
 * MODULE PUR. Il valide et il normalise ; il ne lit ni base ni disque.
 */
import { LOOK_IDS } from './looks';
import { STYLE_TEXTE_IDS } from './styles-texte';
import { ANIMATION_TEXTE_IDS } from './animations-texte';
import { ANIMATION_CONTENU_IDS } from './animations-contenu';
import { TRANSITION_CREATIVE_IDS } from './transitions';
import { CAPTION_IDS } from './captions';
import { presetsPersonnelsValides, type PresetPersonnel } from './presets';

/** Les cinq familles qu'une personne peut mettre en favori. */
export const FAMILLES_BIBLIOTHEQUE = [
  'lut', 'styleTexte', 'animationBloc', 'animationContenu', 'transition',
  // A_4 : les sous-titres s'aiment et se retrouvent comme le reste.
  'caption',
] as const;
export type FamilleBibliotheque = (typeof FAMILLES_BIBLIOTHEQUE)[number];

/** Ce que l'écran affiche pour chaque famille. */
export const LIBELLES_FAMILLE: Record<FamilleBibliotheque, string> = {
  lut: 'Looks',
  styleTexte: 'Textes',
  animationBloc: 'Mouvements',
  animationContenu: 'Apparitions',
  transition: 'Transitions',
  caption: 'Sous-titres',
};

/**
 * ⚠️ L'ENTRÉE « aucune » EST VALIDE POUR LES APPARITIONS.
 *
 * Elle n'est pas dans `ANIMATIONS_CONTENU` — c'est l'absence d'animation —
 * mais elle est bien un choix que l'écran propose et que le profil accepte.
 * L'omettre rendrait ce choix impossible à mettre en favori, ce qui ferait
 * disparaître le cœur d'une carte sur deux sans explication.
 */
const IDS_PAR_FAMILLE: Record<FamilleBibliotheque, readonly string[]> = {
  lut: LOOK_IDS,
  styleTexte: STYLE_TEXTE_IDS,
  animationBloc: ANIMATION_TEXTE_IDS,
  animationContenu: ANIMATION_CONTENU_IDS.includes('aucune')
    ? ANIMATION_CONTENU_IDS : ['aucune', ...ANIMATION_CONTENU_IDS],
  transition: TRANSITION_CREATIVE_IDS,
  caption: CAPTION_IDS,
};

export function idsFamille(f: FamilleBibliotheque): readonly string[] {
  return IDS_PAR_FAMILLE[f];
}

/**
 * ⚠️ UNE VRAIE COLLECTION, PAS UNE LISTE DE COURSES.
 *
 * Quarante par famille laisse la place à une collection réelle — la moitié
 * du catalogue de looks — tout en bornant ce qui part dans un `jsonb` à
 * chaque enregistrement. Cinq aurait été un plafond arbitraire ; l'infini
 * aurait laissé un document grossir sans limite.
 */
export const FAVORIS_MAX_PAR_FAMILLE = 40;

export type FavorisCreatifs = Record<FamilleBibliotheque, readonly string[]>;

export interface BibliothequeCreative {
  favoris: FavorisCreatifs;
  /** A_3e2 — les combinaisons que la personne a nommées elle-même. */
  presets: readonly PresetPersonnel[];
  /** A_3e3 — ce que l'Autopilote a le droit de faire varier. */
  automatisation: PolitiqueCreative;
}

export const FAVORIS_VIDES: FavorisCreatifs = Object.freeze({
  lut: Object.freeze([]) as readonly string[],
  styleTexte: Object.freeze([]) as readonly string[],
  animationBloc: Object.freeze([]) as readonly string[],
  animationContenu: Object.freeze([]) as readonly string[],
  transition: Object.freeze([]) as readonly string[],
  caption: Object.freeze([]) as readonly string[],
}) as FavorisCreatifs;

/**
 * A_3e3 — CE QUE L'AUTOPILOTE A LE DROIT DE CHOISIR.
 *
 * ⚠️ TROIS MODES QUI S'EXCLUENT, PAS TROIS INTERRUPTEURS. Un « varier les
 * effets » ET un « varier les presets » tous deux allumés poseraient une
 * question sans réponse : lequel gagne ? Un seul mode à la fois, et le
 * comportement de chacun tient en une phrase.
 */
export const MODES_CREATIFS = [
  'marque-stricte', 'varier-elements', 'varier-presets',
] as const;
export type ModeCreatif = (typeof MODES_CREATIFS)[number];

export const LIBELLES_MODE: Record<ModeCreatif, string> = {
  'marque-stricte': 'Marque stricte',
  'varier-elements': 'Varier mon style',
  'varier-presets': 'Varier parmi mes presets',
};

export const DESCRIPTIONS_MODE: Record<ModeCreatif, string> = {
  'marque-stricte': 'Studiio conserve toujours les mêmes choix visuels.',
  'varier-elements': 'Studiio varie les effets que tu autorises, sans sortir de ton univers.',
  'varier-presets': 'Studiio alterne entre les presets que tu as choisis.',
};

/**
 * ⚠️ LA VERSION DE LA POLITIQUE ENTRE DANS LA GRAINE.
 *
 * Changer la façon de choisir doit changer les choix — sinon une correction
 * du sélecteur laisserait tous les comptes sur les combinaisons d'hier, et
 * l'on ne saurait jamais si elle a servi.
 */
export const VERSION_POLITIQUE_CREATIVE = 'politique-v1';

export interface PolitiqueCreative {
  mode: ModeCreatif;
  /** Ce que l'Autopilote peut choisir, famille par famille. */
  autorises: FavorisCreatifs;
  /** Les presets entre lesquels il peut alterner. */
  presetsAutorises: readonly string[];
  version: string;
}

export const POLITIQUE_STRICTE: PolitiqueCreative = Object.freeze({
  mode: 'marque-stricte',
  autorises: FAVORIS_VIDES,
  presetsAutorises: Object.freeze([]) as readonly string[],
  version: VERSION_POLITIQUE_CREATIVE,
});

export function politiqueValide(brut: unknown): PolitiqueCreative {
  if (!brut || typeof brut !== 'object') return POLITIQUE_STRICTE;
  const o = brut as Record<string, unknown>;
  const mode = typeof o.mode === 'string'
    && (MODES_CREATIFS as readonly string[]).includes(o.mode)
    ? o.mode as ModeCreatif : 'marque-stricte';
  const a = (o.autorises ?? {}) as Record<string, unknown>;
  const autorises = {} as Record<FamilleBibliotheque, readonly string[]>;
  for (const famille of FAMILLES_BIBLIOTHEQUE) {
    autorises[famille] = favorisValides(a[famille], famille);
  }
  const presetsAutorises = Array.isArray(o.presetsAutorises)
    ? [...new Set(o.presetsAutorises.filter((x): x is string => typeof x === 'string'))]
      .slice(0, FAVORIS_MAX_PAR_FAMILLE)
    : [];
  return {
    mode, autorises, presetsAutorises, version: VERSION_POLITIQUE_CREATIVE,
  };
}

/** La politique ne demande-t-elle rien de plus que le défaut ? */
export function politiqueVide(p: PolitiqueCreative): boolean {
  return p.mode === 'marque-stricte'
    && p.presetsAutorises.length === 0
    && FAMILLES_BIBLIOTHEQUE.every((f) => p.autorises[f].length === 0);
}


export const BIBLIOTHEQUE_VIDE: BibliothequeCreative = Object.freeze({
  favoris: FAVORIS_VIDES,
  presets: Object.freeze([]) as readonly PresetPersonnel[],
  automatisation: POLITIQUE_STRICTE,
});

/**
 * Les favoris d'une famille, nettoyés.
 *
 * Retire ce qui n'est pas une chaîne, ce qui n'existe plus au catalogue, et
 * les doublons ; borne la liste. L'ORDRE DE LA PERSONNE EST CONSERVÉ : c'est
 * l'ordre dans lequel elle les a ajoutés, et le réordonner serait lui prendre
 * un choix qu'elle a fait.
 */
export function favorisValides(
  brut: unknown, famille: FamilleBibliotheque,
): readonly string[] {
  if (!Array.isArray(brut)) return [];
  const connus = IDS_PAR_FAMILLE[famille];
  const vus = new Set<string>();
  const sortie: string[] = [];
  for (const v of brut) {
    if (typeof v !== 'string' || vus.has(v)) continue;
    if (!connus.includes(v)) continue;
    vus.add(v);
    sortie.push(v);
    if (sortie.length >= FAVORIS_MAX_PAR_FAMILLE) break;
  }
  return sortie;
}

/** La bibliothèque complète, telle qu'on accepte de la relire. */
export function bibliothequeValide(brut: unknown): BibliothequeCreative {
  if (!brut || typeof brut !== 'object') return BIBLIOTHEQUE_VIDE;
  const o = brut as Record<string, unknown>;
  const f = (o.favoris ?? {}) as Record<string, unknown>;
  const favoris = {} as Record<FamilleBibliotheque, readonly string[]>;
  for (const famille of FAMILLES_BIBLIOTHEQUE) {
    favoris[famille] = favorisValides(f[famille], famille);
  }
  return {
    favoris,
    presets: presetsPersonnelsValides(o.presets),
    automatisation: politiqueValide(o.automatisation),
  };
}

/** La bibliothèque ne demande-t-elle rien ? */
export function bibliothequeVide(b: BibliothequeCreative): boolean {
  return b.presets.length === 0
    && politiqueVide(b.automatisation)
    && FAMILLES_BIBLIOTHEQUE.every((f) => b.favoris[f].length === 0);
}

/**
 * Ajoute ou retire un favori.
 *
 * ⚠️ AU PLAFOND, LE PLUS ANCIEN PART. Refuser l'ajout obligerait à expliquer
 * un plafond que personne n'a en tête au moment où il clique un cœur ; faire
 * de la place, en revanche, ne perd que ce qu'il n'a plus regardé depuis
 * quarante ajouts.
 */
export function basculerFavori(
  favoris: FavorisCreatifs, famille: FamilleBibliotheque, id: string,
): FavorisCreatifs {
  const liste = favoris[famille];
  const suivant = liste.includes(id)
    ? liste.filter((x) => x !== id)
    : [...liste, id].slice(-FAVORIS_MAX_PAR_FAMILLE);
  return { ...favoris, [famille]: favorisValides(suivant, famille) };
}

// ─────────────────────────────────────────────────────────────────────────
// LES RÉCENTS
// ─────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ LES RÉCENTS NE SONT PAS STOCKÉS, ILS SONT DÉDUITS.
 *
 * Une seconde liste `recentIds`, mise à jour après chaque rendu, serait un
 * historique de plus à écrire, à borner et à réparer — et elle mentirait dès
 * le premier rendu échoué ou le premier enregistrement manqué.
 *
 * Un rendu RÉUSSI est déjà la meilleure preuve qu'un choix a servi. Les
 * récents se lisent donc dans `usage.creatif` des derniers montages, dans
 * l'ordre où ils ont été faits.
 */
export const RECENTS_MAX_PAR_FAMILLE = 10;

/** La clé de `usage.creatif` qui porte le choix d'une famille. */
export const CLE_USAGE_PAR_FAMILLE: Record<FamilleBibliotheque, string> = {
  lut: 'lutId',
  styleTexte: 'styleTexteId',
  animationBloc: 'animationBlocId',
  animationContenu: 'animationContenuId',
  transition: 'transitionId',
  caption: 'captionStyleId',
};

/**
 * Les identifiants récemment utilisés, du plus récent au plus ancien.
 *
 * `usages` arrive DÉJÀ TRIÉ, le plus récent d'abord. Les doublons
 * s'effondrent : un look employé six fois n'apparaît qu'une, à sa place la
 * plus récente.
 */
export function recentsDepuisUsages(
  usages: readonly Record<string, unknown>[],
): FavorisCreatifs {
  const sortie = {} as Record<FamilleBibliotheque, readonly string[]>;
  for (const famille of FAMILLES_BIBLIOTHEQUE) {
    const cle = CLE_USAGE_PAR_FAMILLE[famille];
    const connus = IDS_PAR_FAMILLE[famille];
    const vus = new Set<string>();
    const liste: string[] = [];
    for (const u of usages) {
      const creatif = u?.creatif;
      if (!creatif || typeof creatif !== 'object') continue;
      const v = (creatif as Record<string, unknown>)[cle];
      if (typeof v !== 'string' || vus.has(v)) continue;
      // Un identifiant disparu du catalogue ne revient pas dans la grille.
      if (!connus.includes(v)) continue;
      vus.add(v);
      liste.push(v);
      if (liste.length >= RECENTS_MAX_PAR_FAMILLE) break;
    }
    sortie[famille] = liste;
  }
  return sortie;
}
