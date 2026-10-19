/**
 * Côté NAVIGATEUR : appeler `POST /api/convert/to-mp4` comme le serveur
 * l'attend désormais (PR-F).
 *
 * - `plafondConversionServeur()` lit le plafond de taille d'une source
 *   (`GET /api/convert/to-mp4`), pour refuser AVANT de téléverser. La
 *   valeur vient du serveur (réglable par `STUDIIO_CONVERSION_MAX_OCTETS`),
 *   jamais d'une constante recopiée ici. Injoignable → `null` : on laisse
 *   alors le serveur trancher (413 avant lecture), rien n'est bloqué.
 * - `appelerConversionMp4()` fait le POST et, sur 429 (« une conversion est
 *   déjà en cours »), attend `Retry-After` puis RETENTE, en prévenant
 *   l'écran ; tant que l'échéance globale le permet. Au-delà, le 429 est
 *   rendu tel quel : son message est explicite et l'appelant l'affiche.
 *
 * Aucun import serveur : ce module part dans le bundle client.
 */
import { ATTENTE_CLIENT_CONVERSION_MS } from '@/lib/ffmpeg/limiteur-conversions';

const ROUTE = '/api/convert/to-mp4';
const RETRY_AFTER_DEFAUT_S = 30;
const RETRY_AFTER_MAX_S = 60;

type Fetch = typeof fetch;

/** « 300 Mo » — lisible, arrondi à l'unité. */
export function libelleOctets(octets: number): string {
  return `${Math.round(octets / (1024 * 1024))} Mo`;
}

export function messageSourceTropVolumineuse(taille: number, max: number): string {
  return `Vidéo trop volumineuse pour la conversion MP4 (${libelleOctets(taille)}, maximum ${libelleOctets(max)}). `
    + 'Raccourcissez la vidéo ou téléchargez le WebM.';
}

export async function plafondConversionServeur(fetchImpl: Fetch = fetch): Promise<number | null> {
  try {
    const res = await fetchImpl(ROUTE, { method: 'GET' });
    if (!res.ok) return null;
    const corps = await res.json();
    const max = corps?.maxOctets;
    return typeof max === 'number' && Number.isFinite(max) && max > 0 ? max : null;
  } catch {
    return null;
  }
}

function attendreAvecSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resoudre, rejeter) => {
    if (signal?.aborted) { rejeter(new DOMException('Aborted', 'AbortError')); return; }
    const t = setTimeout(() => { signal?.removeEventListener('abort', surAbandon); resoudre(); }, ms);
    function surAbandon() { clearTimeout(t); rejeter(new DOMException('Aborted', 'AbortError')); }
    signal?.addEventListener('abort', surAbandon, { once: true });
  });
}

export interface OptionsAppelConversion {
  signal?: AbortSignal;
  /** Prévient l'écran qu'on attend : message du serveur + secondes avant le nouvel essai. */
  onAttente?: (message: string, secondes: number) => void;
  /** Échéance totale, en ms depuis l'appel. Défaut : `ATTENTE_CLIENT_CONVERSION_MS`. */
  echeanceMs?: number;
  fetchImpl?: Fetch;
}

export async function appelerConversionMp4(
  videoUrl: string,
  options: OptionsAppelConversion = {},
): Promise<Response> {
  const { signal, onAttente, fetchImpl = fetch } = options;
  const fin = Date.now() + (options.echeanceMs ?? ATTENTE_CLIENT_CONVERSION_MS);

  for (;;) {
    const res = await fetchImpl(ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoUrl }),
      signal,
    });
    if (res.status !== 429) return res;

    const brut = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
    const secondes = Math.min(RETRY_AFTER_MAX_S, Math.max(0, Number.isFinite(brut) ? brut : RETRY_AFTER_DEFAUT_S));
    // Plus le temps d'attendre : le 429 part tel quel, avec son message.
    if (Date.now() + secondes * 1000 >= fin) return res;

    let message = 'Une conversion est déjà en cours.';
    try {
      const corps = await res.clone().json();
      if (typeof corps?.error === 'string' && corps.error) message = corps.error;
    } catch { /* corps illisible : message par défaut */ }
    onAttente?.(message, secondes);
    await attendreAvecSignal(secondes * 1000, signal);
  }
}
