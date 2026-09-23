/**
 * LE JUMEAU DANS LES MONTAGES D'AUTOPILOTE — SANS NAVIGATEUR, EN DEUX TEMPS.
 *
 * La génération D-ID d'un avatar prend 5 à 20 min. Une requête d'Autopilote
 * (cron OU « Produire maintenant ») est bornée à 300 s et n'a AUCUN navigateur
 * pour attendre — c'est ce qui interdisait, jusqu'ici, de monter la vidéo du
 * jumeau côté serveur. On DÉCOUPLE :
 *
 *   1. LANCER (`lancerJumeauMontage`) — quelques secondes : réserve et lance
 *      la génération D-ID (`genererVideoJumeau`, déjà idempotente et facturée),
 *      puis dépose une ligne dans `autopilot_jumeau_attente` avec de quoi
 *      RENDRE le même montage plus tard (config, post, rang, instant). Aucun
 *      rendu, aucun débit de rendu ici.
 *
 *   2. FINALISER (`finaliserJumeauxPrets`) — le cron, à chaque passe : fait
 *      AVANCER la génération (`avancerStatutGeneration`, la même chaîne que le
 *      poll de Créer : re-hébergement MinIO, remboursement si échec), et dès
 *      qu'une vidéo est prête, REND le montage (`produireUnMontage`, la vidéo
 *      du jumeau en séquence « Vidéo »), dépose le post, débite le rendu.
 *
 * IDEMPOTENCE, DOUBLE DÉBIT :
 *   - `unique (user_id, slot_key)` : un créneau ne peut être lancé qu'une fois,
 *     même si le cron repasse (le lancement lit d'abord la file).
 *   - `genererVideoJumeau` ne débite pas deux fois une même génération (index
 *     partiel des générations en vol).
 *   - claim atomique `en_attente → en_cours` : deux finaliseurs ne rendent
 *     jamais le même montage deux fois.
 *   - `produireUnMontage` débite le rendu par `job_id` (référence stable) :
 *     un rendu rejoué ne re-débite pas.
 *
 * SUR ÉCHEC (génération D-ID en échec, délai 30 min dépassé) : les crédits de
 * l'avatar sont remboursés par `avancerStatutGeneration` ; le montage sort
 * quand même, SANS le jumeau, et le dit — `metadata.jumeauIgnore` + motif,
 * jamais un remplacement silencieux. La voix clonée reste la voix off.
 */

import { supabaseAdmin } from '@/lib/db/supabase';
import type { AutopilotConfig } from '@/lib/autopilot/rules';
import type { PreparedPost } from '@/lib/autopilot/engine';
import { genererVideoJumeau, reconcilierLancement } from '@/lib/avatar/moteur-jumeau';
import { avancerStatutGeneration } from '@/lib/avatar/statut';
import { produireUnMontage, creneauxExistants } from '@/lib/autopilot/produire';

/** Format vertical de l'Autopilote — la génération du jumeau le suit. */
const RATIO_AUTOPILOTE = '9:16';
/** Au-delà, la parole ne tient plus dans un plan d'avatar lisible. */
const MAX_SCRIPT = 600;
/**
 * Passes de finalisation avant d'abandonner une ligne coincée. Chaque passe
 * = un poll ; `avancerStatutGeneration` déclare de toute façon l'échec au-delà
 * de 30 min de génération. Ce garde ne couvre que l'imprévu (fournisseur qui
 * ne répond jamais).
 */
const MAX_TENTATIVES = 40;

/**
 * Le script que le jumeau DIT dans le montage.
 *
 * Concis, et DISTINCT du contenu des cartes : titre (l'accroche), sous-titre,
 * puis la phrase de CTA. Le message du brief récurrent, s'il existe, ouvre —
 * c'est l'identité constante de la chaîne. Le jumeau étant la seule voix du
 * montage, ce script ne se répète nulle part ailleurs.
 */
export function scriptJumeauMontage(post: PreparedPost): string {
  const briefMessage = (post.brief?.message ?? '').trim();
  const parts = [briefMessage, post.title, post.content.subtitle, post.content.tagLine]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  // Dédoublonne (le titre peut déjà être le message du brief), garde l'ordre.
  const vus = new Set<string>();
  const uniques = parts.filter((p) => (vus.has(p) ? false : (vus.add(p), true)));
  return uniques.join('. ').slice(0, MAX_SCRIPT);
}

