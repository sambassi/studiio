/**
 * LA GEOMETRIE D'UN CADRE D'APERCU — ECRITE UNE FOIS, POUR TOUS LES ETATS.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ `aspect-ratio` + `max-height` NE SUFFISENT PAS. C'EST MESURE.
 * ---------------------------------------------------------------------------
 *
 * Avec `width: 100%`, le navigateur prend la largeur disponible, en deduit la
 * hauteur du ratio, puis RABOTE cette hauteur a `max-height` — sans jamais
 * revenir sur la largeur. Un montage 1080x1920 dans une colonne de 394 px
 * sortait donc en 394x389 : presque carre, alors que le fichier est vertical.
 * Constate en production le 2026-09-04.
 *
 * La contrainte doit donc porter sur la LARGEUR, la seule dimension que le
 * navigateur calcule en premier : au-dela de `hauteurMax x L / H`, la boite
 * depasserait en hauteur. En la bornant la, `aspect-ratio` n'est plus jamais
 * pris en defaut, et la hauteur se deduit toute seule.
 *
 * ⚠️ ET AUCUN RATIO N'EST ECRIT EN DUR. La formule vaut pour 9:16, 16:9, 1:1
 * et pour les dimensions reelles d'un fichier — c'est la meme geometrie qui
 * sert au cadre vide, a l'attente, a l'affiche et au lecteur.
 *
 * ⚠️ MODULE SANS REACT, ET C'EST VOULU. Il est importe par le composant ET
 * par le controle Playwright, qui tourne dans node : y faire entrer `react`
 * rendrait ce second controle impossible, donc la geometrie non verifiable
 * dans un vrai moteur de rendu — precisement la ou le defaut est ne.
 */

/** Les trois cadres possibles, dans le vocabulaire du contrat de montage. */
export const RATIOS_APERCU: Record<string, [number, number]> = {
  '9:16': [9, 16],
  '1:1': [1, 1],
  '16:9': [16, 9],
};

/** La hauteur qu'un aperçu n'a pas le droit de dépasser. */
export const HAUTEUR_MAX_APERCU = '52vh';

export interface GeometrieApercu {
  aspectRatio: string;
  width: string;
  maxWidth: string;
  maxHeight: string;
  marginInline: string;
}

export function geometrieApercu(
  largeur: number, hauteur: number, hauteurMax: string = HAUTEUR_MAX_APERCU,
): GeometrieApercu {
  return {
    aspectRatio: `${largeur} / ${hauteur}`,
    width: '100%',
    maxWidth: `calc(${hauteurMax} * ${largeur} / ${hauteur})`,
    maxHeight: hauteurMax,
    marginInline: 'auto',
  };
}
