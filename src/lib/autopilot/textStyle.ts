import { findFont } from '@/lib/fonts/catalog';
import { ALL_LUCIDE_NAMES } from '@/lib/icons/library';
import {
  TEXT_CASES, TEXT_ALIGNS, type TextCase, type TextAlign,
} from '@/lib/creer/textFormat';
import { CARD_STYLE_NAMES } from '@/lib/creer/cardStyles';

/**
 * Le style de texte CONSTANT de l'Autopilote — police, taille, position,
 * icônes de cartes.
 *
 * ⚠️ MODULE FEUILLE, ET C'EST DÉLIBÉRÉ. Il est lu par l'écran (navigateur),
 * par la route de configuration et par le cron. Il n'importe donc que des
 * données : le catalogue de polices et la liste d'icônes, tous deux sans accès
 * au DOM au chargement. La leçon du 2026-08-07 a été payée une fois — un
 * import qui traîne la chaîne serveur casse le build client sans qu'aucun test
 * ne le voie.
 *
 * ⚠️ UNE SEULE COLONNE JSONB, PAS DIX COLONNES. Ces réglages sont nombreux
 * (quatre zones × sept propriétés) et destinés à grandir. Une colonne par
 * propriété aurait imposé une migration à chaque ajout, et une migration
 * oubliée se lit en production comme une fonctionnalité qui ne marche pas.
 *
 * ⚠️ `{}` EST LE COMPORTEMENT ACTUEL. Une valeur absente n'est jamais
 * remplacée par un défaut inventé ici : elle reste absente, et
 * `buildAutopilotDesign` garde le sien. C'est ce qui rend l'ajout
 * rétro-compatible pour toutes les configurations existantes.
 */

/** Réglages d'une zone de texte. Toute propriété absente = « ne rien imposer ». */
export interface AutopilotTextZone {
  font?: string;
  /** Échelle du texte, 1 = taille d'origine. */
  scale?: number;
  /** Position de l'ancre, en % du cadre. */
  x?: number;
  y?: number;
  bold?: boolean;
  italic?: boolean;
  letterSpacing?: number;
  lineHeight?: number;
  /**
   * Casse, alignement, souligné et barré.
   *
   * ⚠️ ABSENTS = LE RENDU D'AVANT. Les composants partagés retombent alors sur
   * capitales pour le titre et le CTA, aucune décoration, alignement
   * historique. Ne rien écrire est donc bien un état, pas un trou.
   */
  textCase?: TextCase;
  align?: TextAlign;
  underline?: boolean;
  strike?: boolean;
}

/**
 * Les deux SEULS réglages de montage que le moteur des rushes honore.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ DEUX, ET PAS TROIS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * M3-H concatène des morceaux de rush recadrés — sa commande ffmpeg n'a ni
 * `drawtext`, ni `overlay`, ni `amix`, ni `lut3d`. Un réglage de titre, de
 * musique, de voix ou de look serait donc affiché, enregistré… et ignoré au
 * rendu. Le format et la durée cible, eux, sont de vrais paramètres de
 * `POST /clips/[id]/montage` : ce sont les seuls qui méritent un contrôle.
 *
 * ⚠️ LES VALEURS SONT REVALIDÉES ICI, ET ELLES DOIVENT RESTER ALIGNÉES SUR
 * `montage-contrat`. Elles sont recopiées plutôt qu'importées : ce module est
 * lu par la configuration, qui n'a aucune raison de tirer `clip-contrat` et
 * `designSpec` derrière elle. Un test compare les deux listes — c'est lui qui
 * garantit l'alignement, pas une arête d'import.
 */
export interface AutopilotMontageStyle {
  /** `9:16`, `1:1` ou `16:9` — les trois formats de `FORMATS_MONTAGE`. */
  format: string;
  /** Entre 1 et 120 secondes, les bornes de `dureeCibleValide`. */
  dureeSecondes: number;
}