export type ResultatLancement =
  | { ok: true; generationId: string; attenteId: string; dejaEnFile: boolean }
  | { ok: false; motif: string; message: string };

/**
 * Snapshot RENDABLE : tout ce que `produireUnMontage` demande, moins la vidéo
 * du jumeau (ajoutée à la finalisation). Sérialisé tel quel dans la file.
 */
interface SnapshotMontage {
  /**
   * Génération ACCEPTÉE par le fournisseur mais dont l'identifiant n'a pas pu
   * être écrit sur `avatar_generations` : le finaliseur le rattache (voir
   * `reconcilierLancement`) au lieu de laisser une génération payée sans suivi.
   */
  reconciliation?: { providerVideoId: string };
  config: AutopilotConfig;
  post: PreparedPost;
  rang: number;
  now: number;
  metadataSupplement?: Record<string, unknown>;
  journal?: string;
}

/**
 * LANCE la génération du jumeau pour un montage et le met EN FILE. Ne rend
 * rien, ne débite aucun rendu : c'est le finaliseur qui montera.
 *
 * Idempotent par créneau : si `slot_key` est déjà en file, on ne relance pas —
 * on rend la ligne existante.
 */
export async function lancerJumeauMontage(input: {
  userId: string;
  config: AutopilotConfig;
  post: PreparedPost;
  rang: number;
  now: number;
  jobId: string;
  slotKey: string;
  metadataSupplement?: Record<string, unknown>;
  journal?: string;
}): Promise<ResultatLancement> {
  const journal = input.journal ?? '[Autopilote/Jumeau]';

  // Déjà en file pour ce créneau ? On ne relance pas — le finaliseur s'en
  // occupe. (Course de deux passes de cron : l'`unique` en base tranche aussi.)
  const { data: existant } = await supabaseAdmin
    .from('autopilot_jumeau_attente')
    .select('id, generation_id')
    .eq('user_id', input.userId)
    .eq('slot_key', input.slotKey)
    .limit(1);
  if (existant && existant.length > 0) {
    const l = existant[0] as { id: string; generation_id: string };
    return { ok: true, generationId: l.generation_id, attenteId: l.id, dejaEnFile: true };
  }

  const script = scriptJumeauMontage(input.post);
  if (!script) {
    return { ok: false, motif: 'texte_absent', message: 'Aucun texte à faire dire à votre jumeau pour ce montage.' };
  }

  const snapshot: SnapshotMontage = {
    config: input.config,
    post: input.post,
    rang: input.rang,
    now: input.now,
    metadataSupplement: input.metadataSupplement,
    journal,
  };

  // ── 1. RÉSERVER LE CRÉNEAU, AVANT TOUT APPEL FOURNISSEUR ────────────────
  // ⚠️ L'ORDRE ÉTAIT INVERSE : génération PUIS insertion. Deux passes
  // simultanées sur le même créneau passaient toutes deux le SELECT ci-dessus
  // et lançaient chacune une génération ; l'`unique (user_id, slot_key)` ne
  // tranchait qu'APRÈS, et la génération perdante restait lancée et payée.
  // L'index « en vol » de `genererVideoJumeau` ne couvre que des entrées
  // IDENTIQUES — or le script de deux passes peut différer (graine à la
  // minute). On réserve donc d'abord : seule la passe qui insère lance.
  const { data: reservee, error: errReserve } = await supabaseAdmin
    .from('autopilot_jumeau_attente')
    .insert({
      user_id: input.userId,
      generation_id: GENERATION_RESERVEE,
      slot_key: input.slotKey,
      job_id: input.jobId,
      statut: STATUT_RESERVE,
      snapshot,
    })
    .select('id')
    .single();

  if (errReserve) {
    const conflit = errReserve.code === '23505' || (errReserve.message ?? '').toLowerCase().includes('duplicate');
    if (conflit) {
      // Une passe concurrente a réservé ce créneau : c'est ELLE qui lance.
      const { data: gagnante } = await supabaseAdmin
        .from('autopilot_jumeau_attente')
        .select('id, generation_id')
        .eq('user_id', input.userId)
        .eq('slot_key', input.slotKey)
        .limit(1);
      const l = gagnante?.[0] as { id: string; generation_id: string } | undefined;
      if (l) return { ok: true, generationId: l.generation_id, attenteId: l.id, dejaEnFile: true };
    }
    console.error(`${journal} ${input.userId} — réservation du créneau impossible :`, errReserve.message);
    return { ok: false, motif: 'base', message: 'La mise en file du montage a échoué.' };
  }
  const attenteId = (reservee as { id: string }).id;

  // ── 2. LANCER — seule la passe qui a réservé arrive ici ─────────────────
  // (idempotente, facturée AVATAR_VIDEO_COST ; le moteur est revérifié pour le
  // fournisseur de l'avatar ici même). Refus ou exception : la génération n'a
  // pas démarré (ou a été remboursée par le moteur) — la réservation est
  // RENDUE, pour qu'un passage ultérieur puisse réessayer ce créneau.
  let gen: Awaited<ReturnType<typeof genererVideoJumeau>>;
  try {
    gen = await genererVideoJumeau({ userId: input.userId, textes: [script], aspectRatio: RATIO_AUTOPILOTE });
  } catch (e) {
    await libererReservation(attenteId);
    const message = e instanceof Error ? e.message : String(e);
    console.error(`${journal} ${input.userId} — lancement du jumeau en erreur :`, message);
    return { ok: false, motif: 'base', message: 'Le lancement du jumeau a échoué.' };
  }
  if (!gen.ok && 'lance' in gen && gen.lance) {
    // ── LANCÉE mais NON ENREGISTRÉE ─────────────────────────────────────
    // Le fournisseur a accepté (et la génération est débitée) : rendre la
    // réservation ferait relancer — et payer — une seconde génération au
    // passage suivant. On GARDE le créneau, on rattache la génération, et on
    // conserve l'identifiant fournisseur pour que le finaliseur réconcilie.
    const { error: errGarde } = await supabaseAdmin
      .from('autopilot_jumeau_attente')
      .update({
        generation_id: gen.generationId,
        statut: 'en_attente',
        snapshot: { ...snapshot, reconciliation: { providerVideoId: gen.providerVideoId } },
        updated_at: new Date().toISOString(),
      })
      .eq('id', attenteId)
      .eq('statut', STATUT_RESERVE);
    console.error(
      `${journal} ${input.userId} — jumeau LANCÉ (${gen.providerVideoId}) mais non enregistré ; créneau gardé pour réconciliation`
      + (errGarde ? ` — ET file non mise à jour : ${errGarde.message}` : ''),
    );
    return { ok: true, generationId: gen.generationId, attenteId, dejaEnFile: false };
  }
  if (!gen.ok) {
    await libererReservation(attenteId);
    console.warn(`${journal} ${input.userId} — lancement refusé (${gen.motif}) : ${gen.message}`);
    return { ok: false, motif: gen.motif, message: gen.message };
  }

  // ── 3. ATTACHER la génération à la réservation → en file pour le finaliseur ──
  const { error: errAttache } = await supabaseAdmin
    .from('autopilot_jumeau_attente')
    .update({ generation_id: gen.generationId, statut: 'en_attente', updated_at: new Date().toISOString() })
    .eq('id', attenteId)
    .eq('statut', STATUT_RESERVE);
  if (errAttache) {
    // La génération EST lancée (et facturée) : le créneau reste réservé — jamais
    // relancé — et on le dit fort pour qu'un humain rattache la génération.
    console.error(
      `${journal} ${input.userId} — jumeau lancé (${gen.generationId}) mais NON rattaché à la file ${attenteId} :`,
      errAttache.message,
    );
  }

  console.log(`${journal} ${input.userId} — jumeau lancé (${gen.generationId}), montage en file ${attenteId}`);
  return { ok: true, generationId: gen.generationId, attenteId, dejaEnFile: false };
}

