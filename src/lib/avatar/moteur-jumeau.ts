/**
 * LE MOTEUR VIDÉO DU JUMEAU — une seule chaîne, réutilisable par Créer
 * aujourd'hui et l'Autopilote ensuite.
 *
 *   DISPLAY_SCRIPT ─ prononciations ─▶ SPOKEN_SCRIPT
 *        ─▶ ElevenLabs, MA voix (synthetiserAvecVoix)     → MP3 en mémoire
 *        ─▶ HeyGen POST /v3/assets (uploadAsset)          → audio_asset_id
 *        ─▶ HeyGen POST /v3/videos + audio_asset_id       → video_id
 *        ─▶ suivi par GET /api/avatar/status (polling, re-hébergement,
 *           remboursement en cas d'échec : l'architecture existante)
 *
 * Ce qui est RELU à chaque génération : le jumeau du compte
 * (`resoudreJumeauDuCompte` : avatar vivant, version courante, validé,
 * fournisseur présent ; voix du compte, choix, identifiant). Le navigateur
 * n'apporte que les textes et le format.
 *
 * Ce qui n'est JAMAIS fait : une voix HeyGen à la place de la voix
 * personnelle, une vidéo ordinaire à la place du jumeau, un succès sans
 * identifiant de vidéo fournisseur, un audio déposé sur une URL publique.
 *
 * Crédits : la politique EXISTANTE d'une génération avatar
 * (AVATAR_VIDEO_COST), débitée avant les fournisseurs, remboursée si la
 * vidéo n'a pas été lancée (ElevenLabs, dépôt ou création HeyGen en échec)
 * — comme /api/avatar/generate. Une fois la vidéo lancée chez HeyGen, c'est
 * /api/avatar/status qui rembourse en cas d'échec fournisseur, comme pour
 * toute génération.
 *
 * Idempotence : une génération de jumeau EN COURS pour (compte, avatar,
 * version, script) est rendue telle quelle à un second appel — pas un
 * second audio, pas une seconde vidéo, pas un second débit. ⚠️ C'est une
 * lecture-puis-insertion, pas un index unique : deux requêtes strictement
 * simultanées pourraient passer ; le verrou de série du wizard ferme le
 * double clic côté écran, et une garantie base exigerait une migration —
 * non créée ici, volontairement (voir le rapport du chantier).
 *
 * Disponibilité : `moteurJumeauDisponible()` n'est vrai que si
 * JUMEAU_MOTEUR_ACTIVE=1 ET les deux clés fournisseur sont configurées. Le
 * drapeau reste à zéro tant que la chaîne n'a pas été vue fonctionner sur un
 * vrai compte : des tests doublés ne prouvent pas un fournisseur.
 */

import { supabaseAdmin } from '@/lib/db/supabase';
import { getUserCredits, deductCredits, addCredits } from '@/lib/credits/system';
import { AVATAR_VIDEO_COST } from '@/lib/stripe/constants';
import { uploadAsset, generateAvatarVideoFromAudio, HeyGenError, type AvatarAspectRatio } from '@/lib/avatar/heygen';
import { resoudreJumeauDuCompte, scriptsDuJumeau, type MotifJumeau } from '@/lib/avatar/jumeau';
import { synthetiserAvecVoix, cleElevenLabs } from '@/lib/voice/synthese';

/** Marqueur d'une génération de jumeau dans `avatar_generations.voice_id` : la voix INTERNE (user_voices.id), jamais le voice_id fournisseur. */
export const PREFIXE_VOIX_JUMEAU = 'jumeau:';
export const MAX_TEXTE_JUMEAU = 1200;
const RATIOS: AvatarAspectRatio[] = ['9:16', '16:9', '1:1'];

export function moteurJumeauDisponible(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.JUMEAU_MOTEUR_ACTIVE === '1' && !!env.HEYGEN_API_KEY?.trim() && cleElevenLabs(env) !== null;
}

export type ResultatMoteurJumeau =
  | { ok: true; generationId: string; status: string; avatarVersion: number; dejaEnCours: boolean; display: string; spoken: string }
  | { ok: false; motif: 'moteur_indisponible' | 'texte_absent' | 'texte_trop_long' | 'credits_insuffisants' | MotifJumeau; message: string }
  | { ok: false; motif: 'fournisseur_voix' | 'fournisseur_avatar' | 'base'; message: string; statut?: number };

export interface DepsMoteurJumeau {
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}

