/**
 * Appels navigateur du moteur stock — partagés par Créer et l'Autopilote.
 * Jamais d'exception : un réseau en panne rend une liste vide + un échec.
 */
import type { FormatStock, FournisseurStock, MediaStock, ResultatRechercheStock, TypeStock } from './types';

export async function rechercherStockClient(p: {
  requete: string;
  type: TypeStock;
  format: FormatStock;
  fournisseurs?: FournisseurStock[];
  page?: number;
}): Promise<ResultatRechercheStock> {
  const q = new URLSearchParams({ requete: p.requete, type: p.type, format: p.format, page: String(p.page ?? 1) });
  if (p.fournisseurs?.length) q.set('fournisseurs', p.fournisseurs.join(','));
  try {
    const res = await fetch(`/api/stock/recherche?${q.toString()}`);
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.success) return { medias: [], echecs: [{ provider: 'pexels', motif: 'indisponible' }], requete: p.requete };
    return { medias: j.medias ?? [], echecs: j.echecs ?? [], requete: j.requete ?? p.requete };
  } catch {
    return { medias: [], echecs: [{ provider: 'pexels', motif: 'indisponible' }], requete: p.requete };
  }
}

/** Sélection réelle : vidéo Pexels → Médiathèque ; photo → URL fournisseur (Unsplash signalé). */
export async function importerStockClient(m: Pick<MediaStock, 'provider' | 'type' | 'providerAssetId'>): Promise<{ url: string; media: MediaStock; importe: boolean } | { erreur: string }> {
  try {
    const res = await fetch('/api/stock/importer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: m.provider, type: m.type, providerAssetId: m.providerAssetId }),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.success) return { erreur: j?.error || 'indisponible' };
    return { url: j.url, media: j.media, importe: !!j.importe };
  } catch {
    return { erreur: 'indisponible' };
  }
}

/**
 * Identifiant Unsplash d'une photo d'affiche venue de `/api/pexels`
 * (`id: "unsplash-<id>"`, `source: "unsplash"`), ou `null` pour toute autre
 * photo (Pexels, IA, téléversée). Pur.
 */
export function idUnsplashAffiche(photo: { id: string | number; source?: string }): string | null {
  if (photo.source !== 'unsplash') return null;
  const brut = String(photo.id);
  const id = brut.startsWith('unsplash-') ? brut.slice('unsplash-'.length) : brut;
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

/**
 * Choix d'une photo Unsplash comme affiche : Unsplash EXIGE que chaque
 * utilisation déclenche son `download_location`. Le chemin existant
 * (`/api/stock/importer`, provider `unsplash`) le fait côté serveur — on le
 * réutilise. La photo reste servie en hotlink (`importe: false`) : l'appelant
 * applique l'URL qu'il a déjà, sans attendre ce signalement. Sans effet
 * pour une photo qui n'est pas Unsplash. Jamais d'exception.
 */
export function signalerChoixAfficheUnsplash(photo: { id: string | number; source?: string }): Promise<boolean> {
  const id = idUnsplashAffiche(photo);
  if (!id) return Promise.resolve(false);
  return importerStockClient({ provider: 'unsplash', type: 'photo', providerAssetId: id })
    .then((r) => !('erreur' in r))
    .catch(() => false);
}

/**
 * Un geste sur une photo d'affiche — clic dans la grille OU dépôt sur
 * l'aperçu — est un CHOIX RÉEL quand la photo n'était pas déjà posée à
 * l'endroit visé (affiche globale, fond de la séquence, emplacement du lot).
 * Une fois par choix réel, et par ce seul chemin (`signalerChoixAfficheUnsplash`) :
 * un clic puis un dépôt de la même photo au même endroit, ou un second dépôt,
 * ne signalent rien de plus. Survol, aperçu, dé-choix : aucun appel (aucun
 * geste ne passe ici). Jamais d'exception.
 */
export function signalerChoixAffiche(
  photo: { id: string | number; source?: string } | null | undefined,
  dejaPosee: boolean,
): Promise<boolean> {
  if (!photo || dejaPosee) return Promise.resolve(false);
  return signalerChoixAfficheUnsplash(photo);
}

/** La photo de la grille dont l'URL a été déposée, ou `null` (autre origine). Pur. */
export function photoDeLaGrille<T extends { url: string }>(photos: ReadonlyArray<T>, url: string): T | null {
  return photos.find((p) => p.url === url) ?? null;
}
