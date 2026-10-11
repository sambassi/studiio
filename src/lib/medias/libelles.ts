/**
 * LIBELLÉS DES MÉDIAS — ce que l'utilisateur lit, jamais la technique.
 *
 * ⚠️ RÈGLE PRODUIT : l'utilisateur ne voit JAMAIS le fournisseur technique
 * (banque d'images, moteur d'IA) ni un nom de fichier comme libellé principal.
 * Un média se dit par ce qu'il EST pour lui : « Rush personnel », « Vidéo
 * suggérée », « Photo suggérée », « Ma médiathèque », « Généré avec l'IA ».
 *
 * ⚠️ SEULE EXCEPTION : LES CRÉDITS. Les conditions des banques d'images
 * exigent d'attribuer l'auteur et la plateforme quand le média est montré.
 * Ces mentions vivent dans des éléments marqués `data-credit-media`
 * (« Informations du média » dans l'aperçu, pied de recherche) — discrètes,
 * et exclues des contrôles « aucun fournisseur à l'écran ».
 *
 * Partagé : l'Autopilote l'utilise ; Créer pourra le reprendre tel quel.
 */

/** D'où vient un média, du point de vue de l'utilisateur. */
export type OrigineMedia = 'rush' | 'video-suggeree' | 'photo-suggeree' | 'mediatheque' | 'ia';

export const LIBELLES_ORIGINE: Record<OrigineMedia, string> = {
  rush: 'Rush personnel',
  'video-suggeree': 'Vidéo suggérée',
  'photo-suggeree': 'Photo suggérée',
  mediatheque: 'Ma médiathèque',
  ia: 'Généré avec l’IA',
};

/** « Vidéo suggérée » / « Photo suggérée » selon le type d'un média de banque d'images. */
export function origineSuggeree(type: 'video' | 'photo'): OrigineMedia {
  return type === 'video' ? 'video-suggeree' : 'photo-suggeree';
}

/** Le pied des recherches — la mention collective exigée, en petit. */
export const CREDIT_FOURNISSEURS = 'Photos et vidéos fournies par Pexels et Unsplash';

function nomPlateforme(provider: string): string {
  return provider === 'unsplash' ? 'Unsplash' : 'Pexels';
}

/**
 * « Photo de X sur Unsplash » — l'attribution d'UN média, affichée seulement
 * dans « Informations du média » (élément `data-credit-media`).
 */
export function creditMedia(m: { type: string; auteur?: string | null; provider: string }): string {
  return `${m.type === 'video' ? 'Vidéo' : 'Photo'} de ${m.auteur || 'auteur inconnu'} sur ${nomPlateforme(m.provider)}`;
}

/** « 0:12 » — une durée lisible ; vide si inconnue. */
export function dureeLisible(s?: number | null): string {
  if (s == null || !Number.isFinite(s) || s <= 0) return '';
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** Le nom technique d'un fichier — réservé à l'attribut `title`, jamais au libellé. */
export function nomTechnique(url: string): string {
  try { return decodeURIComponent(new URL(url).pathname.split('/').pop() || url); } catch { return url.split('/').pop() || url; }
}

/** Les mots que l'écran ne doit jamais montrer hors crédits. */
export const NOMS_FOURNISSEURS = /pexels|unsplash/i;
