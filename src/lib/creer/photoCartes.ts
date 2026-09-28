/**
 * Téléversement de la photo des cartes, BORNÉ dans le temps.
 *
 * Il a lieu APRÈS le débit du montage et AVANT `POST /api/posts`. Sans
 * délai maximal, un stockage qui ne répond plus laisserait l'utilisateur
 * débité sans que son post soit jamais créé. La photo n'est qu'un
 * confort pour « Régénérer » : au délai, ou au moindre échec, on rend
 * `undefined` et le post part sans elle — le Calendrier redessinera les
 * cartes, comme avant.
 *
 * Ne lève jamais.
 */
import { uploadPosterFile, type PosterUploadResult } from './posterUpload';
import { photoCartesPourMetadata, type PhotoCartes, type RectPhoto } from './postMetadata/rendu-fidele';

export const DELAI_PHOTO_CARTES_MS = 10_000;

export interface DepsPhotoCartes {
  upload?: (f: File) => Promise<PosterUploadResult>;
  delaiMs?: number;
}

/** `null` si la promesse n'aboutit pas dans le délai. */
function borner<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

export async function televerserPhotoCartes(
  canvas: HTMLCanvasElement,
  rect: RectPhoto,
  metadata: unknown,
  deps: DepsPhotoCartes = {},
): Promise<PhotoCartes | undefined> {
  const upload = deps.upload ?? uploadPosterFile;
  const delai = deps.delaiMs ?? DELAI_PHOTO_CARTES_MS;
  try {
    // UN seul délai pour tout le parcours (encodage + signature + PUT).
    const envoi = await borner((async () => {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return null;
      return upload(new File([blob], 'cartes.png', { type: 'image/png' }));
    })(), delai);
    if (!envoi || envoi.dataUrl) return undefined;
    return photoCartesPourMetadata(envoi.url, rect, metadata);
  } catch {
    return undefined;
  }
}
