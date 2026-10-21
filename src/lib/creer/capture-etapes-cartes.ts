import { etatApres, type CalageCartes } from '@/lib/creer/synchro-cartes';
import { FOND_TEXTE_SUR_IMAGE, estVoile, haloTexteCss } from '@/lib/creer/contraste';

/**
 * Photographie le conteneur des cartes à chaque étape d'apparition calée
 * sur la voix (`calageCartes`) : à l'étape k, seules les cartes déjà dites
 * sont visibles, avec leurs valeurs (une valeur paraît avec sa carte).
 *
 * Un cadre de groupe (`data-card-group`) suit ses cartes : masqué tant
 * qu'aucune d'elles n'est dite, visible dès la première.
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
  options: {
    /**
     * `false` (cartes SUR les rushes) : seule la carte en cours de narration
     * est visible — une surimpression éditoriale à la fois, à sa place.
     * Défaut `true` : les cartes s'accumulent, comme avant.
     */
    cumul?: boolean;
    /** Fond posé sur chaque carte encadrée pendant les photos (restauré ensuite). */
    fondCarte?: string | null;
  } = {},
): Promise<Array<{ debut: number; image: I }> | null> {
  const cumul = options.cumul ?? true;
  const cartes = idsCartes.map((id) => conteneur.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`));
  if (calage.etapes.some((e) => !cartes[e.carte])) return null;

  // Cadres de groupe (`data-card-group`, disposition en flux) : leur filet et
  // leur voile seraient photographies AVANT que la voix ne dise la premiere
  // carte du groupe. Un cadre n'est visible que si l'une de ses cartes l'est.
  const groupes = Array.from(conteneur.querySelectorAll<HTMLElement>('[data-card-group]'));

  const origine = new Map<HTMLElement, string>();
  const poser = (el: HTMLElement, visible: boolean) => {
    if (!origine.has(el)) origine.set(el, el.style.visibility);
    el.style.visibility = visible ? origine.get(el)! : 'hidden';
  };

  // Fond sombre des cartes posées sur un rush : seulement les cartes qui ont
  // déjà un fond (« sans cadre » reste sans cadre).
  const fonds: Array<() => void> = [];
  const descriptions = new Map<HTMLElement, string>();
  if (options.fondCarte) {
    for (const el of cartes) {
      if (!el || !el.style.backgroundColor) continue;
      fonds.push(poserFondCarte(el, options.fondCarte, conteneur));
    }
    // Sur un rush, seul le titre se lisait : la description COURTE vient en
    // seconde ligne (`SequenceCards`, `data-card-description`).
    conteneur.querySelectorAll<HTMLElement>('[data-card-description]').forEach((d) => {
      descriptions.set(d, d.style.display);
      d.style.display = 'block';
    });
  }

  const out: Array<{ debut: number; image: I }> = [];
  try {
    const etapes = calage.etapes;
    for (let k = 1; k <= etapes.length; k++) {
      // Plusieurs étapes au même instant : une seule photo, la dernière.
      if (k < etapes.length && etapes[k].debut === etapes[k - 1].debut) continue;
      const etatCumule = etatApres(calage, k);
      // Non cumulé : la carte de la DERNIÈRE étape « carte » commencée.
      const courante = etapes.slice(0, k).filter((e) => e.element === 'carte').pop()?.carte;
      const etat = cumul || courante === undefined
        ? etatCumule
        : { cartes: new Set([courante]), valeurs: new Set(etatCumule.valeurs.has(courante) ? [courante] : []) };
      cartes.forEach((el, i) => {
        if (!el) return;
        poser(el, etat.cartes.has(i));
        el.querySelectorAll<HTMLElement>('[data-card-value]').forEach((v) => poser(v, !etat.cartes.has(i) || etat.valeurs.has(i)));
      });
      // Masquer le cadre masque aussi ses cartes (heritage de `visibility`) :
      // on ne le fait donc que si AUCUNE n'est encore dite.
      groupes.forEach((g) => poser(g, cartes.some((el, i) => !!el && etat.cartes.has(i) && g.contains(el))));
      const image = await photographier();
      if (!image) return null;
      out.push({ debut: etapes[k - 1].debut, image });
    }
  } finally {
    origine.forEach((v, el) => { el.style.visibility = v; });
    fonds.forEach((rendre) => rendre());
    descriptions.forEach((v, el) => { el.style.display = v; });
  }
  return out.length > 0 ? out : null;
}

/**
 * Fond des cartes posées sur un rush : aucun aplat — contour fin sombre et
 * ombre serrée des glyphes (`contraste.ts`) — et non plus le pavé noir opaque
 * à 72 % (« bandeau sombre opaque », MP4 du 20/10).
 */
export const FOND_CARTE_SUR_RUSH = FOND_TEXTE_SUR_IMAGE;

/**
 * Pose `fond` sur une carte (couleur unie, ou voile en dégradé) avec le halo
 * des glyphes (hérité par ses textes), et rend la fonction qui restaure ses
 * styles.
 */
function poserFondCarte(el: HTMLElement, fond: string, conteneur: HTMLElement): () => void {
  const avant = { bg: el.style.backgroundColor, img: el.style.backgroundImage, ombre: el.style.textShadow };
  if (estVoile(fond)) {
    el.style.backgroundColor = 'transparent';
    el.style.backgroundImage = fond;
  } else {
    el.style.backgroundColor = fond;
  }
  // Halo à l'échelle du conteneur photographié (l'aperçu, pas la vidéo).
  el.style.textShadow = haloTexteCss(conteneur.getBoundingClientRect().width || 320);
  return () => { el.style.backgroundColor = avant.bg; el.style.backgroundImage = avant.img; el.style.textShadow = avant.ombre; };
}

/**
 * Exécute `fn` (une photo) avec `fond` posé sur chaque carte encadrée du
 * conteneur, puis restaure les styles d'origine — même si `fn` échoue.
 * `fond` absent : `fn` seule, rien n'est touché.
 */
export async function avecFondCartes<T>(conteneur: HTMLElement, fond: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  if (!fond) return fn();
  const avant: Array<() => void> = [];
  const descriptions = new Map<HTMLElement, string>();
  conteneur.querySelectorAll<HTMLElement>('[data-card-id]').forEach((el) => {
    if (!el.style.backgroundColor) return;
    avant.push(poserFondCarte(el, fond, conteneur));
  });
  conteneur.querySelectorAll<HTMLElement>('[data-card-description]').forEach((d) => {
    descriptions.set(d, d.style.display);
    d.style.display = 'block';
  });
  try {
    return await fn();
  } finally {
    avant.forEach((rendre) => rendre());
    descriptions.forEach((v, el) => { el.style.display = v; });
  }
}
