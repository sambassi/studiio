/**
 * Mon avatar — la taille du LECTEUR 9:16 quand le formulaire de génération est
 * sous lui, dans la colonne d'aperçu collante. Le lecteur est borné en LARGEUR
 * selon la hauteur d'écran (ratio intact, jamais rogné) pour que lecteur,
 * texte, voix, format et « Générer la vidéo » tiennent ensemble dès
 * l'ouverture, sans défilement.
 *
 * Dans `lib/ui` : Tailwind analyse ce dossier (classe compilée en production).
 * Module pur : la page pose `CLASSE_LECTEUR_GENERATION`, le test vérifie le
 * budget de hauteur avec les mêmes constantes.
 */
export const LECTEUR_LARGEUR_MIN_PX = 130;
export const LECTEUR_LARGEUR_MAX_PX = 200;
/** Hauteur retirée à l'écran avant de convertir en largeur 9:16. */
export const LECTEUR_RETRAIT_REM = 34;

/**
 * Littérale (Tailwind ne compile que des classes écrites en toutes lettres) ;
 * le test vérifie qu'elle reprend exactement les trois constantes ci-dessus.
 */
export const CLASSE_LECTEUR_GENERATION = 'lg:[&_.apercu-cadre]:max-w-[clamp(130px,calc((100vh_-_34rem)*9/16),200px)]';

/** La largeur du lecteur (px) pour une hauteur d'écran donnée — le même calcul que la classe. */
export function largeurLecteur(hauteurEcranPx: number): number {
  const libre = ((hauteurEcranPx - LECTEUR_RETRAIT_REM * 16) * 9) / 16;
  return Math.min(LECTEUR_LARGEUR_MAX_PX, Math.max(LECTEUR_LARGEUR_MIN_PX, libre));
}
