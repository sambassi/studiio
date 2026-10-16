/**
 * LE MOTEUR VIDÉO DU JUMEAU — une seule chaîne par fournisseur d'avatar,
 * réutilisable par Créer aujourd'hui et l'Autopilote ensuite.
 *
 *   DISPLAY_SCRIPT ─ prononciations ─▶ SPOKEN_SCRIPT
 *        ─▶ ElevenLabs, MA voix (synthetiserAvecVoix)     → MP3 en mémoire
 *   HeyGen (avatar créé à partir d'une photo) :
 *        ─▶ HeyGen POST /v3/assets (uploadAsset)          → audio_asset_id
 *        ─▶ HeyGen POST /v3/videos + audio_asset_id       → video_id
 *   D-ID (avatar créé à partir d'une vidéo) — la chaîne de l'aperçu
 *   (`animerAvatarDidSurMaVoix`, `@/lib/avatar/did`), intention `normale` :
 *        ─▶ audio déposé en PRIVÉ (cleAudioAvatar)        → URL signée expirante
 *        ─▶ D-ID POST /scenes { script: audio }           → scene id
 *   puis, pour les deux :
 *        ─▶ suivi par GET /api/avatar/status (polling, re-hébergement,
 *           remboursement en cas d'échec : l'architecture existante, qui
 *           lit `avatar_generations.provider` pour interroger le bon
 *           fournisseur)
 *
 * Ce qui est RELU à chaque génération : le jumeau du compte
 * (`resoudreJumeauDuCompte` : avatar vivant, version courante, validé,
 * fournisseur présent ; voix du compte, choix, identifiant). Le navigateur
 * n'apporte que les textes et le format.
 *
 * Ce qui n'est JAMAIS fait : une voix fournisseur à la place de la voix
 * personnelle, une vidéo ordinaire à la place du jumeau, un succès sans
 * identifiant de vidéo fournisseur, un audio déposé sur une URL publique,
 * un identifiant D-ID envoyé à HeyGen (ou l'inverse), un fournisseur
 * inconnu animé par qui que ce soit.
 *
 * Crédits : le tarif `avatar.jumeau` de la grille centrale (`prixDe`, 40 sans
 * configuration admin), lu UNE fois par génération, le même pour les deux
 * fournisseurs, débité avant les
 * fournisseurs, remboursée si la vidéo n'a pas été lancée (ElevenLabs, dépôt
 * ou création fournisseur en échec) — comme /api/avatar/generate. Une fois
 * la vidéo lancée chez le fournisseur, c'est /api/avatar/status qui
 * rembourse en cas d'échec fournisseur (`credits_charged`), comme pour
 * toute génération.
 *
 * Idempotence — tenue par la BASE, pas par une lecture préalable : la
 * réservation est une insertion sous l'index unique partiel
 * `avatar_generations_jumeau_en_vol_uidx` (compte, avatar, version, voix
 * interne, format, md5(SPOKEN)) sur les générations EN VOL
 * (`2026-09-15-avatar-jumeau-en-vol.sql`). Deux requêtes strictement
 * simultanées : une seule insère ; l'autre reçoit 23505, ne paie rien,
 * n'appelle aucun fournisseur, relit la génération gagnante et rend le
 * MÊME identifiant. Le débit est lié à la génération gagnante
 * (`jumeau:<generationId>`), donc rejouable sans second débit — et
 * l'idempotence ne dépend pas des crédits : un compte exempté de débit est
 * tenu par le même index.
 *
 * Disponibilité — PAR FOURNISSEUR, jugée APRÈS relecture du jumeau (on ne
 * sait pas quel moteur juger avant de savoir quel avatar) :
 *   HeyGen : `moteurJumeauDisponible()` — JUMEAU_MOTEUR_ACTIVE=1 ET les deux
 *     clés fournisseur. Le drapeau reste à zéro tant que la chaîne n'a pas
 *     été vue fonctionner sur un vrai compte : des tests doublés ne prouvent
 *     pas un fournisseur.
 *   D-ID : `didVideoAvatarDisponible()` ET clé ElevenLabs — le gate de
 *     l'aperçu déjà validé en production. Pas de drapeau global pour D-ID.
 */

import { qualiteEnVigueur } from '@/lib/avatar/qualite-sauvegardee';
import { confirmationValable } from '@/lib/fournisseurs/confirmation-cout';
import { devisVideoHeygen, dureeParoleEstimee, type DevisFournisseur, type OperationFournisseur } from '@/lib/fournisseurs/devis-fournisseur';
import { MESSAGES_AVATAR, MESSAGES_CREATION, jumeauVideoAutorise, messageUtilisateurSur } from '@/lib/avatar/fournisseurs';
import { calculerCoutGeneration, compteAdmin, enregistrerCoutGeneration } from '@/lib/avatar/couts';
import { compteExempteDeCredits } from '@/lib/facturation/exemption';
import { supabaseAdmin } from '@/lib/db/supabase';
import { getUserCredits, deductCredits, addCredits } from '@/lib/credits/system';
import { referenceOperation } from '@/lib/credits/atomique';
import { prixDe } from '@/lib/tarifs/serveur';
import { uploadAsset, generateAvatarVideoFromAudio, moteursSupportesDuLook, HeyGenError, CODE_SOLDE_FOURNISSEUR, type AvatarAspectRatio } from '@/lib/avatar/heygen';
import { fournisseurDisponible, signalerRefusDeSolde } from '@/lib/fournisseurs/sante';
import { mettreEnAttente, prendreReprise, lireMarqueurAttente, estEnAttenteFournisseur, ATTENTE_MAX_MS } from '@/lib/avatar/attente-fournisseur';
import type { MoteurAvatar } from '@/lib/avatar/moteurs';
import { resoudreJumeauDuCompte, scriptsDuJumeau, moteurJumeauDisponiblePour, type MotifJumeau } from '@/lib/avatar/jumeau';
import { moteurPourMonAvatar, motifPremium, moteurAvatar, MOTEURS_AVATAR } from '@/lib/avatar/moteurs';
import { animerAvatarDidSurMaVoix, FOURNISSEUR_DID } from '@/lib/avatar/did';
import { synthetiserAvecVoix, cleElevenLabs } from '@/lib/voice/synthese';
import { cleAudioAvatar, retirerObjetPriveAvatar } from '@/lib/avatar/source';

/** Marqueur d'une génération de jumeau dans `avatar_generations.voice_id` : la voix INTERNE (user_voices.id), jamais le voice_id fournisseur. */
export const PREFIXE_VOIX_JUMEAU = 'jumeau:';
export const MAX_TEXTE_JUMEAU = 1200;
const RATIOS: AvatarAspectRatio[] = ['9:16', '16:9', '1:1'];

