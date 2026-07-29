import { createHmac, timingSafeEqual } from 'crypto';
import { supabaseAdmin } from '@/lib/db/supabase';

/**
 * Desabonnement email « un clic » et liste de suppression locale.
 *
 * POURQUOI CE MODULE
 * Gmail refuse en boite de reception les envois en nombre qui ne portent pas
 * les en-tetes `List-Unsubscribe` / `List-Unsubscribe-Post`. L'URL annoncee
 * doit accepter un POST, repondre 200 et desabonner reellement.
 *
 * L'endpoint est heberge par Studiio (et non par afroboost) pour une raison
 * simple : afroboost ne fournit pas de jeton par destinataire, donc aucune URL
 * afroboost ne peut authentifier un desabonnement un-clic aujourd'hui. Notre
 * endpoint signe l'adresse, enregistre la suppression localement, PUIS relaie
 * l'information a afroboost en best-effort — la centralisation est preservee
 * sans dependre d'un travail non livre cote afroboost.
 *
 * SECURITE
 * L'URL porte l'adresse en clair et un HMAC-SHA256 de cette adresse. Sans
 * jeton valide, aucun desabonnement : sinon n'importe qui pourrait desabonner
 * n'importe quelle adresse en devinant l'URL.
 *
 * DEGRADATION
 * Aucune fonction ne throw. Si la table `email_suppressions` n'existe pas
 * encore, la lecture renvoie « aucune suppression » et les envois se
 * comportent exactement comme avant la migration.
 */

/** Reutilise `AUTH_SECRET`, toujours defini, plutot que d'imposer une variable de plus. */
function secret(): string {
  return (process.env.UNSUBSCRIBE_SECRET || process.env.AUTH_SECRET || '').trim();
}

/** Minuscules + trim : la clef primaire de la table est l'adresse normalisee. */
export function normalizeEmail(email: string): string {
  return String(email || '').trim().toLowerCase();
}

function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Jeton opaque derive de l'adresse. Chaine vide si aucun secret n'est configure. */
export function signRecipient(email: string): string {
  const key = secret();
  if (!key) return '';
  return createHmac('sha256', key).update(normalizeEmail(email)).digest('base64url');
}

