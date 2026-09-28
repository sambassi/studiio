import { empreinteValide } from './bibliotheque';
import { LUT_API } from './import';
import { parseCube } from './parse';
import type { Lut, LutRef } from './types';

/**
 * Ce que le compositeur attend pour étalonner le rush : la table DÉJÀ LUE et
 * l'intensité. Même forme que `ComposerOptions['rushLut']`.
 */
export interface LutPourRendu {
  lut: Lut;
  intensity: number;
}

export interface ChargerLutDeps {
  fetch?: typeof fetch;
}

/**
 * Lit la LUT d'une référence pour le rendu, ou rend `null`.
 *
 * Le compositeur ne charge aucune LUT lui-même (elles sont privées, servies
 * par la route authentifiée `GET /api/creatif/luts/[empreinte]`) : c'est
 * l'appelant qui la lit, ICI, et la lui transmet.
 *
 * **Jamais d'exception.** Référence absente, intensité nulle, route en échec,
 * réseau coupé, fichier illisible : `null`, et le montage part avec le rush
 * BRUT. Un export qui échoue à cause d'un filtre serait pire qu'une vidéo aux
 * couleurs d'origine.
 *
 * Le parseur est celui du socle (`parseCube`) : les octets stockés sont
 * toujours un `.cube` canonique, un PNG importé ayant été converti à l'import.
 */
export async function chargerLutPourRendu(
  ref: LutRef | null | undefined,
  deps: ChargerLutDeps = {},
): Promise<LutPourRendu | null> {
  if (!ref || !empreinteValide(ref.empreinte)) return null;
  const intensity = Number.isFinite(ref.intensite) ? Math.max(0, Math.min(1, ref.intensite)) : 1;
  // Intensité nulle : le rendu est le rush brut, inutile de télécharger.
  if (intensity === 0) return null;

  const doFetch = deps.fetch ?? fetch;
  try {
    const res = await doFetch(`${LUT_API}/${encodeURIComponent(ref.empreinte)}`, {
      method: 'GET',
      cache: 'no-store',
    });
    if (!res.ok) {
      console.warn(`[LUT] Filtre « ${ref.nom} » indisponible (HTTP ${res.status}) — montage sans étalonnage.`);
      return null;
    }
    const lut = parseCube(await res.text());
    return { lut, intensity };
  } catch (err) {
    console.warn(
      `[LUT] Filtre « ${ref.nom} » illisible — montage sans étalonnage :`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
