/**
 * Envoi d'un montage DECOUPE en morceaux — cote navigateur.
 *
 * Pourquoi : un `PUT` unique de 62 Mo vers `s3.studiio.pro` n'a aucun point
 * de reprise ; la moindre coupure (ou un delai de proxy sur une requete
 * longue) perd tout le transfert — c'est l'echec `net::ERR_TIMED_OUT` vu en
 * production. Ici, chaque morceau de 8 Mio est une requete courte,
 * re-essayable seule, avec une URL signee juste avant l'essai.
 *
 * Le module ne parle qu'a `/api/render/jobs/<id>/upload` (contrat
 * `rendu-serveur-isolement`) et aux URL de morceaux que ce serveur signe.
 * Aucune URL signee ni identifiant d'envoi n'est ecrit dans la console.
 *
 * Le contenu du fichier n'est jamais modifie : on envoie des `Blob.slice`.
 */
import { planParts, backoffMs } from '@/lib/storage/uploadFile';
import { TAILLE_MORCEAU } from '@/lib/rendus/cible-upload';

export { TAILLE_MORCEAU };
/** En dessous, l'envoi en un bloc historique est garde tel quel. */
export const SEUIL_DECOUPE = TAILLE_MORCEAU;
/** Morceaux en vol simultanement. */
export const PARALLELISME = 3;
/** Essais par morceau (le premier compris). */
export const ESSAIS_PAR_MORCEAU = 4;
/** Un morceau sans aucun octet ACQUITTE pendant ce delai est coupe puis re-essaye. */
export const INACTIVITE_MS = 45_000;

/** Le resultat : decoupe faite, ou serveur qui ne la propose pas. */
export type IssueEnvoi = { ok: true; taille: number; morceaux: number } | { ok: false; indisponible: true };

/** Erreur d'envoi definitive — le message ne porte jamais d'URL. */
export class EchecEnvoi extends Error {
  constructor(message: string) { super(message); this.name = 'EchecEnvoi'; }
}

/** Envoie UN morceau ; rend quand le serveur a repondu 2xx. */
export type TransportMorceau = (
  url: string, corps: Blob, onOctets: (n: number) => void, signal: AbortSignal,
) => Promise<void>;

export interface OptionsEnvoi {
  onProgress?: (pourcent: number) => void;
  /** Injecte pour les tests ; XHR (progression) par defaut, sinon `fetch`. */
  transport?: TransportMorceau;
  tailleMorceau?: number;
  parallelisme?: number;
  essais?: number;
  inactiviteMs?: number;
  /** Attente entre essais ; `backoffMs` par defaut. */
  attente?: (essai: number) => number;
  /** Prefixe des appels serveur (tests hors navigateur). */
  origine?: string;
  /**
   * Etat d'un envoi a REPRENDRE : identifiant d'envoi deja ouvert et
   * morceaux deja deposes. Mis a jour au fil de l'envoi.
   */
  etat?: EtatEnvoiDecoupe;
  /**
   * Echec : garder l'envoi ouvert (morceaux deposes conserves) pour une
   * reprise, au lieu de l'abandonner. MinIO purge seul les envois oublies.
   */
  conserverSiEchec?: boolean;
}

export interface EtatEnvoiDecoupe {
  uploadId?: string;
  faits: Set<number>;
}

/** `PUT` par XHR : seule API navigateur qui rapporte l'avancement d'envoi. */
const transportXhr: TransportMorceau = (url, corps, onOctets, signal) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    // URL presignee : aucun cookie, sinon la signature serait refusee.
    xhr.withCredentials = false;
    xhr.upload.onprogress = (e) => { onOctets(e.loaded); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300
      ? resolve()
      : reject(new EchecEnvoi(`morceau HTTP ${xhr.status}`)));
    xhr.onerror = () => reject(new EchecEnvoi('morceau : connexion perdue'));
    xhr.onabort = () => reject(new EchecEnvoi('morceau : interrompu'));
    if (signal.aborted) { reject(new EchecEnvoi('morceau : interrompu')); return; }
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(corps);
  });

