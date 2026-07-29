import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Parametre `state` OAuth, signe.
 *
 * POURQUOI UNE SIGNATURE
 * Le `state` historique vaut `userId:timestamp:random` — en clair, et surtout
 * NON SIGNE. N'importe qui pouvait donc appeler la route de callback avec
 * `state=<id d'une victime>:0:x` et faire rattacher SON compte social au
 * compte Studiio de la victime (account-linking hijack) : la victime publie
 * alors sur le compte de l'attaquant, ou l'attaquant recupere un canal de
 * publication sur un compte qui n'est pas le sien.
 *
 * Un HMAC de la partie en clair suffit a fermer la faille : sans le secret
 * serveur, un `state` designant un autre utilisateur ne peut pas etre forge.
 *
 * COMPATIBILITE ASCENDANTE
 * La signature est ajoutee comme QUATRIEME segment. Les autres callbacks lisent
 * `state.split(':')[0]`, elles ignorent donc le segment supplementaire et
 * restent inchangees. Les flux OAuth deja en vol (state a 3 segments) sont
 * acceptes en lecture par `verifyState` uniquement si l'appelant le demande
 * explicitement — aucun n'en a besoin aujourd'hui.
 */

/** Duree de vie d'un `state`. Large, un aller-retour OAuth pouvant inclure une 2FA. */
const STATE_TTL_MS = 30 * 60 * 1000;

function secret(): string {
  return (process.env.AUTH_SECRET || '').trim();
}

function computeSignature(payload: string): string {
  const key = secret();
  if (!key) return '';
  return createHmac('sha256', key).update(payload).digest('base64url');
}

/** `userId:timestamp:random:signature` */
export function signState(userId: string): string {
  const timestamp = Date.now();
  // `randomUUID` n'apporte rien ici : l'entropie ne protege de rien, c'est la
  // signature qui authentifie. On garde le format historique a l'identique.
  const random = Math.random().toString(36).slice(2, 10);
  const payload = `${userId}:${timestamp}:${random}`;
  const sig = computeSignature(payload);
  // Sans secret configure, on renvoie le format historique a 3 segments plutot
  // qu'une signature vide qui donnerait une fausse impression de securite.
  return sig ? `${payload}:${sig}` : payload;
}

export interface VerifiedState {
  valid: boolean;
  userId: string | null;
  /** Renseigne quand `valid` est faux, pour le journal. */
  reason?: string;
}

/**
 * Verifie la signature et renvoie le `userId` de confiance.
 *
 * Rejette tout state non signe : accepter le format a 3 segments laisserait la
 * faille grande ouverte, un attaquant n'ayant qu'a omettre la signature.
 */
export function verifyState(state: string | null): VerifiedState {
  if (!state) return { valid: false, userId: null, reason: 'state absent' };
  if (!secret()) return { valid: false, userId: null, reason: 'AUTH_SECRET absent cote serveur' };

  const parts = state.split(':');
  if (parts.length !== 4) {
    return { valid: false, userId: null, reason: 'state non signe' };
  }

  const [userId, timestamp, random, sig] = parts;
  if (!userId || !timestamp || !random || !sig) {
    return { valid: false, userId: null, reason: 'state malforme' };
  }

  // Sans peremption, un state signe reste valable indefiniment : intercepte
  // une fois (historique de navigation, journal de proxy), il serait rejouable
  // des annees plus tard. 30 minutes couvrent largement un aller-retour OAuth,
  // authentification a deux facteurs comprise.
  const issuedAt = Number(timestamp);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > STATE_TTL_MS) {
    return { valid: false, userId: null, reason: 'state expire' };
  }

  const expected = computeSignature(`${userId}:${timestamp}:${random}`);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  // Comparaison a temps constant ; le test de longueur evite le throw de
  // timingSafeEqual sur des tailles differentes.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, userId: null, reason: 'signature invalide' };
  }

  return { valid: true, userId };
}
