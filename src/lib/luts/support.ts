import type { Lut, SupportLut } from './types';

/**
 * Ce qu'un moteur sait faire d'une LUT — décidé ICI, et nulle part ailleurs.
 *
 * Le contrat produit distingue deux choses que l'interface confond
 * facilement : ce qu'on peut IMPORTER et STOCKER (tout `.cube`, tout PNG
 * LUT), et ce que le moteur de rendu sait APPLIQUER aujourd'hui. Une 1D
 * importable mais pas encore rendue ne doit ni disparaître, ni être ignorée
 * en silence : elle est conservée, et son statut le dit.
 *
 * Aucun composant d'interface ne dérive ce statut lui-même : il appelle
 * `supportDeLut` et affiche ce qu'il reçoit. Le jour où `lut1d` est câblé,
 * une seule constante change et tous les écrans suivent.
 */
export interface CapacitesLut {
  /** L'aperçu (navigateur) sait rejouer les frames étalonnées. */
  apercu: boolean;
  /** Le rendu final applique les cubes 3D (`lut3d`). */
  rendu3d: boolean;
  /** Le rendu final applique les courbes 1D (`lut1d`). */
  rendu1d: boolean;
}

/**
 * L'état RÉEL du dépôt, à tenir à jour avec le code — pas avec les intentions.
 *
 * - `apercu` : aucun aperçu étalonné n'est branché sur `main` (phase aperçu
 *   du chantier LUT, à venir).
 * - `rendu3d` / `rendu1d` : le filtre `lut3d` existe pour le catalogue de
 *   looks de l'Autopilote, mais aucun moteur ne consomme encore une LUT
 *   IMPORTÉE ; `lut1d` n'est pas câblé.
 */
export const CAPACITES_ACTUELLES: Readonly<CapacitesLut> = Object.freeze({
  apercu: false,
  rendu3d: false,
  rendu1d: false,
});

export function supportDeLut(
  kind: Lut['kind'],
  capacites: Readonly<CapacitesLut> = CAPACITES_ACTUELLES,
): SupportLut {
  const rendu = kind === '3d' ? capacites.rendu3d : capacites.rendu1d;
  if (rendu) return 'ready';
  if (capacites.apercu) return 'preview-only';
  return 'unsupported-render';
}

/** Libellés courts, pour que l'interface n'invente pas les siens. */
export const LIBELLES_SUPPORT: Record<SupportLut, string> = {
  ready: 'Appliquée au montage',
  'preview-only': 'Aperçu seulement — pas encore appliquée au montage',
  'unsupported-render': 'Conservée — pas encore appliquée à l’aperçu ni au montage',
};
