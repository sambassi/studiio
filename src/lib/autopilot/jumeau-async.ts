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

import { noterProgression, effacerProgression } from '@/lib/autopilot/progression';
import { supabaseAdmin } from '@/lib/db/supabase';
import {
  CODE_DUREE_A_CONFIRMER, dureeAConfirmerAvecAvatar, messageDureeAConfirmer,
} from '@/lib/autopilot/duree-cible';
import type { AutopilotConfig } from '@/lib/autopilot/rules';
import type { PreparedPost } from '@/lib/autopilot/engine';
import { genererVideoJumeau, reconcilierLancement } from '@/lib/avatar/moteur-jumeau';
import { abandonnerGenerationJumeau } from '@/lib/avatar/moteur-jumeau';
import { avancerStatutGeneration } from '@/lib/avatar/statut';
import { produireUnMontage, creneauxExistants } from '@/lib/autopilot/produire';
import { notifyOnce } from '@/lib/notifications/store';
import { avatarAvecAutresSources } from '@/lib/autopilot/sources';
import { scriptJumeauMontage as scriptJumeauPur } from '@/lib/autopilot/script-jumeau';
import { estJumeauIllisible, MESSAGE_JUMEAU_ILLISIBLE } from '@/lib/autopilot/duree-jumeau';
import { estErreurDeFile } from '@/lib/autopilot/limite-rendus';
import {
  echeanceDecisionJumeau, instantPublicationCreneau, libelleCreneau, politiqueRepliJumeau,
  type PolitiqueRepliJumeau,
} from '@/lib/autopilot/echeance-jumeau';

/** Déplacée dans `sources.ts` (pure, utilisable côté client) — réexportée pour les appelants existants. */
export { avatarAvecAutresSources };

/** Format vertical de l'Autopilote — la génération du jumeau le suit. */
const RATIO_AUTOPILOTE = '9:16';
/**
 * Passes de finalisation avant d'abandonner une ligne coincée. Chaque passe
 * = un poll ; `avancerStatutGeneration` déclare de toute façon l'échec au-delà
 * du délai autorisé. Ce garde ne couvre que l'imprévu (fournisseur qui ne
 * répond jamais) — et jamais avant `PLAFOND_SUIVI_JUMEAU_MS` pour un jumeau
 * encore « en cours ».
 */
const MAX_TENTATIVES = 40;

/**
 * B1 — un jumeau encore « en cours » n'est JAMAIS abandonné au seul compte des
 * passes : à un déclenchement toutes les 5 min, 40 passes = 3 h 20, alors que
 * le serveur laisse légitimement jusqu'à 6 h d'attente fournisseur
 * (`ATTENTE_MAX_MS`) puis 6 h 10 de production après la reprise
 * (`DELAI_GENERATION_LANCEE_MS`, `lib/avatar/statut.ts`). C'est le suivi
 * serveur qui tranche (zombie, fin d'attente, délai de production) ; ce
 * plafond ne couvre que l'imprévu au-delà de la somme des deux. Ligne sans
 * `created_at` lisible : comportement d'origine (compte des passes seul).
 */
export const PLAFOND_SUIVI_JUMEAU_MS = 6 * 60 * 60 * 1000 + (6 * 60 * 60 * 1000 + 10 * 60 * 1000);

function suiviEncoreAutorise(ligne: LigneAttente): boolean {
  const debut = ligne.created_at ? Date.parse(ligne.created_at) : Number.NaN;
  return Number.isFinite(debut) && Date.now() - debut <= PLAFOND_SUIVI_JUMEAU_MS;
}

/**
 * A1 — passes de rendu dont la DURÉE du jumeau est restée illisible (sonde et
 * mesure locale de secours) avant de clore la ligne. Réessayer ne coûte rien
 * (lecture de NOTRE stockage, aucun fournisseur, aucun débit) et couvre un
 * stockage momentanément indisponible ; au-delà, le fichier est tenu pour
 * illisible — jamais un montage sans l'avatar à sa place.
 */
export const ESSAIS_MESURE_JUMEAU = 3;

/**
 * Le script que le jumeau DIT dans le montage — la règle vit dans
 * `script-jumeau.ts` (pure, importable côté client : l'aperçu A5 estime la
 * parole avec). Signature d'avant conservée pour les appelants existants.
 */