/** 23505 tel que PostgREST le rend — même reconnaissance que /api/avatar/generate (aperçu). */
function estConflitUnique(erreur: { code?: string; message?: string } | null): boolean {
  if (!erreur) return false;
  return erreur.code === '23505' || (erreur.message ?? '').toLowerCase().includes('duplicate key');
}

export function moteurJumeauDisponible(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.JUMEAU_MOTEUR_ACTIVE === '1' && !!env.HEYGEN_API_KEY?.trim() && cleElevenLabs(env) !== null;
}

export type ResultatMoteurJumeau =
  | {
    ok: true; generationId: string; status: string; avatarVersion: number; dejaEnCours: boolean; display: string; spoken: string;
    /**
     * Le solde de STUDIIO chez le fournisseur est épuisé : la génération est
     * réservée, EN ATTENTE, et reprendra seule (`attente-fournisseur.ts`).
     * Les crédits de l'utilisateur ne sont pas perdus.
     */
    enAttenteFournisseur?: boolean;
  }
  | { ok: false; motif: 'moteur_indisponible' | 'texte_absent' | 'texte_trop_long' | 'credits_insuffisants' | MotifJumeau; message: string }
  | { ok: false; motif: 'fournisseur_voix' | 'fournisseur_avatar' | 'base'; message: string; statut?: number }
  /**
   * Lancement MANUEL par un compte admin (0 crédit Studiio) sans confirmation
   * du coût fournisseur : RIEN n'a été réservé, débité ni appelé. L'appelant
   * montre `devis` et rejoue avec `coutFournisseur.confirme`.
   */
  | { ok: false; motif: 'confirmation_cout'; message: string; devis: DevisFournisseur }
  /**
   * Le fournisseur a ACCEPTÉ la génération (elle est lancée, et débitée), mais
   * son identifiant n'a pas pu être écrit sur `avatar_generations`. Ce n'est
   * PAS un échec à rejouer : relancer paierait une seconde génération.
   * L'appelant garde `generationId` et `providerVideoId` pour réconcilier.
   * (Créer lit `ok: false` et affiche le message, comme avant.)
   */
  | { ok: false; motif: 'base'; message: string; lance: true; generationId: string; providerVideoId: string };

