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

export type UploadMode = 'direct' | 'proxy' | 'multipart';

/**
 * Taille d'un morceau, et seuil de bascule.
 *
 * 8 Mio : le minimum imposé par S3 est de 5 Mio pour tout morceau sauf le
 * dernier. En dessous du seuil, découper coûterait trois allers-retours de
 * signature pour un fichier qui part en une fois.
 */
export const PART_SIZE = 8 * 1024 * 1024;
export const MULTIPART_THRESHOLD = 8 * 1024 * 1024;

/** Tentatives par morceau — et pour l'envoi en un bloc. */
export const MAX_TENTATIVES = 3;

/**
 * Découpage d'un fichier en morceaux.
 *
 * Fonction PURE, pour que le calcul soit vérifiable sur des valeurs plutôt
 * que sur un transfert réel : une erreur d'un octet aux bornes produit un
 * fichier corrompu que seul un visionnage révélerait.
 */
export function planParts(taille: number, partSize: number = PART_SIZE): Array<{
  partNumber: number; start: number; end: number;
}> {
  const out: Array<{ partNumber: number; start: number; end: number }> = [];
  if (!Number.isFinite(taille) || taille <= 0) return out;
  const p = Math.max(1, Math.floor(partSize));
  for (let debut = 0, n = 1; debut < taille; debut += p, n += 1) {
    out.push({ partNumber: n, start: debut, end: Math.min(debut + p, taille) });
  }
  return out;
}

/**
 * Avancement global, morceaux terminés + morceau en cours.
 *
 * Sans le morceau en cours, la barre resterait figée pendant l'envoi de
 * 8 Mio puis sauterait d'un cran — exactement ce qu'on cherche à éviter.
 */
export function aggregateProgress(
  octetsTermines: number,
  octetsDuMorceauEnCours: number,
  total: number,
): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const envoyes = Math.max(0, octetsTermines) + Math.max(0, octetsDuMorceauEnCours);
  return Math.min(100, Math.round((envoyes / total) * 100));
}

/** Pause croissante entre deux tentatives — 0,5 s, 1 s, 2 s… */
export function backoffMs(tentative: number): number {
  return Math.min(8000, 500 * 2 ** Math.max(0, tentative - 1));
}

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

/** Ré-essaie une opération, avec attente croissante. */
async function avecReprise<T>(
  operation: (tentative: number) => Promise<T>,
  quoi: string,
): Promise<T> {
  let derniere: unknown;
  for (let t = 1; t <= MAX_TENTATIVES; t += 1) {
    try {
      return await operation(t);
    } catch (err) {
      derniere = err;
      // ⚠️ C'EST TOUT L'OBJET DU CORRECTIF. Une coupure du réseau de
      // l'utilisateur — quelques secondes de Wi-Fi, un basculement 4G —
      // annulait la totalité d'un envoi sans point de reprise. Ici, elle ne
      // coûte que la tentative en cours.
      if (t < MAX_TENTATIVES) {
        console.warn(`[upload] ${quoi} — tentative ${t}/${MAX_TENTATIVES} échouée, nouvel essai`);
        await new Promise((r) => setTimeout(r, backoffMs(t)));
      }
    }
  }
  throw derniere instanceof Error ? derniere : new Error(`${quoi} : échec`);
}

/** Un appel à la route multipart. */
async function multipart(corps: Record<string, unknown>): Promise<Record<string, any>> {
  const res = await fetch('/api/upload/multipart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) {
    const e = new Error(data?.error || `multipart ${res.status}`);
    (e as Error & { unsupported?: boolean }).unsupported = res.status === 501;
    throw e;
  }
  return data;
}

/**
 * Envoi découpé, chaque morceau ré-essayable.
 *
 * ⚠️ L'`ETag` DE CHAQUE MORCEAU EST INDISPENSABLE : `completeMultipartUpload`
 * le réclame pour recoller le fichier. Le navigateur ne peut le lire que si
 * MinIO l'expose (`Access-Control-Expose-Headers: ETag`) — sans quoi
 * l'assemblage échoue alors que tous les octets sont arrivés.
 */
