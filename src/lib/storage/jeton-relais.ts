/**
 * ─────────────────────────────────────────────────────────────────────────
 * UNE URL DU RELAIS, SIGNÉE ET TEMPORAIRE — POUR CEUX QUI N'ONT PAS DE SESSION
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le relais `/storage/v1/object/public/<bucket>/<clé>` servait tout objet
 * d'un compte à quiconque connaissait son adresse (issue #547). Il exige
 * désormais, pour un objet PROPRIÉTAIRE (`<userId>/…`), soit la session de
 * son propriétaire, soit CE jeton.
 *
 * Le jeton est destiné aux lecteurs qui ne portent pas de cookie et qui ont
 * pourtant le droit de lire : les réseaux sociaux et Zernio qui viennent
 * CHERCHER la vidéo à publier, Chromium de Remotion, les fetch du serveur
 * vers sa propre origine.
 *
 * Forme : `?sr=<expiration ms>.<HMAC-SHA256 base64url>` ajouté à l'URL du
 * relais, dont le chemin (et donc l'extension, que Meta / TikTok / D-ID
 * regardent) ne change pas. Le HMAC couvre `bucket`, la clé TELLE QUE LE
 * RELAIS LA VOIT (décodée une fois) et l'expiration : un jeton ne se
 * transpose ni à une autre clé, ni à un autre compartiment, ni au-delà de
 * son heure.
 *
 * Secret : `STORAGE_RELAY_SECRET`, à défaut `AUTH_SECRET` — la même famille
 * que les jetons média d'avatar, avec un préfixe de domaine distinct pour
 * qu'une signature de l'un ne vaille jamais pour l'autre. Sans secret, on ne
 * signe pas (l'URL ressort nue) et on ne valide rien : jamais de repli
 * ouvert.
 *
 * Module PUR hormis le secret : ni base, ni stockage, ni session.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BUCKET_COPIES_EXTERNES,
  PREFIXE_RELAIS_PUBLIC,
  cibleLisibleParCompte,
  cibleRecevable,
  cibleStockageParChemin,
  extraireCibleStockage,
  originesStockageConfigurees,
} from '@/lib/storage/acces-objet';

/** Nom du paramètre de requête porteur du jeton. */
export const PARAM_JETON_RELAIS = 'sr';

/**
 * Durée par défaut : 24 h. Meta et TikTok téléchargent en quelques minutes,
 * mais Zernio met la publication en file et un rendu Remotion long peut
 * relire ses médias bien après le départ. Au-delà, l'URL meurt seule.
 */
export const DUREE_JETON_RELAIS_MS = 24 * 60 * 60 * 1000;

/** Plafond : aucun appelant ne peut fabriquer un lien quasi permanent. */
export const DUREE_JETON_RELAIS_MAX_MS = 7 * 24 * 60 * 60 * 1000;

const DOMAINE = 'studiio-relais-v1';

function secret(env: NodeJS.ProcessEnv): string | null {
  const s = (env.STORAGE_RELAY_SECRET || env.AUTH_SECRET || '').trim();
  return s.length > 0 ? s : null;
}

function signer(bucket: string, cle: string, expireLe: number, cleSecrete: string): string {
  return createHmac('sha256', cleSecrete)
    .update(`${DOMAINE}\n${bucket}\n${cle}\n${expireLe}`)
    .digest('base64url');
}

/** Le jeton (`<exp>.<sig>`) d'une cible, ou `null` faute de secret / cible recevable. */
export function jetonRelais(
  bucket: string, cle: string, expireLe: number, env: NodeJS.ProcessEnv = process.env,
): string | null {
  const s = secret(env);
  if (!s) return null;
  if (!Number.isInteger(expireLe) || expireLe <= 0) return null;
  if (!cibleRecevable(bucket, cle)) return null;
  return `${expireLe}.${signer(bucket, cle, expireLe, s)}`;
}

/**
 * Le jeton présenté au relais est-il valide pour CETTE cible, MAINTENANT ?
 * Signature comparée en temps constant ; expiration future et pas plus loin
 * que le plafond (un jeton signé avec une expiration absurde reste refusé).
 */