export interface DepsMoteurJumeau {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

/** Une colonne inconnue de la base ou du cache PostgREST (migration non appliquée). */
export function estColonneAbsente(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === '42703' || e.code === 'PGRST204' || /column .* does not exist|Could not find the .* column/i.test(e.message ?? '');
}

export async function genererVideoJumeau(
  args: {
    userId: string; textes: string[]; aspectRatio?: string;
    /** Identité LOGIQUE choisie (projet Créer, réglage Autopilote) ; absente = avatar par défaut. */
    avatarId?: string | null;
    /** Voix du compte choisie pour CETTE génération (`user_voices.id`) ; absente = voix enregistrée. Contrôlée côté serveur. */
    voixId?: string | null;
    /** Qualité de rendu demandée ; le moteur est décidé ICI, jamais par le navigateur. */
    qualite?: unknown;
    /**
     * `remplir` : le format demandé est REMPLI (`fit: cover` chez HeyGen — pas de
     * bandes dans le fichier, pas d'étirement). Absent = comportement d'avant
     * (Créer, Autopilote) : HeyGen choisit.
     */
    cadrage?: 'remplir';
    /**
     * Lancement MANUEL (Créer, Mon avatar, relance) : un compte admin doit
     * avoir CONFIRMÉ le coût fournisseur. Absent (crons, reprise) = pas de garde.
     */
    coutFournisseur?: { confirme: boolean; operation?: OperationFournisseur; moteurConfirme?: unknown };
  },
  deps: DepsMoteurJumeau = {},
): Promise<ResultatMoteurJumeau> {
  const env = deps.env ?? process.env;

  // 0. La qualité, AVANT tout débit : une qualité inconnue est refusée. Avatar V
  //    n'est accepté que sous réserve — confirmé par HeyGen plus bas, avant tout débit.
  let choixMoteur = moteurPourMonAvatar(args.qualite, env);
  if (!choixMoteur.ok) return { ok: false, motif: 'moteur_indisponible', message: choixMoteur.message };

  // 1. Le jumeau, relu maintenant — la VERSION ACTIVE de l'identité choisie.
  const jumeau = await resoudreJumeauDuCompte(args.userId, { avatarId: args.avatarId ?? null, voixId: args.voixId ?? null });
  if (!jumeau.ok) {
    if ('motif' in jumeau) return { ok: false, motif: jumeau.motif, message: jumeau.message };
    return { ok: false, motif: 'base', message: 'Votre jumeau n’a pas pu être vérifié.' };
  }
  const { avatar, voix } = jumeau.jumeau;
  // 1 a. Sans qualité EXPLICITE (Créer, Autopilote) : la qualité que l'utilisateur
  //      a CHOISIE pour cet avatar dans Mon avatar — une seule source de vérité.
  //      (Standard / Avatar III par défaut en production, la qualité affichée par Mon avatar).
  //      Aucun choix : LA qualité par défaut de tous les parcours (`qualiteEnVigueur`).
  if (args.qualite === undefined || args.qualite === null || args.qualite === '') {
    const { qualite } = await qualiteEnVigueur(args.userId, avatar.id, env);
    const choix = moteurPourMonAvatar(qualite, env);
    if (choix.ok) choixMoteur = choix;
  }
  // GARDE, avant tout débit : le moteur se juge POUR le fournisseur de CET
  // avatar (HeyGen : drapeau global + clés ; D-ID : le gate de l'aperçu).
  // Un fournisseur inconnu, ou non configuré, n'atteint aucun fournisseur.
  const fournisseur = jumeau.prive.fournisseurAvatar;
  const moteur = moteurJumeauDisponiblePour(fournisseur, env);
  if (!moteur.disponible || (fournisseur !== 'heygen' && fournisseur !== FOURNISSEUR_DID)) {
    return { ok: false, motif: 'moteur_indisponible', message: moteur.message ?? 'La génération vidéo avec votre jumeau numérique n’est pas encore disponible.' };
  }

  // 1 bis. Jumeau VIDÉO chez le fournisseur principal : TEMPORAIREMENT réservé
  //        à l'admin, et seulement une fois son consentement filmé ACCEPTÉ —
  //        avant tout débit, tout appel fournisseur.
  if (fournisseur === 'heygen' && jumeau.prive.typeAvatar === 'video') {
    if (!jumeauVideoAutorise(await compteAdmin(args.userId))) {
      return { ok: false, motif: 'moteur_indisponible', message: MESSAGES_CREATION.videoIndisponible };
    }
    if (jumeau.prive.consentementJumeau !== 'accepted') {
      return { ok: false, motif: 'moteur_indisponible', message: MESSAGES_CREATION.consentementRequis };
    }
  }

  // 1 ter. Avatar V : seulement si HeyGen le CONFIRME pour CE look (lecture
  //        gratuite, mémorisée) — sinon refus avec la vraie raison, avant tout débit.
  if (choixMoteur.verifierFournisseur) {
    const supportes = fournisseur === 'heygen' && jumeau.prive.typeAvatar === 'video'
      ? await moteursSupportesDuLook(jumeau.prive.providerAvatarId)
      : null;
    const motif = motifPremium(fournisseur === 'heygen' ? jumeau.prive.typeAvatar : 'autre', supportes);
    if (motif) return { ok: false, motif: 'moteur_indisponible', message: motif };
  }

  // 2. Les textes : DISPLAY intact, SPOKEN pour la voix.
  const display = args.textes.filter((t) => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim()).join('\n\n');
  if (!display) return { ok: false, motif: 'texte_absent', message: 'Aucun texte à faire dire à votre jumeau.' };
  if (display.length > MAX_TEXTE_JUMEAU) {
    return { ok: false, motif: 'texte_trop_long', message: `Le texte est limité à ${MAX_TEXTE_JUMEAU} caractères pour votre jumeau.` };
  }
  const spoken = scriptsDuJumeau([display], jumeau.prive.prononciations)[0].spoken;
  const aspectRatio: AvatarAspectRatio = RATIOS.includes(args.aspectRatio as AvatarAspectRatio) ? (args.aspectRatio as AvatarAspectRatio) : '9:16';
  const marqueVoix = `${PREFIXE_VOIX_JUMEAU}${voix.id}`;

  // 2 bis. COÛT FOURNISSEUR — lancement manuel d'un admin : le devis HeyGen
  //        (moteur envoyé, durée estimée du texte dit, coût) AVANT toute
  //        réservation, tout débit et tout appel (voix comprise).
  if (args.coutFournisseur && fournisseur === 'heygen') {
    const devis = devisVideoHeygen({
      operation: args.coutFournisseur.operation ?? 'video_avatar',
      moteurEnvoye: choixMoteur.moteur,
      avatarType: jumeau.prive.typeAvatar,
      dureeSecondes: dureeParoleEstimee([spoken]),
      creditsStudiio: 0,
    });
    if (!confirmationValable(args.coutFournisseur.confirme, args.coutFournisseur.moteurConfirme, devis) && await compteExempteDeCredits(args.userId)) {
      return { ok: false, motif: 'confirmation_cout', message: 'Coût fournisseur à confirmer avant de lancer cette vidéo.', devis };
    }
  }

  // 3. Réservation en base AVANT tout fournisseur — c'est l'index unique
  //    partiel des générations de jumeau EN VOL qui tranche : deux requêtes
  //    strictement simultanées, une seule ligne. Le perdant (23505) relit la
  //    génération gagnante et la rend telle quelle — pas un second audio,
  //    pas une seconde vidéo, pas un second débit. Si la gagnante a disparu
  //    entre-temps (échouée, donc hors index), on retente une fois.
  const identite = { user_id: args.userId, user_avatar_id: avatar.id, avatar_version: avatar.version, voice_id: marqueVoix, aspect_ratio: aspectRatio, script: spoken };
  // Traçabilité : la version EXACTE et le moteur de ce rendu (colonnes de la migration identités/versions).
  const tracabilite = {
    ...(jumeau.prive.avatarVersionId ? { avatar_version_id: jumeau.prive.avatarVersionId } : {}),
    ...(fournisseur === 'heygen' ? { engine: choixMoteur.moteur } : {}),
  };
  // ⚠️ Base d'AVANT la migration identités/versions : ces colonnes n'existent
  // pas, et les écrire ferait échouer TOUTE génération. Une colonne absente
  // (42703 / PGRST204) retire la traçabilité et rejoue la même réservation.
  let avecTracabilite = Object.keys(tracabilite).length > 0;
  let generationId: string | null = null;
  for (let tentative = 0; tentative < 2 && !generationId; tentative += 1) {
    // `provider` = le fournisseur de l'avatar : c'est lui que /api/avatar/status
    // interroge (HeyGen ou D-ID) et rembourse en cas d'échec après lancement.
    const { data: reservee, error: erreurReservation } = await supabaseAdmin
      .from('avatar_generations')
      .insert({ ...identite, ...(avecTracabilite ? tracabilite : {}), intention: 'normale', provider: fournisseur, provider_video_id: null, status: 'pending', credits_charged: 0 })
      .select('id')
      .single();
    if (!erreurReservation && reservee) { generationId = (reservee as { id: string }).id; break; }
    if (avecTracabilite && estColonneAbsente(erreurReservation)) {
      console.warn('[Jumeau] traçabilité version/moteur non enregistrée : migration identités/versions non appliquée.');
      avecTracabilite = false;
      tentative -= 1;
      continue;
    }
    if (!estConflitUnique(erreurReservation)) return { ok: false, motif: 'base', message: 'La génération n’a pas pu être réservée.' };
    const lireEnVol = (colonnes: string) => supabaseAdmin
      .from('avatar_generations')
      .select(colonnes)
      .eq('user_id', identite.user_id)
      .eq('user_avatar_id', identite.user_avatar_id)
      .eq('avatar_version', identite.avatar_version)
      .eq('voice_id', identite.voice_id)
      .eq('aspect_ratio', identite.aspect_ratio)
      .eq('script', identite.script)
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1);
    // B1 — les colonnes du garde zombie (`provider_error` vient de la
    // migration des coûts) peuvent manquer sur une base plus ancienne : on
    // relit alors comme AVANT (`id, status`) et le garde ne s'applique pas —
    // jamais une réservation refusée pour une colonne absente.
    let { data: enVol, error: erreurLecture } = await lireEnVol('id, status, provider, provider_video_id, provider_error, created_at, updated_at');
    if (erreurLecture && estColonneAbsente(erreurLecture)) ({ data: enVol, error: erreurLecture } = await lireEnVol('id, status'));
    if (erreurLecture) return { ok: false, motif: 'base', message: 'Vos générations n’ont pas pu être lues.' };
    const gagnante = (enVol as unknown as Array<{ id: string; status: string } & Partial<LigneZombie>> | null)?.[0];
    // B1 — la « gagnante » est un ZOMBIE (lancement interrompu, jamais parti
    // chez le fournisseur) : la rendre condamnait chaque nouvel essai du même
    // texte à `dejaEnCours` sur une génération qui ne partira jamais. Elle est
    // close (et son débit rendu une fois), puis la réservation est retentée.
    if (gagnante && typeof gagnante.created_at === 'string' && estGenerationZombie({ status: gagnante.status, provider_video_id: gagnante.provider_video_id ?? null, provider_error: gagnante.provider_error ?? null, created_at: gagnante.created_at ?? '', updated_at: gagnante.updated_at ?? null })) {
      await cloreGenerationZombie({ id: gagnante.id, user_id: identite.user_id, provider: gagnante.provider ?? null });
      continue;
    }
    if (gagnante) {
      return { ok: true, generationId: gagnante.id, status: gagnante.status, avatarVersion: avatar.version, dejaEnCours: true, display, spoken };
    }
  }
  if (!generationId) return { ok: false, motif: 'base', message: 'La génération n’a pas pu être réservée. Réessayez.' };