/** Les formats acceptés, recopiés de `FORMATS_MONTAGE`. */
export const MONTAGE_FORMATS: readonly string[] = ['9:16', '1:1', '16:9'];
/** Les bornes acceptées, recopiées de `DUREE_CIBLE_MIN/MAX_SECONDES`. */
export const MONTAGE_DUREE_MIN = 1;
export const MONTAGE_DUREE_MAX = 120;

/**
 * Ce qu'on utilise quand l'utilisateur n'a jamais rien choisi.
 *
 * ⚠️ RÉTRO-COMPATIBLE : c'est exactement ce que `chaine-passerelle` envoyait
 * en dur avant ce lot. Une configuration existante, qui ne porte aucun
 * `montage`, produit donc le MÊME montage qu'hier.
 */
export const MONTAGE_DEFAUT: AutopilotMontageStyle = {
  format: '9:16',
  dureeSecondes: 30,
};

function montage(brut: unknown): AutopilotMontageStyle | undefined {
  if (!brut || typeof brut !== 'object') return undefined;
  const o = brut as Record<string, unknown>;
  const f = typeof o.format === 'string' && MONTAGE_FORMATS.includes(o.format)
    ? o.format : null;
  const d = typeof o.dureeSecondes === 'number' && Number.isFinite(o.dureeSecondes)
    && o.dureeSecondes >= MONTAGE_DUREE_MIN && o.dureeSecondes <= MONTAGE_DUREE_MAX
    ? o.dureeSecondes : null;
  // ⚠️ TOUT OU RIEN. Un format valide avec une durée aberrante donnerait un
  // réglage à moitié appliqué, et le montage suivant ne ressemblerait ni à ce
  // qui est affiché ni au défaut.
  if (f === null || d === null) return undefined;
  return { format: f, dureeSecondes: d };
}

/**
 * Le réglage de montage à utiliser, défaut compris.
 *
 * Un appelant n'a ainsi jamais à connaître `MONTAGE_DEFAUT` ni à écrire un
 * `??` de plus — c'est là que la rétro-compatibilité est garantie une fois.
 */
export function montageDepuisStyle(
  style: AutopilotDesignStyle | undefined | null,
): AutopilotMontageStyle {
  return style?.montage ?? MONTAGE_DEFAUT;
}

export interface AutopilotDesignStyle {
  /**
   * Format et durée du montage de rushes. Absent = les valeurs par défaut.
   *
   * Vit dans `designStyle` — un `jsonb` déjà en base — et non dans une colonne
   * nouvelle : aucune migration n'est nécessaire pour un réglage de plus.
   */
  montage?: AutopilotMontageStyle;
  title?: AutopilotTextZone;
  /**
   * Sous-titre — police et taille SEULEMENT.
   *
   * ⚠️ IL N'A PAS DE POSITION PROPRE, ET CE N'EST PAS UN OUBLI. `SequenceTitle`
   * le rend DANS le cadre du titre, et `CreerSimpleMontage` n'expose aucun
   * `subtitlePos`. Accepter un `x`/`y` ici écrirait un réglage que le rendu
   * ignore : l'utilisateur déplacerait son sous-titre à l'écran et le
   * retrouverait au même endroit dans la vidéo.
   */
  subtitle?: Pick<
    AutopilotTextZone,
    'font' | 'scale' | 'textCase' | 'align' | 'underline' | 'strike'
  >;
  cta?: AutopilotTextZone;
  /**
   * Texte des CARTES — police, taille, graisse, casse, alignement.
   *
   * ⚠️ PAS DE POSITION : les cartes se placent en flux ou par
   * `cardBoxes`, jamais par une ancre en pourcentage. Accepter un x/y
   * écrirait un réglage que le rendu ignore.
   */
  cards?: Pick<
    AutopilotTextZone,
    'font' | 'scale' | 'bold' | 'italic' | 'textCase' | 'align' | 'underline' | 'strike'
  >;
  /** Icône lucide imposée à la carte de rang N, par index (`"0"`, `"1"`…). */
  cardIcons?: Record<string, string>;
  /**
   * Style de carte — l'un des libellés de `CARD_STYLE_OPTIONS`.
   *
   * ⚠️ « Text Only » RETIRE LE CADRE, c'est le réglage demandé. Absent = le
   * rectangle, comme depuis toujours.
   */
  cardStyle?: string;
}



