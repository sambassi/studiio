/**
 * A_1 — LA RÉSOLUTION DES FICHIERS DE POLICE. Serveur uniquement.
 *
 * ⚠️ CE MODULE EST SÉPARÉ POUR UNE RAISON MESURÉE. `rendu-texte` est importé
 * par `rendu-style`, lui-même atteint par des composants CLIENT ; y laisser
 * `node:fs` faisait échouer le build de tout le projet avec
 * « UnhandledSchemeError: Reading from "node:fs" ». Le disque reste donc
 * ici, où seul le moteur de rendu vient le chercher.
 */
import { existsSync } from 'node:fs';
import type { PoliceRendu } from './rendu-texte';

const RACINE_LIBERATION = '/usr/share/fonts/truetype/liberation';

const FICHIERS: Record<PoliceRendu, { normale: string; grasse: string }> = {
  sans: {
    normale: `${RACINE_LIBERATION}/LiberationSans-Regular.ttf`,
    grasse: `${RACINE_LIBERATION}/LiberationSans-Bold.ttf`,
  },
  serif: {
    normale: `${RACINE_LIBERATION}/LiberationSerif-Regular.ttf`,
    grasse: `${RACINE_LIBERATION}/LiberationSerif-Bold.ttf`,
  },
  mono: {
    normale: `${RACINE_LIBERATION}/LiberationMono-Regular.ttf`,
    grasse: `${RACINE_LIBERATION}/LiberationMono-Bold.ttf`,
  },
};

/**
 * Le fichier de police, ou `null` si cette machine ne le porte pas.
 *
 * ⚠️ `null` N'EST PAS UNE ERREUR, C'EST UNE MACHINE SANS CETTE POLICE. Un
 * poste de développement n'a pas forcément `fonts-liberation`. On rend alors
 * `null`, l'appelant n'ajoute pas la couche, et le montage sort SANS texte
 * plutôt que de ne pas sortir du tout — avec une trace dans `usage`, comme le
 * dépôt le fait déjà pour les transitions non rendues.
 */
export function fichierPolice(
  police: PoliceRendu, graisse: 'normale' | 'grasse',
): string | null {
  const chemin = FICHIERS[police]?.[graisse];
  return chemin && existsSync(chemin) ? chemin : null;
}

