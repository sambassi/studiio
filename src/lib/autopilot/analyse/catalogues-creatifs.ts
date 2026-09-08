/**
 * LOT 2B — LES CATALOGUES DU PROFIL CREATIF.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI DES IDENTIFIANTS, ET JAMAIS DES CHEMINS
 * ---------------------------------------------------------------------------
 *
 * Le profil creatif finira par nourrir une commande ffmpeg : une police pour
 * `drawtext`, un fichier `.cube` pour `lut3d`, un nom de transition pour un
 * graphe de filtres. Si l'un de ces trois voyageait depuis le navigateur sous
 * la forme d'un CHEMIN ou d'une URL, le client dicterait ce que le moteur
 * ouvre — c'est exactement ce que `CHAMPS_INTERDITS_RENDU` interdit deja pour
 * `musicUrl`, `ffmpeg` et `args`.
 *
 * D'ou la regle, sans exception : la recette ne porte QUE des identifiants
 * pris dans les listes de ce fichier. La resolution d'un identifiant vers une
 * ressource serveur appartient au moteur, cote serveur, et n'existe pas
 * encore — c'est le Lot 2B etape 2.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ AUCUNE MARQUE PARTICULIERE ICI
 * ---------------------------------------------------------------------------
 *
 * Ces catalogues sont ceux de STUDIIO, pas ceux d'un compte. Aucun
 * identifiant ne porte le nom d'un client, aucune valeur par defaut ne decrit
 * une identite visuelle precise. Le profil d'Afroboost — Bebas Neue, #D91CD2,
 * « Essai gratuit » — est une DONNEE, rangee dans le `designStyle` du compte
 * de Bassi, et rien de tout cela n'a sa place dans du code partage.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ MODULE PUR, LISIBLE PAR LE NAVIGATEUR
 * ---------------------------------------------------------------------------
 *
 * Il n'importe qu'une donnee : le catalogue de polices, deja lu par
 * `textStyle.ts` cote ecran. Ni `fs`, ni `crypto`, ni stockage. C'est ce qui
 * permettra a l'ecran « Mon style » d'afficher les memes listes que celles
 * que le serveur validera, sans les recopier.
 */
import { FONT_CATALOG, type FontGroup } from '@/lib/fonts/catalog-data';

// ---------------------------------------------------------------------------
// Polices
// ---------------------------------------------------------------------------

/**
 * L'identifiant d'une police, derive de sa famille.
 *
 * ⚠️ DERIVE, ET NON RESAISI. Une seconde liste de polices ecrite a la main
 * aurait diverge du catalogue le jour ou une famille y serait ajoutee — et
 * l'ecran aurait alors propose une police que le contrat refuse. Un test
 * compare les deux listes.
 */
