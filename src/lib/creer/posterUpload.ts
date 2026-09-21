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
 *
 * ── Pourquoi l'URL publique est rendue ABSOLUE ici ──────────────────────────
 *
 * En production (`STORAGE_PROVIDER=s3`), `/api/upload/signed-url` renvoie une
 * `publicUrl` RELATIVE : `/storage/v1/object/public/media/<user>/image/…`,
 * servie par l'application elle-meme qui relaie MinIO. Une balise `<img>`
 * l'affiche sans broncher, si bien que le bug ne se voit pas a l'envoi.
 *
 * Mais le brouillon d'auto-sauvegarde (`draft.ts`, `sanitizeDraft`) n'accepte
 * pour `posterUrl`, `seqBackgrounds` et `batchPhotoUrls` que des URL
 * `^https?://` — et c'est VOULU : c'est ce filtre qui tient les `data:` et
 * `blob:` hors du `localStorage`. Une URL relative y est donc jetee au
 * rechargement : la photo « perso » disparait, et `urlUtilisable`
 * (`posterPhotos.ts`) la cache aussi de la grille. Le filtre ne doit pas etre
 * assoupli ; c'est la valeur qui doit etre correcte des sa production.
 *
 * Le seul endroit ou passer, c'est ici : `uploadPosterFile` est le point
 * central de tous les envois d'affiche (« Ma photo », affiches de Serie).
 * On resout l'URL relative contre `window.location.origin` — l'origine de
 * Studiio, celle qui sert bel et bien `/storage/v1/...`. Une `publicUrl`
 * impossible a rendre absolue en http(s) est traitee comme un echec d'envoi
 * (repli data URL, raison affichable), jamais renvoyee telle quelle.
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
 * Rend absolue l'URL publique renvoyee par le stockage, ou `null` si elle
 * n'est pas exploitable.
 *
 * Semantique, valeur par valeur :
 *   - `https://cdn/x.jpg`, `http://…`  → renvoyee TELLE QUELLE (aucune
 *     re-serialisation, l'appelant peut comparer a l'identique) ;
 *   - `/storage/v1/…`, `storage/v1/…`  → resolue contre `origin`
 *     (`new URL(publicUrl, origin).href`) ;
 *   - `//hote/x` (protocol-relative)    → c'est une URL absolue vers un AUTRE
 *     hote deguisee en chemin ; acceptee seulement si cet hote est celui de
 *     `origin`, sinon `null`. Le stockage ne produit jamais cette forme, et
 *     un relais MinIO ne doit pas pouvoir rediriger l'image ailleurs ;
 *   - `data:`, `blob:`, `javascript:` ou tout autre schema → `null` ;
 *   - vide, blancs, `origin` invalide ou non http(s) → `null`.
 *
 * Pure : pas d'acces a `window`, pour etre testable sur des valeurs.
 */
export function urlPubliqueAbsolue(publicUrl: string, origin: string): string | null {
  const brut = typeof publicUrl === 'string' ? publicUrl.trim() : '';
  if (!brut) return null;

  // Deja absolue en http(s) : on ne touche a rien.
  if (/^https?:\/\//i.test(brut)) {
    try { new URL(brut); } catch { return null; }
    return brut;
  }

  // Un autre schema (`data:`, `blob:`, `javascript:`, `mailto:`…) : jamais.
  if (/^[a-z][a-z0-9+.-]*:/i.test(brut)) return null;

  let base: URL;
  try { base = new URL(origin); } catch { return null; }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') return null;

  let resolue: URL;
  try { resolue = new URL(brut, base); } catch { return null; }
  if (resolue.protocol !== 'http:' && resolue.protocol !== 'https:') return null;

  // `//evil.com/x` se resout vers evil.com : refuse, sauf si c'est notre hote.
  if (brut.startsWith('//') && resolue.host !== base.host) return null;

  return resolue.href;
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

    // Voir l'en-tete du module : en production la `publicUrl` est relative
    // (`/storage/v1/…`), et le brouillon n'accepte que de l'absolu http(s).
    const url = urlPubliqueAbsolue(String(signData.publicUrl), window.location.origin);
    if (!url) return fallback('URL publique inexploitable');

    return { url, dataUrl: false };
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
