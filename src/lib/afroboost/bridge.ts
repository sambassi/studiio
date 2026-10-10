import { timingSafeEqual } from 'node:crypto';

/**
 * Raccord Afroboost → Studiio (V1, 16/09/2026).
 *
 * Afroboost (afroboost.com) pousse des BROUILLONS dans le Calendrier IA :
 * un reel deja heberge (media_url), une legende, des UTM, une date. Rien
 * d'autre. Studiio garde la main sur la planification et la publication.
 *
 * Ce module ne fait qu'UNE chose : reconnaitre l'appel de service Afroboost
 * sur `POST /api/posts` et lui imposer une identite.
 *
 *  - Le jeton vit dans `AFROBOOST_SERVICE_TOKEN` (env serveur). Il n'est ni
 *    `CRON_SECRET` (qui declenche la publication) ni un secret NextAuth.
 *  - L'identite est `AFROBOOST_STUDIIO_USER_ID` : un utilisateur Studiio
 *    DEDIE a Afroboost, dont les `social_accounts` sont ceux d'Afroboost.
 *    C'est la cloison avec Spordateur : le cron et `social/publish`
 *    selectionnent les comptes PAR `post.user_id`, donc un post Afroboost ne
 *    peut jamais partir avec un compte d'un autre utilisateur.
 *  - Si l'une des deux variables manque, le raccord est INACTIF : l'appel
 *    est traite comme anonyme (401). Aucune valeur par defaut.
 *  - Comparaison a temps constant, jeton jamais journalise.
 */
export interface IdentiteAfroboost {
  userId: string;
}

export function identiteServiceAfroboost(authorization: string | null | undefined): IdentiteAfroboost | null {
  const attendu = process.env.AFROBOOST_SERVICE_TOKEN;
  const userId = process.env.AFROBOOST_STUDIIO_USER_ID;
  if (!attendu || !userId || !authorization) return null;
  const prefixe = 'Bearer ';
  if (!authorization.startsWith(prefixe)) return null;
  const recu = Buffer.from(authorization.slice(prefixe.length), 'utf8');
  const ref = Buffer.from(attendu, 'utf8');
  if (recu.length !== ref.length || !timingSafeEqual(recu, ref)) return null;
  return { userId };
}

/** Un post pousse par Afroboost est TOUJOURS un brouillon : Studiio decide du reste. */
export const STATUT_IMPOSE_AFROBOOST = 'draft' as const;
