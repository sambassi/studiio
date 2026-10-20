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
/** Tous les statuts d'une ligne de file JUMEAU (jamais `direct_*`). */
const STATUTS_JUMEAU = [...STATUTS_EN_COURS, 'rendu', 'echec'];

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
    // Les lignes de file JUMEAU seulement : la ligne-verrou d'une production
    // SANS avatar (`direct_*`, même préfixe de job) a son propre suivi.
    .in('statut', STATUTS_JUMEAU)
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
 * GARDE ANTI-DOUBLON — une production MANUELLE avec avatar de CE compte est-elle encore en
 * préparation (ligne de file non terminale, récente) ? Lecture seule. Une
 * lecture en erreur vaut « non » : le comportement d'avant, jamais un blocage
 * permanent sur une panne de lecture.
 */
export async function jumeauEnPreparation(userId: string, now = Date.now()): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('autopilot_jumeau_attente')
    .select('job_id, statut, created_at')
    .eq('user_id', userId)
    // Productions MANUELLES seulement : une ligne du cron (ou une réservation
    // bloquée d'un créneau du cron) ne doit jamais bloquer « Produire maintenant ».
    .like('job_id', `${PREFIXE_JOB_MANUEL}%`)
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

// ═════════════════════════════════════════════════════════════════════════════
// PRODUCTION MANUELLE SANS AVATAR — ÉTAT ET VERROU PERSISTANTS
// ═════════════════════════════════════════════════════════════════════════════
//
// ⚠️ CE QUI MANQUAIT. Sans avatar, l'état d'une production vivait en MÉMOIRE
// du processus (`enVol`, `progression.ts`). Un redémarrage / redéploiement
// l'effaçait : la garde anti-doublon devenait aveugle (nouveau clic → nouveau
// rendu ; nouveau créneau de 5 min → nouveau `jobId` → nouveau débit possible),
// et ni l'écran ni le Calendrier ne savaient plus qu'un rendu tournait.
//
// TABLE RÉUTILISÉE, SANS MIGRATION : `autopilot_jumeau_attente`.
//   - UNE ligne par compte, `slot_key = 'manuel-direct'` : l'`unique (user_id,
//     slot_key)` EXISTANT en fait un verrou par compte, tranché par la base
//     (deux processus, deux onglets, un redémarrage : une seule réservation) ;
//   - statuts PROPRES `direct_*` : le finaliseur ne lit que `en_attente` /
//     `en_cours`, le cron que `reserve` / `en_attente` / `en_cours`, la garde
//     avatar et le suivi jumeau leurs statuts explicites — AUCUN ne voit ces
//     lignes (verrouillé par un test) ;
//   - `generation_id` (not null) = l'UUID nul, la convention de `reserve`
//     (`GENERATION_RESERVEE`) : aucune génération réelle ne le porte ;
//   - `snapshot` (not null) = l'état affichable : créneau, étape, avancement,
//     instance du processus qui rend.
//
// Le DÉBIT n'est pas concerné : il reste APRÈS l'insertion du post, sous la
// référence idempotente `autopilote:<jobId>` (`produireUnMontage`).

/** Clé de la ligne-verrou d'un compte (une seule par compte : `unique (user_id, slot_key)`). */
export const SLOT_PRODUCTION_DIRECTE = 'manuel-direct';
export const STATUT_DIRECT_EN_COURS = 'direct_en_cours';
export const STATUT_DIRECT_RENDU = 'direct_rendu';
export const STATUT_DIRECT_ECHEC = 'direct_echec';
/** Même convention que `GENERATION_RESERVEE` (jumeau-async) : aucune génération réelle n'a cet identifiant. */
const GENERATION_AUCUNE = '00000000-0000-0000-0000-000000000000';

/**
 * Sans signe de vie depuis ce délai, une production est ORPHELINE (processus
 * mort sans avoir écrit sa fin) : la réservation est libérée, une relance est
 * possible. Le rendu vivant écrit au moins toutes les `BATTEMENT_DIRECT_MS`.
 */