async function uploadMultipart(
  file: File, options: UploadOptions, contentType: string,
): Promise<UploadResult> {
  const init = await multipart({
    action: 'initiate', filename: file.name, contentType,
    purpose: options.purpose || 'rush',
  });
  const { uploadId, key, bucket, publicUrl } = init;
  const morceaux = planParts(file.size);
  const faits: Array<{ PartNumber: number; ETag: string }> = [];
  let octetsTermines = 0;

  try {
    for (const m of morceaux) {
      const etag = await avecReprise(async () => {
        const { url } = await multipart({
          action: 'sign-part', uploadId, key, bucket, partNumber: m.partNumber,
        });
        return await putPart(url, file.slice(m.start, m.end), contentType, (envoyes) => {
          options.onProgress?.(aggregateProgress(octetsTermines, envoyes, file.size));
        }, options.signal);
      }, `morceau ${m.partNumber}/${morceaux.length}`);
      faits.push({ PartNumber: m.partNumber, ETag: etag });
      octetsTermines += m.end - m.start;
      options.onProgress?.(aggregateProgress(octetsTermines, 0, file.size));
    }

    const fin = await multipart({ action: 'complete', uploadId, key, bucket, parts: faits });
    options.onProgress?.(100);
    return { publicUrl: fin.publicUrl || publicUrl, path: key, bucket, mode: 'multipart' };
  } catch (err) {
    // Les morceaux déposés n'appartiennent à aucun objet tant que l'envoi
    // n'est ni terminé ni abandonné : sans cet appel, ils resteraient
    // facturés et invisibles.
    try { await multipart({ action: 'abort', uploadId, key, bucket }); } catch { /* best-effort */ }
    throw err;
  }
}

/** `PUT` d'un morceau, avec progression et lecture de l'`ETag`. */
function putPart(
  url: string, blob: Blob, contentType: string,
  onBytes: (envoyes: number) => void, signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    // Une URL présignée porte sa signature : y ajouter un cookie la ferait
    // rejeter.
    xhr.withCredentials = false;
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onBytes(e.loaded); };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(messageEchec(xhr.status)));
        return;
      }
      const etag = xhr.getResponseHeader('ETag');
      if (!etag) {
        // Diagnostic explicite : tous les octets sont arrivés, mais on ne
        // peut pas recoller le fichier.
        reject(new Error(
          'ETag illisible — MinIO doit exposer l’en-tête ETag '
          + '(Access-Control-Expose-Headers) pour cette origine',
        ));
        return;
      }
      resolve(etag.replace(/"/g, ''));
    };
    xhr.onerror = () => reject(new Error(messageEchec(0)));
    xhr.ontimeout = () => reject(new Error('Morceau : délai dépassé'));
    if (signal) {
      if (signal.aborted) { xhr.abort(); reject(new Error('Upload annulé')); return; }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.onabort = () => reject(new Error('Upload annulé'));
    }
    xhr.send(blob);
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
  const contentTypeFichier = file.type || 'application/octet-stream';

  // ── Gros fichier : envoi découpé, chaque morceau ré-essayable ──────────
  if (file.size > MULTIPART_THRESHOLD) {
    try {
      return await uploadMultipart(file, options, contentTypeFichier);
    } catch (err) {
      // `unsupported` = l'endpoint public n'est pas déployé : on retombe sur
      // l'envoi en un bloc, qui garde sa propre reprise. Toute autre erreur
      // remonte : la masquer ferait recommencer 300 Mo en un seul PUT.
      if (!(err as { unsupported?: boolean })?.unsupported) throw err;
      console.warn('[upload] multipart indisponible — envoi en un bloc');
    }
  }

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

  // Même en un bloc, on ré-essaie : une micro-coupure ne doit pas annuler un
  // envoi qui allait aboutir.
  await avecReprise(() => putAvecProgression(data.signedUrl, file, contentTypeFichier, {
    withCredentials: mode === 'proxy',
    onProgress: options.onProgress,
    signal: options.signal,
  }), 'envoi');

  return {
    publicUrl: data.publicUrl,
    path: data.path,
    bucket: data.bucket,
    mode,
  };
}
