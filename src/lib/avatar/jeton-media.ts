/**
 * Une URL TEMPORAIRE, SIGNÉE, vers un objet privé du dossier avatar — pour
 * qu'un fournisseur (D-ID) puisse ingérer notre source, notre vidéo de
 * consentement ou notre audio SANS que ces objets deviennent publics et SANS
 * qu'une URL fournisseur devienne jamais notre identité métier.
 *
 * Le jeton porte la CLÉ et une EXPIRATION, signés HMAC-SHA256 avec le secret
 * du serveur (même famille que `jetonOuvertureApercu`). Il n'ouvre qu'un
 * objet PRIVÉ du dossier avatar (`source-…`, `consent-…`, `audio-…`), jamais
 * une vidéo générée ni un autre domaine. L'URL se termine par un nom de
 * fichier avec la bonne extension : D-ID exige `.mp4|.mov|.mpeg` en fin de
 * `source_url`.
 *
 * Module PUR hormis le secret : ni base, ni stockage. La route
 * `/api/avatar/media/[jeton]/[nom]` vérifie le jeton puis diffuse l'objet.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { estClePriveeAvatar } from '@/lib/avatar/source-cle';

/** Deux heures : le temps qu'un fournisseur télécharge une vidéo de quelques dizaines de Mo, avec marge. */
export const DUREE_JETON_MEDIA_MS = 2 * 60 * 60 * 1000;

function cleSecrete(env: NodeJS.ProcessEnv): string {
  const secret = (env.AVATAR_MEDIA_SECRET || env.AUTH_SECRET || '').trim();
  if (!secret) throw new Error('AUTH_SECRET manquant : impossible de signer une URL média temporaire');
  return secret;
}

function signature(message: string, env: NodeJS.ProcessEnv): string {
  return createHmac('sha256', cleSecrete(env)).update(message).digest('base64url');
}

/**
 * Fabrique un jeton pour `cle`, valable jusqu'à `expireLe` (ms epoch).
 * Refuse toute clé qui n'est pas un objet privé du dossier avatar.
 */
export function jetonMediaAvatar(
  args: { cle: string; expireLe: number }, env: NodeJS.ProcessEnv = process.env,
): string {
  if (!estClePriveeAvatar(args.cle)) throw new Error('jetonMediaAvatar: clé hors du dossier privé avatar');
  if (!Number.isInteger(args.expireLe) || args.expireLe <= 0) throw new Error('jetonMediaAvatar: expiration invalide');
  const corps = Buffer.from(`${args.cle}|${args.expireLe}`).toString('base64url');
  return `${corps}.${signature(corps, env)}`;
}

/**
 * Relit un jeton : la clé qu'il ouvre, ou `null` (malformé, signature fausse,
 * expiré, clé hors du dossier privé). Comparaison en temps constant.
 */
export function clePourJetonMedia(
  jeton: unknown, maintenant = Date.now(), env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (typeof jeton !== 'string' || jeton.length === 0 || jeton.length > 1024) return null;
  const point = jeton.indexOf('.');
  if (point <= 0 || point === jeton.length - 1) return null;
  const corps = jeton.slice(0, point);
  const sig = jeton.slice(point + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(corps) || !/^[A-Za-z0-9_-]+$/.test(sig)) return null;
  let attendu: string;
  try { attendu = signature(corps, env); } catch { return null; }
  const a = Buffer.from(sig);
  const b = Buffer.from(attendu);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const clair = Buffer.from(corps, 'base64url').toString('utf8');
  const sep = clair.lastIndexOf('|');
  if (sep <= 0) return null;
  const cle = clair.slice(0, sep);
  const expireLe = Number(clair.slice(sep + 1));
  if (!Number.isInteger(expireLe) || expireLe <= maintenant) return null;
  if (!estClePriveeAvatar(cle)) return null;
  return cle;
}

/**
 * L'URL absolue que le fournisseur recevra. `NEXT_PUBLIC_APP_URL` est la
 * seule base : c'est l'origine publique de l'application, celle que le
 * fournisseur peut joindre. Le nom final porte l'extension de l'objet.
 */
export function urlMediaTemporaire(
  cle: string, args: { maintenant?: number; dureeMs?: number } = {}, env: NodeJS.ProcessEnv = process.env,
): string {
  const base = (env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) throw new Error('NEXT_PUBLIC_APP_URL absente ou non HTTPS : aucune URL média temporaire possible');
  const expireLe = (args.maintenant ?? Date.now()) + (args.dureeMs ?? DUREE_JETON_MEDIA_MS);
  const jeton = jetonMediaAvatar({ cle, expireLe }, env);
  const nom = cle.slice(cle.lastIndexOf('/') + 1);
  return `${base}/api/avatar/media/${jeton}/${nom}`;
}
