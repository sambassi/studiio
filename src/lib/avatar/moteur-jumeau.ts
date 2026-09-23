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
 * Crédits : la politique EXISTANTE d'une génération avatar
 * (AVATAR_VIDEO_COST), la même pour les deux fournisseurs, débitée avant les
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

import { supabaseAdmin } from '@/lib/db/supabase';
import { getUserCredits, deductCredits, addCredits } from '@/lib/credits/system';
import { referenceOperation } from '@/lib/credits/atomique';
import { AVATAR_VIDEO_COST } from '@/lib/stripe/constants';
import { uploadAsset, generateAvatarVideoFromAudio, HeyGenError, type AvatarAspectRatio } from '@/lib/avatar/heygen';
import { resoudreJumeauDuCompte, scriptsDuJumeau, moteurJumeauDisponiblePour, type MotifJumeau } from '@/lib/avatar/jumeau';
import { animerAvatarDidSurMaVoix, FOURNISSEUR_DID } from '@/lib/avatar/did';
import { synthetiserAvecVoix, cleElevenLabs } from '@/lib/voice/synthese';

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
  | { ok: true; generationId: string; status: string; avatarVersion: number; dejaEnCours: boolean; display: string; spoken: string }
  | { ok: false; motif: 'moteur_indisponible' | 'texte_absent' | 'texte_trop_long' | 'credits_insuffisants' | MotifJumeau; message: string }
  | { ok: false; motif: 'fournisseur_voix' | 'fournisseur_avatar' | 'base'; message: string; statut?: number }
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