export const DELAI_ORPHELINE_MS = 30 * 60_000;
/**
 * Ligne écrite par un AUTRE processus (redémarrage : l'instance a changé) et
 * silencieuse depuis ce délai : son rendu est mort avec l'ancien processus —
 * pas besoin d'attendre 30 min pour rendre la main.
 */
export const DELAI_ORPHELINE_AUTRE_INSTANCE_MS = 3 * 60_000;
/** Battement du rendu vivant (mise à jour de `updated_at`). */
export const BATTEMENT_DIRECT_MS = 60_000;
/** Écriture de l'avancement : au changement d'étape, sinon au plus une fois par intervalle. */
export const INTERVALLE_ECRITURE_DIRECTE_MS = 15_000;

/** Identifiant de CE processus — survit au rechargement de module (dev), change au redémarrage. */
export function instanceProcessus(): string {
  const g = globalThis as { __studiioInstanceAutopilote?: string };
  if (!g.__studiioInstanceAutopilote) g.__studiioInstanceAutopilote = `i-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return g.__studiioInstanceAutopilote;
}

export interface SnapshotDirect {
  direct: true;
  instance: string;
  jobId: string;
  date: string;
  time: string;
  timezone?: string;
  title?: string;
  debut: number;
  etape?: string;
  avancement?: number | null;
  pourcent?: number;
  /** Message d'échec affichable (jamais un nom de fournisseur). */
  message?: string;
  code?: string;
}

interface LigneDirecte {
  id: string;
  user_id: string;
  job_id: string;
  statut: string;
  post_id: string | null;
  motif: string | null;
  snapshot: SnapshotDirect | null;
  updated_at: string;
}

const COLONNES_DIRECTES = 'id, user_id, job_id, statut, post_id, motif, snapshot, updated_at';

async function lireLigneDirecte(userId: string): Promise<{ ligne: LigneDirecte | null; erreur: boolean }> {
  const { data, error } = await supabaseAdmin
    .from('autopilot_jumeau_attente')
    .select(COLONNES_DIRECTES)
    .eq('user_id', userId)
    .eq('slot_key', SLOT_PRODUCTION_DIRECTE)
    .limit(1);
  if (error) return { ligne: null, erreur: true };
  const l = (data as LigneDirecte[] | null)?.[0] ?? null;
  return { ligne: l, erreur: false };
}

/** La ligne `direct_en_cours` est-elle orpheline (rendu mort sans écrire sa fin) ? Pure. */
export function estOrpheline(l: { statut: string; updated_at: string; snapshot?: { instance?: unknown } | null }, now = Date.now(), instance = instanceProcessus()): boolean {
  if (l.statut !== STATUT_DIRECT_EN_COURS) return false;
  const t = Date.parse(l.updated_at);
  if (!Number.isFinite(t)) return true;
  const silence = now - t;
  if (silence > DELAI_ORPHELINE_MS) return true;
  return l.snapshot?.instance !== instance && silence > DELAI_ORPHELINE_AUTRE_INSTANCE_MS;
}

/**
 * Clôt une ligne orpheline. Le brouillon du créneau existe-t-il (le rendu a
 * abouti avant la mort du processus) ? → `direct_rendu` avec son post ; sinon
 * `direct_echec`. Conditionnel (statut ET `updated_at` lus) : deux lecteurs
 * simultanés ne clôturent qu'une fois. Aucun fournisseur, aucun débit.
 */
async function cloreOrpheline(l: LigneDirecte, userId: string): Promise<LigneDirecte> {
  const s = l.snapshot;
  const postId = s?.date && s?.time ? await postDuCreneau(userId, jetonManuel(userId, s.date, s.time)).catch(() => null) : null;
  const visible = postId ? await postVisibleDansCalendrier(userId, postId).catch(() => null) : null;
  const maj: Record<string, unknown> = visible
    ? { statut: STATUT_DIRECT_RENDU, post_id: visible.postId, motif: null }
    : {
      statut: STATUT_DIRECT_ECHEC,
      motif: 'interrompue',
      snapshot: { ...(s ?? {}), message: MESSAGE_DIRECTE_INTERROMPUE, code: 'interrompue' },
    };
  const nouveau = { ...maj, updated_at: new Date().toISOString() };
  const { error } = await supabaseAdmin
    .from('autopilot_jumeau_attente')
    .update(nouveau)
    .eq('id', l.id)
    .eq('statut', STATUT_DIRECT_EN_COURS)
    .eq('updated_at', l.updated_at);
  if (error) console.error('[Autopilote/Manuel] orpheline non close :', l.id, error.message);
  else console.warn(`[Autopilote/Manuel] ${userId} — production ${l.job_id} orpheline, close (${String(maj.statut)})`);
  return { ...l, ...(nouveau as Partial<LigneDirecte>) };
}

/** Message d'une production interrompue (processus mort) — honnête sur l'argent. */
export const MESSAGE_DIRECTE_INTERROMPUE =
  'Production interrompue : le serveur a redémarré pendant le rendu. Aucun crédit n’est débité tant qu’aucun brouillon n’est déposé dans le Calendrier. Relancez la production.';

export type ReservationDirecte =
  | { ok: true }
  | { ok: false; raison: 'en_cours'; date?: string; time?: string }
  | { ok: false; raison: 'base'; message: string };

/**
 * Une production sans avatar est-elle EN COURS pour ce compte (ligne vivante,
 * non orpheline) ? Lecture ; une orpheline rencontrée est close au passage.
 * Erreur de lecture → `null` (l'appelant décide).
 */
export async function productionDirecteEnCours(userId: string, now = Date.now()): Promise<{ date: string; time: string } | null> {
  const { ligne } = await lireLigneDirecte(userId);
  if (!ligne || ligne.statut !== STATUT_DIRECT_EN_COURS) return null;
  if (estOrpheline(ligne, now)) { await cloreOrpheline(ligne, userId); return null; }
  return { date: ligne.snapshot?.date ?? '', time: ligne.snapshot?.time ?? '' };
}

/** Le dernier snapshot écrit par CE processus, par compte (base des écritures d'avancement). */
const snapshotsDirects = new Map<string, { jobId: string; snapshot: SnapshotDirect; ecritA: number }>();

/**
 * RÉSERVE la production sans avatar de ce compte, AVANT tout rendu.
 *
 * Atomique côté base :
 *   - pas de ligne → INSERT ; l'`unique (user_id, slot_key)` refuse la seconde
 *     insertion concurrente (23505) → `en_cours` ;
 *   - ligne terminée (`direct_rendu` / `direct_echec`) ou orpheline → UPDATE
 *     conditionné au statut ET à l'`updated_at` lus : une seule requête gagne ;
 *   - ligne vivante → `en_cours`, rien n'est lancé.
 * Toute autre erreur de base → `base` : rien n'est lancé (jamais un rendu sans
 * verrou persistant).
 */
export async function reserverProductionDirecte(
  userId: string,
  p: { jobId: string; date: string; time: string; timezone?: string; title?: string },
  now = Date.now(),
): Promise<ReservationDirecte> {
  const snapshot: SnapshotDirect = {
    direct: true, instance: instanceProcessus(), jobId: p.jobId, date: p.date, time: p.time,
    timezone: p.timezone, title: p.title, debut: now, etape: 'analyse', avancement: null, pourcent: 0,
  };
  const champs = {
    job_id: p.jobId, statut: STATUT_DIRECT_EN_COURS, snapshot, post_id: null, motif: null,
    generation_id: GENERATION_AUCUNE, updated_at: new Date(now).toISOString(),
  };
  const base = (message: string): ReservationDirecte => ({ ok: false, raison: 'base', message });

  for (let essai = 0; essai < 3; essai += 1) {
    const { ligne, erreur } = await lireLigneDirecte(userId);
    if (erreur) return base('lecture');
    if (!ligne) {
      const { error } = await supabaseAdmin
        .from('autopilot_jumeau_attente')
        .insert({ user_id: userId, slot_key: SLOT_PRODUCTION_DIRECTE, ...champs })
        .select('id');
      if (!error) { snapshotsDirects.set(userId, { jobId: p.jobId, snapshot, ecritA: now }); return { ok: true }; }
      const conflit = error.code === '23505' || String(error.message ?? '').toLowerCase().includes('duplicate');
      if (conflit) continue; // une requête concurrente a inséré : on relit
      return base(String(error.message ?? 'insertion'));
    }
    const lue = ligne;
    if (lue.statut === STATUT_DIRECT_EN_COURS) {
      if (!estOrpheline(lue, now)) return { ok: false, raison: 'en_cours', date: lue.snapshot?.date, time: lue.snapshot?.time };
      await cloreOrpheline(lue, userId);
      continue; // relire la ligne close, puis la reprendre
    }
    const { data, error } = await supabaseAdmin
      .from('autopilot_jumeau_attente')
      .update(champs)
      .eq('id', lue.id)
      .eq('statut', lue.statut)
      .eq('updated_at', lue.updated_at)
      .select('id');
    if (error) return base(String(error.message ?? 'mise à jour'));
    if (Array.isArray(data) && data.length > 0) { snapshotsDirects.set(userId, { jobId: p.jobId, snapshot, ecritA: now }); return { ok: true }; }
    // Prise par une autre requête entre la lecture et l'écriture : on relit.
  }
  const { ligne } = await lireLigneDirecte(userId);
  if (ligne?.statut === STATUT_DIRECT_EN_COURS) return { ok: false, raison: 'en_cours', date: ligne.snapshot?.date, time: ligne.snapshot?.time };
  return base('réservation disputée');
}

async function ecrireDirecte(userId: string, jobId: string, maj: Record<string, unknown>, seulementEnCours = true): Promise<boolean> {
  let q = supabaseAdmin
    .from('autopilot_jumeau_attente')
    .update({ ...maj, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('slot_key', SLOT_PRODUCTION_DIRECTE)
    .eq('job_id', jobId);
  if (seulementEnCours) q = q.eq('statut', STATUT_DIRECT_EN_COURS);
  const { error } = await q;
  if (error) { console.error('[Autopilote/Manuel] état non écrit :', userId, jobId, error.message); return false; }
  return true;
}

/**
 * Avancement RÉEL d'une production réservée (étape + avancement mesuré),
 * écrit au changement d'étape ou au plus toutes les `INTERVALLE_ECRITURE_DIRECTE_MS`.
 * Best-effort : une écriture ratée n'arrête jamais le rendu (elle est journalisée).
 */
export function noterEtapeDirecte(userId: string, jobId: string, e: { etape: string; avancement: number | null; pourcent: number }, now = Date.now()): Promise<boolean> | null {
  const courant = snapshotsDirects.get(userId);
  if (!courant || courant.jobId !== jobId) return null;
  const changement = courant.snapshot.etape !== e.etape;
  if (!changement && now - courant.ecritA < INTERVALLE_ECRITURE_DIRECTE_MS) return null;
  const snapshot: SnapshotDirect = { ...courant.snapshot, etape: e.etape, avancement: e.avancement, pourcent: e.pourcent };
  snapshotsDirects.set(userId, { jobId, snapshot, ecritA: now });
  return ecrireDirecte(userId, jobId, { snapshot });
}

/** Battement du rendu vivant : `updated_at` rafraîchi, rien d'autre. */
export function battementDirect(userId: string, jobId: string): Promise<boolean> | null {
  const courant = snapshotsDirects.get(userId);
  if (!courant || courant.jobId !== jobId) return null;
  courant.ecritA = Date.now();
  return ecrireDirecte(userId, jobId, { snapshot: courant.snapshot });
}

/** Fin d'une production réservée : `direct_rendu` (post prouvé) ou `direct_echec` (message affichable). */
export async function terminerProductionDirecte(
  userId: string,
  jobId: string,
  fin: { ok: true; postId: string } | { ok: false; message: string; code?: string },
): Promise<boolean> {
  const courant = snapshotsDirects.get(userId);
  const base = courant?.jobId === jobId ? courant.snapshot : undefined;
  snapshotsDirects.delete(userId);
  if (fin.ok) {
    return ecrireDirecte(userId, jobId, { statut: STATUT_DIRECT_RENDU, post_id: fin.postId, motif: null, ...(base ? { snapshot: { ...base, etape: 'finalisation', pourcent: 100 } } : {}) });
  }
  return ecrireDirecte(userId, jobId, {
    statut: STATUT_DIRECT_ECHEC, motif: fin.code ?? 'echec',
    ...(base ? { snapshot: { ...base, message: fin.message, ...(fin.code ? { code: fin.code } : {}) } } : {}),
  });
}

/** Ce que `/progression` relit de la base pour une production sans avatar. */
export type LectureDirecte =
  | { etat: 'en_cours'; date: string; time: string; jobId: string; etape: string; avancement: number | null; pourcent: number; majA: number }
  | { etat: 'depose'; date: string; time: string; jobId: string; post: PostVerifie; timezone?: string; title?: string }
  | { etat: 'echec'; date: string; time: string; jobId: string; message: string; code?: string };

/**
 * L'état PERSISTANT de la production sans avatar de ce compte — survit au
 * redémarrage. Une orpheline est close au passage. `depose` exige le post
 * RELU dans le Calendrier (bon compte, statut affichable, vidéo).
 */
export async function lireProductionDirecte(userId: string, now = Date.now()): Promise<LectureDirecte | null> {
  const { ligne: brute } = await lireLigneDirecte(userId);
  if (!brute || !brute.snapshot || typeof brute.snapshot !== 'object') return null;
  const ligne = estOrpheline(brute, now) ? await cloreOrpheline(brute, userId) : brute;
  const s = ligne.snapshot!;
  const commun = { date: String(s.date ?? ''), time: String(s.time ?? ''), jobId: ligne.job_id };
  if (ligne.statut === STATUT_DIRECT_EN_COURS) {
    const t = Date.parse(ligne.updated_at);
    return {
      etat: 'en_cours', ...commun, etape: typeof s.etape === 'string' ? s.etape : 'analyse',
      avancement: typeof s.avancement === 'number' ? s.avancement : null,
      pourcent: typeof s.pourcent === 'number' ? s.pourcent : 0, majA: Number.isFinite(t) ? t : now,
    };
  }
  if (ligne.statut === STATUT_DIRECT_RENDU) {
    const post = ligne.post_id ? await postVisibleDansCalendrier(userId, ligne.post_id).catch(() => null) : null;
    if (post) return { etat: 'depose', ...commun, post, timezone: s.timezone, title: s.title };
    return { etat: 'echec', ...commun, message: 'Le rendu est terminé, mais le brouillon n’a pas été retrouvé dans le Calendrier.' };
  }
  if (ligne.statut === STATUT_DIRECT_ECHEC) {
    return { etat: 'echec', ...commun, message: typeof s.message === 'string' && s.message ? s.message : 'Production impossible. Rien n’a été débité.', ...(typeof s.code === 'string' ? { code: s.code } : {}) };
  }
  return null;
}

/** Pour les tests. */
export function _reinitialiserDirect(): void {
  snapshotsDirects.clear();
}
