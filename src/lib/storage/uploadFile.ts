/**
 * Envoi d'un fichier vers le stockage, depuis le navigateur.
 *
 * ⚠️ XHR ET NON `fetch`, ET C'EST TOUT L'INTÉRÊT.
 *
 * `fetch` n'expose AUCUN événement de progression à l'envoi : une fois le
 * `body` remis, on ne sait plus rien jusqu'à la réponse. Sur un rush de
 * 75 Mo, cela veut dire une minute d'écran figé sur « Uploader… » sans
 * qu'on puisse distinguer un envoi lent d'un envoi mort. `XMLHttpRequest`
 * a `upload.onprogress`, et c'est la seule API du navigateur qui l'a.
 *
 * ── DEUX MODES, UN SEUL APPELANT ────────────────────────────────────────
 *
 * `/api/upload/signed-url` répond soit :
 *
 * - `mode: 'direct'` — une URL **présignée MinIO** : le navigateur écrit
 *   DIRECTEMENT dans le stockage. C'est ce qui règle les 502 : le fichier ne
 *   traverse plus l'application, donc Traefik n'a plus de connexion longue à
 *   couper.
 * - `mode: 'proxy'` — une URL de l'application, qui relaie vers MinIO en
 *   interne. Le comportement historique, gardé tant que l'endpoint public
 *   n'est pas déployé.
 *
 * Des deux côtés c'est un `PUT` du fichier en corps : l'appelant n'a pas à
 * savoir lequel il utilise.
 */

export type UploadMode = 'direct' | 'proxy';

export interface UploadResult {
  publicUrl: string;
  path: string;
  bucket: string;
  /** Chemin réellement emprunté — utile aux journaux et aux diagnostics. */
  mode: UploadMode;
}

export interface UploadOptions {
  /** Dossier logique de destination : `rush`, `library`, `voice`… */
  purpose?: string;
  /** Avancement de 0 à 100. Appelé souvent : garder le traitement léger. */
  onProgress?: (percent: number) => void;
  /** Permet d'interrompre un envoi en cours. */
  signal?: AbortSignal;
}

/** Message d'erreur d'un PUT raté — le statut y figure toujours. */
function messageEchec(status: number): string {
  // Le message d'avant citait « Supabase » alors que le stockage est MinIO
  // depuis la migration : il envoyait chercher la panne au mauvais endroit.
  if (status === 0) return 'Upload interrompu (connexion perdue)';
  if (status === 413) return 'Upload échoué (HTTP 413) — fichier trop volumineux';
  if (status === 502 || status === 504) {
    return `Upload échoué (HTTP ${status}) — la connexion a été coupée avant la fin`;
  }
  return `Upload échoué (HTTP ${status})`;
}

/**
 * Envoie le fichier en `PUT`, en rapportant l'avancement.
 *
 * Résout sur 2xx, rejette sinon — le statut est dans le message.
 */
function putAvecProgression(
  url: string,
  file: File | Blob,
  contentType: string,
  options: { withCredentials: boolean; onProgress?: (p: number) => void; signal?: AbortSignal },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    // Le relais applicatif s'authentifie par cookie de session ; une URL
    // présignée porte sa propre signature et n'en veut PAS — envoyer des
    // identifiants à MinIO ferait échouer la vérification.
    xhr.withCredentials = options.withCredentials;
    xhr.setRequestHeader('Content-Type', contentType);

    if (options.onProgress) {
      xhr.upload.onprogress = (e) => {
        // `lengthComputable` est faux tant que la taille totale est inconnue :
        // annoncer un pourcentage calculé sur zéro afficherait « Infinity % ».
        if (!e.lengthComputable || e.total <= 0) return;
        options.onProgress!(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // 100 % explicite : le dernier `onprogress` peut manquer, et une barre
        // qui s'arrête à 98 % laisse croire à un envoi incomplet.
        options.onProgress?.(100);
        resolve();
        return;
      }
      reject(new Error(messageEchec(xhr.status)));
    };
    // `status` vaut 0 sur une erreur réseau : le message le dit autrement.
    xhr.onerror = () => reject(new Error(messageEchec(0)));
    xhr.ontimeout = () => reject(new Error('Upload échoué — délai dépassé'));

    if (options.signal) {
      if (options.signal.aborted) { xhr.abort(); reject(new Error('Upload annulé')); return; }
      options.signal.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.onabort = () => reject(new Error('Upload annulé'));
    }

    xhr.send(file);
  });
}

/**
 * Demande une URL d'envoi, puis y dépose le fichier.
 *
 * Rend l'URL publique de lecture, telle que la route la calcule — c'est elle
 * qu'il faut persister, pas l'URL d'envoi, qui expire.
 */
export async function uploadFile(
  file: File,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const res = await fetch('/api/upload/signed-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      purpose: options.purpose || 'rush',
    }),
    signal: options.signal,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success || !data.signedUrl) {
    throw new Error(data?.error || `Préparation de l'upload échouée (HTTP ${res.status})`);
  }

  const mode: UploadMode = data.mode === 'direct' ? 'direct' : 'proxy';
  const contentType = file.type || 'application/octet-stream';

  await putAvecProgression(data.signedUrl, file, contentType, {
    withCredentials: mode === 'proxy',
    onProgress: options.onProgress,
    signal: options.signal,
  });

  return {
    publicUrl: data.publicUrl,
    path: data.path,
    bucket: data.bucket,
    mode,
  };
}