/** Bornes de l'échelle — les mêmes que le curseur de l'éditeur manuel (60–180 %). */
export const SCALE_MIN = 0.5;
export const SCALE_MAX = 3;

/** Interlettrage, en pixels de l'éditeur — mêmes bornes que le curseur manuel. */
export const LETTER_SPACING_MIN = -2;
export const LETTER_SPACING_MAX = 10;

/** Interligne — mêmes bornes que le curseur manuel. */
export const LINE_HEIGHT_MIN = 0.9;
export const LINE_HEIGHT_MAX = 2;

/** Au-delà, une carte n'existe pas : le Mode simple en produit cinq au plus. */
export const MAX_CARD_ICONS = 12;

function nombreBorne(brut: unknown, min: number, max: number): number | undefined {
  const n = Number(brut);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

function booleen(brut: unknown): boolean | undefined {
  return typeof brut === 'boolean' ? brut : undefined;
}

/**
 * Police retenue, ou rien.
 *
 * ⚠️ RESTREINTE AU CATALOGUE. Une famille écrite à la main — ou héritée d'un
 * catalogue plus ancien — ne serait chargée ni par l'aperçu ni par le rendu
 * serveur : le montage sortirait dans la police par défaut de Chromium, sans
 * la moindre erreur. Mieux vaut ignorer le réglage et garder le défaut connu.
 */
function police(brut: unknown): string | undefined {
  if (typeof brut !== 'string' || !brut.trim()) return undefined;
  return findFont(brut.trim())?.family;
}

/** Retire les propriétés absentes : `{}` doit rester `{}`, pas `{font: undefined}`. */
function compacter<T extends Record<string, unknown>>(o: T): T | undefined {
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) out[k] = v;
  }
  return Object.keys(out).length > 0 ? (out as T) : undefined;
}

function zone(brut: unknown, avecPosition: boolean): AutopilotTextZone | undefined {
  if (!brut || typeof brut !== 'object') return undefined;
  const o = brut as Record<string, unknown>;
  return compacter({
    font: police(o.font),
    scale: nombreBorne(o.scale, SCALE_MIN, SCALE_MAX),
    x: avecPosition ? nombreBorne(o.x, 0, 100) : undefined,
    y: avecPosition ? nombreBorne(o.y, 0, 100) : undefined,
    bold: avecPosition ? booleen(o.bold) : undefined,
    italic: avecPosition ? booleen(o.italic) : undefined,
    letterSpacing: avecPosition
      ? nombreBorne(o.letterSpacing, LETTER_SPACING_MIN, LETTER_SPACING_MAX)
      : undefined,
    lineHeight: avecPosition
      ? nombreBorne(o.lineHeight, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX)
      : undefined,
    // ⚠️ CASSE, ALIGNEMENT ET DECORATION VALENT AUSSI POUR LE SOUS-TITRE.
    // Contrairement a la POSITION, que le rendu n'expose pas pour lui, ces
    // quatre-la sont bien appliques par `SequenceTitle` et par le
    // compositeur canvas — les lui refuser serait un manque, pas une
    // prudence.
    textCase: TEXT_CASES.includes(o.textCase as TextCase) ? (o.textCase as TextCase) : undefined,
    align: TEXT_ALIGNS.includes(o.align as TextAlign) ? (o.align as TextAlign) : undefined,
    underline: booleen(o.underline),
    strike: booleen(o.strike),
  });
}

