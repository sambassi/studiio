/**
 * Adaptateurs Pexels / Unsplash du moteur stock.
 *
 * ⚠️ LES MÊMES CLÉS QUE `/api/pexels` (`PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY`)
 * — aucune nouvelle variable. Le `fetch` est INJECTÉ : les tests passent un
 * faux réseau, jamais le vrai fournisseur.
 *
 * ⚠️ LE STATUT SEUL est conservé en cas de refus, jamais le corps de la
 * réponse (un fournisseur peut y faire écho de la clé envoyée).
 */
import {
  orientationDesDimensions,
  type FournisseurStock,
  type MediaStock,
  type MotifEchecStock,
  type OrientationStock,
  type TypeStock,
} from './types';

export class ErreurFournisseurStock extends Error {
  constructor(public readonly provider: FournisseurStock, public readonly motif: MotifEchecStock, public readonly statut?: number) {
    super(`${provider} ${statut ?? motif}`);
  }
}

export function motifDuStatut(statut: number): MotifEchecStock {
  if (statut === 429) return 'quota';
  if (statut === 401 || statut === 403) return 'refus';
  return 'indisponible';
}

export interface ParametresAdaptateur {
  requete: string;
  type: TypeStock;
  orientation: OrientationStock;
  parPage: number;
  page: number;
}

export interface DependancesStock {
  fetch: typeof fetch;
  cles: { pexels?: string; unsplash?: string };
}

export function dependancesParDefaut(): DependancesStock {
  return {
    fetch: (...a: Parameters<typeof fetch>) => fetch(...a),
    cles: { pexels: process.env.PEXELS_API_KEY, unsplash: process.env.UNSPLASH_ACCESS_KEY },
  };
}

/** Utilisé dans le lien d'attribution Unsplash (UTM exigés par leurs règles). */
export const UTM_UNSPLASH = 'utm_source=studiio&utm_medium=referral';

