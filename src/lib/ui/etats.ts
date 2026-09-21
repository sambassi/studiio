/**
 * États d'interaction partagés — classes Tailwind, module PUR (aucun React).
 *
 * Un contrôle de Studiio doit rendre visibles, sans reposer sur la seule
 * couleur, les cinq situations que l'utilisateur rencontre :
 *
 *   survol      → fond/bordure violet-500 + élévation d'un pixel
 *   appui       → réduction à 98 % + fond plus dense (le doigt « enfonce »)
 *   focus       → anneau violet-400 de 2 px, décollé du fond (clavier)
 *   sélection   → fond violet-600/20 + anneau violet-500 fin + texte blanc,
 *                 ET un marqueur de forme (coche ou barre) porté par le
 *                 composant, ET `aria-pressed` / `aria-selected`
 *   action      → chargement / succès / erreur, TRANSITOIRES : une action
 *                 ponctuelle ne reçoit JAMAIS `ETAT_SELECTION`, sinon un
 *                 bouton « Exporter » cliqué ressemblerait à une option cochée.
 *
 * Deux familles de composition :
 *
 *   `ETAT_INTERACTIF`           tout : pour un contrôle NEUTRE (option,
 *                               onglet, bouton écrit avec ses propres classes
 *                               gris) — le survol violet vient d'ici.
 *   `ETAT_INTERACTIF_SANS_FOND` sans les fonds de survol/appui : pour un
 *                               contrôle qui porte DÉJÀ sa couleur de fond
 *                               (variantes `.button-*` de `globals.css`,
 *                               bouton dégradé de l'ExportBar). Ajouter le
 *                               fond violet ici écraserait la couleur de la
 *                               variante — les utilitaires gagnent toujours
 *                               sur la couche `components`.
 *
 * Contrastes (WCAG, fond #0A0A0F) — mesurés dans `src/__tests__/ui-etats.test.ts` :
 *   texte blanc sur sélection (#9333EA à 20 %)      ≈ 17:1
 *   texte blanc sur `button-primary` (#7C3AED à 82 %) ≈  6:1
 *   anneau focus purple-400 (#C084FC) vs fond        ≈  8:1
 *   texte gray-400 (#9CA3AF) non sélectionné vs fond ≈  7:1
 */

/** Toute transition d'état dure 150 ms — assez vif pour un retour d'appui. */
export const TRANSITION = 'transition duration-150';

/** Survol : le fond et la bordure prennent le violet, le contrôle se soulève. */
export const SURVOL_FOND = 'hover:bg-purple-500/10 hover:border-purple-500/40';
export const SURVOL_ELEVATION = 'hover:-translate-y-px';
export const SURVOL = `${SURVOL_FOND} ${SURVOL_ELEVATION}`;

/** Appui : retour à plat et réduction à 98 % — visible même sans couleur. */
export const RETOUR_APPUI = 'active:translate-y-0 active:scale-[0.98]';
/** Appui : fond plus dense (deux fois le survol). */
export const APPUI_FOND = 'active:bg-purple-500/20';

/**
 * Focus clavier : anneau de 2 px en violet-400 (plus clair que le violet de
 * marque pour se détacher d'un fond déjà violet), décollé de 2 px par un
 * offset de la couleur du fond de page. `outline-none` retire le contour
 * navigateur qui se superposerait à l'anneau.
 */
export const FOCUS_CLAVIER =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-studiio-dark';

/**
 * Désactivé : demi-opacité et curseur interdit. Les deux variantes empilées
 * annulent l'élévation et la réduction — un contrôle inerte ne bouge pas.
 * Pas de `pointer-events-none` : il retirerait le curseur interdit.
 */
export const DESACTIVE =
  'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:active:scale-100';

/** Composition complète, pour un contrôle neutre. */
export const ETAT_INTERACTIF = [TRANSITION, SURVOL, RETOUR_APPUI, APPUI_FOND, FOCUS_CLAVIER, DESACTIVE].join(' ');