/**
 * Réglages du texte des cartes.
 *
 * ⚠️ COMME UNE ZONE, MOINS LA POSITION — mais AVEC la graisse et l'italique.
 * `zone(…, false)` les retire aussi, parce que le sous-titre les hérite du
 * titre ; les cartes, elles, portent les leurs. D'où cette fabrique propre
 * plutôt qu'un drapeau de plus dans la première.
 */
function zoneCartes(brut: unknown): AutopilotDesignStyle['cards'] {
  if (!brut || typeof brut !== 'object') return undefined;
  const o = brut as Record<string, unknown>;
  return compacter({
    font: police(o.font),
    scale: nombreBorne(o.scale, SCALE_MIN, SCALE_MAX),
    bold: booleen(o.bold),
    italic: booleen(o.italic),
    textCase: TEXT_CASES.includes(o.textCase as TextCase) ? (o.textCase as TextCase) : undefined,
    align: TEXT_ALIGNS.includes(o.align as TextAlign) ? (o.align as TextAlign) : undefined,
    underline: booleen(o.underline),
    strike: booleen(o.strike),
  }) as AutopilotDesignStyle['cards'];
}

/**
 * Icônes de cartes retenues.
 *
 * ⚠️ RESTREINTES À `ICON_LIBRARY`. Un nom inconnu rend une icône VIDE —
 * `CardIcon` n'a rien à résoudre — et la carte sort du montage avec un trou à
 * la place de son pictogramme. Et jamais d'emoji : la règle du dépôt est
 * absolue, un caractère Unicode ne passerait de toute façon pas ce filtre.
 */
function icones(brut: unknown): Record<string, string> | undefined {
  if (!brut || typeof brut !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [cle, valeur] of Object.entries(brut as Record<string, unknown>)) {
    const rang = Number(cle);
    if (!Number.isInteger(rang) || rang < 0 || rang >= MAX_CARD_ICONS) continue;
    if (typeof valeur !== 'string') continue;
    if (!ALL_LUCIDE_NAMES.includes(valeur)) continue;
    out[String(rang)] = valeur;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Nettoie un style relu de la base ou reçu de l'écran. */
export function sanitizeDesignStyle(brut: unknown): AutopilotDesignStyle {
  if (!brut || typeof brut !== 'object') return {};
  const o = brut as Record<string, unknown>;
  const sousTitre = zone(o.subtitle, false);
  return compacter({
    // ⚠️ SANS CETTE LIGNE, LE RÉGLAGE EST SILENCIEUSEMENT EFFACÉ à chaque
    // enregistrement : `compacter` ne garde que ce qui est nommé ici.
    montage: montage(o.montage),
    title: zone(o.title, true),
    // La position du sous-titre est retirée par `zone(..., false)` : voir le
    // commentaire du champ.
    subtitle: sousTitre as AutopilotDesignStyle['subtitle'],
    cta: zone(o.cta, true),
    // `false` : pas de position — voir le commentaire du champ. Graisse et
    // italique, eux, passent bien (le drapeau ne gouverne que x/y).
    cards: zoneCartes(o.cards),
    cardIcons: icones(o.cardIcons),
    // ⚠️ RESTREINT AUX LIBELLES DE L'ECRAN. Un libelle inconnu ne
    // correspondrait a aucune branche du compositeur, qui retomberait sur son
    // defaut — un style choisi et sans effet, ce qui est pire qu'un style
    // refuse.
    cardStyle: typeof o.cardStyle === 'string' && CARD_STYLE_NAMES.includes(o.cardStyle)
      ? o.cardStyle
      : undefined,
  }) ?? {};
}

/** Le style impose-t-il quoi que ce soit ? */
export function designStyleIsEmpty(style: AutopilotDesignStyle | undefined | null): boolean {
  return !style || Object.keys(style).length === 0;
}
