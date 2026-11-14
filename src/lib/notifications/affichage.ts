// Les notifications sont STOCKÉES en français par le cron (texte figé à la création, sans
// migration possible ici). On les LOCALISE À L'AFFICHAGE d'après leur `kind`, connu et
// stable ; un `kind` inconnu, ou un texte qui n'est pas celui qu'on attend, reste tel quel.
// Le texte d'origine n'est jamais modifié.
import type { UserNotification } from '@/lib/notifications/store';

type T = (cle: string, params?: Record<string, string | number | null | undefined>) => string;

const STATIQUES: Record<string, string> = {
  'autopilote-credits': 'credits',
  'autopilote-duree-a-confirmer': 'dureeAConfirmer',
  'autopilote-sans-rush': 'sansRush',
};

/** « 3 rushes introuvables » / « 1 rush introuvable » → 3 ; sinon null. */
export function nombreRushIntrouvables(titre: string): number | null {
  const m = /^(\d+)\s+rush(?:es)?\s+introuvables?$/i.exec(titre.trim());
  return m ? Number(m[1]) : null;
}

export function localiserNotification(
  n: Pick<UserNotification, 'kind' | 'title' | 'body'>,
  t: T,
): { title: string; body: string | null } {
  const statique = STATIQUES[n.kind];
  if (statique) {
    return { title: t(`${statique}.title`), body: n.body ? t(`${statique}.body`) : null };
  }
  if (n.kind === 'autopilote-rush-introuvable') {
    const nb = nombreRushIntrouvables(n.title);
    if (nb !== null) {
      const vide = /banque est maintenant vide/i.test(n.body || '');
      return {
        title: t(nb > 1 ? 'rushIntrouvable.titlePlural' : 'rushIntrouvable.titleOne', { n: nb }),
        body: n.body ? t(vide ? 'rushIntrouvable.bodyVide' : nb > 1 ? 'rushIntrouvable.bodyPlural' : 'rushIntrouvable.bodyOne', { n: nb }) : null,
      };
    }
  }
  return { title: n.title, body: n.body };
}