export function jetonRelaisValide(
  bucket: string, cle: string, jeton: unknown,
  maintenant = Date.now(), env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (typeof jeton !== 'string' || jeton.length === 0 || jeton.length > 256) return false;
  const m = /^(\d{1,16})\.([A-Za-z0-9_-]{43})$/.exec(jeton);
  if (!m) return false;
  const expireLe = Number(m[1]);
  if (!Number.isSafeInteger(expireLe) || expireLe <= maintenant) return false;
  if (expireLe - maintenant > DUREE_JETON_RELAIS_MAX_MS) return false;
  const s = secret(env);
  if (!s) return false;
  if (!cibleRecevable(bucket, cle)) return false;
  const attendu = Buffer.from(signer(bucket, cle, expireLe, s));
  const recu = Buffer.from(m[2]);
  return attendu.length === recu.length && timingSafeEqual(attendu, recu);
}

/**
 * Ajoute (ou remplace) le jeton sur une URL du relais PUBLIC.
 *
 * Une URL qui n'est pas un chemin `/storage/v1/object/public/<bucket>/<clé>`
 * canonique ressort INCHANGÉE — URL externe, URL présignée MinIO, données,
 * etc. Une URL relative reste relative, une absolue reste absolue : seul le
 * paramètre `sr` change.
 */
export function signerUrlRelais(
  url: string,
  args: { dureeMs?: number; maintenant?: number } = {},
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (typeof url !== 'string' || url.length === 0) return url;
  const cible = cibleStockageParChemin(url);
  if (cible === null || cible === 'refus' || cible.acces !== 'public') return url;
  const duree = Math.min(Math.max(args.dureeMs ?? DUREE_JETON_RELAIS_MS, 1), DUREE_JETON_RELAIS_MAX_MS);
  const expireLe = (args.maintenant ?? Date.now()) + duree;
  const jeton = jetonRelais(cible.bucket, cible.cle, expireLe, env);
  if (!jeton) return url;
  const diese = url.indexOf('#');
  const sansFragment = diese >= 0 ? url.slice(0, diese) : url;
  const fragment = diese >= 0 ? url.slice(diese) : '';
  const q = sansFragment.indexOf('?');
  const base = q >= 0 ? sansFragment.slice(0, q) : sansFragment;
  const params = new URLSearchParams(q >= 0 ? sansFragment.slice(q + 1) : '');
  params.set(PARAM_JETON_RELAIS, jeton);
  return `${base}?${params.toString()}${fragment}`;
}

/**
 * Signe une URL SEULEMENT si elle désigne le relais de NOTRE stockage :
 * chemin relatif `/storage/v1/object/public/…`, ou URL absolue dont
 * l'origine est l'une des origines configurées (`originesStockageConfigurees`).
 *
 * ⚠️ Un jeton n'est JAMAIS posé sur un autre hôte, même si son chemin imite
 * le nôtre : remis à un tiers, il ouvrirait l'objet sur notre relais.
 *
 * Une URL déjà munie d'une requête (`?…`) est d'abord lue sans elle pour
 * juger l'origine ; l'éventuel ancien `sr` est remplacé.
 */