export async function genererVideoJumeau(
  args: { userId: string; textes: string[]; aspectRatio?: string },
  deps: DepsMoteurJumeau = {},
): Promise<ResultatMoteurJumeau> {
  const env = deps.env ?? process.env;

  // 1. Le jumeau, relu maintenant.
  const jumeau = await resoudreJumeauDuCompte(args.userId);
  if (!jumeau.ok) {
    if ('motif' in jumeau) return { ok: false, motif: jumeau.motif, message: jumeau.message };
    return { ok: false, motif: 'base', message: 'Votre jumeau n’a pas pu être vérifié.' };
  }
  const { avatar, voix } = jumeau.jumeau;
  // GARDE, avant tout débit : le moteur se juge POUR le fournisseur de CET
  // avatar (HeyGen : drapeau global + clés ; D-ID : le gate de l'aperçu).
  // Un fournisseur inconnu, ou non configuré, n'atteint aucun fournisseur.
  const fournisseur = jumeau.prive.fournisseurAvatar;
  const moteur = moteurJumeauDisponiblePour(fournisseur, env);
  if (!moteur.disponible || (fournisseur !== 'heygen' && fournisseur !== FOURNISSEUR_DID)) {
    return { ok: false, motif: 'moteur_indisponible', message: moteur.message ?? 'La génération vidéo avec votre jumeau numérique n’est pas encore disponible.' };
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

  // 3. Réservation en base AVANT tout fournisseur — c'est l'index unique
  //    partiel des générations de jumeau EN VOL qui tranche : deux requêtes
  //    strictement simultanées, une seule ligne. Le perdant (23505) relit la
  //    génération gagnante et la rend telle quelle — pas un second audio,
  //    pas une seconde vidéo, pas un second débit. Si la gagnante a disparu
  //    entre-temps (échouée, donc hors index), on retente une fois.
  const identite = { user_id: args.userId, user_avatar_id: avatar.id, avatar_version: avatar.version, voice_id: marqueVoix, aspect_ratio: aspectRatio, script: spoken };
  let generationId: string | null = null;
  for (let tentative = 0; tentative < 2 && !generationId; tentative += 1) {
    // `provider` = le fournisseur de l'avatar : c'est lui que /api/avatar/status
    // interroge (HeyGen ou D-ID) et rembourse en cas d'échec après lancement.
    const { data: reservee, error: erreurReservation } = await supabaseAdmin
      .from('avatar_generations')
      .insert({ ...identite, intention: 'normale', provider: fournisseur, provider_video_id: null, status: 'pending', credits_charged: 0 })
      .select('id')
      .single();
    if (!erreurReservation && reservee) { generationId = (reservee as { id: string }).id; break; }
    if (!estConflitUnique(erreurReservation)) return { ok: false, motif: 'base', message: 'La génération n’a pas pu être réservée.' };
    const { data: enVol, error: erreurLecture } = await supabaseAdmin
      .from('avatar_generations')
      .select('id, status')
      .eq('user_id', identite.user_id)
      .eq('user_avatar_id', identite.user_avatar_id)
      .eq('avatar_version', identite.avatar_version)
      .eq('voice_id', identite.voice_id)
      .eq('aspect_ratio', identite.aspect_ratio)
      .eq('script', identite.script)
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1);
    if (erreurLecture) return { ok: false, motif: 'base', message: 'Vos générations n’ont pas pu être lues.' };
    const gagnante = enVol?.[0] as { id: string; status: string } | undefined;
    if (gagnante) {
      return { ok: true, generationId: gagnante.id, status: gagnante.status, avatarVersion: avatar.version, dejaEnCours: true, display, spoken };
    }
  }
  if (!generationId) return { ok: false, motif: 'base', message: 'La génération n’a pas pu être réservée. Réessayez.' };

  const gid = generationId;
  const echouer = async (motif: 'fournisseur_voix' | 'fournisseur_avatar' | 'credits_insuffisants' | 'base', message: string, statut?: number, rembourser = false) => {
    await supabaseAdmin.from('avatar_generations').update({ status: 'failed', error_message: message }).eq('id', gid);
    if (rembourser) await rembourserGenerationUneFois(args.userId, gid);
    const refus: ResultatMoteurJumeau = motif === 'credits_insuffisants'
      ? { ok: false, motif, message }
      : { ok: false, motif, message, statut };
    return refus;
  };

  // 4. Crédits — la politique existante d'une génération avatar, débitée
  //    avant les fournisseurs, LIÉE à la génération gagnante : la référence
  //    `jumeau:<generationId>` rend le débit rejouable sans second débit.
  const credits = await getUserCredits(args.userId);
  if (credits < AVATAR_VIDEO_COST) {
    return echouer('credits_insuffisants', `Crédits insuffisants. Requis : ${AVATAR_VIDEO_COST}, disponible : ${credits}.`);
  }
  // ⚠️ LE DÉBIT PEUT LEVER (solde passé sous le seuil entre la lecture et le
  // débit, socle absent, base indisponible). Il levait jusqu'ici HORS de tout
  // `try` : la génération restait `pending` sans fournisseur, dans l'index
  // « en vol » — et toute demande identique recevait ensuite `dejaEnCours` sur
  // une génération qui ne partirait jamais. Aucun fournisseur n'est appelé
  // sur ce chemin ; la génération est close, et remboursée SI un débit a
  // réellement été enregistré (le débit a pu passer avant l'erreur).
  try {
    await deductCredits(args.userId, AVATAR_VIDEO_COST, 'avatar', referenceOperation('jumeau', generationId));
  } catch (e) {
    const insuffisant = e instanceof Error && e.message === 'Insufficient credits';
    console.error(`[Jumeau] débit de la génération ${generationId} en erreur :`, e instanceof Error ? e.message : e);
    return echouer(
      insuffisant ? 'credits_insuffisants' : 'base',
      insuffisant ? `Crédits insuffisants. Requis : ${AVATAR_VIDEO_COST}.` : 'Le débit de la génération a échoué. Rien n’a été lancé.',
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
    const anime = await animerAvatarDidSurMaVoix(
      { userId: args.userId, generationId, providerAvatarId: jumeau.prive.providerAvatarId, providerVoiceId: jumeau.prive.providerVoiceId, spoken, nom: 'Jumeau Studiio' },
      { env, fetch: deps.fetch },
    );
    if (!anime.ok) return echouer(anime.etape === 'voix' ? 'fournisseur_voix' : 'fournisseur_avatar', anime.message, anime.statut, true);
    const erreurMaj = await enregistrerLancement(generationId, args.userId, anime.sceneId, 'processing');
    if (erreurMaj) {
      // La scène est lancée et facturée : on ne rembourse pas, on trace — et
      // on RAPPORTE l'identifiant, pour que l'appelant ne relance jamais.
      console.error(`[Jumeau][D-ID] scène ${anime.sceneId} lancée mais génération ${generationId} non mise à jour :`, erreurMaj);
      return { ok: false, motif: 'base', message: 'Génération lancée mais non enregistrée. Contactez le support.', lance: true, generationId, providerVideoId: anime.sceneId };
    }
    return { ok: true, generationId, status: 'processing', avatarVersion: avatar.version, dejaEnCours: false, display, spoken };
  }

  // 5. MA voix, sur le texte DIT — en mémoire, jamais sur une URL.
  const synthese = await synthetiserAvecVoix({ providerVoiceId: jumeau.prive.providerVoiceId, texte: spoken }, { env, fetch: deps.fetch });
  if (!synthese.ok) {
    return echouer('fournisseur_voix', synthese.motif === 'indisponible' ? 'La voix personnelle n’est pas disponible.' : 'Votre voix n’a pas pu être synthétisée.', 'statut' in synthese ? synthese.statut ?? undefined : undefined, true);
  }

  // 6. L'audio chez HeyGen, puis l'avatar animé sur CET audio.
  try {
    const asset = await uploadAsset(new Blob([new Uint8Array(synthese.audio)], { type: synthese.contentType }), 'jumeau.mp3');
    const video = await generateAvatarVideoFromAudio({ avatarId: jumeau.prive.providerAvatarId, audioAssetId: asset.assetId, aspectRatio });
    const erreurMaj = await enregistrerLancement(generationId, args.userId, video.videoId, video.status === 'completed' ? 'processing' : 'pending');
    if (erreurMaj) {
      // La vidéo est lancée et facturée : on ne rembourse pas, on trace — et
      // on RAPPORTE l'identifiant, pour que l'appelant ne relance jamais.
      console.error(`[Jumeau] video ${video.videoId} lancée mais génération ${generationId} non mise à jour :`, erreurMaj);
      return { ok: false, motif: 'base', message: 'Génération lancée mais non enregistrée. Contactez le support.', lance: true, generationId, providerVideoId: video.videoId };
    }
    return { ok: true, generationId, status: video.status === 'completed' ? 'processing' : 'pending', avatarVersion: avatar.version, dejaEnCours: false, display, spoken };
  } catch (e) {
    const message = e instanceof HeyGenError ? e.message : "Le fournisseur n'a pas pu animer votre avatar.";
    return echouer('fournisseur_avatar', message, e instanceof HeyGenError ? e.httpStatus : undefined, true);
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
): Promise<string | null> {
  let derniere: string | null = null;
  for (let essai = 0; essai < 2; essai += 1) {
    const { error } = await supabaseAdmin
      .from('avatar_generations')
      .update({ provider_video_id: providerVideoId, status, credits_charged: AVATAR_VIDEO_COST })
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

async function rembourserSiDebitee(userId: string, generationId: string): Promise<boolean> {
  const reference = referenceOperation('jumeau', generationId);
  const { data: debits, error: erreurDebit } = await supabaseAdmin
    .from('credit_transactions')
    .select('id')
    .eq('user_id', userId)
    .eq('reference_id', reference)
    .limit(1);
  if (erreurDebit) {
    console.error(`[Jumeau] débit de ${generationId} illisible — remboursement différé :`, erreurDebit.message);
    return false;
  }
  if (!debits || debits.length === 0) return false; // rien n'a été débité

  const { data: pose } = await supabaseAdmin
    .from('avatar_generations')
    .update({ credits_refunded: true })
    .eq('id', generationId)
    .eq('credits_refunded', false)
    .select('id');
  if (!pose || pose.length === 0) return false; // déjà remboursée

  try {
    await addCredits(userId, AVATAR_VIDEO_COST, 'refund');
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
  const { error } = await supabaseAdmin
    .from('avatar_generations')
    .update({ provider_video_id: providerVideoId, status: 'processing', credits_charged: AVATAR_VIDEO_COST })
    .eq('id', generationId)
    .eq('user_id', userId)
    .is('provider_video_id', null);
  if (error) {
    console.error(`[Jumeau] réconciliation de ${generationId} impossible :`, error.message);
    return false;
  }
  return true;
}
