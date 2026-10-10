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

/**
 * LE FORMAT DU LECTEUR SUIT LE FORMAT CHOISI — 9:16, 16:9 ou 1:1. Le cadre
 * prend le ratio du bouton « Format » à l'instant où il change ; la vidéo y
 * est posée en `object-contain` (jamais étirée, jamais rognée).
 *
 * Même budget de hauteur que le 9:16 (`LECTEUR_RETRAIT_REM`) : le lecteur ne
 * dépasse jamais la hauteur libre au-dessus de « Générer la vidéo ».
 *   1:1  → côté = hauteur libre, entre 130 et 356 px (356 = la hauteur du 9:16 le plus grand) ;
 *   16:9 → largeur = hauteur libre × 16/9, au moins 231 px (la hauteur la plus basse
 *          du 9:16, 130 px), et jamais plus large que la colonne.
 */
export type FormatLecteur = '9:16' | '16:9' | '1:1';
export const FORMATS_LECTEUR: readonly FormatLecteur[] = ['9:16', '16:9', '1:1'];
export const LECTEUR_CARRE_MAX_PX = 356;
export const LECTEUR_PAYSAGE_MIN_PX = 231;

/** Les classes littérales, une par format (Tailwind ne compile que ce qu'il lit). */
export const CLASSES_LECTEUR_GENERATION: Record<FormatLecteur, string> = {
  '9:16': CLASSE_LECTEUR_GENERATION,
  '1:1': 'lg:[&_.apercu-cadre]:max-w-[clamp(130px,calc(100vh_-_34rem),356px)]',
  '16:9': 'lg:[&_.apercu-cadre]:max-w-[max(231px,calc((100vh_-_34rem)*16/9))]',
};

/** `'16:9'` → `'16 / 9'` : le ratio CSS du cadre. */
export function ratioCadre(format: FormatLecteur): string {
  return format === '16:9' ? '16 / 9' : format === '1:1' ? '1 / 1' : '9 / 16';
}

/** La hauteur (px) du lecteur pour un format, un écran et une largeur de colonne — le même calcul que les classes. */
export function hauteurLecteur(format: FormatLecteur, hauteurEcranPx: number, largeurColonnePx = Number.POSITIVE_INFINITY): number {
  const libre = hauteurEcranPx - LECTEUR_RETRAIT_REM * 16;
  if (format === '9:16') return (Math.min(largeurColonnePx, largeurLecteur(hauteurEcranPx)) * 16) / 9;
  if (format === '1:1') return Math.min(largeurColonnePx, Math.min(LECTEUR_CARRE_MAX_PX, Math.max(LECTEUR_LARGEUR_MIN_PX, libre)));
  const largeur = Math.min(largeurColonnePx, Math.max(LECTEUR_PAYSAGE_MIN_PX, (libre * 16) / 9));
  return (largeur * 9) / 16;
}
