/**
 * Listes d'abonnes opt-in, servies par afroboost.
 *
 * POURQUOI AUCUN CACHE
 * La liste est relue AVANT CHAQUE ENVOI, volontairement. Un abonne qui repond
 * STOP doit cesser de recevoir des messages immediatement : un cache, meme de
 * quelques minutes, ferait partir des messages a des personnes desabonnees —
 * ce qui est precisement ce qui fait suspendre un WABA ou blacklister un
 * domaine d'envoi. Le cout d'un appel HTTP par diffusion est negligeable a
 * cote.
 *
 * SECURITE
 * `AFROBOOST_LIST_API_KEY` est lue uniquement cote serveur, jamais renvoyee ni
 * journalisee.
 *
 * DEGRADATION
 * Aucune fonction ne throw. Endpoint absent, hors ligne, reponse illisible ou
 * non autorisee : on renvoie une liste VIDE et l'appelant retombe sur son
 * comportement actuel (auto-test). L'endpoint afroboost peut donc ne pas
 * encore exister sans rien casser.
 */

const DEFAULT_LIST_API_URL = 'https://afroboost.com/api/subscribers';

/** Coupe court si l'endpoint ne repond pas : une diffusion ne doit pas pendre. */
const FETCH_TIMEOUT_MS = 8000;

export type SubscriberChannel = 'whatsapp' | 'email';

function listApiUrl(): string {
  return (process.env.AFROBOOST_LIST_API_URL || DEFAULT_LIST_API_URL).trim();
}

/** La source de listes est-elle configuree ? */
export function hasSubscriberSource(): boolean {
  return !!process.env.AFROBOOST_LIST_API_KEY?.trim();
}

/**
 * Recupere les destinataires opt-in confirmes pour un canal.
 *
 * Renvoie toujours un tableau — vide en cas de probleme, jamais d'exception.
 */
export async function fetchSubscribers(channel: SubscriberChannel): Promise<string[]> {
  const key = process.env.AFROBOOST_LIST_API_KEY?.trim();
  if (!key) return [];

  const url = `${listApiUrl()}?channel=${encodeURIComponent(channel)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      // Jamais de cache HTTP non plus : meme raison que ci-dessus.
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[Subscribers] ${channel} : HTTP ${res.status}, repli sur l'auto-test`);
      return [];
    }

    const data = await res.json().catch(() => null);
    const raw = (data as { list?: unknown } | null)?.list;
    if (!Array.isArray(raw)) {
      console.warn(`[Subscribers] ${channel} : reponse sans tableau "list", repli sur l'auto-test`);
      return [];
    }

    const list = raw
      .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
      .map((v) => v.trim());

    console.log(`[Subscribers] ${channel} : ${list.length} abonne(s) opt-in`);
    return list;
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    console.warn(
      `[Subscribers] ${channel} : ${aborted ? 'timeout' : 'endpoint injoignable'}, repli sur l'auto-test`,
    );
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lien de desabonnement, derive de l'origine de l'API de listes.
 *
 * Pas de variable d'environnement supplementaire : si le domaine change,
 * `AFROBOOST_LIST_API_URL` suffit a tout deplacer.
 */
export function unsubscribeUrl(recipient: string): string {
  let origin = 'https://afroboost.com';
  try {
    origin = new URL(listApiUrl()).origin;
  } catch {
    // URL mal formee : on garde le domaine par defaut.
  }
  return `${origin}/desabonnement?contact=${encodeURIComponent(recipient)}`;
}