/** Composition sans fonds : le contrôle apporte ses propres couleurs. */
export const ETAT_INTERACTIF_SANS_FOND = [TRANSITION, SURVOL_ELEVATION, RETOUR_APPUI, FOCUS_CLAVIER, DESACTIVE].join(' ');

/**
 * Sélection persistante (option cochée, onglet actif).
 *
 * L'anneau de 1 px (`ring-1`) est un contour dessiné en `box-shadow` : il ne
 * modifie pas la géométrie et cohabite avec `focus-visible:ring-2`, qui le
 * remplace le temps du focus. Le composant qui l'applique DOIT aussi rendre
 * un marqueur de forme (`Check` ou barre) et l'attribut ARIA correspondant.
 */
export const ETAT_SELECTION = 'bg-purple-600/20 text-white ring-1 ring-purple-500 border-transparent';

/**
 * Un contrôle sélectionné porte déjà son fond : il prend la composition SANS
 * fond, plus un survol/appui qui DENSIFIENT le violet au lieu de le diluer
 * (le `hover:bg-purple-500/10` de `SURVOL_FOND` l'éclaircirait).
 */
const SELECTION_INTERACTIVE = `${ETAT_INTERACTIF_SANS_FOND} hover:bg-purple-600/30 active:bg-purple-600/40`;

/** Repos d'une option non sélectionnée. */
export const ETAT_REPOS = 'bg-gray-800/60 text-gray-400 border-gray-700 hover:text-white';

/** Sélection d'une option — la coche est rendue par `OptionBouton`. */
export function classesOption(selected: boolean): string {
  const base = 'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium';
  return selected
    ? `${base} ${SELECTION_INTERACTIVE} ${ETAT_SELECTION}`
    : `${base} ${ETAT_INTERACTIF} ${ETAT_REPOS}`;
}

/**
 * Onglet — bordure transparente (les onglets sont contigus) ; la barre sous
 * l'onglet actif est rendue par `Onglets`, le fond violet doux vient d'ici.
 */
export function classesOnglet(selected: boolean): string {
  const base = 'relative inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium border border-transparent';
  return selected
    ? `${base} ${SELECTION_INTERACTIVE} ${ETAT_SELECTION}`
    : `${base} ${ETAT_INTERACTIF} text-gray-400 hover:text-white`;
}

/**
 * Carte ou option à GÉOMÉTRIE LIBRE (le composant garde ses paddings, sa grille
 * et son contenu) : seules les couleurs et les retours d'état sont partagés.
 * Sélectionnée → fond violet doux + anneau ; le composant rend aussi un
 * marqueur de forme (coche) et `aria-pressed`.
 */
export function classesCarteOption(selected: boolean): string {
  return selected
    ? `${SELECTION_INTERACTIVE} ${ETAT_SELECTION}`
    : `${ETAT_INTERACTIF} ${ETAT_REPOS}`;
}

export type EtatAction = 'repos' | 'chargement' | 'succes' | 'erreur';

/** Libellés lus par les lecteurs d'écran (et affichables) pour chaque état. */
export const LIBELLE_ETAT: Record<Exclude<EtatAction, 'repos'>, string> = {
  chargement: 'Chargement…',
  succes: 'Fait',
  erreur: 'Échec',
};

/**
 * Classes d'une ACTION ponctuelle selon son état. Ne contient jamais
 * `ETAT_SELECTION` : un succès est vert et passager, une erreur est rouge et
 * porte une icône — aucun des deux ne ressemble à un choix retenu.
 */
export function classesAction(etat: EtatAction): string {
  switch (etat) {
    case 'chargement':
      return 'cursor-progress';
    case 'succes':
      return 'border-emerald-500/60 text-emerald-200';
    case 'erreur':
      return 'border-red-500/70 text-red-200';
    default:
      return '';
  }
}
