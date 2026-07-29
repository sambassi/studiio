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

/**
 * Adresse mailto de l'en-tete, extraite de `RESEND_FROM`.
 *
 * Elle doit appartenir au domaine d'envoi, sinon l'en-tete pointe vers une
 * boite qui n'existe pas — ce qui degrade la reputation au lieu de l'ameliorer.
 */
export function unsubscribeMailto(): string {
  const from = (process.env.RESEND_FROM || '').trim();
  const angle = from.match(/<([^>]+)>/);
  const candidate = (angle ? angle[1] : from).trim();
  return looksLikeEmail(candidate) ? candidate : '';
}

/**
 * En-tetes de desabonnement pour UN destinataire.
 *
 * Renvoie `{}` si l'adresse est inexploitable ou si aucun secret n'est
 * configure : mieux vaut aucun en-tete qu'un en-tete pointant vers une URL
 * qui repondra 400.
 */
export function listUnsubscribeHeaders(email: string): Record<string, string> {
  const normalized = normalizeEmail(email);
  if (!looksLikeEmail(normalized) || !signRecipient(normalized)) return {};

  const targets = [`<${unsubscribeEndpoint(normalized)}>`];
  const mailto = unsubscribeMailto();
  if (mailto) targets.push(`<mailto:${mailto}?subject=unsubscribe>`);

  return {
    'List-Unsubscribe': targets.join(', '),
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
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

/** Raccourci pour un destinataire unique. */
export async function isSuppressed(email: string): Promise<boolean> {
  const kept = await filterSuppressed([email]);
  return kept.length === 0;
}
