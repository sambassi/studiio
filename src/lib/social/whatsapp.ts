/**
 * Canal WhatsApp — Meta WhatsApp Cloud API.
 *
 * SECURITE
 * `STUDIIO_WHATSAPP_TOKEN` est lu UNIQUEMENT depuis l'environnement serveur.
 * Il n'est jamais renvoye au navigateur ni journalise. Les fonctions de ce
 * module ne doivent etre appelees que depuis des routes authentifiees ou le
 * cron protege par CRON_SECRET — jamais depuis un endpoint public.
 *
 * FEATURE FLAG
 * Sans token, `isWhatsAppEnabled()` est faux : le canal reste annonce
 * « Bientot disponible » cote UI et les routes le refusent proprement.
 */

import { isAdmin } from '@/lib/admin';
import { fetchSubscribers } from '@/lib/social/subscribers';

/** Identifiants NON secrets — surchargeables par env si le compte change. */
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '1062611940271584';
const WABA_ID = process.env.WHATSAPP_WABA_ID || '1615280896432370';
const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';

/** Modele approuve pour la diffusion hors fenetre de 24 h. */
const TEMPLATE_NAME = process.env.WHATSAPP_TEMPLATE_NAME || 'afroboost_campagne';
const TEMPLATE_LANG = process.env.WHATSAPP_TEMPLATE_LANG || 'fr';

/** Pause entre deux envois d'une diffusion, en millisecondes. */
const BROADCAST_DELAY_MS = 500;

/**
 * Plafond dur du nombre de destinataires par post.
 *
 * Deux raisons. D'abord le temps : le cron a `maxDuration = 300`, et 500 ms
 * par envoi plafonnent donc autour de 600 destinataires — au-dela la fonction
 * est tuee EN COURS de diffusion, le post n'est jamais marque, il repasse au
 * tour suivant et les destinataires deja servis recoivent le message une
 * seconde fois. Ensuite l'abus : une liste non bornee transforme le WABA en
 * relais de masse.
 *
 * La troncature n'est jamais silencieuse : elle est journalisee et remontee
 * dans le resultat.
 */
export const MAX_RECIPIENTS = 50;

export { WABA_ID };

/** Le canal est-il configure ? Un token vide vaut « non configure ». */
export function isWhatsAppEnabled(): boolean {
  return !!process.env.STUDIIO_WHATSAPP_TOKEN?.trim();
}

/**
 * Le canal est-il utilisable PAR CE COMPTE ?
 *
 * DECISION DE PERIMETRE, a connaitre avant d'elargir : le WABA est celui
 * d'Afroboost. Ouvrir l'envoi a tous les comptes inscrits pose deux problemes
 * qui ne se resolvent pas par du code defensif :
 *
 *  - QUOTA : sans limite de debit ni debit de credits, n'importe qui peut
 *    declencher des envois en boucle et consommer le quota Meta du compte.
 *  - CONFORMITE : Meta exige le consentement prealable du destinataire. Un
 *    tiers ne peut pas l'attester pour des numeros qu'il fournit.
 *
 * Le canal est donc reserve au detenteur du compte Meta. L'ouvrir plus
 * largement suppose un WABA par utilisateur, ou une limite de debit avec
 * debit de credits et une preuve d'opt-in.
 */
export function canUseWhatsApp(email: string | null | undefined): boolean {
  return isWhatsAppEnabled() && isAdmin(email);
}

/**
 * Normalise un numero au format E.164 SANS le « + », attendu par l'API Meta.
 *
 * - retire espaces, tirets, points, parentheses et le « + » eventuel ;
 * - un numero commencant par « 00 » (prefixe international) perd ces deux 0 ;
 * - un numero commencant par un seul « 0 » est considere SUISSE : le 0 initial
 *   est remplace par « 41 ».
 *
 * Renvoie `null` si rien d'exploitable ne reste — l'appelant doit traiter ce
 * cas comme un echec plutot que d'envoyer un numero invalide a Meta.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let n = String(raw).replace(/[\s\-.()]/g, '');
  n = n.replace(/^\+/, '');
  if (n.startsWith('00')) n = n.slice(2);
  else if (n.startsWith('0')) n = `41${n.slice(1)}`;
  if (!/^\d{8,15}$/.test(n)) return null;
  return n;
}

/** Longueur maximale d'un parametre de modele. Meta rejette bien au-dela. */
const MAX_PARAM_LEN = 700;

/**
 * Assainit un parametre de modele.
 *
 * C'est la cause directe de l'erreur Meta 100 « Invalid parameter » : un
 * parametre contenant un SAUT DE LIGNE ou une TABULATION est refuse, et les
 * titres de posts en contiennent regulierement. On aplatit donc tout blanc en
 * espace simple, on borne la longueur, et on garantit une valeur non vide —
 * un parametre vide est rejete tout autant.
 */
