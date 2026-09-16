/**
 * Derniere creation telechargeable de l'utilisateur.
 *
 * `GET /api/videos` renvoie deja la Bibliotheque fusionnee (table `videos` +
 * `scheduled_posts`), triee du plus recent au plus ancien. Ce module ne fait
 * que choisir, dans cette liste, l'element qu'on peut reellement telecharger —
 * il n'ajoute aucune route et ne connait pas le reseau.
 */

export type DownloadableItem = {
  id: string;
  title?: string | null;
  status?: string | null;
  type?: string | null;
  created_at?: string | null;
  video_url?: string | null;
};

/**
 * Statuts dont le fichier n'existe pas encore (ou plus).
 *
 * Volontairement une liste NOIRE et non une liste blanche : dans Studiio, un
 * montage termine reste tres souvent en `draft` (cree depuis /creer, jamais
 * publie). Une liste blanche `completed|published` rendrait le bouton inutile
 * pour le flux principal. Ce qui prouve qu'une video est finie, ici, c'est
 * qu'elle porte un fichier.
 */
const UNFINISHED_STATUSES = new Set(['rendering', 'queued', 'processing', 'failed']);

function isDownloadable(item: DownloadableItem): boolean {
  const url = item?.video_url;
  if (typeof url !== 'string' || url.trim() === '') return false;
  const status = (item.status || '').toLowerCase();
  return !UNFINISHED_STATUSES.has(status);
}

function timestamp(item: DownloadableItem): number {
  const t = item.created_at ? new Date(item.created_at).getTime() : NaN;
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Retourne la creation telechargeable la plus recente, ou `null` s'il n'y en a
 * aucune — auquel cas l'appelant garde son repli vers la Bibliotheque.
 */
export function pickLatestDownloadable(
  items: readonly DownloadableItem[] | null | undefined
): DownloadableItem | null {
  if (!Array.isArray(items) || items.length === 0) return null;

  // L'API trie deja, mais on ne s'en remet pas a elle : un tri stable ici
  // garantit « la derniere » meme si l'ordre change en amont.
  const usable = items.filter(isDownloadable);
  if (usable.length === 0) return null;

  return usable.reduce((latest, item) => (timestamp(item) > timestamp(latest) ? item : latest));
}