/**
 * Statut d'une ligne dont le créneau est RÉSERVÉ mais dont la génération n'est
 * pas encore attachée. Le finaliseur l'ignore (il ne lit que `en_attente`) ;
 * le cron la compte comme faite (`creneauxJumeauEnAttente`).
 */
export const STATUT_RESERVE = 'reserve';

/**
 * `generation_id` est `not null` : une réservation porte l'UUID nul le temps
 * du lancement. Aucune génération réelle n'a cet identifiant.
 */
export const GENERATION_RESERVEE = '00000000-0000-0000-0000-000000000000';

/** Rend un créneau réservé dont le lancement n'a pas abouti. */
async function libererReservation(id: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('autopilot_jumeau_attente')
    .delete()
    .eq('id', id)
    .eq('statut', STATUT_RESERVE);
  if (error) console.error('[Autopilote/Jumeau] réservation non rendue :', id, error.message);
}

/** Les créneaux d'un compte DÉJÀ en file jumeau — pour que le cron ne les relance pas. */
export async function creneauxJumeauEnAttente(userId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from('autopilot_jumeau_attente')
    .select('slot_key, statut')
    .eq('user_id', userId)
    .in('statut', [STATUT_RESERVE, 'en_attente', 'en_cours']);
  const out = new Set<string>();
  for (const l of (data ?? []) as Array<{ slot_key?: string }>) {
    if (typeof l.slot_key === 'string') out.add(l.slot_key);
  }
  return out;
}

