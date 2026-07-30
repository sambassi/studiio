/**
 * Type d'une LUT (table de correspondance couleur), défini UNE SEULE FOIS.
 *
 * `ImageFilters` a été dupliqué en trois endroits du dépôt
 * (`ImageEditorPanel.tsx`, `video-composer.ts`, `creer/page.tsx`) et les
 * copies ont divergé. Ce fichier est la source unique : tout consommateur
 * (aperçu, compositeur, persistance) importe d'ici.
 */

/** Taille de cube maximale acceptée. Un 64³ pèse déjà ~6 Mo en texte. */
export const MAX_LUT_SIZE = 64;

/** Taille de fichier maximale acceptée à l'import, en octets. */
export const MAX_LUT_BYTES = 8 * 1024 * 1024;

export interface Lut {
  /**
   * `'3d'` : cube complet, `size³` triplets.
   * `'1d'` : une courbe par canal, `size` triplets. Conservé tel quel plutôt
   * qu'étendu en cube — une 1D de 4096 points ne rentre dans aucun cube.
   */
  kind: '3d' | '1d';
  /** Nombre de pas par axe. */
  size: number;
  /**
   * Valeurs de sortie, en flottants, dans l'ordre imposé par le format
   * `.cube` : **le rouge varie le plus vite**, puis le vert, puis le bleu.
   * Index du triplet (r,g,b) = `((b * size + g) * size + r) * 3`.
   */
  table: Float32Array;
  title?: string;
  /**
   * Disposition retenue quand la LUT vient d'une image. Renseigné par
   * `parseLutPng`, qui doit trancher entre deux dispositions de MÊME taille.
   */
  layout?: 'hald' | 'tiles';
  domainMin: [number, number, number];
  domainMax: [number, number, number];
}

/**
 * Référence persistée d'une LUT — c'est CELA qui va dans `design.lut` et dans
 * le brouillon, jamais la table parsée. Une `.cube` de 6 Mo en data URL
 * ferait sauter le quota `localStorage` (échec silencieux de l'auto-sauvegarde)
 * et partirait dans le `metadata` de chaque post.
 */
export interface LutRef {
  /** URL de stockage du fichier d'origine (jamais une data URL). */
  url: string;
  /** Nom affiché à l'utilisateur. */
  name: string;
  /** Intensité du mélange avec l'image d'origine, 0 → 1. */
  intensity: number;
}