/** Mots du « slug » d'une page Pexels (`/video/femme-qui-danse-123/`) — la vidéo n'a pas d'alt. */
export function motsDuSlug(url: string): string {
  const m = /\/(?:video|photo)\/([^/?#]+?)-?\d*\/?(?:[?#]|$)/.exec(url || '');
  return m ? m[1].replace(/-/g, ' ').trim() : '';
}

/** Le fichier vidéo à garder : MP4, le plus grand côté ≤ 1920 (1080p), sinon le plus petit disponible. */
export function choisirFichierVideo(
  fichiers: ReadonlyArray<{ link?: string; file_type?: string; width?: number | null; height?: number | null }>,
): { link: string; width: number; height: number } | null {
  const mp4 = fichiers.filter((f) => f.link && (f.file_type || '').includes('mp4') && f.width && f.height);
  if (mp4.length === 0) return null;
  const cote = (f: { width?: number | null; height?: number | null }) => Math.max(f.width || 0, f.height || 0);
  const sous = mp4.filter((f) => cote(f) <= 1920).sort((a, b) => cote(b) - cote(a));
  const f = sous[0] ?? [...mp4].sort((a, b) => cote(a) - cote(b))[0];
  return { link: f.link!, width: f.width || 0, height: f.height || 0 };
}

const ORIENTATION_PEXELS: Record<OrientationStock, string> = { portrait: 'portrait', landscape: 'landscape', square: 'square' };
const ORIENTATION_UNSPLASH: Record<OrientationStock, string> = { portrait: 'portrait', landscape: 'landscape', square: 'squarish' };

async function appeler(deps: DependancesStock, provider: FournisseurStock, url: string, headers: Record<string, string>): Promise<any> {
  let res: Response;
  try {
    res = await deps.fetch(url, { headers, cache: 'no-store' });
  } catch {
    throw new ErreurFournisseurStock(provider, 'indisponible');
  }
  if (!res.ok) throw new ErreurFournisseurStock(provider, motifDuStatut(res.status), res.status);
  try {
    return await res.json();
  } catch {
    throw new ErreurFournisseurStock(provider, 'indisponible');
  }
}

export async function rechercherPexels(p: ParametresAdaptateur, deps: DependancesStock): Promise<MediaStock[]> {
  const cle = deps.cles.pexels;
  if (!cle) throw new ErreurFournisseurStock('pexels', 'non_configure');
  const q = `query=${encodeURIComponent(p.requete)}&per_page=${p.parPage}&page=${p.page}&orientation=${ORIENTATION_PEXELS[p.orientation]}`;
  if (p.type === 'video') {
    const data = await appeler(deps, 'pexels', `https://api.pexels.com/videos/search?${q}&size=medium`, { Authorization: cle });
    const out: MediaStock[] = [];
    for (const v of Array.isArray(data?.videos) ? data.videos : []) {
      const fichier = choisirFichierVideo(Array.isArray(v.video_files) ? v.video_files : []);
      if (!fichier || v.id == null) continue;
      const largeur = Number(v.width) || fichier.width;
      const hauteur = Number(v.height) || fichier.height;
      const auteur = String(v.user?.name || 'Pexels');
      out.push({
        id: `pexels-video-${v.id}`,
        provider: 'pexels',
        providerAssetId: String(v.id),
        type: 'video',
        largeur,
        hauteur,
        orientation: orientationDesDimensions(largeur, hauteur),
        dureeSecondes: Number(v.duration) || undefined,
        vignetteUrl: String(v.video_pictures?.[0]?.picture || v.image || ''),
        apercuUrl: String(v.image || v.video_pictures?.[0]?.picture || ''),
        fichierUrl: fichier.link,
        sourceUrl: String(v.url || `https://www.pexels.com/video/${v.id}/`),
        auteur,
        auteurUrl: v.user?.url ? String(v.user.url) : undefined,
        description: motsDuSlug(String(v.url || '')),
        licence: 'Licence Pexels',
        attribution: `Vidéo de ${auteur} sur Pexels`,
      });
    }
    return out;
  }
  const data = await appeler(deps, 'pexels', `https://api.pexels.com/v1/search?${q}`, { Authorization: cle });
  return (Array.isArray(data?.photos) ? data.photos : []).filter((ph: any) => ph?.id != null && ph?.src).map((ph: any): MediaStock => {
    const largeur = Number(ph.width) || 0;
    const hauteur = Number(ph.height) || 0;
    const auteur = String(ph.photographer || 'Pexels');
    return {
      id: `pexels-photo-${ph.id}`,
      provider: 'pexels',
      providerAssetId: String(ph.id),
      type: 'photo',
      largeur,
      hauteur,
      orientation: orientationDesDimensions(largeur, hauteur),
      vignetteUrl: String(ph.src.small || ph.src.tiny || ph.src.medium || ''),
      apercuUrl: String(ph.src.medium || ph.src.small || ''),
      fichierUrl: String(ph.src.large2x || ph.src.large || ph.src.original || ''),
      sourceUrl: String(ph.url || `https://www.pexels.com/photo/${ph.id}/`),
      auteur,
      auteurUrl: ph.photographer_url ? String(ph.photographer_url) : undefined,
      description: String(ph.alt || motsDuSlug(String(ph.url || ''))),
      licence: 'Licence Pexels',
      attribution: `Photo de ${auteur} sur Pexels`,
    };
  });
}

export async function rechercherUnsplash(p: ParametresAdaptateur, deps: DependancesStock): Promise<MediaStock[]> {
  // Unsplash ne sert QUE des photos : aucune requête n'est faite pour une vidéo.
  if (p.type !== 'photo') return [];
  const cle = deps.cles.unsplash;
  if (!cle) throw new ErreurFournisseurStock('unsplash', 'non_configure');
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(p.requete)}&per_page=${p.parPage}&page=${p.page}&orientation=${ORIENTATION_UNSPLASH[p.orientation]}`;
  const data = await appeler(deps, 'unsplash', url, { Authorization: `Client-ID ${cle}`, 'Accept-Version': 'v1' });
  return (Array.isArray(data?.results) ? data.results : []).filter((ph: any) => ph?.id && ph?.urls).map((ph: any): MediaStock => {
    const largeur = Number(ph.width) || 0;
    const hauteur = Number(ph.height) || 0;
    const auteur = String(ph.user?.name || 'Unsplash');
    const profil = ph.user?.links?.html ? `${ph.user.links.html}?${UTM_UNSPLASH}` : undefined;
    return {
      id: `unsplash-photo-${ph.id}`,
      provider: 'unsplash',
      providerAssetId: String(ph.id),
      type: 'photo',
      largeur,
      hauteur,
      orientation: orientationDesDimensions(largeur, hauteur),
      vignetteUrl: String(ph.urls.thumb || ph.urls.small || ''),
      apercuUrl: String(ph.urls.small || ph.urls.regular || ''),
      fichierUrl: String(ph.urls.regular || ph.urls.full || ''),
      sourceUrl: ph.links?.html ? `${ph.links.html}?${UTM_UNSPLASH}` : `https://unsplash.com/photos/${ph.id}?${UTM_UNSPLASH}`,
      auteur,
      auteurUrl: profil,
      description: String(ph.alt_description || ph.description || ''),
      licence: 'Licence Unsplash',
      attribution: `Photo de ${auteur} sur Unsplash`,
      downloadLocation: ph.links?.download_location ? String(ph.links.download_location) : undefined,
    };
  });
}

