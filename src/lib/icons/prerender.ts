import { CARD_ICON_MAP } from '@/components/ui/CardIcon';

/**
 * Pre-rend une icone lucide en HTMLImageElement, pour le compositeur video.
 *
 * POURQUOI CE MODULE EXISTE
 * Le compositeur ne connait que deux champs sur une carte :
 *   - `iconImage` : dessine tel quel sur le canvas ;
 *   - `emoji`     : dessine en TEXTE (`ctx.fillText`).
 * Depuis que `smart-content` produit des noms d'icones lucide au lieu
 * d'emojis, une carte dont `emoji` vaut « Droplet » sans `iconImage` fait
 * ecrire le mot « Droplet » en toutes lettres sur la video. Le compositeur
 * emet d'ailleurs un `console.warn` explicite dans ce cas.
 *
 * Ce module centralise la conversion. Il etait auparavant duplique dans
 * l'editeur ; toute page qui appelle `composeAndUpload` avec des cartes doit
 * passer par ici, sinon elle produit du texte a la place des icones.
 *
 * Cote client uniquement : `react-dom/server` est charge dynamiquement et le
 * rendu passe par `Image` + `URL.createObjectURL`.
 */

/**
 * Forme minimale attendue : le champ portant le nom d'icone.
 *
 * Pas de signature d'index — elle empechait TypeScript d'inferer le type
 * concret des cartes de l'appelant, qui se retrouvait avec des proprietes
 * `unknown` en sortie.
 */
export interface PreRenderableCard {
  emoji?: string;
  iconColor?: string;
  iconImage?: HTMLImageElement;
}

/**
 * Renvoie une copie des cartes dont `emoji` designe une icone lucide connue,
 * enrichie d'un `iconImage`. Les cartes portant un vrai emoji (contenu ancien)
 * sont laissees INTACTES : le compositeur les dessine deja correctement en
 * texte, c'est le comportement voulu et retro-compatible.
 *
 * Ne leve jamais : en cas d'echec, la carte est renvoyee telle quelle.
 */
export async function preRenderCardIcons<T extends PreRenderableCard>(
  cards: T[],
): Promise<T[]> {
  if (!cards || cards.length === 0) return cards;

  let renderToStaticMarkup: (el: unknown) => string;
  let React: typeof import('react');
  try {
    ({ renderToStaticMarkup } = (await import('react-dom/server')) as unknown as {
      renderToStaticMarkup: (el: unknown) => string;
    });
    React = await import('react');
  } catch {
    // Sans react-dom/server on ne peut rien rasteriser : on renvoie tel quel.
    return cards;
  }

  return Promise.all(
    cards.map(async (card) => {
      const name = card?.emoji;
      // Deja une image, ou pas un nom d'icone connu (emoji legitime) : on ne
      // touche a rien.
      if (card?.iconImage || !name || !CARD_ICON_MAP[name]) return card;

      try {
        const IconComp = CARD_ICON_MAP[name];
        const svg = renderToStaticMarkup(
          React.createElement(IconComp as never, {
            size: 64,
            color: card.iconColor || '#FFFFFF',
            strokeWidth: 2,
          }),
        );
        const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(img);
          };
          img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('icon rasterisation failed'));
          };
          img.src = url;
        });
        return { ...card, iconImage: image };
      } catch {
        return card;
      }
    }),
  );
}