export interface ResultatFinalisation {
  examines: number;
  rendus: number;
  encore: number;
  echecs: number;
}

interface LigneAttente {
  id: string;
  user_id: string;
  generation_id: string;
  slot_key: string;
  job_id: string;
  statut: string;
  snapshot: SnapshotMontage;
  tentatives: number;
}

/**
 * FINALISE les montages dont le jumeau est prêt. Appelée par le cron (à chaque
 * passe) : elle fait avancer chaque génération et rend ce qui est prêt. Bornée
 * par `max` pour tenir dans le budget de la requête.
 */
export async function finaliserJumeauxPrets(opts: { userId?: string; max?: number } = {}): Promise<ResultatFinalisation> {
  const max = Math.max(1, opts.max ?? 5);
  // D'abord, reprendre les lignes ABANDONNÉES en `en_cours` (crash, redémarrage
  // du conteneur, déploiement pendant un rendu) — sinon elles le restaient
  // pour toujours, le finaliseur ne relisant que `en_attente`.
  await reprendreLignesAbandonnees(opts.userId);
  let q = supabaseAdmin
    .from('autopilot_jumeau_attente')
    .select('*')
    .eq('statut', 'en_attente')
    .order('created_at', { ascending: true })
    .limit(max);
  if (opts.userId) q = q.eq('user_id', opts.userId);
  const { data: lignes } = await q;

  const res: ResultatFinalisation = { examines: 0, rendus: 0, encore: 0, echecs: 0 };

  for (const brute of (lignes ?? []) as LigneAttente[]) {
    res.examines += 1;

    // Claim atomique : `en_attente` → `en_cours`. Deux finaliseurs ne rendent
    // jamais deux fois — un seul remporte l'update.
    const { data: claim } = await supabaseAdmin
      .from('autopilot_jumeau_attente')
      .update({ statut: 'en_cours', tentatives: brute.tentatives + 1, updated_at: new Date().toISOString() })
      .eq('id', brute.id)
      .eq('statut', 'en_attente')
      .select('id');
    if (!claim || claim.length === 0) continue; // pris par une autre passe

    const ligne = brute;
    try {
      // Génération lancée mais jamais enregistrée : on la rattache AVANT de la
      // suivre. Sans identifiant fournisseur, le suivi dirait « en cours » à
      // chaque passe jusqu'au plafond de tentatives.
      const reco = ligne.snapshot?.reconciliation;
      if (reco?.providerVideoId) {
        await reconcilierLancement(ligne.generation_id, ligne.user_id, reco.providerVideoId);
      }
      const statut = await avancerStatutGeneration(ligne.user_id, ligne.generation_id);

      if (statut.status === 'processing') {
        // Toujours en génération : on rouvre pour la prochaine passe, sauf si
        // trop de tentatives (fournisseur qui ne répond jamais).
        if (ligne.tentatives + 1 >= MAX_TENTATIVES) {
          await echouer(ligne, 'La préparation du jumeau ne s’est jamais terminée.');
          await rendreSansJumeau(ligne, 'jumeau non abouti');
          res.echecs += 1;
        } else {
          await rouvrir(ligne.id);
          res.encore += 1;
        }
        continue;
      }

      if (statut.status === 'completed') {
        await rendreMontage(ligne, statut.videoUrl);
        res.rendus += 1;
        continue;
      }

      // failed | introuvable : crédits avatar déjà remboursés le cas échéant.
      const motif = statut.status === 'failed' ? statut.error : 'Génération du jumeau introuvable.';
      await echouer(ligne, motif);
      // Le créneau ne reste pas vide : montage SANS jumeau, dit explicitement.
      await rendreSansJumeau(ligne, 'jumeau en échec');
      res.echecs += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // ── Échec DÉFINITIF : un média du montage n'existe plus ─────────────
      // Un 404/410 au téléchargement ne se résout pas en réessayant : le
      // même rendu échouait à chaque passe, jusqu'à MAX_TENTATIVES. On clôt
      // tout de suite, avec la cause. Rien à rembourser ici : le jumeau est
      // produit (sa génération a abouti), et le rendu n'est débité qu'après
      // succès. Aucun rappel fournisseur : on ne relance rien.
      if (estMediaIntrouvable(message)) {
        console.error(`[Autopilote/Jumeau] ${ligne.user_id} — média introuvable, montage abandonné sans réessai : ${message}`);
        await echouer(ligne, `Un média du montage est introuvable (404) : ${message.slice(0, 300)}`);
        res.echecs += 1;
        continue;
      }
      // Erreur transitoire (fournisseur, réseau, ou rendu qui a échoué) : on
      // rouvre pour réessayer — sauf si on a déjà trop insisté, pour ne pas
      // boucler indéfiniment sur une ligne coincée.
      console.warn(`[Autopilote/Jumeau] ${ligne.user_id} — passe en échec transitoire, on réessaiera :`, message);
      if (ligne.tentatives + 1 >= MAX_TENTATIVES) {
        await echouer(ligne, 'La finalisation du montage-jumeau a échoué de façon répétée.');
        res.echecs += 1;
      } else {
        await rouvrir(ligne.id);
        res.encore += 1;
      }
    }
  }

  return res;
}

