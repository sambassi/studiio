/**
 * Types d'une LUT (table de correspondance couleur), définis UNE SEULE FOIS.
 *
 * `ImageFilters` a été dupliqué en trois endroits du dépôt
 * (`ImageEditorPanel.tsx`, `video-composer.ts`, `creer/page.tsx`) et les
 * copies ont divergé. Ce fichier est la source unique : tout consommateur
 * (aperçu, compositeur, persistance, bibliothèque, moteur de rendu) importe
 * d'ici — Créer comme Autopilote.
 */

/**
 * Taille de cube 3D maximale acceptée.
 *
 * 65, et non 64 : DaVinci Resolve exporte en 33 ou **65** pas par défaut.
 * Un plafond à 64 refusait donc une part des LUT du commerce sans qu'on le
 * voie. Un 65³ pèse ~7 Mo en texte, sous `MAX_LUT_BYTES`.
 */
export const MAX_LUT_SIZE = 65;

/**
 * Nombre de points maximal d'une LUT 1D — la borne de la SPÉCIFICATION.
 *
 * La « Cube LUT Specification 1.0 » (Adobe/IRIDAS) autorise `LUT_1D_SIZE`
 * de 2 à 65536. Une 1D est une courbe par canal, pas un cube : lui
 * appliquer le plafond du cube refuserait presque toutes les 1D réelles, et
 * une borne « raisonnable » inventée ici transformerait un exemple fréquent
 * (4096) en limite artificielle de Studiio. Aucune allocation du parseur ne
 * dépend de la taille déclarée : le seul coût réel est le poids du fichier,
 * gardé SÉPARÉMENT par `MAX_LUT_BYTES`.
 */
export const MAX_LUT_1D_SIZE = 65536;

/**
 * Taille de fichier maximale acceptée à l'import, en octets (8 Mio).
 *
 * Garde INDÉPENDANTE de la validité structurelle : un fichier structurellement
 * valide qui dépasse ce poids est refusé pour son poids, jamais en réduisant
 * la spécification du format.
 */
export const MAX_LUT_BYTES = 8 * 1024 * 1024;

/** Longueur d'une empreinte SHA-256 en hexadécimal. */
export const EMPREINTE_LUT_LONGUEUR = 64;

export interface Lut {
  /**
   * `'3d'` : cube complet, `size³` triplets.
   * `'1d'` : une courbe par canal, `size` triplets. Conservé tel quel plutôt
   * qu'étendu en cube — une 1D de 65536 points ne rentre dans aucun cube.
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

/** Ce que la personne a déposé. La forme STOCKÉE, elle, est toujours un `.cube`. */
export type OrigineLut = 'cube' | 'png';

/**
 * Fiche d'une LUT importée, une par (compte, empreinte).
 *
 * C'est le type métier CANONIQUE, partagé par le wizard Créer, l'Autopilote,
 * la bibliothèque et le moteur de rendu. Elle décrit un objet PRIVÉ du
 * stockage ; elle ne porte jamais d'URL publique — l'identité est
 * l'empreinte, l'accès passe par une route authentifiée.
 */
export interface LutAsset {
  /**
   * SHA-256 hexadécimal des octets `.cube` CANONIQUES, tels que stockés.
   *
   * C'est l'identité ET la clé de déduplication. Jamais calculée sur le nom,
   * ni sur la table parsée : deux écritures différentes du même cube — un
   * espace de plus, un commentaire — sont deux fichiers.
   */
  empreinte: string;
  /**
   * Clé de l'objet privé dans le compartiment du compte.
   * Construite par le serveur (`cleLutAsset`), jamais reçue du navigateur.
   */
  cle: string;
  /** Nom affiché. Modifiable sans toucher à l'objet. */
  nom: string;
  /** Le `TITLE` déclaré dans le fichier, s'il y en avait un. */
  titre: string | null;
  kind: Lut['kind'];
  origine: OrigineLut;
  /** Nombre de pas par axe (3D) ou de points (1D). */
  taille: number;
  /** Poids des octets canoniques stockés. */
  octets: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  /** ISO 8601. */
  importeeLe: string;
}

/**
 * Référence LÉGÈRE d'une LUT, celle qui va dans les brouillons, le
 * `metadata` des posts et le profil Autopilote. Jamais la table, jamais une
 * URL : l'empreinte désigne la fiche, la fiche désigne l'objet.
 */
export interface LutRef {
  empreinte: string;
  /** Recopié pour l'affichage sans relire la bibliothèque. */
  nom: string;
  /** Intensité du mélange avec l'image d'origine, 0 → 1. */
  intensite: number;
}

/**
 * Ce qu'un moteur sait faire d'une LUT, DÉRIVÉ par `supportDeLut` — jamais
 * décidé dans une interface. L'UI ne doit jamais laisser croire qu'un format
 * sera appliqué au montage s'il ne l'est pas.
 *
 * - `ready` : appliquée au rendu final.
 * - `preview-only` : visible dans l'aperçu, pas encore au rendu.
 * - `unsupported-render` : importable et conservée, sans effet visible.
 */
export type SupportLut = 'ready' | 'preview-only' | 'unsupported-render';