  const gid = generationId;
  const echouer = async (motif: 'fournisseur_voix' | 'fournisseur_avatar' | 'credits_insuffisants' | 'base', messageBrut: string, statut?: number, rembourser = false) => {
    // Fournisseur INVISIBLE : l'erreur brute va aux journaux et à l'admin
    // (`provider_error`), l'utilisateur lit un message Studiio.
    const fournisseurEnCause = motif === 'fournisseur_voix' || motif === 'fournisseur_avatar';
    const message = fournisseurEnCause
      ? (rembourser ? MESSAGES_AVATAR.echecRembourse : MESSAGES_AVATAR.echecAvantLancement)
      : messageUtilisateurSur(messageBrut, MESSAGES_AVATAR.echecAvantLancement);
    if (fournisseurEnCause) console.error(`[Jumeau][${fournisseur}] génération ${gid} refusée :`, messageBrut);
    await supabaseAdmin.from('avatar_generations').update({ status: 'failed', error_message: message }).eq('id', gid);
    if (fournisseurEnCause) {
      await enregistrerCoutGeneration(gid, calculerCoutGeneration({ provider: fournisseur, admin: await compteExempteDeCredits(args.userId), secondes: 0, caracteres: 0, creditsDebites: 0 }, env), messageBrut);
    }
    if (rembourser) await rembourserGenerationUneFois(args.userId, gid);
    const refus: ResultatMoteurJumeau = motif === 'credits_insuffisants'
      ? { ok: false, motif, message }
      : { ok: false, motif, message, statut };
    return refus;
  };

  // 4. Crédits — la politique existante d'une génération avatar, débitée
  //    avant les fournisseurs, LIÉE à la génération gagnante : la référence
  //    `jumeau:<generationId>` rend le débit rejouable sans second débit.
  //    Le prix est lu UNE fois, ici : contrôle, débit et `credits_charged`
  //    utilisent ce nombre ; le remboursement relit le montant DÉBITÉ.
  const coutJumeau = await prixDe('avatar.jumeau');
  const credits = await getUserCredits(args.userId);
  if (credits < coutJumeau) {
    // QUOTA UTILISATEUR épuisé : refus AVANT tout fournisseur (ni voix, ni avatar).
    return echouer('credits_insuffisants', MESSAGES_AVATAR.quotaEpuise);
  }

  // 4 bis. FINANCEMENT FOURNISSEUR (le solde de Studiio, pas celui de
  //        l'utilisateur), AVANT débit et avant la voix : un fournisseur
  //        bloqué est d'abord RÉCUPÉRÉ si possible (relecture du solde sous
  //        bail — une recharge automatique passée entre-temps débloque, et
  //        l'utilisateur ne voit rien). Toujours bloqué → la génération reste
  //        réservée EN ATTENTE, rien n'est débité, elle reprendra seule.
  if (!(await fournisseurDisponible(fournisseur))) {
    try {
      await mettreEnAttente(generationId, { reprises: 0, cadrage: args.cadrage, cause: 'Fournisseur bloqué à la pré-vérification (solde Studiio épuisé).' });
    } catch (e) {
      return echouer('base', e instanceof Error ? e.message : 'Mise en attente impossible.');
    }
    return { ok: true, generationId, status: 'pending', avatarVersion: avatar.version, dejaEnCours: false, display, spoken, enAttenteFournisseur: true };
  }
  // ⚠️ LE DÉBIT PEUT LEVER (solde passé sous le seuil entre la lecture et le
  // débit, socle absent, base indisponible). Il levait jusqu'ici HORS de tout
  // `try` : la génération restait `pending` sans fournisseur, dans l'index
  // « en vol » — et toute demande identique recevait ensuite `dejaEnCours` sur
  // une génération qui ne partirait jamais. Aucun fournisseur n'est appelé
  // sur ce chemin ; la génération est close, et remboursée SI un débit a
  // réellement été enregistré (le débit a pu passer avant l'erreur).
  try {
    await deductCredits(args.userId, coutJumeau, 'avatar', referenceOperation('jumeau', generationId));
  } catch (e) {
    const insuffisant = e instanceof Error && e.message === 'Insufficient credits';
    console.error(`[Jumeau] débit de la génération ${generationId} en erreur :`, e instanceof Error ? e.message : e);
    return echouer(
      insuffisant ? 'credits_insuffisants' : 'base',
      insuffisant ? `Crédits insuffisants. Requis : ${coutJumeau}.` : 'Le débit de la génération a échoué. Rien n’a été lancé.',
      undefined,
      true,
    );
  }

  // 5-D. Avatar D-ID : LA chaîne de l'aperçu (ElevenLabs sur MA voix → audio
  //      privé → scène D-ID sur URL signée), intention `normale`, sur le
  //      SPOKEN de la vidéo. Même débit, même remboursement si rien n'est
  //      lancé ; une fois la scène lancée, /api/avatar/status (provider
  //      'did') suit, re-héberge, et rembourse en cas d'échec fournisseur.
  //      Aucun appel HeyGen sur ce chemin.
  if (fournisseur === FOURNISSEUR_DID) {
    const lanceDid = await lancerChezDid({
      generationId, userId: args.userId, providerAvatarId: jumeau.prive.providerAvatarId,
      providerVoiceId: jumeau.prive.providerVoiceId, spoken, cadrage: args.cadrage, coutJumeau,
    }, { env, fetch: deps.fetch });
    if (lanceDid.issue === 'lance') {
      return { ok: true, generationId, status: 'processing', avatarVersion: avatar.version, dejaEnCours: false, display, spoken };
    }
    if (lanceDid.issue === 'attente') {
      return { ok: true, generationId, status: 'pending', avatarVersion: avatar.version, dejaEnCours: false, display, spoken, enAttenteFournisseur: true };
    }
    if (lanceDid.issue === 'non_enregistre') {
      return { ok: false, motif: 'base', message: 'Génération lancée mais non enregistrée. Contactez le support.', lance: true, generationId, providerVideoId: lanceDid.providerVideoId };
    }
    return echouer(lanceDid.motif, lanceDid.message, lanceDid.statut, true);
  }

