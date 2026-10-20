/**
 * SUIVI D'UNE PRODUCTION MANUELLE AVEC JUMEAU — « où en est mon brouillon ? ».
 *
 * ⚠️ LE FAUX SUCCÈS QU'IL FERME (prod 2026-10-13). Avec l'avatar actif,
 * « Produire un brouillon maintenant » ne rend RIEN tout de suite : il lance la
 * vidéo de l'avatar, met le montage en FILE (`autopilot_jumeau_attente`) et
 * répond 200 `{ jumeau: 'en_preparation' }` — sans `postId`. L'écran prenait
 * cette réponse pour un dépôt et affichait « Brouillon déposé dans le
 * Calendrier », alors que le montage n'est rendu qu'à la passe suivante du
 * finaliseur (cron Autopilote, horaire). Le Calendrier était vide.
 *
 * Le succès n'est désormais annoncé qu'après PREUVE :
 *   A. la file dit `rendu` avec un `post_id` ;
 *   B. ce post existe dans `scheduled_posts` pour CE compte ;
 *   C. son statut est affichable (brouillon / planifié) ;
 *   D. le Calendrier le lit (même table, même `user_id`, sa date) ;
 *   E. il porte sa vidéo (`media_url`).
 *
 * Tant que le montage n'est pas rendu, l'écran dit « en préparation » et,
 * onglet ouvert, fait avancer la file de CE compte sans attendre le cron
 * (même finaliseur, prise atomique de chaque ligne : jamais deux rendus).
 */
import { supabaseAdmin } from '@/lib/db/supabase';
import { finaliserJumeauxPrets } from '@/lib/autopilot/jumeau-async';
import { trahitUnFournisseur } from '@/lib/avatar/fournisseurs';
import { slotKey } from '@/lib/autopilot/engine';

/** Préfixe du `job_id` d'une production manuelle (`produire-maintenant`). */
export const PREFIXE_JOB_MANUEL = 'autopilote-manuel-';
/** Au-delà, une production manuelle n'est plus « la dernière » à suivre. */
export const FENETRE_SUIVI_MS = 6 * 60 * 60 * 1000;
/** Au plus une avancée de file par compte et par intervalle (le navigateur relit toutes les 2 s). */
export const INTERVALLE_AVANCEE_MS = 15_000;

const STATUTS_EN_COURS = ['reserve', 'en_attente', 'en_cours'];
const STATUTS_AFFICHABLES = ['draft', 'scheduled'];

export interface PostVerifie {
  postId: string;
  scheduledDate: string;
  scheduledTime: string;
  status: string;
  videoUrl: string;
}

export type SuiviJumeau =
  /**
   * `statut` (additif) : l'état RÉEL de la ligne de file (`reserve` →
   * `en_attente` → `en_cours`), que l'écran traduit en étapes ; `depuis` :
   * l'horodatage serveur de la mise en file (temps écoulé, survit au rechargement).
   */
  | { etat: 'en_preparation'; jobId: string; statut?: string; depuis?: string }
  | { etat: 'depose'; jobId: string; post: PostVerifie; sansAvatar: boolean }
  | { etat: 'echec'; jobId: string; message: string };

/**
 * Le post est-il RÉELLEMENT dans le Calendrier de ce compte, vidéo comprise ?
 * Critères = ceux de `GET /api/posts` (même table, même `user_id`) + un statut
 * affiché par le Calendrier + une vidéo. `null` sinon.
 */
