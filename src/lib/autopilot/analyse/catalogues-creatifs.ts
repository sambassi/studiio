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
import { FONT_CATALOG, type FontGroup } from '@/lib/fonts/catalog';

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

export const POLICES_AUTORISEES: readonly PoliceAutorisee[] = FONT_CATALOG.map((f) => ({
  id: slugPolice(f.family),
  nom: f.family,
  famille: f.family,
  poidsDisponibles: f.weights,
  usage: f.group,
  licence: null,
  ressourceServeur: null,
}));

export const POLICE_IDS: readonly string[] = POLICES_AUTORISEES.map((p) => p.id);

export function policeParId(id: unknown): PoliceAutorisee | undefined {
  if (typeof id !== 'string') return undefined;
  return POLICES_AUTORISEES.find((p) => p.id === id);
}

// ---------------------------------------------------------------------------
// LUT — looks colorimetriques
// ---------------------------------------------------------------------------

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
export const LUTS_AUTORISEES: readonly LutAutorisee[] = [
  { id: 'neutral', nom: 'Neutre', description: 'Aucune correction — l\'image du rush.', ressourceServeur: null },
  { id: 'clean', nom: 'Clean', description: 'Contraste doux, peaux naturelles.', ressourceServeur: null },
  { id: 'vibrant', nom: 'Vibrant', description: 'Saturation soutenue, couleurs franches.', ressourceServeur: null },
  { id: 'cinema-warm', nom: 'Cinema chaud', description: 'Hautes lumieres ambrees, ombres denses.', ressourceServeur: null },
  { id: 'cinema-cool', nom: 'Cinema froid', description: 'Bleus profonds, rendu nocturne.', ressourceServeur: null },
];

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

export const ANIMATIONS_AUTORISEES: readonly AnimationAutorisee[] = [
  { id: 'none', nom: 'Aucune', categorie: 'aucune' },
  { id: 'fade', nom: 'Fondu', categorie: 'fondu' },
  { id: 'slide-up', nom: 'Glisse vers le haut', categorie: 'mouvement' },
  { id: 'scale', nom: 'Echelle', categorie: 'echelle' },
  { id: 'pop', nom: 'Pop', categorie: 'echelle' },
  { id: 'bounce-soft', nom: 'Rebond doux', categorie: 'mouvement' },
];

export const ANIMATION_IDS: readonly string[] = ANIMATIONS_AUTORISEES.map((a) => a.id);

/** L'animation qui ne fait rien — le comportement d'avant ce lot. */
export const ANIMATION_AUCUNE = 'none' as const;

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
