/**
 * Sélection RÉELLE d'un média stock — la seule étape qui touche un fichier.
 *
 * - Vidéo Pexels : relue par son identifiant chez Pexels (jamais une URL du
 *   client), téléchargée (≤ `TAILLE_MAX_IMPORT`), rangée dans la Médiathèque
 *   de l'utilisateur (`media/<uid>/library/`, protégée comme ses autres
 *   médias de bibliothèque). Elle devient alors un rush comme un autre :
 *   même stockage, même vérification, même montage.
 * - Photo Pexels : relue par identifiant, servie par son URL Pexels (comme la
 *   recherche manuelle existante).
 * - Photo Unsplash : le téléchargement est SIGNALÉ (`download_location`, exigé
 *   par Unsplash), et la photo reste servie par son URL Unsplash (hotlink
 *   exigé) — jamais recopiée chez nous.
 *
 * L'attribution (fournisseur, identifiant, auteur, page source, licence) est
 * écrite à côté, dans `media/stock-attributions/<uid>/…json` — hors du
 * dossier listé par la Médiathèque, sans migration de base.
 */
import {
  hoteVideoPexelsAutorise,
  photoPexelsParId,
  signalerTelechargementUnsplash,
  videoPexelsParId,
  type DependancesStock,
} from './fournisseurs';
import type { FournisseurStock, MediaStock, TypeStock } from './types';

export const TAILLE_MAX_IMPORT = 120 * 1024 * 1024;

export interface DemandeImport {
  provider: FournisseurStock;
  type: TypeStock;
  providerAssetId: string;
}

export interface StockageImport {
  televerser: (o: { chemin: string; contenu: Buffer; contentType: string }) => Promise<string>;
}

export interface ResultatImport {
  url: string;
  media: MediaStock;
  importe: boolean;
}

export class ErreurImport extends Error {
  constructor(public readonly code: 'invalide' | 'introuvable' | 'trop_lourd' | 'telechargement' | 'hote', message?: string) {
    super(message ?? code);
  }
}

export function nomFichierStock(provider: FournisseurStock, type: TypeStock, id: string): string {
  return `stock-${provider}-${type}-${id.replace(/[^A-Za-z0-9_-]/g, '')}.${type === 'video' ? 'mp4' : 'jpg'}`;
}

export function attributionPourStockage(m: MediaStock, url: string): Record<string, unknown> {
  return {
    provider: m.provider,
    providerAssetId: m.providerAssetId,
    type: m.type,
    auteur: m.auteur,
    auteurUrl: m.auteurUrl ?? null,
    sourceUrl: m.sourceUrl,
    licence: m.licence,
    attribution: m.attribution,
    largeur: m.largeur,
    hauteur: m.hauteur,
    orientation: m.orientation,
    dureeSecondes: m.dureeSecondes ?? null,
    url,
    importeLe: new Date().toISOString(),
  };
}

export async function importerMediaStock(
  userId: string,
  d: DemandeImport,
  deps: DependancesStock,
  stockage: StockageImport,
): Promise<ResultatImport> {
  if (d.provider === 'unsplash') {
    if (d.type !== 'photo') throw new ErreurImport('invalide', 'Unsplash ne fournit que des photos');
    const media = await signalerTelechargementUnsplash(d.providerAssetId, deps);
    if (!media) throw new ErreurImport('introuvable');
    return { url: media.fichierUrl, media, importe: false };
  }
  if (d.provider !== 'pexels') throw new ErreurImport('invalide');
  if (d.type === 'photo') {
    const media = await photoPexelsParId(d.providerAssetId, deps);
    if (!media) throw new ErreurImport('introuvable');
    return { url: media.fichierUrl, media, importe: false };
  }
  const media = await videoPexelsParId(d.providerAssetId, deps);
  if (!media) throw new ErreurImport('introuvable');
  if (!hoteVideoPexelsAutorise(media.fichierUrl)) throw new ErreurImport('hote');

  const res = await deps.fetch(media.fichierUrl, { cache: 'no-store' }).catch(() => null);
  if (!res || !res.ok) throw new ErreurImport('telechargement');
  const annoncee = Number(res.headers.get('content-length') || 0);
  if (annoncee > TAILLE_MAX_IMPORT) throw new ErreurImport('trop_lourd');
  const contenu = Buffer.from(await res.arrayBuffer());
  if (contenu.length > TAILLE_MAX_IMPORT) throw new ErreurImport('trop_lourd');
  if (contenu.length < 1024) throw new ErreurImport('telechargement');

  const nom = nomFichierStock('pexels', 'video', d.providerAssetId);
  const url = await stockage.televerser({ chemin: `${userId}/library/${nom}`, contenu, contentType: 'video/mp4' });
  // L'attribution ne doit jamais faire échouer l'import : elle se réécrit au prochain choix.
  await stockage.televerser({
    chemin: `stock-attributions/${userId}/${nom}.json`,
    contenu: Buffer.from(JSON.stringify(attributionPourStockage(media, url))),
    contentType: 'application/json',
  }).catch(() => null);
  return { url, media, importe: true };
}
