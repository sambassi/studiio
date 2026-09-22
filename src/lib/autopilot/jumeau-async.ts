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
import { genererVideoJumeau } from '@/lib/avatar/moteur-jumeau';
import { avancerStatutGeneration } from '@/lib/avatar/statut';
import { produireUnMontage } from '@/lib/autopilot/produire';

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

  // Lance la génération D-ID (idempotente, facturée AVATAR_VIDEO_COST). Le
  // moteur est revérifié POUR le fournisseur de l'avatar ici même.
  const gen = await genererVideoJumeau({ userId: input.userId, textes: [script], aspectRatio: RATIO_AUTOPILOTE });
  if (!gen.ok) {
    console.warn(`${journal} ${input.userId} — lancement refusé (${gen.motif}) : ${gen.message}`);
    return { ok: false, motif: gen.motif, message: gen.message };
  }

  const snapshot: SnapshotMontage = {
    config: input.config,
    post: input.post,
    rang: input.rang,
    now: input.now,
    metadataSupplement: input.metadataSupplement,
    journal,
  };

  const { data: inseree, error } = await supabaseAdmin
    .from('autopilot_jumeau_attente')
    .insert({
      user_id: input.userId,
      generation_id: gen.generationId,
      slot_key: input.slotKey,
      job_id: input.jobId,
      statut: 'en_attente',
      snapshot,
    })
    .select('id')
    .single();

  if (error) {
    // Conflit d'unicité : une passe concurrente a inséré entre le SELECT et
    // l'INSERT. La génération est lancée (idempotente, pas de second débit) ;
    // on relit la ligne gagnante.
    const conflit = error.code === '23505' || (error.message ?? '').toLowerCase().includes('duplicate');
    if (conflit) {
      const { data: gagnante } = await supabaseAdmin
        .from('autopilot_jumeau_attente')
        .select('id, generation_id')
        .eq('user_id', input.userId)
        .eq('slot_key', input.slotKey)
        .limit(1);
      const l = gagnante?.[0] as { id: string; generation_id: string } | undefined;
      if (l) return { ok: true, generationId: l.generation_id, attenteId: l.id, dejaEnFile: true };
    }
    console.error(`${journal} ${input.userId} — mise en file impossible :`, error.message);
    return { ok: false, motif: 'base', message: 'La mise en file du montage a échoué.' };
  }

  const attenteId = (inseree as { id: string }).id;
  console.log(`${journal} ${input.userId} — jumeau lancé (${gen.generationId}), montage en file ${attenteId}`);
  return { ok: true, generationId: gen.generationId, attenteId, dejaEnFile: false };
}

/** Les créneaux d'un compte DÉJÀ en file jumeau — pour que le cron ne les relance pas. */
export async function creneauxJumeauEnAttente(userId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from('autopilot_jumeau_attente')
    .select('slot_key, statut')
    .eq('user_id', userId)
    .in('statut', ['en_attente', 'en_cours']);
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
      // Erreur transitoire (fournisseur, réseau, ou rendu qui a échoué) : on
      // rouvre pour réessayer — sauf si on a déjà trop insisté, pour ne pas
      // boucler indéfiniment sur une ligne coincée.
      console.warn(`[Autopilote/Jumeau] ${ligne.user_id} — passe en échec transitoire, on réessaiera :`, e instanceof Error ? e.message : e);
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

/** Rend le montage AVEC la vidéo du jumeau, dépose le post, débite le rendu. */
async function rendreMontage(ligne: LigneAttente, jumeauVideoUrl: string): Promise<void> {
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