/** Comparaison a temps constant : une comparaison naive fuit le jeton octet par octet. */
export function verifyRecipient(email: string, token: string): boolean {
  const expected = signRecipient(email);
  if (!expected || !token) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function appOrigin(): string {
  const raw = (process.env.NEXT_PUBLIC_APP_URL || 'https://studiio.pro').trim();
  try {
    return new URL(raw).origin;
  } catch {
    return 'https://studiio.pro';
  }
}

/**
 * URL de desabonnement d'un destinataire.
 *
 * La MEME URL sert au lien visible dans le corps (GET -> page de
 * confirmation) et a l'en-tete un-clic (POST -> desabonnement immediat). Le
 * GET n'a volontairement aucun effet de bord : les antivirus et les
 * previsualiseurs de liens visitent les URL des emails, et desabonneraient
 * les gens a leur insu.
 */
export function unsubscribeEndpoint(email: string): string {
  const normalized = normalizeEmail(email);
  const token = signRecipient(normalized);
  const qs = new URLSearchParams({ e: normalized, t: token });
  return `${appOrigin()}/api/email/unsubscribe?${qs.toString()}`;
}

/** Un lien de desabonnement n'est signable que si un secret est configure. */
export function canSignRecipient(email: string): boolean {
  const normalized = normalizeEmail(email);
  return looksLikeEmail(normalized) && !!signRecipient(normalized);
}

/**
 * Adresse mailto de l'en-tete.
 *
 * Par defaut, extraite de `RESEND_FROM` : elle doit appartenir au domaine
 * d'envoi, sinon l'en-tete pointe vers une boite qui n'existe pas — ce qui
 * degrade la reputation au lieu de l'ameliorer. `UNSUBSCRIBE_MAILTO` permet
 * de pointer vers une boite REELLEMENT relevee, `notifications@` etant par
 * convention une adresse d'emission.
 */
export function unsubscribeMailto(): string {
  const override = (process.env.UNSUBSCRIBE_MAILTO || '').trim();
  if (looksLikeEmail(override)) return override;

  const from = (process.env.RESEND_FROM || '').trim();
  const angle = from.match(/<([^>]+)>/);
  const candidate = (angle ? angle[1] : from).trim();
  return looksLikeEmail(candidate) ? candidate : '';
}

/**
 * La table `email_suppressions` est-elle exploitable ?
 *
 * POURQUOI CETTE SONDE EXISTE
 * Annoncer `List-Unsubscribe-Post` engage a honorer le desabonnement. Tant
 * que la migration n'est pas appliquee (elle exige deux etapes manuelles :
 * `grant all` puis `docker kill -s SIGUSR1 studiio-postgrest`), l'endpoint
 * repondrait 200 a Gmail sans rien enregistrer — donc un desabonne
 * continuerait a recevoir les envois. C'est exactement la faute que les
 * regles expediteurs de Gmail sanctionnent, et elle est PIRE que l'absence
 * d'en-tete : sans en-tete, aucune promesse n'est rompue.
 *
 * Resultat memoise avec un TTL court : une fois la migration appliquee, les
 * en-tetes reapparaissent seuls, sans redeploiement.
 */
const STORE_PROBE_TTL_MS = 60_000;
let storeProbe: { ready: boolean; at: number } | null = null;

export async function suppressionStoreReady(): Promise<boolean> {
  const now = Date.now();
  // Une fois prete, la table ne disparait pas : on ne re-sonde plus.
  if (storeProbe?.ready) return true;
  if (storeProbe && now - storeProbe.at < STORE_PROBE_TTL_MS) return false;

  let ready = false;
  try {
    const { error } = await supabaseAdmin.from('email_suppressions').select('email').limit(1);
    ready = !error;
    if (error) {
      console.error(
        `[Unsubscribe] Table email_suppressions indisponible (${error.message}) — ` +
          'en-tetes de desabonnement DESACTIVES. Appliquer migrations/2026-07-29-email-suppressions.sql ' +
          'puis `docker kill -s SIGUSR1 studiio-postgrest`.',
      );
    }
  } catch (err) {
    console.error('[Unsubscribe] Sonde email_suppressions impossible :', err);
  }

  storeProbe = { ready, at: now };
  return ready;
}

/**
 * En-tetes de desabonnement pour UN destinataire.
 *
 * Renvoie `{}` si l'adresse est inexploitable, si aucun secret n'est
 * configure, ou si la liste de suppression n'est pas encore operationnelle.
 * Mieux vaut aucun en-tete qu'un en-tete pointant vers une URL qui ne
 * desabonne rien.
 */
export async function listUnsubscribeHeaders(email: string): Promise<Record<string, string>> {
  const normalized = normalizeEmail(email);
  if (!canSignRecipient(normalized)) return {};
  if (!(await suppressionStoreReady())) return {};

  const targets = [`<${unsubscribeEndpoint(normalized)}>`];
  const mailto = unsubscribeMailto();
  if (mailto) targets.push(`<mailto:${mailto}?subject=unsubscribe>`);

  return {
    'List-Unsubscribe': targets.join(', '),
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

/**
 * Pied de page HTML portant le lien de desabonnement VISIBLE.
 *
 * Gmail veut le lien dans le corps EN PLUS de l'en-tete. Ce bloc est ajoute
 * cote serveur pour les envois dont le corps est saisi librement (campagnes
 * admin) : le lien ne doit pas dependre du fait que le redacteur y pense.
 *
 * Chaine vide si l'adresse n'est pas signable — auquel cas l'en-tete est lui
 * aussi absent, les deux restent donc coherents.
 */
export function unsubscribeFooter(email: string): string {
  if (!canSignRecipient(email)) return '';
  // L'URL ne contient que des caracteres encodes (encodeURIComponent) et un
  // jeton base64url : l'echappement est une ceinture de securite.
  const url = unsubscribeEndpoint(email).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return (
    `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #E5E7EB;` +
    `color:#6B7280;font-size:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">` +
    `Vous recevez cet email car vous êtes inscrit à nos actualités.<br />` +
    `<a href="${url}" style="color:#6B7280;">Se désabonner</a>` +
    `</div>`
  );
}

/** Enregistre un desabonnement. `false` si l'ecriture a echoue (table absente, base injoignable). */
export async function recordSuppression(
  email: string,
  reason: 'one-click' | 'link' | 'manual' = 'one-click',
): Promise<boolean> {
  const normalized = normalizeEmail(email);
  if (!looksLikeEmail(normalized)) return false;

  try {
    // `upsert` sur la clef primaire : un desabonnement repete ne doit pas
    // remonter une erreur de doublon.
    const { error } = await supabaseAdmin
      .from('email_suppressions')
      .upsert({ email: normalized, reason }, { onConflict: 'email' });
    if (error) {
      console.error('[Unsubscribe] Ecriture impossible :', error.message);
      return false;
    }
    console.log(`[Unsubscribe] ${normalized} desabonne (${reason})`);
    return true;
  } catch (err) {
    console.error('[Unsubscribe] Ecriture impossible :', err);
    return false;
  }
}

/**
 * Retire les adresses desabonnees d'une liste de destinataires.
 *
 * REPLI VOLONTAIREMENT PERMISSIF
 * Si la lecture echoue (table pas encore creee, base momentanement
 * injoignable), on renvoie la liste INTACTE au lieu de la vider. Un repli
 * restrictif transformerait la moindre erreur transitoire en panne totale et
 * silencieuse du canal email. La liste opt-in d'afroboost, relue avant chaque
 * envoi, reste de toute facon le filtre principal ; celui-ci est une seconde
 * couche. L'echec est journalise en `error` pour rester visible.
 */
export async function filterSuppressed(emails: string[]): Promise<string[]> {
  if (!emails || emails.length === 0) return [];
  const normalized = emails.map(normalizeEmail).filter(looksLikeEmail);
  if (normalized.length === 0) return [];

  try {
    const { data, error } = await supabaseAdmin
      .from('email_suppressions')
      .select('email')
      .in('email', normalized);

    if (error) {
      console.error(
        `[Unsubscribe] Liste de suppression illisible (${error.message}) — envoi sans ce filtre.`,
      );
      return emails;
    }

    const blocked = new Set((data || []).map((r: { email: string }) => normalizeEmail(r.email)));
    if (blocked.size === 0) return emails;

    const kept = emails.filter((e) => !blocked.has(normalizeEmail(e)));
    console.log(`[Unsubscribe] ${emails.length - kept.length} destinataire(s) desabonne(s) ecarte(s)`);
    return kept;
  } catch (err) {
    console.error('[Unsubscribe] Liste de suppression illisible — envoi sans ce filtre.', err);
    return emails;
  }
}

/**
 * Raccourci pour un destinataire unique.
 *
 * Une adresse malformee n'est PAS « desabonnee » : elle est invalide. Les
 * confondre produirait un diagnostic trompeur (« cette adresse est
 * desabonnee ») la ou l'erreur reelle de l'API d'envoi serait bien plus
 * utile. On laisse donc passer et l'envoi remontera la vraie cause.
 */
export async function isSuppressed(email: string): Promise<boolean> {
  if (!looksLikeEmail(normalizeEmail(email))) return false;
  const kept = await filterSuppressed([email]);
  return kept.length === 0;
}