export function sanitizeTemplateParam(value: unknown, fallback = 'Nouvelle publication'): string {
  const flat = String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!flat) return fallback;
  return flat.length > MAX_PARAM_LEN ? `${flat.slice(0, MAX_PARAM_LEN - 1).trimEnd()}…` : flat;
}

export interface WhatsAppResult {
  success: boolean;
  /** Identifiant de message Meta (wamid) en cas de succes. */
  messageId?: string;
  error?: string;
  /** Code d'erreur Meta, ex. 132018 (parametres de modele) ou 131030. */
  errorCode?: number;
}

export interface SendWhatsAppOptions {
  /**
   * `template` (defaut) : obligatoire hors fenetre de 24 h.
   * `text` : uniquement si l'on SAIT que le contact a ecrit dans les 24 h,
   * sinon Meta rejette le message.
   */
  kind?: 'template' | 'text';
  /** Corps du message en mode `text`. */
  text?: string;
  /**
   * Parametres du modele, dans l'ORDRE des {{1}}, {{2}}... du modele approuve.
   *
   * ⚠️ Le nombre ET l'ordre doivent correspondre EXACTEMENT au modele valide
   * par Meta. Un decalage renvoie l'erreur 132018
   * (« number of parameters does not match ») et le message n'est pas envoye.
   * Le modele par defaut `afroboost_campagne` attend une seule variable.
   */
  templateParams?: string[];
}

/**
 * Envoie un message WhatsApp a UN destinataire.
 *
 * Ne throw jamais : renvoie toujours un `WhatsAppResult`.
 *
 * Piege Meta : l'API repond frequemment avec un HTTP 200 portant malgre tout
 * un objet `error`, ou un 4xx structure de la meme facon. On considere donc
 * qu'il y a echec des qu'un `error` est present, sans se fier au seul statut.
 */
export async function sendWhatsApp(
  recipient: string,
  options: SendWhatsAppOptions = {},
): Promise<WhatsAppResult> {
  const token = process.env.STUDIIO_WHATSAPP_TOKEN?.trim();
  if (!token) {
    return { success: false, error: 'Canal WhatsApp non configure (token absent)' };
  }

  const to = normalizePhone(recipient);
  if (!to) {
    return { success: false, error: `Numero invalide: ${recipient}` };
  }

  const kind = options.kind || 'template';
  // Le modele attend UNE variable : on prend la premiere fournie, assainie.
  // Les eventuelles suivantes sont ignorees plutot que d'etre envoyees et de
  // provoquer une 132018 (« number of parameters does not match »).
  const templateParam = sanitizeTemplateParam(options.templateParams?.[0]);
  if ((options.templateParams?.length ?? 0) > 1) {
    console.warn(
      `[WhatsApp] ${options.templateParams!.length} parametres fournis, le modele ${TEMPLATE_NAME} n'en attend qu'un — seul le premier est envoye.`,
    );
  }
  const body =
    kind === 'text'
      ? {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: options.text || '' },
        }
      : {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: TEMPLATE_NAME,
            language: { code: TEMPLATE_LANG },
            // Structure EXACTE du modele approuve `afroboost_campagne` :
            //   corps « Afroboost vous informe: {{1}}. Rendez-vous sur afroboost.com »
            //   AUCUN en-tete, AUCUN bouton, AUCUN pied de page.
            // On n'emet donc qu'un seul composant `body`. Ajouter un composant
            // `header` ou `button` que le modele ne declare pas fait echouer
            // l'appel en erreur 100.
            components: [
              {
                type: 'body',
                // Exactement UN parametre, garanti : `parameters: []` sur un
                // modele qui attend {{1}} renvoie aussi une erreur 100.
                parameters: [{ type: 'text', text: templateParam }],
              },
            ],
          },
        };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          // Le token ne sort jamais d'ici : ni log, ni reponse.
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    const data = await res.json().catch(() => ({}));

    // Un `error` present fait foi, meme sur un HTTP 200.
    const metaError = data?.error;
    if (metaError || !res.ok) {
      const code = metaError?.code ?? metaError?.error_code;
      const message =
        metaError?.message || metaError?.error_user_msg || `HTTP ${res.status}`;
      console.error(
        `[WhatsApp] Echec envoi — code=${code ?? 'n/a'} message=${message}`,
      );
      return { success: false, error: message, errorCode: typeof code === 'number' ? code : undefined };
    }

    const messageId = data?.messages?.[0]?.id as string | undefined;
    if (!messageId) {
      // Un 200 sans wamid n'est pas un envoi : ne pas le compter comme reussi.
      console.error('[WhatsApp] Reponse 200 sans identifiant de message');
      return { success: false, error: 'Reponse Meta sans identifiant de message' };
    }
    console.log(`[WhatsApp] Message envoye — wamid=${messageId}`);
    return { success: true, messageId };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur reseau';
    console.error('[WhatsApp] Appel impossible:', message);
    return { success: false, error: message };
  }
}

