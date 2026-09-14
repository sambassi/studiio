import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { getUserCredits, deductCredits, addCredits } from '@/lib/credits/system';
import { AVATAR_VIDEO_COST, AVATAR_MAX_SCRIPT_CHARS } from '@/lib/stripe/constants';
import {
  generateAvatarVideo,
  getAvatarTrainingStatus,
  resolveVoiceId,
  HeyGenError,
  type AvatarAspectRatio,
} from '@/lib/avatar/heygen';
import {
  generationPossible, interrogerLeFournisseur, MESSAGES_GENERATION,
} from '@/lib/avatar/etats';
import {
  lireIntention, INTENTION_APERCU, SCRIPT_APERCU, APERCU_SCRIPT_MAX_CHARS,
} from '@/lib/avatar/contrat';
import {
  apercuOccupe, reserverGeneration, confirmerGeneration, echouerGeneration,
} from '@/lib/avatar/generation';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const VALID_RATIOS: AvatarAspectRatio[] = ['9:16', '16:9', '1:1'];

/**
 * POST /api/avatar/generate — lance une video ou l'avatar prononce un texte.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * A_8f (correctif Gap-1) — DEUX INTENTIONS, UN SEUL PIPELINE
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Cette route ne lisait jamais `validated_at` : le portail Autopilote exigeait
 * la validation du clone, l'appel direct non. Elle exige desormais, dans cet
 * ordre et AVANT tout appel au fournisseur :
 *
 *   auth → propriete de l'avatar → consentement → identifiant fournisseur
 *   reel → entrainement termine → version connue → politique de l'intention
 *   → RESERVATION en base → (seulement alors) fournisseur.
 *
 *   `intention: 'apercu'`  — une seule fois par version, sur le script court
 *                            de Studiio ; `validated_at` n'est pas exige,
 *                            c'est l'apercu qui permet de valider.
 *   `intention: 'normale'` — apres validation seulement.
 *
 * ⚠️ L'INTENTION EST EXPLICITE. Absente ou inconnue, la requete est refusee ;
 * rien n'est deduit de l'etat du clone.
 *
 * ⚠️ LA RESERVATION PRECEDE LE FOURNISSEUR. Pour un apercu, c'est l'index
 * unique de la base qui departage deux requetes simultanees : le perdant ne
 * l'appelle jamais. Voir `lib/avatar/generation.ts`.
 *
 * Ordre des credits (inchange) : solde verifie puis debite AVANT l'appel, pour
 * bloquer les requetes paralleles qui depasseraient le solde ; si le
 * fournisseur echoue, REMBOURSEMENT immediat. Un apercu coute aujourd'hui le
 * meme prix qu'une generation : le modele economique n'est pas l'objet de ce
 * lot.
 *
 * La video n'est pas attendue ici : le fournisseur rend en asynchrone. Le
 * client interroge ensuite GET /api/avatar/status.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  let creditsDeducted = false;
  let reservationId: string | null = null;

  try {
    const body = await req.json();
    const avatarRowId: string | undefined = body?.avatarId;
    const intention = lireIntention(body?.intention);
    const voiceId: string | undefined = body?.voiceId || undefined;
    const aspectRatio: AvatarAspectRatio = VALID_RATIOS.includes(body?.aspectRatio)
      ? body.aspectRatio
      : '9:16';

    if (!intention) {
      return NextResponse.json(
        { success: false, error: 'Intention de generation manquante.', code: 'intention_invalide' },
        { status: 400 },
      );
    }

    /* ⚠️ LE SCRIPT D'UN APERCU VIENT DU SERVEUR. Le navigateur n'en choisit
       pas : un apercu pre-validation sur un texte libre serait une generation
       gratuite deguisee. La borne est verifiee ici meme, pas supposee. */
    let script: string;
    if (intention === INTENTION_APERCU) {
      script = SCRIPT_APERCU;
      if (script.length > APERCU_SCRIPT_MAX_CHARS) {
        return NextResponse.json(
          { success: false, error: 'Le script d’aperçu dépasse la borne prévue.' },
          { status: 500 },
        );
      }
    } else {
      script = (body?.script ?? '').toString().trim();
      if (!script) {
        return NextResponse.json(
          { success: false, error: 'Le texte a prononcer est vide.' },
          { status: 400 },
        );
      }
      if (script.length > AVATAR_MAX_SCRIPT_CHARS) {
        return NextResponse.json(
          {
            success: false,
            error: `Texte trop long (${script.length} caracteres). Maximum : ${AVATAR_MAX_SCRIPT_CHARS}.`,
          },
          { status: 400 },
        );
      }
    }

    // Avatar de l'utilisateur — on verifie explicitement la propriete.
    /* ⚠️ ET JAMAIS UNE PREPARATION SUPPRIMEE — A_8f. Generer avec un avatar
       que la personne a retire serait le faire parler apres coup. */
    const query = supabaseAdmin.from('user_avatars').select('*')
      .eq('user_id', userId).is('deleted_at', null);
    const { data: avatarRows } = avatarRowId
      ? await query.eq('id', avatarRowId).limit(1)
      : await query.order('created_at', { ascending: false }).limit(1);

    const avatarRow = avatarRows?.[0];
    if (!avatarRow) {
      return NextResponse.json(
        { success: false, error: "Aucun avatar. Creez d'abord votre avatar." },
        { status: 404 },
      );
    }
    if (!avatarRow.consent_at) {
      return NextResponse.json(
        { success: false, error: 'Consentement manquant sur cet avatar.' },
        { status: 403 },
      );
    }

    /* ⚠️ SANS IDENTIFIANT CHEZ LE FOURNISSEUR, ON S'ARRETE ICI — avant meme de
       l'interroger. Une source prete (`source_ready`) n'a jamais rencontre de
       moteur d'entrainement : il n'y a rien a generer, et rien a demander. */
    const chezFournisseur = typeof avatarRow.provider_avatar_id === 'string'
      && avatarRow.provider_avatar_id.length > 0;
    if (!chezFournisseur) {
      return NextResponse.json(
        { success: false, error: MESSAGES_GENERATION.aucun_clone, code: 'aucun_clone' },
        { status: 409 },
      );
    }

    // 1. L'avatar est-il pret ? Le fournisseur entraine en asynchrone et
    //    refuse une generation sur un avatar encore en cours. Ce controle est
    //    fait AVANT tout debit : un avatar pas pret ne doit jamais consommer
    //    de credits, meme rembourses ensuite. C'est un appel de STATUT, pas
    //    une generation — et il n'a lieu que s'il y a quelque chose a demander.
    const isVideoAvatar = avatarRow.avatar_type === 'video';

    if (interrogerLeFournisseur(avatarRow)) {
      const training = await getAvatarTrainingStatus(avatarRow.provider_avatar_id);
      const remoteStatus = training?.status ?? null;
      console.log(
        `[Avatar] Avatar ${avatarRow.provider_avatar_id} (${avatarRow.avatar_type ?? 'photo'}) — statut local "${avatarRow.status}", statut HeyGen "${remoteStatus ?? 'inconnu'}"`,
      );

      if (remoteStatus && remoteStatus !== avatarRow.status) {
        const patch: Record<string, unknown> = { status: remoteStatus };
        if (remoteStatus === 'failed' && training?.error) patch.training_error = training.error;
        await supabaseAdmin.from('user_avatars').update(patch).eq('id', avatarRow.id);
        avatarRow.status = remoteStatus;
      }

      if (remoteStatus === 'failed') {
        const detail = training?.error ? ` (${training.error})` : '';
        return NextResponse.json(
          {
            success: false,
            error: `L'entrainement de votre avatar a echoue chez HeyGen${detail}. Renvoyez ${isVideoAvatar ? 'une video' : 'une photo'}.`,
            code: 'avatar_failed',
          },
          { status: 409 },
        );
      }
      if (remoteStatus === 'pending_consent') {
        return NextResponse.json(
          {
            success: false,
            error:
              "HeyGen attend une validation de consentement sur cet avatar. Verifiez votre compte HeyGen pour la finaliser.",
            code: 'avatar_pending_consent',
          },
          { status: 409 },
        );
      }
    }

    /* ⚠️ LE PORTAIL — pur, verifiable sur des valeurs. `apercuOccupe` n'est lu
       que pour un apercu ; c'est l'index unique qui garantit, cette lecture
       ne fait que nommer le refus dans le cas deja connu. */
    const occupe = intention === INTENTION_APERCU
      ? await apercuOccupe(userId, avatarRow.id, avatarRow.version)
      : false;
    const verdict = generationPossible({ avatar: avatarRow, intention, apercuOccupe: occupe });
    if (!verdict.ok) {
      return NextResponse.json(
        {
          success: false,
          error: verdict.motif === 'entrainement_en_cours'
            ? (isVideoAvatar
              ? "Votre avatar video est encore en cours d'entrainement. Cela peut prendre plusieurs minutes."
              : 'Votre avatar est encore en cours de preparation. Reessayez dans une minute.')
            : MESSAGES_GENERATION[verdict.motif],
          code: verdict.motif === 'entrainement_en_cours' ? 'avatar_not_ready' : verdict.motif,
        },
        { status: 409 },
      );
    }

    // 2. La reservation — PREMIERE ecriture, AVANT tout appel sortant.
    const reservation = await reserverGeneration({
      userId, avatarId: avatarRow.id, version: verdict.version, intention,
      script, voiceId: voiceId ?? null, aspectRatio,
    });
    if (!reservation.ok) {
      if (reservation.motif === 'apercu_deja_reserve') {
        return NextResponse.json(
          {
            success: false,
            error: MESSAGES_GENERATION.apercu_deja_produit,
            code: 'apercu_deja_produit',
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { success: false, error: 'La generation n’a pas pu etre enregistree. Reessayez.' },
        { status: 500 },
      );
    }
    reservationId = reservation.id;

    // 3. Voix — OBLIGATOIRE. HeyGen l'a confirme explicitement :
    //    "voice_id is required: this avatar has no default voice configured".
    //    resolveVoiceId() garantit une valeur (liste HeyGen, puis env, puis
    //    constante documentee).
    const resolvedVoiceId = await resolveVoiceId(voiceId);
    console.log(
      `[Avatar][HeyGen] Requete a envoyer — intention=${intention} avatar_id=${avatarRow.provider_avatar_id} voice_id=${resolvedVoiceId} ratio=${aspectRatio} script=${script.length} car.`,
    );

    // 4. Solde
    const credits = await getUserCredits(userId);
    if (credits < AVATAR_VIDEO_COST) {
      await echouerGeneration(reservationId, 'Credits insuffisants.');
      reservationId = null;
      return NextResponse.json(
        {
          success: false,
          error: `Credits insuffisants. Requis : ${AVATAR_VIDEO_COST}, disponible : ${credits}.`,
          code: 'insufficient_credits',
        },
        { status: 402 },
      );
    }

    // 5. Debit avant appel externe
    await deductCredits(userId, AVATAR_VIDEO_COST, 'avatar');
    creditsDeducted = true;

    // 6. Fournisseur
    const { videoId, status } = await generateAvatarVideo({
      avatarId: avatarRow.provider_avatar_id,
      script,
      voiceId: resolvedVoiceId,
      aspectRatio,
    });

    const confirmee = await confirmerGeneration(reservationId, {
      providerVideoId: videoId,
      status: status === 'completed' ? 'processing' : 'pending',
      creditsCharged: AVATAR_VIDEO_COST,
    });
    if (!confirmee) {
      // La video est lancee et facturee chez le fournisseur : on ne rembourse
      // pas, mais on trace pour pouvoir la retrouver manuellement.
      console.error(
        `[Avatar] Generation lancee (video ${videoId}) mais mise a jour de ${reservationId} echouee pour ${userId}`,
      );
      return NextResponse.json(
        { success: false, error: 'Generation lancee mais non enregistree. Contactez le support.' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        generationId: reservationId,
        intention,
        status: status === 'completed' ? 'processing' : 'pending',
        creditsCharged: AVATAR_VIDEO_COST,
      },
    });
  } catch (error) {
    // La reservation n'a pas abouti : elle devient `failed`, ce qui libere la
    // place d'apercu et laisse une trace de la tentative.
    if (reservationId) {
      const message = error instanceof HeyGenError ? error.message : 'La generation a echoue.';
      await echouerGeneration(reservationId, message);
    }

    // Remboursement systematique si les credits ont ete debites et que la
    // generation n'a pas demarre.
    if (creditsDeducted) {
      try {
        await addCredits(userId, AVATAR_VIDEO_COST, 'refund');
        console.log(`[Avatar] ${AVATAR_VIDEO_COST} credits rembourses a ${userId}`);
      } catch (refundError) {
        console.error('[Avatar] REMBOURSEMENT ECHOUE pour', userId, refundError);
      }
    }

    if (error instanceof HeyGenError) {
      // Le corps brut a deja ete journalise par heygenFetch ; on trace ici le
      // contexte applicatif pour relier les deux dans les logs Coolify.
      console.error(
        `[Avatar][HeyGen] Generation refusee pour ${userId} — code=${error.code} http=${error.httpStatus} : ${error.message}`,
      );
      return NextResponse.json(
        { success: false, error: error.message, code: error.code, refunded: creditsDeducted },
        { status: error.httpStatus },
      );
    }
    console.error('[Avatar] Generate failed:', error);
    return NextResponse.json(
      { success: false, error: 'La generation a echoue.', refunded: creditsDeducted },
      { status: 500 },
    );
  }
}
