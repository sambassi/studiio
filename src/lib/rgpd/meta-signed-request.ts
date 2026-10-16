/**
 * Callback Meta « Data Deletion Request » — lecture VÉRIFIÉE du `signed_request`.
 *
 * Format (documentation Meta) : `<signature>.<charge>`, deux segments
 * base64url. La signature est HMAC-SHA256 de la CHARGE ENCODÉE (la chaîne
 * telle quelle, pas le JSON décodé) avec le secret de l'application. La
 * charge décodée porte `algorithm: "HMAC-SHA256"`, `issued_at`, `user_id`
 * (identifiant Facebook propre à l'application, « app-scoped »).
 *
 * L'ancienne route décodait la charge SANS vérifier la signature : n'importe
 * qui pouvait fabriquer une demande au nom de n'importe quel identifiant.
 *
 * Pure : le(s) secret(s) sont fournis par l'appelant. Comparaison à temps
 * constant. Aucune exception : `{ ok: false, raison }` sur toute anomalie.
 */
import { createHmac, timingSafeEqual } from 'crypto';

export type AppliMeta = 'facebook' | 'instagram';

export interface SecretMeta {
  appli: AppliMeta;
  secret: string;
}

export type LectureSignedRequest =
  | { ok: true; appli: AppliMeta; metaUserId: string; emisLe: number | null }
  | { ok: false; raison: 'absente' | 'malformee' | 'signature_invalide' | 'algorithme' | 'sans_utilisateur' | 'sans_secret' };

/** Borne de taille : un `signed_request` réel fait quelques centaines d'octets. */
export const TAILLE_MAX_SIGNED_REQUEST = 4096;

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;
/** Identifiant Facebook : chiffres uniquement, longueur raisonnable. */
const ID_META = /^[0-9]{1,32}$/;

function decoderBase64Url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Les secrets configurés, dans l'ordre d'essai. Les vides sont écartés. */
export function secretsMeta(env: NodeJS.ProcessEnv = process.env): SecretMeta[] {
  const out: SecretMeta[] = [];
  const fb = env.FACEBOOK_CLIENT_SECRET || env.FACEBOOK_SECRET || '';
  if (fb) out.push({ appli: 'facebook', secret: fb });
  const ig = env.META_INSTAGRAM_APP_SECRET || '';
  if (ig && ig !== fb) out.push({ appli: 'instagram', secret: ig });
  return out;
}

export function lireSignedRequest(brut: unknown, secrets: SecretMeta[]): LectureSignedRequest {
  if (typeof brut !== 'string' || brut.length === 0) return { ok: false, raison: 'absente' };
  if (secrets.length === 0) return { ok: false, raison: 'sans_secret' };
  if (brut.length > TAILLE_MAX_SIGNED_REQUEST) return { ok: false, raison: 'malformee' };
  const parties = brut.split('.');
  if (parties.length !== 2) return { ok: false, raison: 'malformee' };
  const [sigEncodee, charge] = parties;
  if (!sigEncodee || !charge || !BASE64URL.test(sigEncodee) || !BASE64URL.test(charge)) {
    return { ok: false, raison: 'malformee' };
  }
  const signature = decoderBase64Url(sigEncodee);
  if (signature.length !== 32) return { ok: false, raison: 'signature_invalide' };

  let appli: AppliMeta | null = null;
  for (const s of secrets) {
    const attendue = createHmac('sha256', s.secret).update(charge).digest();
    if (timingSafeEqual(attendue, signature)) { appli = s.appli; break; }
  }
  // La charge n'est décodée qu'APRÈS la signature : rien de ce qu'elle dit
  // n'est cru avant.
  if (!appli) return { ok: false, raison: 'signature_invalide' };

  let donnees: Record<string, unknown>;
  try {
    const v = JSON.parse(decoderBase64Url(charge).toString('utf-8'));
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, raison: 'malformee' };
    donnees = v as Record<string, unknown>;
  } catch {
    return { ok: false, raison: 'malformee' };
  }
  if (typeof donnees.algorithm !== 'string' || donnees.algorithm.toUpperCase() !== 'HMAC-SHA256') {
    return { ok: false, raison: 'algorithme' };
  }
  const uid = typeof donnees.user_id === 'number' ? String(donnees.user_id) : donnees.user_id;
  if (typeof uid !== 'string' || !ID_META.test(uid)) return { ok: false, raison: 'sans_utilisateur' };
  const emis = typeof donnees.issued_at === 'number' && Number.isFinite(donnees.issued_at) ? donnees.issued_at : null;
  return { ok: true, appli, metaUserId: uid, emisLe: emis };
}

/** Fabrique un `signed_request` — pour les TESTS uniquement (aucun appel Meta). */
export function signerPourTest(charge: Record<string, unknown>, secret: string): string {
  const enc = Buffer.from(JSON.stringify(charge)).toString('base64url');
  const sig = createHmac('sha256', secret).update(enc).digest('base64url');
  return `${sig}.${enc}`;
}
