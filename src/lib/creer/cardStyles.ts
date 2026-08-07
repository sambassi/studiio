/**
 * Les styles de carte — LA liste, en module FEUILLE.
 *
 * ⚠️ ELLE VIVAIT DANS `DesignOption.tsx`, UN COMPOSANT `'use client'`. Le
 * validateur de l'Autopilote (`textStyle.ts`) doit connaître les libellés
 * acceptés, et il est lu par le CRON : importer un composant React depuis le
 * serveur pour trois chaînes de caractères est exactement le genre de chaîne
 * d'imports qui a déjà cassé un build (cf. `tasks/lessons.md`, 2026-08-07 —
 * une constante d'une ligne entraînait un client S3 entier).
 *
 * `DesignOption` dérive désormais ses options d'ici : une seule liste, deux
 * lecteurs.
 *
 * ⚠️ LES LIBELLÉS SONT DES IDENTIFIANTS. Le compositeur canvas branche dessus
 * (`if (cardStyle === 'Text Only')`) et ils sont écrits dans le `design` des
 * posts déjà en base. Les traduire ou les renommer changerait le rendu de
 * l'existant en silence — le libellé français vit dans `sublabel`.
 */

export interface CardStyleDef {
  /** Identifiant ET libellé technique — écrit en base, lu par le compositeur. */
  label: string;
  /** Ce que l'utilisateur lit. */
  sublabel: string;
  /** Clé d'icône de `DESIGN_ICON_PATHS`. */
  icon: string;
}

/**
 * Style de carte par défaut.
 *
 * ⚠️ « Compact » ET NON « Full Width ». L'écran figeait `'Compact'` en dur ;
 * le compositeur, lui, retombe sur `'Full Width'` quand rien n'est fourni.
 * Tout montage produit par « Créer simple » a donc été rendu en Compact, et
 * c'est cette valeur-là qu'il faut garder pour ne rien changer à l'existant.
 */
export const DEFAULT_CARD_STYLE = 'Compact';

/** Le style qui retire le cadre — texte et icône seuls, sur le fond. */
export const CARD_STYLE_TEXT_ONLY = 'Text Only';

export const CARD_STYLES: readonly CardStyleDef[] = Object.freeze([
  { icon: 'card_compact', label: 'Compact', sublabel: 'Par defaut' },
  { icon: 'card_compact', label: 'Educatif', sublabel: 'Detaille' },
  { icon: 'card_stats', label: 'Stats Bold', sublabel: 'Chiffres' },
  { icon: 'card_minimal', label: 'Minimal Line', sublabel: 'Epure' },
  { icon: 'card_fullwidth', label: 'Full Width', sublabel: 'Large' },
  { icon: 'card_minimal', label: CARD_STYLE_TEXT_ONLY, sublabel: 'Sans cadre' },
]);

/** Les libellés acceptés — pour valider ce qui vient de la base ou de l'écran. */
export const CARD_STYLE_NAMES: readonly string[] = Object.freeze(
  CARD_STYLES.map((s) => s.label),
);

/** Le style demandé s'il existe, sinon le défaut. */
export function sanitizeCardStyle(brut: unknown, parDefaut = DEFAULT_CARD_STYLE): string {
  return typeof brut === 'string' && CARD_STYLE_NAMES.includes(brut) ? brut : parDefaut;
}

/**
 * Ce style retire-t-il le cadre ?
 *
 * Une fonction plutôt qu'une comparaison recopiée : les deux moteurs de rendu
 * la posent, et une comparaison écrite deux fois est une comparaison qui
 * finira par différer d'une majuscule.
 */
export function isFrameless(cardStyle: string | undefined | null): boolean {
  return cardStyle === CARD_STYLE_TEXT_ONLY;
}