export interface BroadcastResult {
  success: boolean;
  sent: number;
  failed: number;
  /** Destinataires ignores par le plafond MAX_RECIPIENTS. */
  truncated: number;
  /** Detail par destinataire, numero normalise pour ne pas fuiter la saisie brute. */
  results: Array<{ to: string; success: boolean; messageId?: string; error?: string }>;
}

/**
 * Diffusion : envoie a plusieurs destinataires, un par un, avec une pause.
 *
 * La pause evite de declencher les limites de debit de Meta. La diffusion est
 * consideree comme reussie des qu'AU MOINS un envoi aboutit — un numero
 * invalide ne doit pas annuler toute la campagne.
 */
export async function broadcastWhatsApp(
  recipients: string[],
  options: SendWhatsAppOptions = {},
): Promise<BroadcastResult> {
  const results: BroadcastResult['results'] = [];
  let sent = 0;
  let failed = 0;

  const list = recipients.slice(0, MAX_RECIPIENTS);
  const truncated = recipients.length - list.length;
  if (truncated > 0) {
    console.warn(
      `[WhatsApp] Diffusion plafonnee : ${list.length} destinataires envoyes, ${truncated} ignores (limite ${MAX_RECIPIENTS}).`,
    );
  }

  for (let i = 0; i < list.length; i++) {
    const raw = list[i];
    const res = await sendWhatsApp(raw, options);
    results.push({
      to: normalizePhone(raw) || raw,
      success: res.success,
      messageId: res.messageId,
      error: res.error,
    });
    if (res.success) sent++;
    else failed++;

    if (i < list.length - 1) {
      await new Promise((r) => setTimeout(r, BROADCAST_DELAY_MS));
    }
  }

  return { success: sent > 0, sent, failed, truncated, results };
}

/**
 * Destinataires d'un post, par ordre de priorite.
 *
 *   1. liste d'abonnes opt-in servie par afroboost (vraie diffusion) ;
 *   2. `metadata.whatsappTo` du post, ADMIN UNIQUEMENT (voir plus bas) ;
 *   3. `WHATSAPP_DEFAULT_RECIPIENT` — l'auto-test.
 *
 * La liste (1) est relue a chaque envoi, sans cache, pour respecter les STOP.
 * Si l'endpoint afroboost n'est pas encore en ligne, `fetchSubscribers` rend
 * un tableau vide et l'on retombe sur (2) puis (3) : l'auto-test actuel
 * continue de fonctionner a l'identique.
 *
 * ⚠️ CONTROLE D'ABUS pour (2) — a lire avant de toucher a cette fonction.
 * `metadata` est stocke VERBATIM depuis le corps de requete par /api/posts :
 * n'importe quel compte inscrit peut y poser des numeros arbitraires. Sans
 * garde, le WABA d'Afroboost devient un relais ouvert — et Meta suspend un
 * WABA qui envoie du non-sollicite. La liste du post n'est donc honoree que si
 * son proprietaire est ADMIN, c'est-a-dire le detenteur du compte Meta.
 *
 * Le canal Email n'a pas ce probleme : il ecrit au proprietaire du post, pas a
 * une adresse fournie par le client.
 */
export async function resolveRecipients(
  metadata: unknown,
  opts: { ownerEmail?: string | null } = {},
): Promise<string[]> {
  const fallback = process.env.WHATSAPP_DEFAULT_RECIPIENT?.trim();
  const envList = fallback ? [fallback] : [];

  // Defense en profondeur : le gate `canUseWhatsApp` des appelants suffit
  // AUJOURD'HUI, mais un futur appelant qui l'oublierait diffuserait a toute
  // la liste opt-in. La restriction est donc aussi portee ici.
  if (!isAdmin(opts.ownerEmail)) return envList;

  // (1) Abonnes opt-in — la seule source utilisable pour une vraie diffusion.
  // Dedupliques : un doublon dans la liste servie produirait deux envois au
  // meme destinataire, ce qui degrade la reputation d'envoi.
  const subscribers = await fetchSubscribers('whatsapp');
  if (subscribers.length > 0) return [...new Set(subscribers)];

  // (2) Liste du post, elle aussi reservee au detenteur du compte Meta.

  const meta = metadata as { whatsappTo?: unknown } | null | undefined;
  // `.filter` AVANT `.map(String)` : dans l'autre sens, `null` devenait la
  // chaine "null" et partait comme destinataire.
  const fromPost = Array.isArray(meta?.whatsappTo)
    ? (meta!.whatsappTo as unknown[])
        .filter((v) => typeof v === 'string' && v.trim() !== '')
        .map((v) => String(v).trim())
    : [];

  return fromPost.length > 0 ? fromPost : envList;
}
