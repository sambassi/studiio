/**
 * Médias STOCK — le contrat commun à Créer et à l'Autopilote.
 *
 * ⚠️ UN SEUL MOTEUR. Créer (recherche guidée) et l'Autopilote (compléter les
 * rushes) passent tous deux par `searchStockMedia` : mêmes adaptateurs, même
 * cache, même classement. La route historique `/api/pexels` (recherche
 * manuelle de photos) reste intacte : elle n'est pas remplacée, seulement
 * complétée.
 *
 * ⚠️ CAPACITÉS RÉELLES. Pexels fournit des photos ET des vidéos ; Unsplash ne
 * fournit QUE des photos. Une photo Unsplash n'est jamais présentée comme une
 * vidéo : demander `type: 'video'` à Unsplash ne renvoie rien.
 */

export type FournisseurStock = 'pexels' | 'unsplash';
export type TypeStock = 'photo' | 'video';
export type OrientationStock = 'portrait' | 'landscape' | 'square';
export type FormatStock = '9:16' | '16:9' | '1:1';

/** Ce que chaque fournisseur sait réellement servir. */
export const CAPACITES_FOURNISSEUR: Record<FournisseurStock, ReadonlyArray<TypeStock>> = {
  pexels: ['photo', 'video'],
  unsplash: ['photo'],
};

/**
 * Un média stock, tel que l'écran l'affiche et tel qu'on le conserve.
 *
 * Les URL d'APERÇU (vignette, image moyenne) servent à la grille ; le fichier
 * HD d'une vidéo (`fichierUrl`) n'est téléchargé qu'à la sélection réelle.
 */
export interface MediaStock {
  /** `${provider}-${type}-${providerAssetId}` — stable, sert au dédoublonnage. */
  id: string;
  provider: FournisseurStock;
  providerAssetId: string;
  type: TypeStock;
  largeur: number;
  hauteur: number;
  orientation: OrientationStock;
  /** Durée d'une vidéo, en secondes. */
  dureeSecondes?: number;
  /** Petite image pour la grille. */
  vignetteUrl: string;
  /** Image moyenne (photo) ou image d'aperçu (vidéo). */
  apercuUrl: string;
  /** Photo : l'URL à afficher en grand (hotlink exigé par Unsplash). Vidéo : le fichier MP4 choisi (≤ 1080p). */
  fichierUrl: string;
  /** Page du média chez le fournisseur. */
  sourceUrl: string;
  auteur: string;
  auteurUrl?: string;
  /** Texte alternatif / mots du titre, pour juger la pertinence. */
  description: string;
  licence: string;
  /** « Photo de X sur Pexels » — à afficher quand le média est montré. */
  attribution: string;
  /** Unsplash : endpoint à signaler quand l'utilisateur CHOISIT la photo. */
  downloadLocation?: string;
}

/** Un refus fournisseur, distinct d'une recherche vide. */
export type MotifEchecStock = 'non_configure' | 'quota' | 'refus' | 'indisponible';

export interface EchecStock {
  provider: FournisseurStock;
  motif: MotifEchecStock;
}

export interface ResultatRechercheStock {
  medias: MediaStock[];
  /** Fournisseurs tombés — jamais bloquant : les autres résultats restent. */
  echecs: EchecStock[];
  requete: string;
}

export function orientationDuFormat(format: FormatStock): OrientationStock {
  return format === '16:9' ? 'landscape' : format === '1:1' ? 'square' : 'portrait';
}

export function orientationDesDimensions(largeur: number, hauteur: number): OrientationStock {
  if (!largeur || !hauteur) return 'portrait';
  const r = largeur / hauteur;
  if (r > 1.15) return 'landscape';
  if (r < 0.87) return 'portrait';
  return 'square';
}
