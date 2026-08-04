/**
 * Signature d'un rendu — « ce montage est-il encore celui qu'on a composé ? ».
 *
 * Le bouton Play compose la vraie vidéo ; l'export la réutilise si rien n'a
 * bougé, pour ne débiter qu'une fois. Encore faut-il savoir si quelque chose a
 * bougé.
 *
 * ⚠️ LA SIGNATURE EST DÉRIVÉE DES OPTIONS ELLES-MÊMES, pas d'une liste de
 * champs écrite à la main.
 *
 * Une liste manuelle serait fausse au premier réglage ajouté sans y penser —
 * et son échec est SILENCIEUX : l'export réutiliserait un montage périmé, et
 * l'utilisateur recevrait une vidéo qui ne correspond plus à son écran. En
 * parcourant l'objet réellement envoyé au compositeur, tout nouveau champ
 * entre dans la signature sans que personne ait à y penser.
 */

/**
 * Clés volontairement ignorées.
 *
 * - `cardsSnapshot` / `cardsSnapshotRect` : la photo des cartes est
 *   re-capturée à chaque rendu et porte une URL neuve à chaque fois. L'inclure
 *   rendrait toute signature unique, donc le cache inutile. Ce qui la
 *   détermine — le contenu des cartes et le design — est déjà dans les options.
 * - `onProgress` : une fonction, différente à chaque rendu.
 * - `elements` : les icônes sont rasterisées en images neuves à chaque envoi ;
 *   c'est `elementsKey` (ajoutée par l'appelant) qui porte leur description.
 */
export const VOLATILE_KEYS = new Set([
  'cardsSnapshot',
  'cardsSnapshotRect',
  'onProgress',
  'elements',
]);

/**
 * Projection stable et sérialisable des options.
 *
 * Les clés sont triées : deux objets identiques au désordre près doivent
 * donner la même signature, sinon le cache raterait sans raison.
 */
function stable(value: unknown, profondeur = 0): unknown {
  // Garde-fou : une structure cyclique ou absurdement profonde ne doit pas
  // faire tomber l'écran pour une simple comparaison.
  if (profondeur > 12) return '…';
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === 'function') return undefined;
  if (t === 'number') return Number.isFinite(value as number) ? value : null;
  if (t === 'string' || t === 'boolean') return value;
  if (t !== 'object') return String(value);

  // Élément du DOM ou objet non sérialisable (image, canvas…) : on ne garde
  // que son genre, jamais son identité — elle change à chaque rendu.
  if (typeof Node !== 'undefined' && value instanceof Node) return '[node]';
  if (value instanceof Blob) return `[blob:${value.size}]`;

  if (Array.isArray(value)) return value.map((v) => stable(v, profondeur + 1));

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    if (VOLATILE_KEYS.has(key)) continue;
    const v = stable((value as Record<string, unknown>)[key], profondeur + 1);
    if (v === undefined) continue;
    out[key] = v;
  }
  return out;
}

/**
 * Signature du rendu. Deux appels sur des options équivalentes rendent la
 * même chaîne ; le moindre réglage changé en produit une autre.
 */
export function renderSignature(options: unknown): string {
  try {
    return JSON.stringify(stable(options));
  } catch {
    // Impossible de comparer : on rend une valeur UNIQUE, donc le cache ne
    // sera jamais réutilisé. Recomposer coûte ; livrer un montage périmé
    // coûte plus cher.
    return `illisible-${Math.random()}`;
  }
}

/** Le montage en cache correspond-il encore à ce qui est à l'écran ? */
export function signatureMatches(
  cached: string | null | undefined,
  current: string,
): boolean {
  return !!cached && cached === current;
}
