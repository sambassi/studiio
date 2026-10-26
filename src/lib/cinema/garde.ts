/**
 * CINEMA IA — le VERROU D'ACCES. Ferme par defaut.
 *
 * Cinema IA n'est ouvert qu'a UN compte : celui dont l'identifiant est dans
 * `CINEMA_COMPTE_AUTORISE` (variable serveur, jamais `NEXT_PUBLIC_*`), et qui
 * est de surcroit administrateur. Les deux conditions sont exigees :
 *   - variable absente, vide ou mal formee  -> personne n'entre ;
 *   - un autre administrateur               -> refuse ;
 *   - un utilisateur standard               -> refuse.
 *
 * L'identifiant n'est lu que cote serveur et n'est jamais renvoye au
 * navigateur : la page et les routes repondent 404 (le module « n'existe pas »)
 * a qui n'a pas le droit, sans dire pourquoi.
 */
import { timingSafeEqual } from 'crypto';
import { isAdmin } from '@/lib/admin';
import { proprietaireValide } from '@/lib/cinema/stockage/cles';

export type SujetSession = { id?: string | null; email?: string | null } | null | undefined;

/** L'identifiant autorise, ou `null` quand le verrou est ferme. */
export function compteAutorise(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env.CINEMA_COMPTE_AUTORISE?.trim();
  return v && proprietaireValide(v) ? v : null;
}

/** Comparaison a temps constant de deux chaines de longueur quelconque. */
function egal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** `true` seulement si le verrou est ouvert POUR CE compte. */
export function accesCinemaAutorise(user: SujetSession, env: NodeJS.ProcessEnv = process.env): boolean {
  const autorise = compteAutorise(env);
  if (!autorise || !user?.id || typeof user.id !== 'string') return false;
  return egal(user.id, autorise) && isAdmin(user.email);
}