export function slugPolice(famille: string): string {
  return famille
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface PoliceAutorisee {
  /** Ce que la recette stocke — jamais autre chose. */
  id: string;
  /** Ce que l'ecran affiche. */
  nom: string;
  /** La famille CSS, telle que le catalogue la nomme. */
  famille: string;
  poidsDisponibles: number[];
  usage: FontGroup;
  /**
   * La licence de la fonte, a renseigner AVANT que l'etape 2 ne branche
   * `drawtext`.
   *
   * ⚠️ `null` EST UN AVEU, PAS UN OUBLI. Ces familles viennent de Google
   * Fonts, dont les licences ne sont pas toutes identiques ; ecrire « OFL »
   * pour les cinquante-deux sans avoir verifie serait une affirmation
   * inventee, et c'est precisement le genre d'affirmation qu'on ne decouvre
   * fausse qu'au moment de distribuer un fichier.
   */
  licence: string | null;
  /**
   * Le fichier que `drawtext` ouvrira. `null` tant que l'etape 2 n'a pas
   * tranche la question des fontes embarquees dans l'image Docker.
   *
   * ⚠️ CE CHAMP NE VIENT JAMAIS DU CLIENT. Il est resolu ici, a partir d'un
   * identifiant deja valide.
   */
  ressourceServeur: string | null;
}

/**
 * LES TROIS FAMILLES QUE LE SERVEUR REND VRAIMENT.
 *
 * ⚠️ ELLES SONT EN TETE, ET ELLES SONT LES SEULES A PORTER UNE LICENCE ET UNE
 * RESSOURCE. Les cinquante-deux familles Google qui suivent gardent leur
 * `licence: null` et leur `ressourceServeur: null` — l'aveu reste entier.
 * Celles-ci viennent du paquet `fonts-liberation` que le Dockerfile installe :
 * leur licence autorise l'incrustation et la redistribution, et leurs fichiers
 * existent dans l'image.
 *
 * Sans cette entree, le validateur du profil refusait `serif` et `mono` — donc
 * l'ecran proposait des polices que le profil remettait aussitot a `null`, et
 * le rendu retombait sur `sans` sans que rien ne le dise.
 */
const POLICES_SERVEUR: readonly PoliceAutorisee[] = [
  {
    id: 'sans', nom: 'Sans serif', famille: 'Liberation Sans',
    poidsDisponibles: [400, 700], usage: 'text',
    licence: 'SIL Open Font License 1.1',
    ressourceServeur: '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  },
  {
    id: 'serif', nom: 'Serif', famille: 'Liberation Serif',
    poidsDisponibles: [400, 700], usage: 'text',
    licence: 'SIL Open Font License 1.1',
    ressourceServeur: '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf',
  },
  {
    id: 'mono', nom: 'Monospace', famille: 'Liberation Mono',
    poidsDisponibles: [400, 700], usage: 'text',
    licence: 'SIL Open Font License 1.1',
    ressourceServeur: '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf',
  },
];

const POLICES_CATALOGUE: readonly PoliceAutorisee[] = FONT_CATALOG.map((f) => ({
  id: slugPolice(f.family),
  nom: f.family,
  famille: f.family,
  poidsDisponibles: f.weights,
  usage: f.group,
  licence: null,
  ressourceServeur: null,
}));

export const POLICES_AUTORISEES: readonly PoliceAutorisee[] = [
  ...POLICES_SERVEUR, ...POLICES_CATALOGUE,
];

export const POLICE_IDS: readonly string[] = POLICES_AUTORISEES.map((p) => p.id);

export function policeParId(id: unknown): PoliceAutorisee | undefined {
  if (typeof id !== 'string') return undefined;
  return POLICES_AUTORISEES.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// LUT — looks colorimetriques
// ---------------------------------------------------------------------------

import { LOOKS_CREATIFS } from '@/lib/creatif/looks';
import { ANIMATIONS_TEXTE } from '@/lib/creatif/animations-texte';

export interface LutAutorisee {
  id: string;
  nom: string;
  description: string;
  /**
   * Le `.cube` que `lut3d` chargera. `null` : aucun fichier n'est encore
   * livre. Le contrat existe pour que l'etape 2 n'ait qu'a le remplir.
   *
   * ⚠️ JAMAIS RENSEIGNE DEPUIS LE NAVIGATEUR. Un `/path/file.cube` recu du
   * client serait un argument ffmpeg deguise.
   */
  ressourceServeur: string | null;
}

/**
 * Les looks proposes par Studiio.
 *
 * ⚠️ DES NOMS DE LOOK, PAS DES NOMS DE CLIENT. « cinema-warm » decrit une
 * intention colorimetrique et sert a tout le monde ; un « afroboost-cinema »
 * dans une liste partagee ferait entrer une marque dans le code de tous les
 * comptes. Un compte qui veut son propre look partira d'un de ceux-ci et
 * reglera son intensite — et le jour ou des LUT PAR COMPTE seront possibles,
 * elles vivront dans le stockage du compte, designees comme le logo : par un
 * couple compartiment/cle, pas par un identifiant grave ici.
 */
/**
 * ⚠️ LE CATALOGUE N'EST PLUS ECRIT ICI — IL EST DERIVE (lot A_3a).
 *
 * Les looks vivent dans `src/lib/creatif/looks.ts`, avec leur categorie,
 * leurs tags et leur description : c'est la bibliotheque que l'ecran
 * parcourt. Les recopier ici en ferait deux verites, et la seconde
 * divergerait au premier look ajoute — l'ecran en proposerait un que le
 * validateur du profil refuserait, sans que rien ne le dise.
 *
 * Ce module garde la FORME attendue par le profil (`LutAutorisee`), et rien
 * de plus. `ressourceServeur` est un NOM DE FICHIER, jamais un chemin : la
 * racine est fixee par `rendu-lut`.
 */
export const LUTS_AUTORISEES: readonly LutAutorisee[] = LOOKS_CREATIFS.map((l) => ({
  id: l.id,
  nom: l.nom,
  description: l.description,
  ressourceServeur: l.fichier,
}));

export const LUT_IDS: readonly string[] = LUTS_AUTORISEES.map((l) => l.id);

export function lutParId(id: unknown): LutAutorisee | undefined {
  if (typeof id !== 'string') return undefined;
  return LUTS_AUTORISEES.find((l) => l.id === id);
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export interface TransitionAutorisee {
  id: string;
  nom: string;
  categorie: 'coupe' | 'fondu' | 'mouvement' | 'effet';
  /** Les reglages que cette transition accepte. Les autres seront ignores. */
  parametres: readonly ('dureeMs' | 'intensite')[];
}

/**
 * ⚠️ UNE TRANSITION EST UNE PROPRIETE DU RENDU, PAS DU PLAN.
 *
 * `m3g-v2` decide OU couper ; une transition decide COMMENT la coupe se voit.
 * Changer de transition ne doit donc jamais recalculer un plan, ni changer
 * `ALGORITHME_PLAN`. C'est la meme separation que celle de la recette audio,
 * et elle est testee.
 */
export const TRANSITIONS_AUTORISEES: readonly TransitionAutorisee[] = [
  { id: 'cut', nom: 'Coupe franche', categorie: 'coupe', parametres: [] },
  { id: 'crossfade', nom: 'Fondu enchaine', categorie: 'fondu', parametres: ['dureeMs'] },
  { id: 'zoom', nom: 'Zoom', categorie: 'mouvement', parametres: ['dureeMs', 'intensite'] },
  { id: 'flash', nom: 'Flash', categorie: 'effet', parametres: ['dureeMs', 'intensite'] },
  { id: 'slide', nom: 'Glissement', categorie: 'mouvement', parametres: ['dureeMs'] },
  { id: 'blur', nom: 'Flou', categorie: 'effet', parametres: ['dureeMs', 'intensite'] },
  { id: 'whip', nom: 'Whip pan', categorie: 'mouvement', parametres: ['dureeMs', 'intensite'] },
];

export const TRANSITION_IDS: readonly string[] = TRANSITIONS_AUTORISEES.map((t) => t.id);

export function transitionParId(id: unknown): TransitionAutorisee | undefined {
  if (typeof id !== 'string') return undefined;
  return TRANSITIONS_AUTORISEES.find((t) => t.id === id);
}

// ---------------------------------------------------------------------------
// Animations
// ---------------------------------------------------------------------------

export interface AnimationAutorisee {
  id: string;
  nom: string;
  categorie: 'aucune' | 'fondu' | 'mouvement' | 'echelle';
}

/**
 * ⚠️ LE CATALOGUE D'ANIMATIONS EST DERIVE (lot A_3c), plus ecrit ici.
 *
 * Il vivait ici en six entrees decoratives — `none`, `fade`, `slide-up`,
 * `scale`, `pop`, `bounce-soft` — qu'AUCUN rendu ne consommait. Les vraies
 * animations, avec leur geste et leur duree, vivent dans
 * `src/lib/creatif/animations-texte.ts`.
 *
 * ⚠️ LES ANCIENS IDENTIFIANTS NE SONT PAS REPRIS, ET C'EST VOULU. Un profil
 * qui portait `fade` retombe sur « Aucune » — donc sur EXACTEMENT le rendu
 * qu'il avait, puisque aucune de ces six valeurs n'etait rendue. Les
 * remapper vers les nouvelles animations aurait anime des videos que
 * personne n'a demande d'animer.
 */
export const ANIMATIONS_AUTORISEES: readonly AnimationAutorisee[] =
  ANIMATIONS_TEXTE.map((a) => ({
    id: a.id,
    nom: a.nom,
    categorie: a.categorie === 'sobre' && a.id === 'aucune' ? 'aucune' : 'mouvement',
  })) as readonly AnimationAutorisee[];

export const ANIMATION_IDS: readonly string[] = ANIMATIONS_AUTORISEES.map((a) => a.id);

/** L'animation qui ne fait rien — le comportement d'avant ce lot. */
export const ANIMATION_AUCUNE = 'aucune' as const;

export function animationParId(id: unknown): AnimationAutorisee | undefined {
  if (typeof id !== 'string') return undefined;
  return ANIMATIONS_AUTORISEES.find((a) => a.id === id);
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * Le point d'extension des presets — « Fitness », « Cinema », « Podcast »…
 *
 * ⚠️ VIDE, ET C'EST VOLONTAIRE. Un preset n'est qu'un profil creatif partiel
 * pre-rempli : il n'a besoin d'AUCUNE structure de plus que celle qui existe
 * deja. Ce qui manquerait le jour ou on voudrait en ajouter un, c'est un
 * endroit ou ranger « de quel preset ce profil est parti » — d'ou le champ
 * `presetId` du profil, valide contre cette liste. La liste peut rester vide
 * des annees sans que rien ne casse : `presetId` vaut alors toujours `null`.
 */
export const PRESETS_AUTORISES: readonly { id: string; nom: string }[] = [];

export const PRESET_IDS: readonly string[] = PRESETS_AUTORISES.map((p) => p.id);