export function signerSiNotreStockage(
  url: unknown,
  args: OptionsSignatureLecteur,
  env: NodeJS.ProcessEnv = process.env,
): unknown {
  if (typeof url !== 'string' || url.length === 0) return url;
  const sansRequete = url.split(/[?#]/)[0];
  const cible = extraireCibleStockage(sansRequete, { origines: originesStockageConfigurees(env) });
  if (!cible) return url;
  // ⚠️ ADJOINT CONFUS : on ne signe QUE ce que le compte au nom duquel on
  // lit pourrait lire lui-même avec sa session (ou ce qui est public). Sans
  // ce filtre, un `inputProps` venu du navigateur portant la clé d'un autre
  // compte recevrait un jeton, et le rendu lirait l'objet d'autrui.
  if (!lectureParCompte(cible.bucket, cible.cle, args.lecteur)) return url;
  return signerUrlRelais(url, args, env);
}

/** Options de signature au nom d'un compte : `lecteur` est OBLIGATOIRE. */
export interface OptionsSignatureLecteur {
  /** Le compte au nom duquel le média est lu (propriétaire exigé). */
  lecteur: string;
  dureeMs?: number;
  maintenant?: number;
}

/** Public sans condition, ou lisible par ce compte (propriété sur la clé). Pure. */
function lectureParCompte(bucket: string, cle: string, lecteur: unknown): boolean {
  if (!cibleRecevable(bucket, cle)) return false;
  if (bucket === BUCKET_COPIES_EXTERNES && /^externes\/(?:proxies\/)?[^/]+$/.test(cle)) return true;
  return cibleLisibleParCompte(bucket, cle, lecteur);
}

/**
 * Copie PROFONDE d'un objet de propriétés (Remotion `inputProps`) où chaque
 * chaîne désignant le relais de notre stockage reçoit un jeton. Une même URL
 * reçoit le MÊME jeton partout (une seule horloge pour l'appel) : les
 * compositions qui comparent des URL entre elles (plans d'un même rush)
 * restent identiques.
 *
 * À appeler au DERNIER moment, juste avant de remettre les propriétés au
 * moteur : une URL signée ne doit jamais être PERSISTÉE (les parseurs de
 * stockage refusent une URL qui porte une requête).
 */
export function signerUrlsRelaisProfond<T>(
  valeur: T,
  args: OptionsSignatureLecteur,
  env: NodeJS.ProcessEnv = process.env,
): T {
  const maintenant = args.maintenant ?? Date.now();
  const deja = new Map<string, string>();
  const visiter = (v: unknown, profondeur: number): unknown => {
    if (profondeur > 12) return v;
    if (typeof v === 'string') {
      if (!v.includes(PREFIXE_RELAIS_PUBLIC)) return v;
      const connu = deja.get(v);
      if (connu !== undefined) return connu;
      const signee = signerSiNotreStockage(v, { ...args, maintenant }, env) as string;
      deja.set(v, signee);
      return signee;
    }
    if (Array.isArray(v)) return v.map((x) => visiter(x, profondeur + 1));
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = visiter(x, profondeur + 1);
      return out;
    }
    return v;
  };
  return visiter(valeur, 0) as T;
}

/** Rendu (Remotion, hybride) : un long rendu relit ses médias pendant des minutes. */
export const DUREE_JETON_RENDU_MS = 6 * 60 * 60 * 1000;

/**
 * Contenu ÉDITORIAL publié par l'administration (vidéo de démo de la page
 * d'accueil) : rangé sous le dossier du compte administrateur, il doit être
 * lu par des visiteurs ANONYMES. Il n'y a pas de « lecteur » à opposer : le
 * contenu a été publié volontairement par un administrateur, et sa clé vient
 * de `app_settings` (écrit sous `requireAdmin`), jamais d'un navigateur
 * quelconque. Jeton de 24 h, renouvelé à chaque lecture de la page.
 *
 * ⚠️ Ne JAMAIS appeler sur une URL fournie par un compte ordinaire.
 */
export function signerContenuEditorial(url: unknown, env: NodeJS.ProcessEnv = process.env): unknown {
  if (typeof url !== 'string' || url.length === 0) return url;
  const sansRequete = url.split(/[?#]/)[0];
  if (!extraireCibleStockage(sansRequete, { origines: originesStockageConfigurees(env) })) return url;
  return signerUrlRelais(url, {}, env);
}

/**
 * Retire le jeton `sr` d'une URL (avant toute PERSISTANCE). Les autres
 * paramètres et le fragment sont conservés ; sans paramètre restant, le `?`
 * disparaît. Toute autre valeur ressort inchangée.
 */
export function retirerJetonRelais<T>(url: T): T {
  if (typeof url !== 'string' || !url.includes('?')) return url;
  const diese = url.indexOf('#');
  const sansFragment = diese >= 0 ? url.slice(0, diese) : url;
  const fragment = diese >= 0 ? url.slice(diese) : '';
  const q = sansFragment.indexOf('?');
  const params = new URLSearchParams(sansFragment.slice(q + 1));
  if (!params.has(PARAM_JETON_RELAIS)) return url;
  params.delete(PARAM_JETON_RELAIS);
  const reste = params.toString();
  return `${sansFragment.slice(0, q)}${reste ? `?${reste}` : ''}${fragment}` as T;
}
