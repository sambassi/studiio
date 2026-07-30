/**
 * Envoi d'une photo d'affiche choisie sur le bureau.
 *
 * Pourquoi ce module : le bouton « Ma photo » de l'editeur lisait le fichier en
 * `FileReader.readAsDataURL` et poussait le base64 dans le pool d'affiches.
 * Deux consequences mesurables :
 *
 *   1. `pexelsPhotos` fait partie de l'instantane d'auto-sauvegarde. Une photo
 *      de 3 Mo devient ~4 Mo de base64 : `localStorage.setItem` leve
 *      `QuotaExceededError`, attrapee en silence — l'auto-sauvegarde du
 *      montage s'arrete alors sans que rien ne le signale.
 *   2. Le data URL partait tel quel dans `metadata.posterUrl` de CHAQUE post
 *      du lot : un batch de 30 ecrivait 30 fois la meme image en base.
 *
 * On passe donc par le meme chemin que les rushes et l'audio :
 * `/api/upload/signed-url` puis `PUT` direct vers le stockage, et on ne garde
 * que l'URL publique.
 */

/** Resultat d'un envoi. `dataUrl` signale le repli, jamais le chemin nominal. */
export interface PosterUploadResult {
  url: string;
  /** `true` si l'envoi a echoue et qu'on est retombe sur un data URL local. */
  dataUrl: boolean;
  /** Renseigne uniquement en cas de repli, pour l'afficher a l'utilisateur. */
  reason?: string;
}

/** Lecture locale — utilisee seulement en repli. */
function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const out = ev.target?.result;
      if (typeof out === 'string') resolve(out);
      else reject(new Error('lecture illisible'));
    };
    reader.onerror = () => reject(new Error('lecture impossible'));
    reader.readAsDataURL(file);
  });
}

/**
 * Envoie le fichier et renvoie son URL publique.
 *
 * ⚠️ Ne leve jamais. Si la signature ou le `PUT` echoue, on retombe sur le
 * data URL — c'est-a-dire exactement le comportement d'avant ce module : un
 * incident de stockage ne doit pas empecher l'utilisateur d'utiliser sa photo.
 * L'appelant peut prevenir grace au drapeau `dataUrl`.
 */
export async function uploadPosterFile(file: File): Promise<PosterUploadResult> {
  const fallback = async (reason: string): Promise<PosterUploadResult> => ({
    url: await readAsDataUrl(file),
    dataUrl: true,
    reason,
  });

  if (typeof window === 'undefined' || typeof fetch === 'undefined') {
    // Rendu serveur : aucun fichier a envoyer, l'appel n'a pas de sens.
    return { url: '', dataUrl: false, reason: 'hors navigateur' };
  }

  try {
    const signRes = await fetch('/api/upload/signed-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name || 'affiche.jpg',
        contentType: file.type || 'image/jpeg',
        purpose: 'image',
      }),
    });
    const signData = await signRes.json().catch(() => null);
    if (!signRes.ok || !signData?.success || !signData?.signedUrl || !signData?.publicUrl) {
      return fallback(signData?.error || `signature refusee (HTTP ${signRes.status})`);
    }

    const putRes = await fetch(signData.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'image/jpeg' },
      body: file,
    });
    if (!putRes.ok) return fallback(`envoi refuse (HTTP ${putRes.status})`);

    return { url: signData.publicUrl as string, dataUrl: false };
  } catch (err) {
    return fallback(err instanceof Error ? err.message : 'reseau indisponible');
  }
}

/**
 * Index de l'affiche a utiliser pour la Nieme video du lot.
 *
 * Extrait de la boucle d'export pour etre testable : c'est la regle « une
 * affiche differente par video, jamais deux fois la meme d'affilee » que la
 * tache demande de garantir. Avec un pool de taille 1, la repetition est
 * inevitable et assumee.
 */
export function posterIndexForBatchItem(
  batchIndex: number,
  poolSize: number,
  explicit?: number,
): number {
  if (typeof explicit === 'number') return explicit;
  if (poolSize <= 0) return -1;
  return batchIndex % poolSize;
}
