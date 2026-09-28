import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * `state` OAuth signé pour la connexion des réseaux sociaux
 * (Instagram, Facebook, TikTok, YouTube).
 *
 * Pourquoi : l'ancien `state` valait `userId:timestamp:random`, en clair et
 * sans signature. Le callback en déduisait l'utilisateur à qui rattacher le
 * compte : quiconque connaissait l'identifiant d'une victime pouvait lier SON
 * compte Instagram ou TikTok au profil de celle-ci.
 *
 * Format : `v1.<userId base64url>.<émis-le ms>.<nonce hex>.<HMAC base64url>`
 * — uniquement des caractères sûrs dans une URL, sans encodage.
 *
 * Le `state` n'est qu'un garde-fou de plus : le callback exige AUSSI une
 * session, et n'écrit jamais que sous l'identifiant de cette session.
 */

const VERSION = 'v1';
/** Domaine de signature : une signature d'un autre usage d'AUTH_SECRET ne vaut rien ici. */
const DOMAIN = 'studiio:social-oauth-state';
/** Durée de validité d'un `state` : largement assez pour un aller-retour OAuth. */
export const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
/** Tolérance d'horloge pour un `state` émis « dans le futur ». */
const CLOCK_SKEW_MS = 60 * 1000;

export type OAuthStateFailure =
  | 'missing'
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'no_secret';

export type OAuthStateResult =
  | { ok: true; userId: string; issuedAt: number }
  | { ok: false; reason: OAuthStateFailure };

function getSecret(): string | null {
  // Même résolution que la config NextAuth (src/lib/auth/config.ts).
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  return secret && secret.length > 0 ? secret : null;
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`${DOMAIN}|${payload}`).digest('base64url');
}

/**
 * Fabrique un `state` signé pour `userId`.
 * Lève une erreur si aucun secret n'est configuré : mieux vaut refuser la
 * connexion que d'émettre un `state` non signé.
 */
export function createOAuthState(userId: string, now: number = Date.now()): string {
  if (!userId) throw new Error('createOAuthState: userId requis');
  const secret = getSecret();
  if (!secret) throw new Error('Secret de signature OAuth manquant (AUTH_SECRET)');
  const payload = [
    VERSION,
    Buffer.from(userId, 'utf8').toString('base64url'),
    String(Math.floor(now)),
    randomBytes(16).toString('hex'),
  ].join('.');
  return `${payload}.${sign(secret, payload)}`;
}

/** Vérifie signature (à temps constant), format et fraîcheur d'un `state`. */
export function verifyOAuthState(
  state: string | null | undefined,
  now: number = Date.now(),
): OAuthStateResult {
  if (!state) return { ok: false, reason: 'missing' };

  const secret = getSecret();
  if (!secret) return { ok: false, reason: 'no_secret' };

  const parts = state.split('.');
  if (parts.length !== 5) return { ok: false, reason: 'malformed' };
  const [version, userB64, issuedRaw, nonce, signature] = parts;
  if (
    version !== VERSION ||
    !/^[A-Za-z0-9_-]+$/.test(userB64) ||
    !/^\d{1,16}$/.test(issuedRaw) ||
    !/^[0-9a-f]{32}$/.test(nonce) ||
    !/^[A-Za-z0-9_-]+$/.test(signature)
  ) {
    return { ok: false, reason: 'malformed' };
  }

  const payload = `${version}.${userB64}.${issuedRaw}.${nonce}`;
  const expected = Buffer.from(sign(secret, payload), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  // timingSafeEqual exige des longueurs égales ; la longueur d'un HMAC-SHA256
  // en base64url est publique (43), la comparer ne fuit rien.
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: 'bad_signature' };
  }

  const issuedAt = Number(issuedRaw);
  if (!Number.isFinite(issuedAt)) return { ok: false, reason: 'malformed' };
  if (issuedAt > now + CLOCK_SKEW_MS || now - issuedAt > OAUTH_STATE_TTL_MS) {
    return { ok: false, reason: 'expired' };
  }

  const userId = Buffer.from(userB64, 'base64url').toString('utf8');
  if (!userId) return { ok: false, reason: 'malformed' };

  return { ok: true, userId, issuedAt };
}