export function scriptJumeauMontage(post: PreparedPost, config?: AutopilotConfig | null): string {
  return scriptJumeauPur(post, config);
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
  /** A1 : passes déjà arrêtées faute de durée fiable du jumeau. */
  echecsMesureJumeau?: number;
  /** B3 — politique si le jumeau n'est pas prêt à l'échéance (absente = `sans_avatar`, B2). */
  politiqueRepli?: PolitiqueRepliJumeau;
  /**
   * B3 — le créneau est sorti (ou sort) SANS avatar à l'échéance. Posé AVANT
   * le rendu (`decideLe`), complété après (`produitLe`) : la ligne reste
   * suivie pour la GÉNÉRATION (remboursement si elle échoue, jamais un second
   * montage si elle aboutit).
   */
  repliSansAvatar?: { decideLe: string; produitLe?: string };
  /** B3 — politique `suspendre` : échéance passée, créneau signalé (une fois). */
  suspension?: { decideLe: string };
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

  // A4 v3 — avatar seul, cible sous 20 s : RIEN n'est lancé (ni réservation,
  // ni génération, ni débit). Placé APRÈS la lecture de la file : un créneau
  // déjà en file (génération déjà lancée et payée) suit son cours, à sa durée.
  const dureeBrief = input.post.brief?.duree ?? input.config.brief?.duree;
  if (dureeAConfirmerAvecAvatar(dureeBrief, !avatarAvecAutresSources(input.config))) {
    return { ok: false, motif: CODE_DUREE_A_CONFIRMER, message: messageDureeAConfirmer(dureeBrief as number) };
  }

  const script = scriptJumeauMontage(input.post, input.config);
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
  // (idempotente, facturée au tarif `avatar.jumeau` ; le moteur est revérifié pour le
  // fournisseur de l'avatar ici même). Refus ou exception : la génération n'a
  // pas démarré (ou a été remboursée par le moteur) — la réservation est
  // RENDUE, pour qu'un passage ultérieur puisse réessayer ce créneau.
  let gen: Awaited<ReturnType<typeof genererVideoJumeau>>;
  try {
    gen = await genererVideoJumeau({
      userId: input.userId, textes: [script], aspectRatio: RATIO_AUTOPILOTE, avatarId: input.config.jumeauAvatarId ?? null,
      // Le fichier de l'avatar doit TOUJOURS remplir le 9:16 (`fit: cover`),
      // comme Créer (#540). BUG 6 : « avatar seul », le fournisseur choisissait
      // et rendait un avatar 16:9 centré entre deux bandes CLAIRES de son
      // fond, que Remotion (cover d'un 9:16 dans un 9:16) recopiait jusque
      // dans le MP4. Le recadrer chez le fournisseur garde la pleine
      // définition ; `retirerBandesIncrustees` reste le filet au rapatriement.
      cadrage: 'remplir' as const,
    });
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
  created_at?: string | null;
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
    // B2 — où en est la passe : `suivi` (fournisseur, pas encore de vidéo) ou
    // `rendu` (le jumeau est LIVRÉ et payé). Le repli sans jumeau ne vaut que
    // pour un jumeau jamais obtenu, jamais pour un jumeau livré.
    let phase: 'suivi' | 'rendu' = 'suivi';
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
        // trop de tentatives ET au-delà de l'attente autorisée (B1).
        if (ligne.tentatives + 1 >= MAX_TENTATIVES && !suiviEncoreAutorise(ligne)) {
          await abandonnerSuivi(ligne, 'La préparation du jumeau ne s’est jamais terminée.');
          res.echecs += 1;
        } else {
          // B3 — échéance de publication : décider AVANT l'heure annoncée.
          // La génération, elle, reste suivie (aucune clôture, aucun remboursement).
          await rouvrir(ligne.id, { snapshot: await appliquerEcheance(ligne) });
          res.encore += 1;
        }
        continue;
      }

      if (statut.status === 'completed') {
        phase = 'rendu';
        // B3 — le créneau est DÉJÀ sorti sans avatar : un jumeau livré après
        // le repli ne produit jamais une seconde vidéo ni un second post.
        if (ligne.snapshot?.repliSansAvatar?.produitLe) {
          await clore(ligne, 'rendu', 'Jumeau livré après le repli sans avatar : aucun second montage.');
          res.rendus += 1;
          continue;
        }
        await rendreMontage(ligne, statut.videoUrl);
        res.rendus += 1;
        continue;
      }

      // failed | introuvable : crédits avatar déjà remboursés le cas échéant.
      const motif = statut.status === 'failed' ? statut.error : 'Génération du jumeau introuvable.';
      if (ligne.snapshot?.repliSansAvatar?.produitLe) {
        // Le créneau est déjà sorti sans avatar et l'utilisateur prévenu.
        await clore(ligne, 'echec', motif);
      } else {
        await echouer(ligne, motif);
        // Le créneau ne reste pas vide : montage SANS jumeau, dit explicitement
        // — sauf politique `suspendre` (jamais de version dégradée).
        if (politiqueRepliJumeau(ligne.snapshot) === 'sans_avatar') await rendreSansJumeau(ligne, 'jumeau en échec');
      }
      res.echecs += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // ── File de rendu (`limite-rendus.ts`) : serveur occupé, ou ce créneau déjà en rendu ─────
      // Le jumeau est PRODUIT (et payé) : un serveur saturé n'est ni son échec ni celui du
      // montage. Rien n'a été rendu ni débité ; on rouvre SANS consommer de tentative — des
      // heures de saturation ne doivent jamais abandonner un avatar livré.
      if (estErreurDeFile(e)) {
        console.warn(`[Autopilote/Jumeau] ${ligne.user_id} — montage ${ligne.id} reporté (file de rendu) : ${message}`);
        await rouvrir(ligne.id, { tentatives: ligne.tentatives });
        res.encore += 1;
        continue;
      }
      // ── A1 : la DURÉE du jumeau est illisible ───────────────────────────
      // `produireUnMontage` s'est arrêté AVANT tout rendu et tout débit. On
      // ne monte JAMAIS le créneau sans l'avatar (pas de `rendreSansJumeau`) :
      // on réessaie quelques passes (stockage passager), puis on clôt avec
      // un message clair. Aucun fournisseur rappelé, aucune génération relancée.
      if (estJumeauIllisible(e)) {
        const echecs = (ligne.snapshot?.echecsMesureJumeau ?? 0) + 1;
        if (echecs >= ESSAIS_MESURE_JUMEAU || ligne.tentatives + 1 >= MAX_TENTATIVES) {
          await echouer(ligne, MESSAGE_JUMEAU_ILLISIBLE, `${MESSAGE_JUMEAU_ILLISIBLE} Aucun rendu n’a été débité.`);
          res.echecs += 1;
        } else {
          console.warn(`[Autopilote/Jumeau] ${ligne.user_id} — durée du jumeau illisible (passe ${echecs}/${ESSAIS_MESURE_JUMEAU}), on réessaiera`);
          await rouvrir(ligne.id, { snapshot: { ...ligne.snapshot, echecsMesureJumeau: echecs } });
          res.encore += 1;
        }
        continue;
      }
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
      // B1 — en phase `suivi`, un couac passager après 40 passes n'abandonne
      // pas un jumeau encore dans son attente autorisée.
      if (ligne.tentatives + 1 >= MAX_TENTATIVES && !(phase === 'suivi' && suiviEncoreAutorise(ligne))) {
        // B2 — le SUIVI du fournisseur a échoué à chaque passe : aucun jumeau
        // n'a été obtenu. Même issue que la ligne restée « en cours » : la
        // génération est close (crédits rendus une fois) et le créneau sort
        // SANS jumeau, dit explicitement. Un jumeau LIVRÉ dont le rendu
        // échoue (`rendu`) n'est jamais remplacé par un montage sans avatar.
        if (phase === 'suivi') {
          await abandonnerSuivi(ligne, 'La finalisation du montage-jumeau a échoué de façon répétée.');
        } else {
          await echouer(ligne, 'La finalisation du montage-jumeau a échoué de façon répétée.');
        }
        res.echecs += 1;
      } else {
        // B3 — un suivi en panne passagère n'empêche pas la décision à l'échéance.
        await rouvrir(ligne.id, phase === 'suivi' ? { snapshot: await appliquerEcheance(ligne) } : {});
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

/** Clôt la génération encore en vol (débit rendu une fois) ; ne lève jamais. */
async function abandonnerGeneration(ligne: LigneAttente): Promise<void> {
  try {
    await abandonnerGenerationJumeau(ligne.user_id, ligne.generation_id);
  } catch (e) {
    console.error(`[Autopilote/Jumeau] ${ligne.user_id} — génération ${ligne.generation_id} non close :`, e instanceof Error ? e.message : e);
  }
}

async function rouvrir(id: string, complement: { snapshot?: SnapshotMontage; tentatives?: number } = {}): Promise<void> {
  await supabaseAdmin
    .from('autopilot_jumeau_attente')
    .update({ statut: 'en_attente', ...complement, updated_at: new Date().toISOString() })
    .eq('id', id);
}

async function echouer(ligne: LigneAttente, motif: string, corps?: string): Promise<void> {
  await supabaseAdmin
    .from('autopilot_jumeau_attente')
    .update({ statut: 'echec', motif, updated_at: new Date().toISOString() })
    .eq('id', ligne.id);
  console.error(`[Autopilote/Jumeau] ${ligne.user_id} — montage ${ligne.id} en échec : ${motif}`);
  // ── L'échec se DIT, pas seulement dans la file ──────────────────────────
  // `motif` n'était lu par personne : un montage-jumeau abandonné (média
  // introuvable, fournisseur muet) laissait un créneau vide sans un mot. Une
  // notification par jour au plus ; jamais bloquante pour la finalisation.
  try {
    await notifyOnce({
      userId: ligne.user_id,
      kind: KIND_JUMEAU_ECHEC,
      title: 'Autopilote : votre jumeau n’a pas pu être monté',
      // Le motif technique (message fournisseur, URL, code HTTP) reste dans
      // la file et les journaux : l'utilisateur lit une phrase claire.
      body: corps ?? ('Le montage prévu avec votre jumeau n’a pas pu être produit. '
        + 'Les crédits du jumeau sont remboursés s’il n’a pas été généré ; '
        + 'le rendu n’est débité que pour un montage livré.'),
      href: '/dashboard/creer?panneau=autopilote',
    });
  } catch (e) {
    console.error('[Autopilote/Jumeau] notification d’échec impossible :', e instanceof Error ? e.message : e);
  }
}

/** Famille de notification d'un montage-jumeau abandonné (anti-doublon par jour). */
export const KIND_JUMEAU_ECHEC = 'autopilote-jumeau-echec';

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
      // B3 — après un repli sans avatar, le post du créneau EXISTE mais la
      // génération doit rester suivie : on rouvre, on ne clôt pas.
      if (!ligne.snapshot?.repliSansAvatar && await dejaRendu(ligne)) continue;
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
  const tardif = await renduTardif(ligne);
  // Production MANUELLE (« Produire maintenant ») : l'écran suit l'avancement
  // RÉEL du montage (images rendues), comme sans avatar — au lieu d'une
  // barre figée sur « Montage ». Préfixe = `PREFIXE_JOB_MANUEL`
  // (suivi-jumeau-manuel.ts, non importé : il importe ce module).
  const manuel = ligne.job_id.startsWith('autopilote-manuel-');
  let rendu: Awaited<ReturnType<typeof produireUnMontage>>;
  try {
    rendu = await produireUnMontage({
      userId: ligne.user_id,
      config: tardif.config,
      post: s.post,
      rang: s.rang,
      now: s.now,
      jobId: ligne.job_id,
      slotKey: ligne.slot_key,
      journal: s.journal ?? '[Autopilote/Jumeau]',
      metadataSupplement: { ...(s.metadataSupplement ?? {}), ...tardif.supplement, jumeau: true },
      jumeauVideoUrl,
      ...(manuel ? { onProgression: (etape, avancement) => noterProgression(ligne.user_id, etape, avancement) } : {}),
    });
  } finally {
    // Fin (ou échec) du rendu : l'écran repasse sur l'état PROUVÉ de la file
    // (`depose` seulement quand le brouillon est relu dans le Calendrier).
    if (manuel) effacerProgression(ligne.user_id);
  }
  await supabaseAdmin
    .from('autopilot_jumeau_attente')
    .update({ statut: 'rendu', post_id: rendu.postId, updated_at: new Date().toISOString() })
    .eq('id', ligne.id);
  if (tardif.tardif) await notifierBrouillonTardif(ligne, 'avec');
  console.log(`[Autopilote/Jumeau] ${ligne.user_id} — montage jumeau rendu (post ${rendu.postId ?? '?'})`);
}

/**
 * Le jumeau a échoué : le créneau ne reste pas vide. On rend le montage
 * ORDINAIRE (rush/affiche + voix off si demandée) et on ÉCRIT l'échec du
 * jumeau dans les métadonnées — jamais un remplacement silencieux.
 */
async function rendreSansJumeau(ligne: LigneAttente, motif: string, o: { garderSuivi?: boolean } = {}): Promise<boolean> {
  const s = ligne.snapshot;
  try {
    // `garderSuivi` (B3, repli à l'échéance) : la génération reste suivie —
    // un post déjà déposé ne CLÔT pas la ligne, il évite seulement le doublon.
    if (o.garderSuivi ? (await creneauxExistants(ligne.user_id)).has(ligne.slot_key) : await dejaRendu(ligne)) return true;
    const tardif = await renduTardif(ligne);
    await produireUnMontage({
      userId: ligne.user_id,
      config: tardif.config,
      post: s.post,
      rang: s.rang,
      now: s.now,
      jobId: ligne.job_id,
      slotKey: ligne.slot_key,
      journal: s.journal ?? '[Autopilote/Jumeau]',
      metadataSupplement: { ...(s.metadataSupplement ?? {}), ...tardif.supplement, jumeauIgnore: true, jumeauIgnoreMotif: motif },
      // Pas de jumeauVideoUrl : montage ordinaire.
    });
    if (tardif.tardif) await notifierBrouillonTardif(ligne, 'sans');
    return true;
  } catch (e) {
    console.error(`[Autopilote/Jumeau] ${ligne.user_id} — montage de repli (sans jumeau) impossible :`, e instanceof Error ? e.message : e);
    return false;
  }
}

// ── B3 — ÉCHÉANCE DE PUBLICATION ─────────────────────────────────────────────

/** Famille de notification « avatar en retard » — suffixée du créneau : une par créneau. */
export const KIND_JUMEAU_RETARD = 'autopilote-jumeau-retard';

function kindRetard(ligne: LigneAttente, variante: 'decision' | 'brouillon'): string {
  const famille = variante === 'decision' ? KIND_JUMEAU_RETARD : `${KIND_JUMEAU_RETARD}-brouillon`;
  return `${famille}:${ligne.slot_key.split('|').slice(-2).join(' ')}`;
}

async function notifierRetard(ligne: LigneAttente, title: string, body: string, variante: 'decision' | 'brouillon' = 'decision'): Promise<void> {
  try {
    await notifyOnce({ userId: ligne.user_id, kind: kindRetard(ligne, variante), title, body, href: '/dashboard/calendar' });
  } catch (e) {
    console.error('[Autopilote/Jumeau] notification de retard impossible :', e instanceof Error ? e.message : e);
  }
}

/**
 * Le jumeau est encore « en cours » : l'échéance de décision (heure de
 * publication − marge de montage) est-elle passée ? Rend le snapshot à
 * conserver sur la ligne. N'abandonne JAMAIS la génération et ne rembourse
 * rien : elle peut encore aboutir, `avancerStatutGeneration` la suit avec ses
 * propres délais.
 *
 *   - `sans_avatar` (défaut, B2) : le créneau sort une fois, SANS avatar,
 *     avant l'heure de publication ; l'utilisateur est prévenu une fois.
 *   - `suspendre` : aucune vidéo ; le créneau reste en attente, signalé une
 *     fois ; s'il aboutit après l'heure, il sort en brouillon (`renduTardif`).
 */
async function appliquerEcheance(ligne: LigneAttente): Promise<SnapshotMontage> {
  const s = ligne.snapshot;
  const echeance = echeanceDecisionJumeau(s);
  if (echeance === null || Date.now() < echeance) return s;
  if (s.repliSansAvatar?.produitLe || s.suspension) return s;
  const libelle = libelleCreneau(s);

  if (politiqueRepliJumeau(s) === 'suspendre') {
    console.warn(`[Autopilote/Jumeau] ${ligne.user_id} — jumeau en retard, créneau ${ligne.slot_key} suspendu`);
    await notifierRetard(
      ligne,
      'Autopilote : avatar en retard',
      `Avatar en retard chez le fournisseur : la publication du ${libelle} est suspendue. `
        + 'Elle ne partira pas en retard sans votre validation ; aucun rendu n’est débité tant qu’elle n’est pas produite.',
    );
    return { ...s, suspension: { decideLe: new Date().toISOString() } };
  }

  // Marque posée AVANT le rendu : une ligne reprise après un crash reste suivie.
  const decide: SnapshotMontage = { ...s, repliSansAvatar: { decideLe: s.repliSansAvatar?.decideLe ?? new Date().toISOString() } };
  await supabaseAdmin
    .from('autopilot_jumeau_attente')
    .update({ snapshot: decide, updated_at: new Date().toISOString() })
    .eq('id', ligne.id);
  const ok = await rendreSansJumeau({ ...ligne, snapshot: decide }, 'jumeau en retard', { garderSuivi: true });
  if (!ok) return decide; // rendu raté : la passe suivante réessaie
  console.warn(`[Autopilote/Jumeau] ${ligne.user_id} — jumeau en retard, créneau ${ligne.slot_key} produit sans avatar`);
  await notifierRetard(
    ligne,
    'Autopilote : vidéo produite sans avatar',
    `Votre avatar n’était pas prêt à temps : la vidéo du ${libelle} a été produite sans avatar.`,
  );
  return { ...decide, repliSansAvatar: { ...decide.repliSansAvatar!, produitLe: new Date().toISOString() } };
}

/**
 * Un rendu qui aboutirait APRÈS l'heure de publication ne part jamais seul
 * en retard : il sort en BROUILLON (mêmes date/heure/fuseau au Calendrier),
 * et l'utilisateur le sait. Avant l'heure, ou pour un brouillon : inchangé.
 */
async function renduTardif(ligne: LigneAttente): Promise<{ config: AutopilotConfig; supplement: Record<string, unknown>; tardif: boolean }> {
  const s = ligne.snapshot;
  const pub = instantPublicationCreneau(s);
  if (pub === null || Date.now() < pub) return { config: s.config, supplement: {}, tardif: false };
  return { config: { ...s.config, mode: 'review' }, supplement: { publicationSuspendue: 'jumeau en retard' }, tardif: true };
}

/** Prévient (une fois) que la vidéo tardive est en brouillon — APRÈS son rendu réussi. */
async function notifierBrouillonTardif(ligne: LigneAttente, avatar: 'avec' | 'sans'): Promise<void> {
  await notifierRetard(
    ligne,
    'Autopilote : vidéo en attente de validation',
    `Avatar en retard chez le fournisseur : la publication du ${libelleCreneau(ligne.snapshot)} est suspendue. `
      + `La vidéo ${avatar === 'avec' ? 'avec' : 'sans'} avatar est prête en brouillon : validez-la pour la publier.`,
    'brouillon',
  );
}

/** Clôt une ligne SANS notification (le créneau est déjà sorti et dit). */
async function clore(ligne: LigneAttente, statut: 'rendu' | 'echec', motif: string): Promise<void> {
  await supabaseAdmin
    .from('autopilot_jumeau_attente')
    .update({ statut, motif, updated_at: new Date().toISOString() })
    .eq('id', ligne.id);
  console.warn(`[Autopilote/Jumeau] ${ligne.user_id} — ligne ${ligne.id} close (${statut}) : ${motif}`);
}

/**
 * Le suivi est abandonné (plafond B1 dépassé) : la génération encore en vol
 * est close et remboursée une fois (B2). Le créneau sort sans jumeau — sauf
 * s'il est DÉJÀ sorti (repli B3) ou que la politique l'interdit.
 */
async function abandonnerSuivi(ligne: LigneAttente, motif: string): Promise<void> {
  if (ligne.snapshot?.repliSansAvatar?.produitLe) {
    await clore(ligne, 'echec', motif);
    await abandonnerGeneration(ligne);
    return;
  }
  await echouer(ligne, motif);
  await abandonnerGeneration(ligne);
  if (politiqueRepliJumeau(ligne.snapshot) === 'sans_avatar') await rendreSansJumeau(ligne, 'jumeau non abouti');
}