  // 5-6. MA voix, puis l'avatar animé chez HeyGen — chemin partagé avec la
  //      reprise d'une génération en attente.
  const lance = await lancerChezHeyGen({
    generationId, userId: args.userId, providerAvatarId: jumeau.prive.providerAvatarId,
    providerVoiceId: jumeau.prive.providerVoiceId, spoken, aspectRatio, moteur: choixMoteur.moteur,
    cadrage: args.cadrage, coutJumeau,
  }, { env, fetch: deps.fetch });
  if (lance.issue === 'lance') {
    return { ok: true, generationId, status: lance.status, avatarVersion: avatar.version, dejaEnCours: false, display, spoken };
  }
  if (lance.issue === 'attente') {
    return { ok: true, generationId, status: 'pending', avatarVersion: avatar.version, dejaEnCours: false, display, spoken, enAttenteFournisseur: true };
  }
  if (lance.issue === 'non_enregistre') {
    return { ok: false, motif: 'base', message: 'Génération lancée mais non enregistrée. Contactez le support.', lance: true, generationId, providerVideoId: lance.providerVideoId };
  }
  return echouer(lance.motif, lance.message, lance.statut, true);
}

type IssueLancement =
  | { issue: 'lance'; status: 'pending' | 'processing'; providerVideoId: string }
  | { issue: 'attente' }
  | { issue: 'non_enregistre'; providerVideoId: string }
  | { issue: 'echec'; motif: 'fournisseur_voix' | 'fournisseur_avatar'; message: string; statut?: number };

/** Code normalisé d'un refus D-ID « solde insuffisant » (`erreurNormalisee`, HTTP 402). */
const CODE_SOLDE_DID = 'did_insufficient_credits';

/**
 * D-ID (legacy) : la MÊME règle financière que HeyGen. Voix → audio privé →
 * scène sur URL signée → identifiant écrit. Refus « solde D-ID » : fournisseur
 * signalé, UNE récupération (relecture de `GET /credits` sous bail), UN nouvel
 * essai si le solde est revenu, sinon génération EN ATTENTE (débit gardé).
 *
 * ⚠️ `animerAvatarDidSurMaVoix` retire déjà l'audio déposé quand la scène est
 * refusée : un nouvel essai redépose sous la même clé sans collision. La voix
 * est en revanche resynthétisée (la chaîne D-ID ne réutilise pas l'audio).
 */
async function lancerChezDid(
  p: {
    generationId: string; userId: string; providerAvatarId: string; providerVoiceId: string; spoken: string;
    cadrage?: 'remplir'; coutJumeau?: number; reprise?: boolean;
  },
  deps: { env: NodeJS.ProcessEnv; fetch?: typeof fetch },
): Promise<IssueLancement> {
  for (let essai = 0; essai < 2; essai += 1) {
    const anime = await animerAvatarDidSurMaVoix(
      { userId: p.userId, generationId: p.generationId, providerAvatarId: p.providerAvatarId, providerVoiceId: p.providerVoiceId, spoken: p.spoken, nom: 'Jumeau Studiio' },
      { env: deps.env, fetch: deps.fetch },
    );
    if (anime.ok) {
      const erreurMaj = await enregistrerLancement(p.generationId, p.userId, anime.sceneId, 'processing', p.coutJumeau);
      if (erreurMaj) {
        // La scène est lancée et facturée : on ne rembourse pas, on trace — et
        // on RAPPORTE l'identifiant, pour que l'appelant ne relance jamais.
        console.error(`[Jumeau][D-ID] scène ${anime.sceneId} lancée mais génération ${p.generationId} non mise à jour :`, erreurMaj);
        return { issue: 'non_enregistre', providerVideoId: anime.sceneId };
      }
      return { issue: 'lance', status: 'processing', providerVideoId: anime.sceneId };
    }
    if (anime.code === CODE_SOLDE_DID) {
      await signalerRefusDeSolde(FOURNISSEUR_DID, anime.message);
      if (essai === 0 && !p.reprise && (await fournisseurDisponible(FOURNISSEUR_DID))) continue;
      await mettreEnAttente(p.generationId, { reprises: p.reprise ? 1 : 0, cadrage: p.cadrage, cause: anime.message });
      return { issue: 'attente' };
    }
    return { issue: 'echec', motif: anime.etape === 'voix' ? 'fournisseur_voix' : 'fournisseur_avatar', message: anime.message, statut: anime.statut };
  }
  await mettreEnAttente(p.generationId, { reprises: p.reprise ? 1 : 0, cadrage: p.cadrage });
  return { issue: 'attente' };
}

/**
 * Voix (ElevenLabs, en mémoire) → audio chez HeyGen → vidéo de l'avatar sur
 * CET audio → identifiant écrit. Le débit est déjà fait par l'appelant.
 *
 * Refus « solde HeyGen épuisé » : le fournisseur est signalé (admin alerté),
 * UNE récupération est tentée (relecture du solde sous bail) ; récupéré → UN
 * nouvel essai, avec le MÊME audio déjà envoyé (la voix n'est pas refacturée).
 * Sinon → la génération passe EN ATTENTE, son débit lui reste attaché.
 */
