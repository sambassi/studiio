import { supabaseAdmin } from '@/lib/db/supabase';

/**
 * Notifications in-app — la cloche du tableau de bord.
 *
 * ⚠️ CE MODULE EST UN SOCLE, PAS UNE RÉUTILISATION. Il n'existait AUCUN
 * système de notifications destiné à l'utilisateur : la cloche de `Navbar.tsx`
 * était un bouton sans gestionnaire de clic, avec une pastille rouge écrite en
 * dur, et `/api/admin/notifications` ne règle que les alertes EMAIL de
 * l'administrateur. La demande disait « réutiliser le mécanisme existant » ;
 * il n'y en avait pas.
 *
 * ⚠️ RIEN ICI NE LÈVE JAMAIS. Une notification est un service rendu à côté du
 * travail réel : une panne de base ne doit pas emporter le cycle de
 * l'Autopilote qui l'a déclenchée. Toutes les fonctions rendent une valeur
 * neutre et journalisent.
 */

/** Familles d'évènements. Une par cause, c'est elle qui porte l'anti-doublon. */
export const NOTIFICATION_KINDS = {
  /** La banque de rushes est vide : plus rien ne peut être produit. */
  autopiloteSansRush: 'autopilote-sans-rush',
  /** Un rush référencé a disparu du stockage. */
  autopiloteRushIntrouvable: 'autopilote-rush-introuvable',
  /** Le solde est descendu au seuil fixé par l'utilisateur. */
  autopiloteCredits: 'autopilote-credits',
} as const;

export type NotificationKind = typeof NOTIFICATION_KINDS[keyof typeof NOTIFICATION_KINDS];

export interface UserNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  href: string | null;
  readAt: string | null;
  createdAt: string;
}

/**
 * Fenêtre d'anti-doublon par défaut : une journée.
 *
 * ⚠️ CE N'EST PAS UN CONFORT, C'EST LA CONDITION POUR QUE LA CLOCHE SOIT
 * LISIBLE. Le déclencheur de l'Autopilote passe TOUTES LES HEURES, et son
 * refus « sans rush » est rendu AVANT le test d'heure de départ : sans
 * anti-doublon, un compte à la banque vide accumulerait vingt-quatre
 * notifications — et vingt-quatre emails — par jour, jusqu'à ce qu'il n'y
 * regarde plus.
 */
export const DEFAULT_DEDUPE_MS = 24 * 60 * 60 * 1000;

let storeProbe: { ready: boolean; at: number } | null = null;
const STORE_PROBE_TTL_MS = 60_000;

/** La table existe-t-elle ? Memoisé, comme les autres sondes du dépôt. */
export async function notificationStoreReady(): Promise<boolean> {
  const now = Date.now();
  // Une fois prête, la table ne disparaît pas : on ne re-sonde plus.
  if (storeProbe?.ready) return true;
  if (storeProbe && now - storeProbe.at < STORE_PROBE_TTL_MS) return false;

  let ready = false;
  try {
    const { error } = await supabaseAdmin.from('user_notifications').select('id').limit(1);
    ready = !error;
    if (error) {
      console.error(
        `[Notifications] Table user_notifications indisponible (${error.message}) — cloche DESACTIVEE. `
        + 'Appliquer migrations/2026-08-07-user-notifications.sql puis '
        + '`docker kill -s SIGUSR1 studiio-postgrest`.',
      );
    }
  } catch (err) {
    console.error('[Notifications] Sonde user_notifications impossible :', err);
  }
  storeProbe = { ready, at: now };
  return ready;
}

/**
 * Garde-fou EN MÉMOIRE, quand la table n'est pas encore là.
 *
 * ⚠️ IL SERT À PROTÉGER L'EMAIL, PAS LA CLOCHE. Tant que la migration n'est
 * pas appliquée, `notifyOnce` doit quand même dire « oui, c'est nouveau » une
 * seule fois par jour, sinon l'email best-effort de l'Autopilote repartirait à
 * chaque passage horaire — le défaut que ce module existe pour corriger.
 *
 * Imparfait par nature : une instance sans état recyclée remet le compteur à
 * zéro. C'est strictement mieux que rien, et le cas disparaît dès que la
 * migration est passée.
 */
const memoire = new Map<string, number>();

function memoireAutorise(cle: string, fenetreMs: number, now: number): boolean {
  const dernier = memoire.get(cle);
  if (typeof dernier === 'number' && now - dernier < fenetreMs) return false;
  memoire.set(cle, now);
  // La carte ne doit pas grossir indéfiniment dans un processus long.
  if (memoire.size > 5_000) {
    for (const [k, t] of memoire) {
      if (now - t >= fenetreMs) memoire.delete(k);
    }
  }
  return true;
}

