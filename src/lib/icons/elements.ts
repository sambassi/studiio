import type { FreeElementRender } from '@/lib/video-composer';

/**
 * Rasterise les éléments libres d'un post DEPUIS SES DONNÉES, pour le
 * compositeur — le pendant, hors aperçu, de `rasterizeElements` du parcours
 * Créer.
 *
 * Le parcours lit le SVG dans le DOM de l'aperçu (`[data-free-element] svg`).
 * Le Calendrier n'a pas cet aperçu : il rend le MÊME composant (`CardIcon`,
 * celui que monte `FreeElementsLayer`) en balisage statique, puis applique
 * exactement les mêmes attributs que le parcours (taille intrinsèque,
 * `xmlns`, `color`, `stroke`) avant de le décoder. Même glyphe, même taille
 * de destination.
 *
 * Module séparé de `prerender.ts` : les tests qui doublent ce dernier n'ont
 * pas à connaître celui-ci.
 *
 * Côté client uniquement. Ne lève jamais : un élément qui ne se rasterise pas
 * est omis (le compositeur l'omettrait de toute façon), et une liste vide
 * donne `undefined` — rien ne change alors dans le montage.
 */
export async function rasteriserElementsLibres(
  elements: ReadonlyArray<{ iconName: string; x: number; y: number; sizePct: number; color: string }>,
  largeurVideo: number,
): Promise<FreeElementRender[] | undefined> {
  if (!elements || elements.length === 0) return undefined;
  let renderToStaticMarkup: (el: unknown) => string;
  let React: typeof import('react');
  let CardIcon: typeof import('@/components/ui/CardIcon').CardIcon;
  try {
    ({ renderToStaticMarkup } = (await import('react-dom/server')) as unknown as {
      renderToStaticMarkup: (el: unknown) => string;
    });
    React = await import('react');
    ({ CardIcon } = await import('@/components/ui/CardIcon'));
  } catch {
    return undefined;
  }

  const prepares = await Promise.all(elements.map(async (el) => {
    try {
      const px = Math.max(1, Math.round((el.sizePct / 100) * largeurVideo));
      const balisage = renderToStaticMarkup(
        React.createElement(CardIcon, { name: el.iconName, size: px, color: el.color, className: '' }),
      );
      const doc = new DOMParser().parseFromString(balisage, 'image/svg+xml');
      const svg = doc.documentElement;
      // Un nom inconnu rend un emoji en `<span>` : le parcours, qui cherche un
      // `svg`, l'omet aussi.
      if (!svg || svg.nodeName.toLowerCase() !== 'svg') return null;
      svg.setAttribute('width', String(px));
      svg.setAttribute('height', String(px));
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.setAttribute('color', el.color);
      svg.setAttribute('stroke', el.color);
      const source = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 4000);
        img.onload = () => { clearTimeout(timer); resolve(); };
        img.onerror = () => { clearTimeout(timer); resolve(); };
      });
      if (!img.complete || img.naturalWidth === 0) return null;
      return { x: el.x, y: el.y, sizePct: el.sizePct, img };
    } catch {
      return null;
    }
  }));
  const gardes = prepares.filter(Boolean) as FreeElementRender[];
  return gardes.length > 0 ? gardes : undefined;
}

/**
 * Charge une image durable pour le compositeur (photo des cartes). `null` si
 * elle ne se décode pas en temps utile : le compositeur redessine alors les
 * cartes lui-même, comme avant.
 *
 * `crossOrigin` : une image d'une autre origine sans lui « tacherait » le
 * canvas, et l'enregistrement du montage échouerait.
 */
export function chargerImagePourRendu(url: string, delaiMs = 10000): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const timer = setTimeout(() => resolve(null), delaiMs);
      img.onload = () => {
        clearTimeout(timer);
        resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? img : null);
      };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = url;
    } catch {
      resolve(null);
    }
  });
}
