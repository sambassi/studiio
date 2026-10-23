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
import { estMediaIndisponible } from '@/lib/rendus/medias-requis';
import { pleinCadreDesJumeaux } from '@/lib/creer/jumeau-plein-cadre-client';

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
  /**
   * Facultatif : l'etape en cours (« Envoi du montage… 42 % ») et la
   * signature du contenu, qui permet de reprendre l'ENVOI SEUL apres un
   * echec, sans recomposer (`rendreEtFacturer`, `cleReprise`).
   */
  suivi?: { etape?: (texte: string) => void; cleReprise?: string },
): Promise<MontageLivre> {
  let vignette: Blob | null = null;
  // Un media necessaire introuvable a un message PROPRE, plus utile que le
  // generique « la composition a echoue » : on le garde pour le relever.
  let mediaManquant: Error | null = null;
  // Jumeau DÉJÀ stocké avec bandes incrustées : sa version plein cadre
  // (dérivée localement, sans fournisseur ni crédit) — AVANT la tentative.
  await pleinCadreDesJumeaux(options);

  const livraison = await rendreEtFacturer({
    operation,
    format,
    etape: suivi?.etape,
    cleReprise: suivi?.cleReprise,
    composer: async () => {
      try {
        const rendu = await composeVideo(options);
        // La vignette voyage AVEC le montage : une reprise d'envoi, qui ne
        // recompose pas, la retrouve ainsi.
        return { video: rendu.video, annexe: rendu.thumbnail };
      } catch (e) {
        if (estMediaIndisponible(e)) mediaManquant = e;
        throw e;
      }
    },
  });

  if (!livraison.ok || !livraison.blob) {
    if (mediaManquant) throw mediaManquant;
    throw Object.assign(new Error(messagePour(livraison.motif)), {
      reprenable: livraison.reprenable === true,
    });
  }
  if (livraison.annexe instanceof Blob) vignette = livraison.annexe;

  return {
    blob: livraison.blob,
    url: livraison.url ?? null,
    thumbnailUrl: vignette ? await televerserVignette(vignette) : null,
    composerVersion: CURRENT_COMPOSER_VERSION,
  };
}