/**
 * L'erreur dit-elle qu'un média à TÉLÉCHARGER n'existe pas (404/410) ?
 *
 * Forme observée en production (Remotion) :
 * `Error while downloading https://…/music/….mp3 … 404 {"error":"not found"}`.
 * Il faut les DEUX indices — un téléchargement, et un code 404/410 isolé —
 * pour ne pas prendre pour définitif un « 404 » apparu ailleurs dans un
 * message (identifiant, durée). Tout le reste reste transitoire.
 */
export function estMediaIntrouvable(message: string): boolean {
  if (!/download/i.test(message)) return false;
  return /(?<![\w.-])(404|410)(?![\w.-])/.test(message);
}

async function rouvrir(id: string): Promise<void> {
  await supabaseAdmin
    .from('autopilot_jumeau_attente')
    .update({ statut: 'en_attente', updated_at: new Date().toISOString() })
    .eq('id', id);
}

async function echouer(ligne: LigneAttente, motif: string): Promise<void> {
  await supabaseAdmin
    .from('autopilot_jumeau_attente')
    .update({ statut: 'echec', motif, updated_at: new Date().toISOString() })
    .eq('id', ligne.id);
}

/**
 * Un post existe-t-il DÉJÀ pour ce créneau ? Cas d'un rendu terminé dont le
 * statut n'a pas été écrit (crash juste après l'insertion, écriture refusée) :
 * la ligne est close en `rendu` au lieu de rendre — et déposer — une seconde
 * fois. Le débit du rendu, lui, est de toute façon idempotent par `job_id`.
 */
async function dejaRendu(ligne: LigneAttente): Promise<boolean> {
  const faits = await creneauxExistants(ligne.user_id);
  if (!faits.has(ligne.slot_key)) return false;
  await supabaseAdmin
    .from('autopilot_jumeau_attente')
    .update({ statut: 'rendu', updated_at: new Date().toISOString() })
    .eq('id', ligne.id);
  console.warn(`[Autopilote/Jumeau] ${ligne.user_id} — créneau ${ligne.slot_key} déjà rendu, ligne close sans nouveau rendu`);
  return true;
}

/**
 * Au-delà, une ligne `en_cours` est tenue pour ABANDONNÉE.
 *
 * Un rendu dure quelques minutes (sept, mesuré en production sous charge) ;
 * trois quarts d'heure laissent une marge large sans jamais reprendre un rendu
 * encore vivant. `updated_at` est posé au claim : c'est l'âge du rendu.
 */