async function lancerChezHeyGen(
  p: {
    generationId: string; userId: string; providerAvatarId: string; providerVoiceId: string; spoken: string;
    aspectRatio: AvatarAspectRatio; moteur: MoteurAvatar; cadrage?: 'remplir'; coutJumeau?: number;
    /** Reprise d'une attente : pas de second essai immédiat, l'unique reprise EST cet essai. */
    reprise?: boolean;
  },
  deps: { env: NodeJS.ProcessEnv; fetch?: typeof fetch },
): Promise<IssueLancement> {
  const synthese = await synthetiserAvecVoix({ providerVoiceId: p.providerVoiceId, texte: p.spoken }, deps);
  if (!synthese.ok) {
    return {
      issue: 'echec', motif: 'fournisseur_voix',
      message: synthese.motif === 'indisponible' ? 'La voix personnelle n’est pas disponible.' : 'Votre voix n’a pas pu être synthétisée.',
      statut: 'statut' in synthese ? synthese.statut ?? undefined : undefined,
    };
  }
  let assetId: string;
  try {
    assetId = (await uploadAsset(new Blob([new Uint8Array(synthese.audio)], { type: synthese.contentType }), 'jumeau.mp3')).assetId;
  } catch (e) {
    if (e instanceof HeyGenError && e.code === CODE_SOLDE_FOURNISSEUR) {
      await signalerRefusDeSolde('heygen', e.message);
      await mettreEnAttente(p.generationId, { reprises: p.reprise ? 1 : 0, cadrage: p.cadrage, cause: e.message });
      return { issue: 'attente' };
    }
    return { issue: 'echec', motif: 'fournisseur_avatar', message: e instanceof HeyGenError ? e.message : "Le fournisseur n'a pas pu animer votre avatar.", statut: e instanceof HeyGenError ? e.httpStatus : undefined };
  }
  const lancer = () => generateAvatarVideoFromAudio({
    avatarId: p.providerAvatarId, audioAssetId: assetId, aspectRatio: p.aspectRatio, moteur: p.moteur,
    ...(p.cadrage === 'remplir' ? { cadrage: 'cover' as const } : {}),
  });
  for (let essai = 0; essai < 2; essai += 1) {
    try {
      const video = await lancer();
      const status = video.status === 'completed' ? 'processing' : 'pending';
      const erreurMaj = await enregistrerLancement(p.generationId, p.userId, video.videoId, status, p.coutJumeau);
      if (erreurMaj) {
        // La vidéo est lancée et facturée : on ne rembourse pas, on trace — et
        // on RAPPORTE l'identifiant, pour que l'appelant ne relance jamais.
        console.error(`[Jumeau] video ${video.videoId} lancée mais génération ${p.generationId} non mise à jour :`, erreurMaj);
        return { issue: 'non_enregistre', providerVideoId: video.videoId };
      }
      return { issue: 'lance', status, providerVideoId: video.videoId };
    } catch (e) {
      if (e instanceof HeyGenError && e.code === CODE_SOLDE_FOURNISSEUR) {
        await signalerRefusDeSolde('heygen', e.message);
        // UN seul nouvel essai, et seulement si le solde est revenu.
        if (essai === 0 && !p.reprise && (await fournisseurDisponible('heygen'))) continue;
        await mettreEnAttente(p.generationId, { reprises: p.reprise ? 1 : 0, cadrage: p.cadrage, cause: e.message });
        return { issue: 'attente' };
      }
      return { issue: 'echec', motif: 'fournisseur_avatar', message: e instanceof HeyGenError ? e.message : "Le fournisseur n'a pas pu animer votre avatar.", statut: e instanceof HeyGenError ? e.httpStatus : undefined };
    }
  }
  await mettreEnAttente(p.generationId, { reprises: p.reprise ? 1 : 0, cadrage: p.cadrage });
  return { issue: 'attente' };
}

/** Ligne d'une génération en attente, telle que la reprise la relit. */
interface LigneAttente {
  id: string; user_id: string; status: string; provider: string | null; provider_video_id: string | null;
  provider_error: string | null; user_avatar_id: string | null; voice_id: string | null; aspect_ratio: string | null;
  script: string | null; engine?: string | null; created_at: string;
}

export type IssueReprise = 'relancee' | 'toujours_en_attente' | 'deja_prise' | 'abandonnee' | 'pas_en_attente';

/**
 * Reprend UNE génération en attente du fournisseur — appelée par le suivi
 * (navigateur) et par le cron de santé des fournisseurs.
 *
 *   - attente trop longue (`ATTENTE_MAX_MS`) ou reprise déjà consommée et de
 *     nouveau refusée → ABANDON : `failed`, crédits recrédités une fois ;
 *   - fournisseur toujours indisponible → rien (elle attend encore) ;
 *   - sinon → reprise UNIQUE prise atomiquement (0 → 1), MÊME génération,
 *     MÊME référence de débit (`jumeau:<id>` : un débit déjà fait n'est pas
 *     refait), puis voix + vidéo.
 */
export async function reprendreGenerationEnAttente(
  ligne: LigneAttente,
  deps: DepsMoteurJumeau & { now?: () => number } = {},
): Promise<IssueReprise> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => Date.now());
  const marqueur = lireMarqueurAttente(ligne.provider_error);
  if (!marqueur || !estEnAttenteFournisseur(ligne)) return 'pas_en_attente';
  if (now() - Date.parse(ligne.created_at) > ATTENTE_MAX_MS) {
    await abandonnerAttente(ligne);
    return 'abandonnee';
  }
  if (marqueur.reprises === 1) return 'deja_prise';
  const fournisseur = ligne.provider === FOURNISSEUR_DID ? FOURNISSEUR_DID : ligne.provider === 'heygen' ? 'heygen' : null;
  if (!fournisseur) return 'toujours_en_attente';
  if (!(await fournisseurDisponible(fournisseur))) return 'toujours_en_attente';
  if (!(await prendreReprise(ligne.id, marqueur))) return 'deja_prise';

  const voixId = ligne.voice_id?.startsWith(PREFIXE_VOIX_JUMEAU) ? ligne.voice_id.slice(PREFIXE_VOIX_JUMEAU.length) : null;
  const jumeau = await resoudreJumeauDuCompte(ligne.user_id, { avatarId: ligne.user_avatar_id, voixId });
  if (!jumeau.ok || !ligne.script) {
    await abandonnerAttente(ligne, MESSAGES_AVATAR.echecRembourse);
    return 'abandonnee';
  }
  const coutJumeau = await prixDe('avatar.jumeau');
  try {
    // Idempotent : déjà débitée avant la mise en attente → `dejaDebite`, rien de plus.
    await deductCredits(ligne.user_id, coutJumeau, 'avatar', referenceOperation('jumeau', ligne.id));
  } catch (e) {
    const insuffisant = e instanceof Error && e.message === 'Insufficient credits';
    await abandonnerAttente(ligne, insuffisant ? MESSAGES_AVATAR.quotaEpuise : MESSAGES_AVATAR.echecRembourse);
    return 'abandonnee';
  }
  if (fournisseur === FOURNISSEUR_DID) {
    // Un refus AU SUIVI laisse l'audio de la scène refusée dans notre stockage :
    // retiré avant de redéposer sous la même clé (dépôt sans écrasement).
    await retirerAudioDid(ligne.user_id, ligne.id);
    const issueDid = await lancerChezDid({
      generationId: ligne.id, userId: ligne.user_id, providerAvatarId: jumeau.prive.providerAvatarId,
      providerVoiceId: jumeau.prive.providerVoiceId, spoken: ligne.script, cadrage: marqueur.cadrage, coutJumeau, reprise: true,
    }, { env, fetch: deps.fetch });
    if (issueDid.issue === 'lance' || issueDid.issue === 'non_enregistre') return 'relancee';
    await abandonnerAttente(ligne, issueDid.issue === 'attente' ? undefined : MESSAGES_AVATAR.echecRembourse);
    return 'abandonnee';
  }
  const aspectRatio: AvatarAspectRatio = RATIOS.includes(ligne.aspect_ratio as AvatarAspectRatio) ? (ligne.aspect_ratio as AvatarAspectRatio) : '9:16';
  // Le moteur ENREGISTRÉ à la réservation (la reprise rejoue la même demande),
  // sinon le moteur par défaut du serveur.
  const moteur: MoteurAvatar = (MOTEURS_AVATAR as readonly string[]).includes(ligne.engine ?? '')
    ? (ligne.engine as MoteurAvatar) : moteurAvatar(env);
  const issue = await lancerChezHeyGen({
    generationId: ligne.id, userId: ligne.user_id, providerAvatarId: jumeau.prive.providerAvatarId,
    providerVoiceId: jumeau.prive.providerVoiceId, spoken: ligne.script, aspectRatio,
    moteur, cadrage: marqueur.cadrage, coutJumeau, reprise: true,
  }, { env, fetch: deps.fetch });
  if (issue.issue === 'lance' || issue.issue === 'non_enregistre') return 'relancee';
  if (issue.issue === 'attente') {
    // L'unique reprise a de nouveau été refusée faute de solde : abandon.
    await abandonnerAttente(ligne);
    return 'abandonnee';
  }
  await abandonnerAttente(ligne, MESSAGES_AVATAR.echecRembourse);
  return 'abandonnee';
}

