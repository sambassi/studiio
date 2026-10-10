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