/** Uniquement pour les tests : repart d'un état vierge. */
export function resetNotificationThrottle(): void {
  memoire.clear();
  storeProbe = null;
}

export interface NotifyResult {
  /** Une notification a-t-elle réellement été émise ? `false` = doublon étouffé. */
  created: boolean;
  /** A-t-elle été écrite en base, ou seulement comptée en mémoire ? */
  persisted: boolean;
}

/**
 * Crée une notification, SAUF si la même famille a déjà été émise récemment.
 *
 * Le booléen rendu est ce qui pilote l'email : l'appelant n'envoie que quand
 * `created` est vrai. Une seule décision, un seul anti-doublon — deux
 * conditions parallèles auraient fini par ne plus dire la même chose, et
 * l'email aurait continué de partir vingt-quatre fois par jour pendant que la
 * cloche, elle, restait propre.
 */
export async function notifyOnce(input: {
  userId: string;
  kind: NotificationKind | string;
  title: string;
  body?: string;
  href?: string;
  /** Fenêtre d'anti-doublon. Par défaut, une journée. */
  dedupeMs?: number;
  /** Injectable pour les tests. */
  now?: number;
}): Promise<NotifyResult> {
  const { userId, kind, title } = input;
  if (!userId || !kind || !title) return { created: false, persisted: false };
  const now = input.now ?? Date.now();
  const fenetre = input.dedupeMs ?? DEFAULT_DEDUPE_MS;
  const cleMemoire = `${userId}|${kind}`;

  if (!(await notificationStoreReady())) {
    // Table absente : la cloche ne peut rien montrer, mais l'email doit
    // rester limité. Le garde-fou mémoire prend le relais.
    return { created: memoireAutorise(cleMemoire, fenetre, now), persisted: false };
  }

  try {
    const depuis = new Date(now - fenetre).toISOString();
    const { data, error } = await supabaseAdmin
      .from('user_notifications')
      .select('id')
      .eq('user_id', userId)
      .eq('kind', kind)
      .gte('created_at', depuis)
      .limit(1);
    if (error) {
      console.error('[Notifications] Lecture anti-doublon échouée :', error.message);
      // On ne sait pas : on retombe sur le garde-fou mémoire plutôt que de
      // supposer « rien récemment » — supposer produirait le harcèlement.
      return { created: memoireAutorise(cleMemoire, fenetre, now), persisted: false };
    }
    if ((data ?? []).length > 0) return { created: false, persisted: false };

    const { error: insertError } = await supabaseAdmin
      .from('user_notifications')
      .insert({
        user_id: userId,
        kind,
        title,
        body: input.body ?? null,
        href: input.href ?? null,
      });
    if (insertError) {
      console.error('[Notifications] Écriture échouée :', insertError.message);
      return { created: memoireAutorise(cleMemoire, fenetre, now), persisted: false };
    }
    memoire.set(cleMemoire, now);
    return { created: true, persisted: true };
  } catch (err) {
    console.error('[Notifications] Écriture impossible :', err);
    return { created: memoireAutorise(cleMemoire, fenetre, now), persisted: false };
  }
}

/** Les notifications récentes d'un utilisateur, les plus fraîches d'abord. */
export async function listNotifications(
  userId: string,
  limit = 20,
): Promise<UserNotification[]> {
  if (!userId || !(await notificationStoreReady())) return [];
  try {
    const { data, error } = await supabaseAdmin
      .from('user_notifications')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(Math.min(50, Math.max(1, limit)));
    if (error) {
      console.error('[Notifications] Lecture échouée :', error.message);
      return [];
    }
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: String(r.id),
      kind: String(r.kind ?? ''),
      title: String(r.title ?? ''),
      body: (r.body as string | null) ?? null,
      href: (r.href as string | null) ?? null,
      readAt: (r.read_at as string | null) ?? null,
      createdAt: String(r.created_at ?? ''),
    }));
  } catch (err) {
    console.error('[Notifications] Lecture impossible :', err);
    return [];
  }
}

/**
 * Marque comme lues — toutes, ou celles listées.
 *
 * ⚠️ LE FILTRE SUR `user_id` EST OBLIGATOIRE MÊME AVEC DES IDENTIFIANTS. Ces
 * identifiants viennent du client : sans lui, on marquerait comme lues les
 * notifications de n'importe qui.
 */
export async function markRead(userId: string, ids?: string[]): Promise<boolean> {
  if (!userId || !(await notificationStoreReady())) return false;
  try {
    let requete = supabaseAdmin
      .from('user_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null);
    if (ids && ids.length > 0) requete = requete.in('id', ids.slice(0, 100));
    const { error } = await requete;
    if (error) {
      console.error('[Notifications] Marquage échoué :', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Notifications] Marquage impossible :', err);
    return false;
  }
}
