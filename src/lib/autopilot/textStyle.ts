import { findFont } from '@/lib/fonts/catalog';
import { ALL_LUCIDE_NAMES } from '@/lib/icons/library';

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
}

export interface AutopilotDesignStyle {
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
  subtitle?: Pick<AutopilotTextZone, 'font' | 'scale'>;
  cta?: AutopilotTextZone;
  /** Icône lucide imposée à la carte de rang N, par index (`"0"`, `"1"`…). */
  cardIcons?: Record<string, string>;
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
  });
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
    title: zone(o.title, true),
    // La position du sous-titre est retirée par `zone(..., false)` : voir le
    // commentaire du champ.
    subtitle: sousTitre as AutopilotDesignStyle['subtitle'],
    cta: zone(o.cta, true),
    cardIcons: icones(o.cardIcons),
  }) ?? {};
}

/** Le style impose-t-il quoi que ce soit ? */
export function designStyleIsEmpty(style: AutopilotDesignStyle | undefined | null): boolean {
  return !style || Object.keys(style).length === 0;
}
