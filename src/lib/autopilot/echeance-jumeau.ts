/**
 * B3 — L'ÉCHÉANCE D'UN CRÉNEAU QUI ATTEND SON JUMEAU. Pur, sans base.
 *
 * Le post d'un créneau Autopilote avec jumeau n'est créé qu'APRÈS le rendu
 * (`finaliserJumeauxPrets` → `produireUnMontage`), à la date/heure du créneau
 * d'origine ; en mode `auto` il naît `scheduled`, et le cron de publication
 * publie un post « scheduled » en retard SANS limite. Un jumeau qui tarde
 * (jusqu'à `PLAFOND_SUIVI_JUMEAU_MS`, ~12 h 10) pouvait donc faire publier une
 * vidéo des heures après l'heure annoncée — ou la faire attendre sans un mot.
 *
 * La décision « avec ou sans avatar » se prend donc AVANT l'heure réelle de
 * publication, en anticipant le temps de montage :
 *
 *   échéance = heure de publication (date + heure du créneau, dans le fuseau
 *              de la configuration — celui que le cron de publication lit dans
 *              `metadata.timezone`) − `MARGE_PRODUCTION_JUMEAU_MS`.
 *
 * Seul un post qui partirait SEUL est concerné (`mode: auto` → `scheduled`).
 * Un brouillon (`review`, et « Produire maintenant ») ne publie rien : aucune
 * échéance, comportement d'avant (attente longue possible).
 */

import { DEFAULT_TIMEZONE, PUBLISH_TIME_RE, START_DATE_RE, statusForMode } from '@/lib/autopilot/rules';
import type { AutopilotMode } from '@/lib/autopilot/rules';

/**
 * Marge réservée au montage et au dépôt du post avant l'heure de publication.
 *
 * Mesures existantes : un rendu Remotion dure ~400 s (`REMOTION_RENDER_MS`
 * observé), « sept minutes sous charge » (`DELAI_ABANDON_EN_COURS_MS`) ; s'y
 * ajoutent l'intervalle entre deux passes du finaliseur (déclenchement toutes
 * les 5 min) et le dépôt (téléversement, post). 7 + 5 + 3 = 15 min ; 20 min
 * laissent une marge sûre sans priver l'avatar de temps utile.
 */
export const MARGE_PRODUCTION_JUMEAU_MS = 20 * 60 * 1000;

/**
 * Politique de repli quand le jumeau n'est pas prêt à l'échéance.
 *
 *   - `sans_avatar` (DÉFAUT, et seule politique en production : B2) — le
 *     créneau sort sans jumeau, dit (`rendreSansJumeau`, `jumeauIgnore`).
 *     C'est déjà l'issue de l'échec à `MAX_TENTATIVES`.
 *   - `suspendre` — aucune version dégradée : le créneau reste en attente,
 *     signalé, et ne publie jamais en retard en silence.
 *
 * Aucun réglage utilisateur n'existe aujourd'hui (aucune colonne) : la valeur
 * est lue dans le snapshot de la file, absente = `sans_avatar`.
 */
export type PolitiqueRepliJumeau = 'sans_avatar' | 'suspendre';

export function politiqueRepliJumeau(snapshot: { politiqueRepli?: unknown } | null | undefined): PolitiqueRepliJumeau {
  return snapshot?.politiqueRepli === 'suspendre' ? 'suspendre' : 'sans_avatar';
}

/** Décalage (ms) du fuseau à l'instant `t` : heure locale lue comme UTC − t. LÈVE si fuseau illisible. */
function decalage(t: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(t));
  const n = (k: string) => Number(parts.find((p) => p.type === k)?.value);
  const h = n('hour') === 24 ? 0 : n('hour');
  const local = Date.UTC(n('year'), n('month') - 1, n('day'), h, n('minute'), n('second'));
  if (!Number.isFinite(local)) throw new Error('fuseau illisible');
  return local - Math.floor(t / 1000) * 1000;
}

/**
 * Instant UTC de « date heure » lues dans `timezone` (repli Paris, comme le
 * cron de publication). `null` si la date ou l'heure est illisible.
 */
export function instantLocal(date: unknown, time: unknown, timezone?: string | null): number | null {
  if (typeof date !== 'string' || !START_DATE_RE.test(date)) return null;
  const hhmm = typeof time === 'string' ? time.slice(0, 5) : '';
  if (!PUBLISH_TIME_RE.test(hhmm)) return null;
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const naif = Date.UTC(y, m - 1, d, h, mi);
  const calcul = (tz: string) => {
    let t = naif - decalage(naif, tz);
    t = naif - decalage(t, tz); // deuxième passe : changement d'heure
    return t;
  };
  try { return calcul(timezone || DEFAULT_TIMEZONE); } catch { /* repli Paris */ }
  try { return calcul(DEFAULT_TIMEZONE); } catch { return null; }
}

interface SnapshotEcheance {
  config?: { mode?: AutopilotMode | string; runTimezone?: string | null } | null;
  post?: { scheduledDate?: unknown; scheduledTime?: unknown } | null;
}

/** Le post de ce créneau partirait-il SEUL (`scheduled`) ? */
export function publicationAutomatique(s: SnapshotEcheance | null | undefined): boolean {
  return statusForMode((s?.config?.mode ?? 'review') as AutopilotMode) === 'scheduled';
}

/** Heure réelle de publication du créneau, ou `null` (brouillon, créneau illisible). */
export function instantPublicationCreneau(s: SnapshotEcheance | null | undefined): number | null {
  if (!publicationAutomatique(s)) return null;
  return instantLocal(s?.post?.scheduledDate, s?.post?.scheduledTime, s?.config?.runTimezone ?? null);
}

/** Échéance de décision avec/sans avatar, ou `null` : aucune (attente d'avant). */
export function echeanceDecisionJumeau(s: SnapshotEcheance | null | undefined): number | null {
  const pub = instantPublicationCreneau(s);
  return pub === null ? null : pub - MARGE_PRODUCTION_JUMEAU_MS;
}

/** Libellé « 16/10/2026 à 18:00 » du créneau, pour les messages. */
export function libelleCreneau(s: SnapshotEcheance | null | undefined): string {
  const date = typeof s?.post?.scheduledDate === 'string' ? s.post.scheduledDate : '';
  const time = typeof s?.post?.scheduledTime === 'string' ? s.post.scheduledTime.slice(0, 5) : '';
  if (!START_DATE_RE.test(date)) return 'prévue';
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}${time ? ` à ${time}` : ''}`;
}