export async function postVisibleDansCalendrier(userId: string, postId: string): Promise<PostVerifie | null> {
  const { data, error } = await supabaseAdmin
    .from('scheduled_posts')
    .select('id, user_id, status, scheduled_date, scheduled_time, media_url')
    .eq('id', postId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  const p = data as { id: string; user_id: string; status: string; scheduled_date: string; scheduled_time: string; media_url: string | null };
  if (p.user_id !== userId || !STATUTS_AFFICHABLES.includes(p.status) || !p.media_url) return null;
  return { postId: p.id, scheduledDate: p.scheduled_date, scheduledTime: String(p.scheduled_time ?? '').slice(0, 5), status: p.status, videoUrl: p.media_url };
}

/** Le montage de repli (sans avatar) d'un créneau en échec, s'il a été rendu. */
async function postDuCreneau(userId: string, slotKey: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('scheduled_posts')
    .select('id')
    .eq('user_id', userId)
    .eq('metadata->>slotKey', slotKey)
    .limit(1);
  const id = (data as Array<{ id?: unknown }> | null)?.[0]?.id;
  return typeof id === 'string' ? id : null;
}

/** La dernière production manuelle avec jumeau de ce compte, et son état PROUVÉ. */
export async function suiviProductionJumeau(userId: string, now = Date.now()): Promise<SuiviJumeau | null> {
  const { data } = await supabaseAdmin
    .from('autopilot_jumeau_attente')
    .select('job_id, slot_key, statut, post_id, motif, created_at')
    .eq('user_id', userId)
    .like('job_id', `${PREFIXE_JOB_MANUEL}%`)
    .order('created_at', { ascending: false })
    .limit(1);
  const ligne = (data as Array<{ job_id: string; slot_key: string; statut: string; post_id: string | null; motif: string | null; created_at: string }> | null)?.[0];
  if (!ligne || now - Date.parse(ligne.created_at) > FENETRE_SUIVI_MS) return null;
  const jobId = ligne.job_id;

  if (STATUTS_EN_COURS.includes(ligne.statut)) return { etat: 'en_preparation', jobId, statut: ligne.statut, depuis: ligne.created_at };

  if (ligne.statut === 'rendu') {
    const post = ligne.post_id ? await postVisibleDansCalendrier(userId, ligne.post_id) : null;
    if (post) return { etat: 'depose', jobId, post, sansAvatar: false };
    return { etat: 'echec', jobId, message: 'Le montage est terminé, mais le brouillon n’a pas été retrouvé dans le Calendrier. Rien n’a été débité en double ; réessayez.' };
  }

  // Échec du jumeau : le finaliseur rend un montage de REPLI, sans avatar.
  const repli = await postDuCreneau(userId, ligne.slot_key);
  const postRepli = repli ? await postVisibleDansCalendrier(userId, repli) : null;
  if (postRepli) return { etat: 'depose', jobId, post: postRepli, sansAvatar: true };
  const motif = ligne.motif && !trahitUnFournisseur(ligne.motif) ? ` ${ligne.motif}` : '';
  return { etat: 'echec', jobId, message: `La vidéo avec votre avatar n’a pas pu être préparée : aucun brouillon n’a été déposé.${motif}` };
}

// ── Production manuelle SANS avatar : retrouvée par son créneau ───────────────
// Son état d'avancement vit en mémoire du processus (`progression.ts`) : un
// redémarrage l'efface. L'écran garde le créneau lancé ; le serveur relit alors
// le Calendrier pour ce créneau — déposé (PREUVE : post relu) ou perdu.

/** Le `job_id` d'une production manuelle — LE MÊME que celui du POST. */
export function jobIdManuel(userId: string, date: string, time: string): string {
  return `${PREFIXE_JOB_MANUEL}${userId}-${date}-${time.replace(':', '')}`;
}

/** Le jeton de créneau d'une production manuelle (`metadata.slotKey` du post). */
export function jetonManuel(userId: string, date: string, time: string): string {
  return `manuel:${slotKey(userId, date, time)}`;
}

/** Date/heure d'un créneau manuel lues d'une requête ; `null` si absentes ou invalides. */
export function creneauDepuisRequete(date: unknown, time: unknown): { date: string; time: string } | null {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) return null;
  return { date, time };
}

export type SuiviManuel = { etat: 'depose'; post: PostVerifie } | { etat: 'perdue' };

/** Le créneau manuel a-t-il produit un brouillon RÉELLEMENT visible ? Sinon : perdu. */
export async function suiviProductionManuelle(userId: string, date: string, time: string): Promise<SuiviManuel> {
  const id = await postDuCreneau(userId, jetonManuel(userId, date, time)).catch(() => null);
  const post = id ? await postVisibleDansCalendrier(userId, id) : null;
  return post ? { etat: 'depose', post } : { etat: 'perdue' };
}

/**
 * GARDE ANTI-DOUBLON — une vidéo avec avatar de CE compte est-elle encore en
 * préparation (ligne de file non terminale, récente) ? Lecture seule. Une
 * lecture en erreur vaut « non » : le comportement d'avant, jamais un blocage
 * permanent sur une panne de lecture.
 */
export async function jumeauEnPreparation(userId: string, now = Date.now()): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('autopilot_jumeau_attente')
    .select('job_id, statut, created_at')
    .eq('user_id', userId)
    .in('statut', STATUTS_EN_COURS)
    .order('created_at', { ascending: false })
    .limit(5);
  if (error || !Array.isArray(data)) return false;
  return (data as Array<{ created_at?: string }>).some((l) => {
    const t = Date.parse(String(l.created_at ?? ''));
    return Number.isFinite(t) && now - t <= FENETRE_SUIVI_MS;
  });
}

// ── Faire avancer la file pendant que l'écran attend ─────────────────────────

const derniereAvancee = new Map<string, number>();
const avanceesEnVol = new Set<string>();

/**
 * Fait avancer la file de CE compte (une ligne au plus), sans attendre le
 * cron. Ne bloque jamais la réponse ; bornée dans le temps et dans
 * l'instance. La prise atomique `en_attente → en_cours` du finaliseur garantit
 * qu'un cron simultané ne rend pas le même montage une seconde fois.
 */
export function avancerFileDuCompte(userId: string, now = Date.now(), finaliser = finaliserJumeauxPrets): boolean {
  if (avanceesEnVol.has(userId)) return false;
  if (now - (derniereAvancee.get(userId) ?? 0) < INTERVALLE_AVANCEE_MS) return false;
  derniereAvancee.set(userId, now);
  avanceesEnVol.add(userId);
  void finaliser({ userId, max: 1 })
    .catch((e: unknown) => console.error('[Autopilote/Suivi]', userId, e instanceof Error ? e.message : e))
    .finally(() => { avanceesEnVol.delete(userId); });
  return true;
}

/** Pour les tests. */
export function _reinitialiserSuivi(): void {
  derniereAvancee.clear();
  avanceesEnVol.clear();
}