export async function genererVideoJumeau(
  args: { userId: string; textes: string[]; aspectRatio?: string },
  deps: DepsMoteurJumeau = {},
): Promise<ResultatMoteurJumeau> {
  const env = deps.env ?? process.env;
  if (!moteurJumeauDisponible(env)) {
    return { ok: false, motif: 'moteur_indisponible', message: 'La génération vidéo avec votre jumeau numérique n’est pas encore disponible.' };
  }

  // 1. Le jumeau, relu maintenant.
  const jumeau = await resoudreJumeauDuCompte(args.userId);
  if (!jumeau.ok) {
    if ('motif' in jumeau) return { ok: false, motif: jumeau.motif, message: jumeau.message };
    return { ok: false, motif: 'base', message: 'Votre jumeau n’a pas pu être vérifié.' };
  }
  const { avatar, voix } = jumeau.jumeau;

  // 2. Les textes : DISPLAY intact, SPOKEN pour la voix.
  const display = args.textes.filter((t) => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim()).join('\n\n');
  if (!display) return { ok: false, motif: 'texte_absent', message: 'Aucun texte à faire dire à votre jumeau.' };
  if (display.length > MAX_TEXTE_JUMEAU) {
    return { ok: false, motif: 'texte_trop_long', message: `Le texte est limité à ${MAX_TEXTE_JUMEAU} caractères pour votre jumeau.` };
  }
  const spoken = scriptsDuJumeau([display], jumeau.prive.prononciations)[0].spoken;
  const aspectRatio: AvatarAspectRatio = RATIOS.includes(args.aspectRatio as AvatarAspectRatio) ? (args.aspectRatio as AvatarAspectRatio) : '9:16';
  const marqueVoix = `${PREFIXE_VOIX_JUMEAU}${voix.id}`;

  // 3. Idempotence : une génération de jumeau en cours pour ce script, cette version → la même.
  const { data: enCours, error: erreurLecture } = await supabaseAdmin
    .from('avatar_generations')
    .select('id, status')
    .eq('user_id', args.userId)
    .eq('user_avatar_id', avatar.id)
    .eq('avatar_version', avatar.version)
    .eq('voice_id', marqueVoix)
    .eq('script', spoken)
    .in('status', ['pending', 'processing'])
    .order('created_at', { ascending: false })
    .limit(1);
  if (erreurLecture) return { ok: false, motif: 'base', message: 'Vos générations n’ont pas pu être lues.' };
  const existante = enCours?.[0] as { id: string; status: string } | undefined;
  if (existante) {
    return { ok: true, generationId: existante.id, status: existante.status, avatarVersion: avatar.version, dejaEnCours: true, display, spoken };
  }

  // 4. Réservation en base AVANT tout fournisseur (version épinglée, voix interne marquée).
  const { data: reservee, error: erreurReservation } = await supabaseAdmin
    .from('avatar_generations')
    .insert({
      user_id: args.userId,
      user_avatar_id: avatar.id,
      avatar_version: avatar.version,
      intention: 'normale',
      provider_video_id: null,
      script: spoken,
      voice_id: marqueVoix,
      aspect_ratio: aspectRatio,
      status: 'pending',
      credits_charged: 0,
    })
    .select('id')
    .single();
  if (erreurReservation || !reservee) return { ok: false, motif: 'base', message: 'La génération n’a pas pu être réservée.' };
  const generationId = (reservee as { id: string }).id;

  const echouer = async (motif: 'fournisseur_voix' | 'fournisseur_avatar' | 'credits_insuffisants', message: string, statut?: number, rembourser = false) => {
    await supabaseAdmin.from('avatar_generations').update({ status: 'failed', error_message: message }).eq('id', generationId);
    if (rembourser) {
      try { await addCredits(args.userId, AVATAR_VIDEO_COST, 'refund'); } catch (e) { console.error('[Jumeau] remboursement échoué :', e); }
    }
    return { ok: false as const, motif, message, statut };
  };

  // 5. Crédits — la politique existante d'une génération avatar, débitée avant les fournisseurs.
  const credits = await getUserCredits(args.userId);
  if (credits < AVATAR_VIDEO_COST) {
    return echouer('credits_insuffisants', `Crédits insuffisants. Requis : ${AVATAR_VIDEO_COST}, disponible : ${credits}.`);
  }
  await deductCredits(args.userId, AVATAR_VIDEO_COST, 'avatar');

  // 6. MA voix, sur le texte DIT — en mémoire, jamais sur une URL.
  const synthese = await synthetiserAvecVoix({ providerVoiceId: jumeau.prive.providerVoiceId, texte: spoken }, { env, fetch: deps.fetch });
  if (!synthese.ok) {
    return echouer('fournisseur_voix', synthese.motif === 'indisponible' ? 'La voix personnelle n’est pas disponible.' : 'Votre voix n’a pas pu être synthétisée.', 'statut' in synthese ? synthese.statut ?? undefined : undefined, true);
  }

  // 7. L'audio chez HeyGen, puis l'avatar animé sur CET audio.
  try {
    const asset = await uploadAsset(new Blob([new Uint8Array(synthese.audio)], { type: synthese.contentType }), 'jumeau.mp3');
    const video = await generateAvatarVideoFromAudio({ avatarId: jumeau.prive.providerAvatarId, audioAssetId: asset.assetId, aspectRatio });
    const { error: erreurMaj } = await supabaseAdmin
      .from('avatar_generations')
      .update({ provider_video_id: video.videoId, status: video.status === 'completed' ? 'processing' : 'pending', credits_charged: AVATAR_VIDEO_COST })
      .eq('id', generationId)
      .eq('user_id', args.userId);
    if (erreurMaj) {
      // La vidéo est lancée et facturée : on ne rembourse pas, on trace.
      console.error(`[Jumeau] video ${video.videoId} lancée mais génération ${generationId} non mise à jour :`, erreurMaj.message);
      return { ok: false, motif: 'base', message: 'Génération lancée mais non enregistrée. Contactez le support.' };
    }
    return { ok: true, generationId, status: video.status === 'completed' ? 'processing' : 'pending', avatarVersion: avatar.version, dejaEnCours: false, display, spoken };
  } catch (e) {
    const message = e instanceof HeyGenError ? e.message : "Le fournisseur n'a pas pu animer votre avatar.";
    return echouer('fournisseur_avatar', message, e instanceof HeyGenError ? e.httpStatus : undefined, true);
  }
}
