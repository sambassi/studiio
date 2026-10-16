/**
 * M2-a — La RECHERCHE qui a fait trouver un média stock, gardée par le
 * serveur entre `/api/stock/recherche` et `/api/stock/importer`.
 *
 * Le corps de l'import ne porte que `{ provider, type, providerAssetId }` :
 * la requête n'y figure pas, et on ne la demande pas au navigateur. Le
 * serveur, qui vient de faire la recherche POUR CE COMPTE, la retient en
 * mémoire (6 h, bornée) ; l'import l'écrit alors dans l'attribution.
 *
 * Perdue au redéploiement : l'attribution n'a alors pas de `requete`, comme
 * avant M2-a (la description Pexels reste). Aucune donnée d'un autre compte.
 */
const TTL_MS = 6 * 3600_000;
const MAX = 2000;
const memo = new Map<string, { at: number; requete: string }>();

const cle = (userId: string, mediaId: string) => `${userId}|${mediaId}`;

export function memoriserRequeteStock(userId: string, mediaIds: ReadonlyArray<string>, requete: string): void {
  const r = (requete || '').trim().slice(0, 120);
  if (!userId || !r) return;
  for (const id of mediaIds) {
    if (!id) continue;
    const k = cle(userId, id);
    memo.delete(k);
    memo.set(k, { at: Date.now(), requete: r });
  }
  while (memo.size > MAX) memo.delete(memo.keys().next().value as string);
}

export function requeteStockMemorisee(userId: string, mediaId: string): string | null {
  const v = memo.get(cle(userId, mediaId));
  if (!v) return null;
  if (Date.now() - v.at > TTL_MS) { memo.delete(cle(userId, mediaId)); return null; }
  return v.requete;
}

/** Tests seulement. */
export function viderRequetesStock(): void { memo.clear(); }