/** Relit UNE vidéo Pexels par son identifiant (import : on ne fait jamais confiance à une URL du client). */
export async function videoPexelsParId(id: string, deps: DependancesStock): Promise<MediaStock | null> {
  if (!/^\d{1,12}$/.test(id)) return null;
  const cle = deps.cles.pexels;
  if (!cle) throw new ErreurFournisseurStock('pexels', 'non_configure');
  const v = await appeler(deps, 'pexels', `https://api.pexels.com/videos/videos/${id}`, { Authorization: cle });
  const fichier = choisirFichierVideo(Array.isArray(v?.video_files) ? v.video_files : []);
  if (!fichier) return null;
  const auteur = String(v.user?.name || 'Pexels');
  const largeur = Number(v.width) || fichier.width;
  const hauteur = Number(v.height) || fichier.height;
  return {
    id: `pexels-video-${id}`,
    provider: 'pexels',
    providerAssetId: id,
    type: 'video',
    largeur,
    hauteur,
    orientation: orientationDesDimensions(largeur, hauteur),
    dureeSecondes: Number(v.duration) || undefined,
    vignetteUrl: String(v.video_pictures?.[0]?.picture || v.image || ''),
    apercuUrl: String(v.image || ''),
    fichierUrl: fichier.link,
    sourceUrl: String(v.url || `https://www.pexels.com/video/${id}/`),
    auteur,
    auteurUrl: v.user?.url ? String(v.user.url) : undefined,
    description: motsDuSlug(String(v.url || '')),
    licence: 'Licence Pexels',
    attribution: `Vidéo de ${auteur} sur Pexels`,
  };
}

/** Le fichier HD d'une vidéo Pexels ne vient QUE de ces hôtes. */
export function hoteVideoPexelsAutorise(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'videos.pexels.com' || u.hostname.endsWith('.pexels.com')
      || (u.hostname === 'player.vimeo.com' && u.pathname.startsWith('/external/')));
  } catch {
    return false;
  }
}

/**
 * Unsplash exige de signaler chaque photo réellement CHOISIE (pas affichée)
 * via son `download_location`. On relit la photo par son identifiant : jamais
 * une URL fournie par le client.
 */
export async function signalerTelechargementUnsplash(id: string, deps: DependancesStock): Promise<MediaStock | null> {
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(id)) return null;
  const cle = deps.cles.unsplash;
  if (!cle) throw new ErreurFournisseurStock('unsplash', 'non_configure');
  const headers = { Authorization: `Client-ID ${cle}`, 'Accept-Version': 'v1' };
  const ph = await appeler(deps, 'unsplash', `https://api.unsplash.com/photos/${encodeURIComponent(id)}`, headers);
  const loc = ph?.links?.download_location;
  if (typeof loc === 'string' && loc.startsWith('https://api.unsplash.com/')) {
    await appeler(deps, 'unsplash', loc, headers).catch(() => null);
  }
  if (!ph?.urls) return null;
  const largeur = Number(ph.width) || 0;
  const hauteur = Number(ph.height) || 0;
  const auteur = String(ph.user?.name || 'Unsplash');
  return {
    id: `unsplash-photo-${id}`,
    provider: 'unsplash',
    providerAssetId: id,
    type: 'photo',
    largeur,
    hauteur,
    orientation: orientationDesDimensions(largeur, hauteur),
    vignetteUrl: String(ph.urls.thumb || ''),
    apercuUrl: String(ph.urls.small || ''),
    fichierUrl: String(ph.urls.regular || ph.urls.full || ''),
    sourceUrl: ph.links?.html ? `${ph.links.html}?${UTM_UNSPLASH}` : `https://unsplash.com/photos/${id}?${UTM_UNSPLASH}`,
    auteur,
    auteurUrl: ph.user?.links?.html ? `${ph.user.links.html}?${UTM_UNSPLASH}` : undefined,
    description: String(ph.alt_description || ph.description || ''),
    licence: 'Licence Unsplash',
    attribution: `Photo de ${auteur} sur Unsplash`,
    downloadLocation: typeof loc === 'string' ? loc : undefined,
  };
}

/** Relit UNE photo Pexels par son identifiant. */
export async function photoPexelsParId(id: string, deps: DependancesStock): Promise<MediaStock | null> {
  if (!/^\d{1,12}$/.test(id)) return null;
  const cle = deps.cles.pexels;
  if (!cle) throw new ErreurFournisseurStock('pexels', 'non_configure');
  const ph = await appeler(deps, 'pexels', `https://api.pexels.com/v1/photos/${id}`, { Authorization: cle });
  if (!ph?.src) return null;
  const largeur = Number(ph.width) || 0;
  const hauteur = Number(ph.height) || 0;
  const auteur = String(ph.photographer || 'Pexels');
  return {
    id: `pexels-photo-${id}`,
    provider: 'pexels',
    providerAssetId: id,
    type: 'photo',
    largeur,
    hauteur,
    orientation: orientationDesDimensions(largeur, hauteur),
    vignetteUrl: String(ph.src.small || ''),
    apercuUrl: String(ph.src.medium || ''),
    fichierUrl: String(ph.src.large2x || ph.src.large || ''),
    sourceUrl: String(ph.url || `https://www.pexels.com/photo/${id}/`),
    auteur,
    auteurUrl: ph.photographer_url ? String(ph.photographer_url) : undefined,
    description: String(ph.alt || ''),
    licence: 'Licence Pexels',
    attribution: `Photo de ${auteur} sur Pexels`,
  };
}
