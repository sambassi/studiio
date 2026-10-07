import { etatApres, type CalageCartes } from '@/lib/creer/synchro-cartes';

/**
 * Photographie le conteneur des cartes à chaque étape d'apparition calée
 * sur la voix (`calageCartes`) : à l'étape k, seules les cartes déjà dites
 * sont visibles, et parmi elles seules les valeurs déjà dites.
 *
 * Masquer passe par `visibility: hidden` : la mise en page ne bouge pas,
 * chaque photo garde EXACTEMENT le cadre de la photo complète — le
 * compositeur les pose toutes au même rectangle. Les styles d'origine sont
 * TOUJOURS restaurés (`finally`), même si une photo échoue.
 *
 * `null` = pas de calage possible (une carte introuvable dans le DOM, une
 * photo ratée) : l'export garde la photo unique d'avant.
 */
export async function capturerEtapesCartes<I>(
  conteneur: HTMLElement,
  calage: CalageCartes,
  idsCartes: readonly string[],
  photographier: () => Promise<I | null>,
): Promise<Array<{ debut: number; image: I }> | null> {
  const cartes = idsCartes.map((id) => conteneur.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`));
  if (calage.etapes.some((e) => !cartes[e.carte])) return null;

  const origine = new Map<HTMLElement, string>();
  const poser = (el: HTMLElement, visible: boolean) => {
    if (!origine.has(el)) origine.set(el, el.style.visibility);
    el.style.visibility = visible ? origine.get(el)! : 'hidden';
  };

  const out: Array<{ debut: number; image: I }> = [];
  try {
    const etapes = calage.etapes;
    for (let k = 1; k <= etapes.length; k++) {
      // Plusieurs étapes au même instant : une seule photo, la dernière.
      if (k < etapes.length && etapes[k].debut === etapes[k - 1].debut) continue;
      const etat = etatApres(calage, k);
      cartes.forEach((el, i) => {
        if (!el) return;
        poser(el, etat.cartes.has(i));
        el.querySelectorAll<HTMLElement>('[data-card-value]').forEach((v) => poser(v, !etat.cartes.has(i) || etat.valeurs.has(i)));
      });
      const image = await photographier();
      if (!image) return null;
      out.push({ debut: etapes[k - 1].debut, image });
    }
  } finally {
    origine.forEach((v, el) => { el.style.visibility = v; });
  }
  return out.length > 0 ? out : null;
}