/**
 * Fin d'une attente : `failed`, crédits recrédités AU PLUS UNE FOIS (et
 * seulement s'ils ont été débités — `rembourserGenerationUneFois`). Le message
 * dit la vérité sans nommer le fournisseur.
 */
export async function abandonnerAttente(ligne: Pick<LigneAttente, 'id' | 'user_id'>, message?: string): Promise<void> {
  const admin = await compteExempteDeCredits(ligne.user_id);
  const rembourse = await rembourserGenerationUneFois(ligne.user_id, ligne.id);
  const visible = message
    ?? (admin ? MESSAGES_AVATAR.creditsFournisseurAdmin : rembourse ? MESSAGES_AVATAR.creditsFournisseurRembourse : MESSAGES_AVATAR.creditsFournisseur);
  await supabaseAdmin.from('avatar_generations').update({ status: 'failed', error_message: visible, updated_at: new Date().toISOString() }).eq('id', ligne.id);
  // Audio privé d'une scène D-ID jamais aboutie : rien à garder (sans effet
  // pour HeyGen, qui n'en dépose pas). Jamais bloquant : l'abandon est acquis.
  await retirerAudioDid(ligne.user_id, ligne.id);
}

/** Retire l'audio privé d'une génération D-ID ; ne lève jamais. */
async function retirerAudioDid(userId: string, generationId: string): Promise<void> {
  try {
    await retirerObjetPriveAvatar(userId, cleAudioAvatar(userId, generationId));
  } catch (e) {
    console.warn(`[Jumeau] audio de ${generationId} non retiré :`, e instanceof Error ? e.message : e);
  }
}

/**
 * Écrit l'identifiant fournisseur d'une génération LANCÉE — avec UN nouvel
 * essai : l'écriture qui échoue ici laisse une génération payée sans suivi.
 * Rend le message d'erreur, ou `null` si c'est écrit.
 *
 * Exportée pour la réconciliation de la file Autopilote, qui rejoue cette même
 * écriture à partir de l'identifiant qu'elle a conservé.
 */
export async function enregistrerLancement(
  generationId: string,
  userId: string,
  providerVideoId: string,
  status: 'pending' | 'processing',
  /** Le montant débité pour CETTE génération (lu une fois par l'appelant) ; absent → relu au journal. */
  creditsDebites?: number,
): Promise<string | null> {
  let derniere: string | null = null;
  // Un admin n'est JAMAIS débité (exemption de `deductCredits`) : la ligne ne
  // doit donc pas dire « N crédits facturés », sinon le suivi « rembourserait »
  // des crédits jamais pris. Studiio : 0 ; le coût fournisseur, lui, est mesuré.
  const creditsFactures = await creditsFacturesJumeau(userId, generationId, creditsDebites);
  for (let essai = 0; essai < 2; essai += 1) {
    const { error } = await supabaseAdmin
      .from('avatar_generations')
      .update({ provider_video_id: providerVideoId, status, credits_charged: creditsFactures })
      .eq('id', generationId)
      .eq('user_id', userId);
    if (!error) return null;
    derniere = error.message ?? 'erreur inconnue';
  }
  return derniere;
}

/**
 * Rembourse une génération de jumeau AU PLUS UNE FOIS — et seulement si elle a
 * réellement été débitée.
 *
 * ⚠️ `addCredits` n'a ni référence ni verrou : rejouée, elle rendait les
 * crédits deux fois. Deux gardes, sans nouveau schéma :
 *
 *   1. le débit `jumeau:<generationId>` doit EXISTER dans `credit_transactions`
 *      — un administrateur n'est jamais débité (exemption existante), donc
 *      jamais « remboursé » : `addCredits` réécrivait sinon sa colonne
 *      `credits` à partir du solde fictif illimité ;
 *   2. le drapeau `credits_refunded` est POSÉ atomiquement (false → true)
 *      avant de rendre quoi que ce soit — le même que `failAndRefund` du
 *      suivi : les deux chemins ne peuvent pas rembourser chacun leur tour.
 */
