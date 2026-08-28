/**
 * Les compartiments de stockage autorises — une seule liste.
 *
 * Elle etait ecrite DEUX fois, a l'identique : dans `/api/storage/upload` et
 * dans `/api/upload/multipart`. Deux copies d'une liste blanche ne divergent
 * pas tout de suite ; elles divergent le jour ou l'une accueille un nouveau
 * compartiment et pas l'autre — et ce jour-la, un chemin d'envoi accepte ce
 * que l'autre refuse, sans que rien ne le signale.
 *
 * Toute route qui recoit un nom de compartiment du navigateur doit passer
 * par `bucketAutorise`. Un nom libre laisserait un appelant viser un
 * compartiment que l'application ne gere pas.
 */
export const ALLOWED_BUCKETS = ['media', 'audio', 'videos', 'images'] as const;
export type BucketAutorise = (typeof ALLOWED_BUCKETS)[number];

export function bucketAutorise(valeur: unknown): valeur is BucketAutorise {
  return typeof valeur === 'string'
    && (ALLOWED_BUCKETS as readonly string[]).includes(valeur);
}
