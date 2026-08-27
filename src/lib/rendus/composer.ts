/**
 * Composer ET facturer, avec la meme signature que `composeAndUpload`.
 *
 * L'editeur avance appelle le compositeur avec un objet d'options de plus de
 * cent lignes. Le faire passer par le parcours facture ne doit pas obliger a
 * y toucher : ce module offre donc un remplacant au meme contrat de retour,
 * qui insere la tentative serveur autour de la composition.
 *
 * Ordre garanti : tentative -> composition -> televersement vers LA cle
 * attribuee -> verification serveur -> livraison. Une composition non
 * confirmee leve, donc n'est jamais livree.
 */
import { composeVideo, CURRENT_COMPOSER_VERSION, type ComposerOptions } from '@/lib/video-composer';
import { rendreEtFacturer, messagePour, type OperationRendu } from '@/lib/rendus/client';

/**
 * Televerse la vignette par le chemin ordinaire.
 *
 * Elle n'est pas facturee et ne sert de preuve a rien : c'est le MONTAGE qui
 * fait foi. Elle passe donc par `/api/upload/signed-url`, comme avant.
 */
export async function televerserVignette(vignette: Blob): Promise<string | null> {
  try {
    const res = await fetch('/api/upload/signed-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: `vignette-${Date.now()}.jpg`,
        contentType: vignette.type || 'image/jpeg',
        purpose: 'thumbnail',
      }),
    });
    const json = await res.json();
    if (!json?.success || !json?.signedUrl) return null;
    const put = await fetch(json.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': vignette.type || 'image/jpeg' },
      body: vignette,
    });
    return put.ok ? (json.publicUrl ?? null) : null;
  } catch {
    return null;
  }
}

export interface MontageLivre {
  blob: Blob;
  url: string | null;
  thumbnailUrl: string | null;
  composerVersion: string;
}

/**
 * Remplace `composeAndUpload` sur les parcours factures.
 *
 * Leve si le serveur ne confirme pas — l'appelant traite deja ce cas par son
 * `try/catch` d'iteration, qui saute la creation du post. Rien n'est livre,
 * rien n'est debite.
 */
export async function composerEtFacturer(
  operation: OperationRendu,
  format: 'reel' | 'tv',
  options: ComposerOptions,
): Promise<MontageLivre> {
  let vignette: Blob | null = null;

  const livraison = await rendreEtFacturer({
    operation,
    format,
    composer: async () => {
      const rendu = await composeVideo(options);
      vignette = rendu.thumbnail;
      return rendu.video;
    },
  });

  if (!livraison.ok || !livraison.blob) {
    throw new Error(messagePour(livraison.motif));
  }

  return {
    blob: livraison.blob,
    url: livraison.url ?? null,
    thumbnailUrl: vignette ? await televerserVignette(vignette) : null,
    composerVersion: CURRENT_COMPOSER_VERSION,
  };
}