export const DELAI_ABANDON_EN_COURS_MS = 45 * 60 * 1000;

/**
 * Reprend les lignes restées `en_cours` au-delà du délai d'abandon.
 *
 * Deux issues, aucune ne rappelle le fournisseur ni ne débite :
 *   - un post existe déjà pour le créneau → le rendu avait abouti : `rendu` ;
 *   - sinon → `en_attente`, le finaliseur la reprend au claim suivant (qui
 *     compte une tentative : la reprise reste BORNÉE par `MAX_TENTATIVES`).
 * Le passage `en_cours` → `en_attente` est conditionnel (statut ET âge) : deux
 * finaliseurs simultanés ne rouvrent qu'une fois, et le claim atomique ne
 * laisse qu'un seul rendu partir.
 */
async function reprendreLignesAbandonnees(userId?: string): Promise<void> {
  const limite = new Date(Date.now() - DELAI_ABANDON_EN_COURS_MS).toISOString();
  let q = supabaseAdmin
    .from('autopilot_jumeau_attente')
    .select('*')
    .eq('statut', 'en_cours')
    .lt('updated_at', limite)
    .limit(10);
  if (userId) q = q.eq('user_id', userId);
  const { data: abandonnees, error } = await q;
  if (error) {
    console.error('[Autopilote/Jumeau] lignes en cours illisibles :', error.message);
    return;
  }
  for (const ligne of (abandonnees ?? []) as LigneAttente[]) {
    try {
      if (await dejaRendu(ligne)) continue;
      await supabaseAdmin
        .from('autopilot_jumeau_attente')
        .update({ statut: 'en_attente', updated_at: new Date().toISOString() })
        .eq('id', ligne.id)
        .eq('statut', 'en_cours')
        .lt('updated_at', limite);
      console.warn(`[Autopilote/Jumeau] ${ligne.user_id} — ligne ${ligne.id} abandonnée en cours de rendu, reprise`);
    } catch (e) {
      console.error('[Autopilote/Jumeau] reprise impossible :', ligne.id, e instanceof Error ? e.message : e);
    }
  }
}

/** Rend le montage AVEC la vidéo du jumeau, dépose le post, débite le rendu. */
async function rendreMontage(ligne: LigneAttente, jumeauVideoUrl: string): Promise<void> {
  if (await dejaRendu(ligne)) return;
  const s = ligne.snapshot;
  const rendu = await produireUnMontage({
    userId: ligne.user_id,
    config: s.config,
    post: s.post,
    rang: s.rang,
    now: s.now,
    jobId: ligne.job_id,
    slotKey: ligne.slot_key,
    journal: s.journal ?? '[Autopilote/Jumeau]',
    metadataSupplement: { ...(s.metadataSupplement ?? {}), jumeau: true },
    jumeauVideoUrl,
  });
  await supabaseAdmin
    .from('autopilot_jumeau_attente')
    .update({ statut: 'rendu', post_id: rendu.postId, updated_at: new Date().toISOString() })
    .eq('id', ligne.id);
  console.log(`[Autopilote/Jumeau] ${ligne.user_id} — montage jumeau rendu (post ${rendu.postId ?? '?'})`);
}

/**
 * Le jumeau a échoué : le créneau ne reste pas vide. On rend le montage
 * ORDINAIRE (rush/affiche + voix off si demandée) et on ÉCRIT l'échec du
 * jumeau dans les métadonnées — jamais un remplacement silencieux.
 */
async function rendreSansJumeau(ligne: LigneAttente, motif: string): Promise<void> {
  const s = ligne.snapshot;
  try {
    if (await dejaRendu(ligne)) return;
    await produireUnMontage({
      userId: ligne.user_id,
      config: s.config,
      post: s.post,
      rang: s.rang,
      now: s.now,
      jobId: ligne.job_id,
      slotKey: ligne.slot_key,
      journal: s.journal ?? '[Autopilote/Jumeau]',
      metadataSupplement: { ...(s.metadataSupplement ?? {}), jumeauIgnore: true, jumeauIgnoreMotif: motif },
      // Pas de jumeauVideoUrl : montage ordinaire.
    });
  } catch (e) {
    console.error(`[Autopilote/Jumeau] ${ligne.user_id} — montage de repli (sans jumeau) impossible :`, e instanceof Error ? e.message : e);
  }
}