/** Repli sans XHR (tests Node) : pas d'avancement intermediaire. */
const transportFetch: TransportMorceau = async (url, corps, onOctets, signal) => {
  const res = await fetch(url, { method: 'PUT', body: corps, signal });
  if (!res.ok) throw new EchecEnvoi(`morceau HTTP ${res.status}`);
  onOctets(corps.size);
};

function transportParDefaut(): TransportMorceau {
  return typeof XMLHttpRequest !== 'undefined' ? transportXhr : transportFetch;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Envoie `blob` au depot de la tentative `jobId`, en morceaux.
 *
 * - `{ ok: false, indisponible: true }` : le serveur ne propose pas l'envoi
 *   decoupe (pas d'endpoint public) — rien n'a ete ouvert, l'appelant reprend
 *   l'envoi historique.
 * - leve `EchecEnvoi` sur echec definitif, APRES avoir abandonne l'envoi
 *   decoupe (best-effort) : aucun morceau orphelin.
 * - `{ ok: true }` seulement quand le serveur a relu les morceaux, assemble
 *   l'objet et verifie sa taille.
 */
export async function envoyerMontageDecoupe(
  jobId: string, blob: Blob, options: OptionsEnvoi = {},
): Promise<IssueEnvoi> {
  const origine = options.origine ?? '';
  const transport = options.transport ?? transportParDefaut();
  const tailleMorceau = options.tailleMorceau ?? TAILLE_MORCEAU;
  const parallelisme = Math.max(1, options.parallelisme ?? PARALLELISME);
  const essais = Math.max(1, options.essais ?? ESSAIS_PAR_MORCEAU);
  const inactiviteMs = options.inactiviteMs ?? INACTIVITE_MS;
  const attente = options.attente ?? backoffMs;

  const action = async (corps: Record<string, unknown>) => {
    const res = await fetch(`${origine}/api/render/jobs/${encodeURIComponent(jobId)}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(corps),
    });
    const json = await res.json().catch(() => null) as Record<string, unknown> | null;
    return { status: res.status, json };
  };

  const etat: EtatEnvoiDecoupe = options.etat ?? { faits: new Set() };
  if (!etat.uploadId) {
    etat.faits.clear();
    const init = await action({
      action: 'multipart-initiate', taille: blob.size, contentType: blob.type || 'video/webm',
    });
    if (init.status === 501 || init.json?.unsupported) return { ok: false, indisponible: true };
    if (init.status !== 200 || !init.json?.ok || typeof init.json.uploadId !== 'string') {
      throw Object.assign(
        new EchecEnvoi(`ouverture refusee (${String(init.json?.motif ?? init.status)})`),
        { tentativeClose: init.status === 409 },
      );
    }
    etat.uploadId = init.json.uploadId;
  }
  const uploadId = etat.uploadId;

  const tousLesMorceaux = planParts(blob.size, tailleMorceau);
  const envoyes = new Map<number, number>();
  // Reprise : les morceaux deja deposes comptent, et ne repartent pas.
  for (const m of tousLesMorceaux) if (etat.faits.has(m.partNumber)) envoyes.set(m.partNumber, m.end - m.start);
  const morceaux = tousLesMorceaux.filter((m) => !etat.faits.has(m.partNumber));
  let dernierPourcent = -1;
  const signaler = () => {
    let total = 0;
    envoyes.forEach((n) => { total += n; });
    // 99 % au plus tant que le serveur n'a pas assemble et verifie.
    const p = Math.min(99, Math.floor((total / blob.size) * 100));
    if (p !== dernierPourcent) { dernierPourcent = p; options.onProgress?.(p); }
  };

  const envoyerUn = async (m: { partNumber: number; start: number; end: number }) => {
    let derniere: unknown = null;
    for (let essai = 1; essai <= essais; essai += 1) {
      envoyes.set(m.partNumber, 0);
      try {
        // URL signee juste avant CET essai : jamais expiree sur une reprise.
        const sig = await action({ action: 'multipart-sign', uploadId, partNumber: m.partNumber });
        if (sig.status !== 200 || !sig.json?.ok || typeof sig.json.url !== 'string') {
          // Tentative close, quota… : re-essayer ne changera rien.
          if (sig.status === 409 || sig.status === 400) {
            // `envoi_inconnu` : cet envoi n'est plus celui de la tentative —
            // une reprise en ouvrira un neuf. `non_reserve` : tentative close.
            if (sig.json?.motif === 'envoi_inconnu') { etat.uploadId = undefined; etat.faits.clear(); }
            throw Object.assign(new EchecEnvoi(`signature refusee (${sig.status})`), {
              definitif: true, tentativeClose: sig.status === 409 && sig.json?.motif !== 'envoi_inconnu',
            });
          }
          throw new EchecEnvoi(`signature indisponible (${sig.status})`);
        }
        const controleur = new AbortController();
        let veille: ReturnType<typeof setTimeout> | null = null;
        const rearmer = () => {
          if (veille) clearTimeout(veille);
          veille = setTimeout(() => controleur.abort(), inactiviteMs);
        };
        rearmer();
        try {
          await transport(sig.json.url, blob.slice(m.start, m.end), (n) => {
            envoyes.set(m.partNumber, n);
            rearmer();
            signaler();
          }, controleur.signal);
        } finally {
          if (veille) clearTimeout(veille);
        }
        envoyes.set(m.partNumber, m.end - m.start);
        etat.faits.add(m.partNumber);
        signaler();
        return;
      } catch (e) {
        derniere = e;
        envoyes.set(m.partNumber, 0);
        // 404 sur un morceau : l'envoi decoupe n'existe plus (abandonne ou
        // purge). Inutile d'insister ; une reprise en ouvrira un neuf.
        if (e instanceof EchecEnvoi && /HTTP 404\b/.test(e.message)) {
          etat.uploadId = undefined;
          etat.faits.clear();
          break;
        }
        if ((e as { definitif?: boolean })?.definitif) break;
        if (essai < essais) {
          console.warn(`[Rendus] morceau ${m.partNumber}/${tousLesMorceaux.length} — essai ${essai}/${essais} echoue, nouvel essai`);
          await pause(attente(essai));
        }
      }
    }
    throw derniere instanceof EchecEnvoi ? derniere : new EchecEnvoi('morceau : echec');
  };

  try {
    // File de travail partagee par `parallelisme` ouvriers. Le premier echec
    // definitif arrete la distribution des morceaux suivants.
    let suivant = 0;
    let arret: unknown = null;
    const ouvrier = async () => {
      while (arret === null && suivant < morceaux.length) {
        const m = morceaux[suivant];
        suivant += 1;
        try { await envoyerUn(m); } catch (e) { if (arret === null) arret = e; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(parallelisme, morceaux.length) }, ouvrier));
    if (arret !== null) throw arret;

    const fin = await action({ action: 'multipart-complete', uploadId, taille: blob.size });
    if (fin.status !== 200 || !fin.json?.ok) {
      // `incomplet` : le serveur a deja abandonne cet envoi — une reprise
      // devra en ouvrir un neuf.
      if (fin.json?.motif === 'incomplet') { etat.uploadId = undefined; etat.faits.clear(); }
      throw new EchecEnvoi(`assemblage refuse (${String(fin.json?.motif ?? fin.status)})`);
    }
    etat.uploadId = undefined;
    etat.faits.clear();
    options.onProgress?.(100);
    return { ok: true, taille: Number(fin.json.taille), morceaux: Number(fin.json.morceaux) };
  } catch (e) {
    if (!options.conserverSiEchec || !etat.uploadId) {
      // Les morceaux deposes n'appartiennent a aucun objet : on les libere.
      try { await action({ action: 'multipart-abort', uploadId }); } catch { /* best-effort */ }
      etat.uploadId = undefined;
      etat.faits.clear();
    }
    throw e instanceof EchecEnvoi ? e : new EchecEnvoi('envoi interrompu');
  }
}

/** Libere un envoi decoupe laisse ouvert pour reprise (best-effort). */
export async function abandonnerEnvoiDecoupe(jobId: string, etat: EtatEnvoiDecoupe): Promise<void> {
  const uploadId = etat.uploadId;
  etat.uploadId = undefined;
  etat.faits.clear();
  if (!uploadId) return;
  await fetch(`/api/render/jobs/${encodeURIComponent(jobId)}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ action: 'multipart-abort', uploadId }),
  }).catch(() => {});
}
