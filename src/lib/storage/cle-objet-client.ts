/**
 * Clé d'objet d'une URL de stockage — côté NAVIGATEUR.
 *
 * ⚠️ POURQUOI UN SECOND MODULE ET PAS `cleanup.ts`. `storageKey()` y fait
 * exactement ce calcul, mais ce fichier importe `supabaseAdmin` : l'embarquer
 * dans un composant client tirerait la clé de service dans le bundle. Ce
 * module-ci est pur, sans import, et c'est tout son intérêt.
 *
 * ── POURQUOI COMPARER DES CLÉS ET NON DES CHAÎNES ───────────────────────
 *
 * En production (`STORAGE_PROVIDER=s3`), `/api/upload/signed-url` renvoie
 * une URL publique RELATIVE (`/storage/v1/object/public/media/u/x.mp4`)
 * alors que `/api/media/list` renvoie la même ressource en ABSOLU. Le même
 * fichier peut donc entrer deux fois dans la banque de rushes — une par
 * chemin d'ajout — et `sanitizeConfig`, qui dédoublonne par égalité de
 * chaînes, ne verrait rien. La clé `<bucket>/<chemin>`, elle, est ce que
 * MinIO indexe : une seule forme par objet.
 */

const MOTIF_OBJET = /\/storage\/v1\/object\/(?:public|sign)\/([^/?#]+)\/([^?#]+)/;

/** `<bucket>/<chemin>` de l'URL, ou `null` si ce n'est pas une URL de stockage. */
export function cleObjetStockage(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  const m = MOTIF_OBJET.exec(url);
  if (!m) return null;
  return `${m[1]}/${m[2]}`;
}

/**
 * Dédoublonne des URL en préservant l'ordre d'arrivée.
 *
 * Deux URL de stockage sont « les mêmes » quand leur clé d'objet est la
 * même, quelle qu'en soit l'écriture (relative, absolue, signée). Une URL
 * qui ne se réduit pas à une clé — un CDN externe, par exemple — retombe sur
 * l'égalité de chaînes, comme avant.
 */
export function dedupeParCleObjet(urls: readonly string[]): string[] {
  const vues = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    if (typeof url !== 'string' || !url) continue;
    const cle = cleObjetStockage(url) ?? `url:${url}`;
    if (vues.has(cle)) continue;
    vues.add(cle);
    out.push(url);
  }
  return out;
}
