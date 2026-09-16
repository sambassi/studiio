/**
 * Envoyer un formulaire (multipart) à une route de l'application EN VOYANT
 * les octets réellement transférés — ce que `fetch` ne sait pas dire.
 *
 * `uploadFile` (lib/storage) fait la même chose pour un objet de stockage
 * (URL signée / relais) ; ici c'est le cas d'une route applicative qui reçoit
 * un `FormData` (`POST /api/avatar/create`, `POST /api/avatar/did/consentement/video`).
 * Le contrat de la route ne change pas : mêmes champs, même réponse JSON.
 *
 * La progression rapportée est celle de l'ENVOI (`xhr.upload.onprogress`,
 * `loaded / total`) — et rien d'autre : une fois les octets partis, le
 * serveur travaille, et cette fonction n'invente aucune progression pour
 * lui (cahier UX, Annexe A). Aucun `fetch` global n'est touché.
 */

export interface ProgressionEnvoi { charges: number; total: number; pourcentage: number }

export interface ReponseEnvoi<T = unknown> { ok: boolean; status: number; json: T | null }

export interface OptionsEnvoi {
  onProgression?: (p: ProgressionEnvoi) => void;
  signal?: AbortSignal;
  /** Injectable pour les tests. */
  creerXhr?: () => XMLHttpRequest;
}

export function formaterOctets(octets: number): string {
  if (!Number.isFinite(octets) || octets < 0) return '0 o';
  if (octets < 1024) return `${Math.round(octets)} o`;
  if (octets < 1024 * 1024) return `${(octets / 1024).toFixed(0)} Ko`;
  return `${(octets / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}

/** « 18,4 Mo / 42,1 Mo » — le détail réel d'un envoi. */
export function detailEnvoi(p: ProgressionEnvoi): string {
  return `${formaterOctets(p.charges)} / ${formaterOctets(p.total)}`;
}

export function envoyerFormulaire<T = unknown>(url: string, corps: FormData, options: OptionsEnvoi = {}): Promise<ReponseEnvoi<T>> {
  return new Promise((resolve, reject) => {
    const xhr = options.creerXhr ? options.creerXhr() : new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.withCredentials = true;
    xhr.responseType = 'text';
    if (options.onProgression) {
      xhr.upload.onprogress = (e) => {
        // Sans `lengthComputable`, on ne connaît pas le total : on ne fabrique pas de pourcentage.
        if (!e.lengthComputable || e.total <= 0) return;
        const charges = Math.min(e.loaded, e.total);
        options.onProgression!({ charges, total: e.total, pourcentage: Math.min(100, Math.round((charges / e.total) * 100)) });
      };
    }
    xhr.onload = () => {
      let json: T | null = null;
      try { json = xhr.responseText ? (JSON.parse(xhr.responseText) as T) : null; } catch { json = null; }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, json });
    };
    xhr.onerror = () => reject(new Error('Connexion impossible.'));
    xhr.onabort = () => reject(new Error('Envoi annulé.'));
    if (options.signal) {
      if (options.signal.aborted) { xhr.abort(); return; }
      options.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    xhr.send(corps);
  });
}