export async function rembourserGenerationUneFois(userId: string, generationId: string): Promise<boolean> {
  try {
    return await rembourserSiDebitee(userId, generationId);
  } catch (e) {
    // Jamais d'exception vers l'appelant : un remboursement manqué se dit, il
    // n'emporte pas la clôture de la génération.
    console.error(`[Jumeau] remboursement de ${generationId} impossible :`, e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Le montant RÉELLEMENT débité pour une génération de jumeau, lu au journal
 * (`credit_transactions`, référence `jumeau:<generationId>`). `0` : aucun
 * débit (admin, prix 0) ; `null` : journal illisible.
 */
async function montantDebiteJumeau(userId: string, generationId: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from('credit_transactions')
    .select('id, amount')
    .eq('user_id', userId)
    .eq('reference_id', referenceOperation('jumeau', generationId))
    .limit(1);
  if (error) return null;
  const montant = Number((data?.[0] as { amount?: unknown } | undefined)?.amount);
  return Number.isFinite(montant) ? Math.abs(montant) : 0;
}

/** `credits_charged` d'une génération : 0 pour un admin, sinon ce qui a été débité. */
async function creditsFacturesJumeau(userId: string, generationId: string, creditsDebites?: number): Promise<number> {
  if (await compteExempteDeCredits(userId)) return 0;
  if (typeof creditsDebites === 'number') return creditsDebites;
  // Journal illisible : le tarif en vigueur, comme avant (jamais 0 par erreur).
  return (await montantDebiteJumeau(userId, generationId)) ?? prixDe('avatar.jumeau');
}

async function rembourserSiDebitee(userId: string, generationId: string): Promise<boolean> {
  const reference = referenceOperation('jumeau', generationId);
  const { data: debits, error: erreurDebit } = await supabaseAdmin
    .from('credit_transactions')
    .select('id, amount')
    .eq('user_id', userId)
    .eq('reference_id', reference)
    .limit(1);
  if (erreurDebit) {
    console.error(`[Jumeau] débit de ${generationId} illisible — remboursement différé :`, erreurDebit.message);
    return false;
  }
  if (!debits || debits.length === 0) return false; // rien n'a été débité
  // ⚠️ ON REND CE QUI A ÉTÉ PRIS, jamais le tarif du moment : l'admin a pu
  // changer le prix entre le débit et l'échec.
  const montantDebite = Math.abs(Number((debits[0] as { amount?: unknown }).amount));
  if (!Number.isFinite(montantDebite) || montantDebite === 0) {
    console.error(`[Jumeau] montant du débit de ${generationId} illisible — remboursement différé.`);
    return false;
  }

  const { data: pose } = await supabaseAdmin
    .from('avatar_generations')
    .update({ credits_refunded: true })
    .eq('id', generationId)
    .eq('credits_refunded', false)
    .select('id');
  if (!pose || pose.length === 0) return false; // déjà remboursée

  try {
    await addCredits(userId, montantDebite, 'refund');
    return true;
  } catch (e) {
    console.error(`[Jumeau] REMBOURSEMENT ÉCHOUÉ pour la génération ${generationId} :`, e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * Rattache après coup l'identifiant fournisseur d'une génération LANCÉE dont
 * l'écriture avait échoué (voir `lance: true`). N'écrit que si la génération
 * n'a TOUJOURS pas d'identifiant : une génération déjà suivie (ou terminée)
 * n'est jamais ramenée en arrière. Rend `true` si la génération porte
 * désormais un identifiant fournisseur.
 */
export async function reconcilierLancement(
  generationId: string,
  userId: string,
  providerVideoId: string,
): Promise<boolean> {
  // Ce qui a été débité pour CETTE génération (journal), 0 pour un admin.
  const creditsFactures = await creditsFacturesJumeau(userId, generationId);
  const { error } = await supabaseAdmin
    .from('avatar_generations')
    .update({ provider_video_id: providerVideoId, status: 'processing', credits_charged: creditsFactures })
    .eq('id', generationId)
    .eq('user_id', userId)
    .is('provider_video_id', null)
    // B1 — une génération déjà CLOSE (zombie échu, remboursé) n'est jamais
    // ressuscitée : elle repartirait `processing` alors que ses crédits sont rendus.
    .in('status', ['pending', 'processing']);
  if (error) {
    console.error(`[Jumeau] réconciliation de ${generationId} impossible :`, error.message);
    return false;
  }
  return true;
}

/**
 * B1 — GÉNÉRATION ZOMBIE : réservée (et parfois débitée) puis jamais partie
 * chez le fournisseur — crash ou redéploiement en plein lancement. Elle n'a
 * ni identifiant fournisseur ni marqueur d'attente, et restait « en cours »
 * pour toujours dans l'index des générations en vol.
 *
 * Même délai que le garde stale du suivi (`STALE_AFTER_MS`, 30 min) : un
 * lancement dure quelques secondes (voix puis vidéo), jamais une demi-heure.
 * Une génération EN ATTENTE FOURNISSEUR (marqueur) n'est jamais un zombie :
 * elle a son propre délai (`ATTENTE_MAX_MS`).
 */
export const DELAI_GENERATION_ZOMBIE_MS = 30 * 60 * 1000;

interface LigneZombie {
  status: string; provider: string | null; provider_video_id: string | null; provider_error: string | null; created_at: string; updated_at: string | null;
}

export function estGenerationZombie(
  g: { status: string; provider_video_id: string | null; provider_error?: string | null; created_at: string; updated_at?: string | null },
  maintenant: number = Date.now(),
): boolean {
  if (g.status !== 'pending' && g.status !== 'processing') return false;
  if (g.provider_video_id) return false;
  // Déjà mise en attente au moins une fois (marqueur, qui n'est jamais retiré
  // d'une ligne en vol) : jamais un zombie — l'attente et sa reprise unique
  // ont leur propre fin (`ATTENTE_MAX_MS`, abandon remboursé).
  if (lireMarqueurAttente(g.provider_error) !== null) return false;
  // L'âge se mesure depuis le DERNIER lancement réel, jamais depuis
  // `created_at` seul : sans migration, l'horodatage disponible est
  // `updated_at`, posé à chaque mise en attente et à la prise de reprise
  // (`prendreReprise`). On prend le plus récent des deux — au pire, la
  // clôture est retardée, jamais avancée.
  const reperes = [g.created_at, g.updated_at].map((v) => (v ? Date.parse(v) : Number.NaN)).filter(Number.isFinite);
  if (reperes.length === 0) return false;
  return maintenant - Math.max(...reperes) > DELAI_GENERATION_ZOMBIE_MS;
}

/**
 * Clôt un zombie : `failed` (pose CONDITIONNELLE — toujours en vol et
 * toujours sans identifiant fournisseur), puis le débit `jumeau:<id>` est
 * rendu AU PLUS UNE FOIS par le chemin existant `rembourserGenerationUneFois`
 * (journal + drapeau `credits_refunded` atomique). Deux passes concurrentes :
 * une seule remporte la clôture, une seule rembourse.
 *
 * `close: false` : une autre passe l'a close, ou un identifiant fournisseur
 * vient d'y être rattaché — l'appelant relit la ligne.
 */
export async function cloreGenerationZombie(
  g: { id: string; user_id: string; provider: string | null },
): Promise<{ close: boolean; rembourse: boolean; message: string }> {
  const { data: prise, error } = await supabaseAdmin
    .from('avatar_generations')
    .update({ status: 'failed', error_message: MESSAGES_AVATAR.nonDemarree, updated_at: new Date().toISOString() })
    .eq('id', g.id)
    .in('status', ['pending', 'processing'])
    .is('provider_video_id', null)
    .select('id');
  if (error || !prise || prise.length === 0) return { close: false, rembourse: false, message: MESSAGES_AVATAR.nonDemarree };
  console.error(`[Jumeau] génération ${g.id} jamais partie chez le fournisseur (lancement interrompu) : close.`);
  const rembourse = await rembourserGenerationUneFois(g.user_id, g.id);
  const message = rembourse ? MESSAGES_AVATAR.nonDemarreeRembourse : MESSAGES_AVATAR.nonDemarree;
  if (rembourse) {
    await supabaseAdmin.from('avatar_generations').update({ error_message: message }).eq('id', g.id);
  }
  if (g.provider === FOURNISSEUR_DID) await retirerAudioDid(g.user_id, g.id);
  return { close: true, rembourse, message };
}
