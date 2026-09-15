import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import {
  uploadAsset,
  createAvatarFromAsset,
  getAvatarTrainingStatus,
  listVoices,
  pickDefaultVoice,
  HeyGenError,
  HEYGEN_ASSET_MAX_BYTES,
  type AvatarKind,
} from '@/lib/avatar/heygen';
import { CONSENTEMENT_ENROLEMENT, ETAT_SOURCE_PRETE, SUJET_AVATAR } from '@/lib/avatar/contrat';
import {
  BUCKET_AVATAR, cleSourceAvatar, cleSourceDepuisUrlLegacy, retirerSourceAvatar,
} from '@/lib/avatar/source';
import { commencerNouvelleVersionAvatar } from '@/lib/avatar/version';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 Mo
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Formats video. MP4 et WebM sont les seuls documentes comme supportes par
 * HeyGen ; QuickTime (.mov) est accepte ici et transmis tel quel — si HeyGen
 * le refuse, son message reel remonte desormais jusqu'a l'utilisateur.
 */
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

/**
 * Textes de consentement stockes avec l'avatar — preuve datee. Les textes
 * vivent dans le contrat (`CONSENTEMENT_ENROLEMENT`), mot pour mot ceux
 * d'origine, avec la version que `consent_version` enregistre.
 */
const CONSENT_TEXT: Record<AvatarKind, string> = CONSENTEMENT_ENROLEMENT.textes;

/** La ligne rendue a la page, sans `source_url` : la source se lit par `/api/avatar/source`. */
function sansSourceUrl(avatar: Record<string, unknown>): Record<string, unknown> {
  const { source_url: _sourceUrl, ...reste } = avatar;
  void _sourceUrl;
  return reste;
}

/** Statuts HeyGen consideres comme « avatar utilisable ». */
const READY_STATUSES = ['completed', 'ready', 'success'];

/** Ce que les routes lisent d'un avatar vivant. */
interface AvatarVivant {
  id: string;
  version: number;
  source_object_key: string | null;
  source_url: string | null;
  status: string;
  provider_avatar_id: string | null;
  provider_asset_id: string | null;
  training_error: string | null;
  [colonne: string]: unknown;
}

/**
 * L'avatar VIVANT du compte — ou la preuve qu'on ne sait pas.
 *
 * ⚠️ Une erreur de lecture n'est PAS « aucun avatar » : sur cette confusion,
 * le POST enverrait une source, insererait, appellerait le fournisseur —
 * pour un compte qui a peut-etre deja tout cela. On rend donc DEUX choses
 * distinctes : `null` (lu, rien), et `ok: false` (pas lu).
 */
async function lireAvatarVivant(
  userId: string,
): Promise<{ ok: true; avatar: AvatarVivant | null } | { ok: false; erreur: string }> {
  const { data, error } = await supabaseAdmin
    .from('user_avatars')
    .select('*')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) return { ok: false, erreur: error.message };
  return { ok: true, avatar: ((data?.[0] as AvatarVivant | undefined) ?? null) };
}

const erreurServeur = (message: string, code: string) =>
  NextResponse.json({ success: false, error: message, code }, { status: 500 });

const conflit = (code: 'avatar_concurrent' | 'avatar_superseded') =>
  NextResponse.json(
    { success: false, error: 'Un autre envoi vient de remplacer votre avatar. Rechargez la page.', code },
    { status: 409 },
  );

/**
 * GET /api/avatar/create — avatar courant de l'utilisateur + voix disponibles.
 * Sert a l'affichage initial de la page : premiere visite (aucun avatar) vs
 * utilisateur deja equipe.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { data: avatars } = await supabaseAdmin
      .from('user_avatars')
      .select('*')
      .eq('user_id', session.user.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1);

    let avatar = avatars?.[0] ?? null;

    // Entrainement en cours ? On rafraichit le statut depuis HeyGen a chaque
    // consultation, ce qui permet a l'UI de simplement re-interroger cette
    // route pour suivre l'avancement — sans route supplementaire.
    // ⚠️ Sans `provider_avatar_id` (source enregistree, fournisseur jamais
    // sollicite ou en echec), il n'y a RIEN a interroger : on n'appelle pas
    // HeyGen avec `null` dans l'URL.
    if (avatar && avatar.provider_avatar_id && !READY_STATUSES.includes(avatar.status)) {
      const training = await getAvatarTrainingStatus(avatar.provider_avatar_id);
      if (training && training.status !== avatar.status) {
        const patch: Record<string, unknown> = { status: training.status };
        if (training.status === 'failed' && training.error) {
          patch.training_error = training.error;
        }
        // ⚠️ LE RESULTAT N'EST ECRIT QUE SUR LA VERSION INTERROGEE. Le
        // remplacement conserve `id` : pendant l'appel HeyGen, le compte a pu
        // passer en version+1 (fournisseur NULL, `source_ready`). Un
        // « completed » pour l'ancien identifiant ne doit jamais se poser sur
        // la nouvelle version. Zero ligne = instantane perime : on relit.
        const { data: touchees, error: erreurSync } = await supabaseAdmin
          .from('user_avatars')
          .update(patch)
          .eq('id', avatar.id)
          .eq('version', avatar.version)
          .eq('provider_avatar_id', avatar.provider_avatar_id)
          .is('deleted_at', null)
          .select();
        if (erreurSync) {
          console.warn(`[Avatar][HeyGen] Statut non resynchronise pour ${avatar.provider_avatar_id} : ${erreurSync.message}`);
        } else if (touchees && touchees.length === 1) {
          avatar = touchees[0];
          console.log(
            `[Avatar][HeyGen] Statut d'entrainement resynchronise pour ${avatar.provider_avatar_id}: ${training.status}`,
          );
        } else {
          console.log(`[Avatar][HeyGen] Instantane perime pour ${avatar.provider_avatar_id} : une version plus recente existe, relecture.`);
          const relu = await lireAvatarVivant(session.user.id);
          if (relu.ok) avatar = relu.avatar;
        }
      }
    }

    // Voix : non bloquant pour l'affichage, mais on renvoie explicitement une
    // voix par defaut. L'UI ne doit jamais proposer un choix "vide" : un
    // voice_id absent ou vide fait echouer /v3/videos en 400.
    const allVoices = await listVoices();

    const rank = (v: { language?: string }) => {
      const l = (v.language || '').toLowerCase();
      if (l.startsWith('fr') || l.includes('french')) return 0;
      if (l.startsWith('en') || l.includes('english')) return 1;
      return 2;
    };

    // Voix francaises en tete, puis anglaises, puis le reste : l'utilisateur
    // trouve immediatement une voix pertinente dans le selecteur.
    const voices = [...allVoices].sort((a, b) => rank(a) - rank(b)).slice(0, 80);

    const defaultVoiceId = pickDefaultVoice(voices)?.voiceId ?? null;
    console.log(
      `[Avatar][HeyGen] ${allVoices.length} voix chargees, ${voices.length} exposees, defaut=${defaultVoiceId ?? 'aucun'}`,
    );

    // ⚠️ `source_url` n'est plus renvoyé : c'est un localisateur interne
    // (relais public fermé aux sources), la page lit `/api/avatar/source`.
    // Le seul consommateur de cette réponse est `/dashboard/avatar`.
    if (avatar) avatar = sansSourceUrl(avatar);

    return NextResponse.json({ success: true, data: { avatar, voices, defaultVoiceId } });
  } catch (error) {
    console.error('[Avatar] GET create failed:', error);
    return NextResponse.json(
      { success: false, error: "Impossible de charger l'avatar." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/avatar/create — cree l'avatar HeyGen a partir d'une photo OU d'une
 * video.
 *
 * Le type de fichier determine la nature de l'avatar :
 *   image/* → avatar photo (talking photo), rendu rapide
 *   video/* → avatar video (digital twin), entrainement plus long, plus realiste
 *
 * Consentement OBLIGATOIRE dans les deux cas : sans `consent=true`, la requete
 * est refusee avant tout appel a HeyGen. On ne cree un avatar que de sa propre
 * personne.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const consent = formData.get('consent');
    const name = (formData.get('name') as string | null) || 'Mon avatar';

    if (consent !== 'true') {
      return NextResponse.json(
        {
          success: false,
          error:
            "Le consentement est obligatoire : vous devez certifier etre la personne sur le fichier envoye.",
        },
        { status: 400 },
      );
    }

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'Aucun fichier fourni.' },
        { status: 400 },
      );
    }

    const isVideo = file.type.startsWith('video/');
    const kind: AvatarKind = isVideo ? 'video' : 'photo';

    if (isVideo) {
      if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
        return NextResponse.json(
          { success: false, error: 'Format video non supporte. Utilisez MP4 ou WebM.' },
          { status: 400 },
        );
      }
      // Limite imposee par HeyGen sur POST /v3/assets. Au-dela, HeyGen exige un
      // upload direct par URL presignee, non implemente ici.
      if (file.size > HEYGEN_ASSET_MAX_BYTES) {
        return NextResponse.json(
          {
            success: false,
            error: `Video trop lourde (${Math.round(file.size / 1024 / 1024)} Mo). HeyGen limite l'envoi a 32 Mo — reduisez la duree ou la qualite.`,
          },
          { status: 413 },
        );
      }
    } else {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        return NextResponse.json(
          { success: false, error: 'Format non supporte. Utilisez JPG, PNG ou WebP.' },
          { status: 400 },
        );
      }
      if (file.size > MAX_IMAGE_SIZE) {
        return NextResponse.json(
          { success: false, error: 'Image trop lourde (10 Mo maximum).' },
          { status: 413 },
        );
      }
    }

    console.log(
      `[Avatar][HeyGen] Creation demandee par ${userId} — nature=${kind} type=${file.type} taille=${Math.round(file.size / 1024)} Ko`,
    );

    const buffer = Buffer.from(await file.arrayBuffer());
    const extByType: Record<string, string> = {
      'image/png': 'png',
      'image/webp': 'webp',
      'image/jpeg': 'jpg',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
    };
    const ext = extByType[file.type] ?? (isVideo ? 'mp4' : 'jpg');

    /* ─────────────────────────────────────────────────────────────────────
       AVATAR-2A — REMPLACER SANS EFFACER.

       L'ordre est le contrat :
         C. lire l'avatar VIVANT du compte (et sa source actuelle) ;
         D. construire la nouvelle cle, ici et nulle part ailleurs ;
         E. deposer la nouvelle source — BLOQUANT : sans objet, rien d'autre ;
         F. la transition en base : premiere inscription = insert version 1,
            sinon compare-and-set version -> version+1 sur la MEME ligne
            (`user_avatars.id` conserve, generations conservees) ;
         G. transition refusee (une autre requete a gagne) : retirer MA
            source seulement — jamais celle relue, qui est la gagnante ;
         H. transition reussie : retirer l'ANCIENNE source, apres seulement ;
         I. le fournisseur, APRES la base ; son resultat n'est ecrit que sur
            la version qu'il concerne (`where version = nouvelle`) — une
            reponse tardive ne peut pas ecraser une version plus recente.
       ───────────────────────────────────────────────────────────────────── */

    // C. L'avatar vivant, et la source qu'il designe aujourd'hui.
    //    ⚠️ Une lecture en echec ARRETE tout, avant la moindre ecriture :
    //    « je n'ai pas pu lire » n'est pas « il n'y a rien ».
    const lecture = await lireAvatarVivant(userId);
    if (!lecture.ok) {
      console.error(`[Avatar] Lecture de l'avatar impossible pour ${userId} : ${lecture.erreur}`);
      return erreurServeur("Votre avatar n'a pas pu etre lu. Reessayez.", 'avatar_read_failed');
    }
    const actuel = lecture.avatar;
    const ancienneCle = actuel
      ? (actuel.source_object_key ?? cleSourceDepuisUrlLegacy(actuel.source_url, userId))
      : null;

    // D + E. La nouvelle source, sous sa cle privee.
    const nouvelleCle = cleSourceAvatar(userId, ext);
    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET_AVATAR)
      .upload(nouvelleCle, buffer, { contentType: file.type, upsert: false });
    if (upErr) {
      console.error('[Avatar] Source upload failed:', upErr.message);
      return NextResponse.json(
        { success: false, error: "Votre fichier n'a pas pu etre enregistre. Reessayez." },
        { status: 500 },
      );
    }

    const consentement = {
      consent_at: new Date().toISOString(),
      consent_text: CONSENT_TEXT[kind],
      consent_version: CONSENTEMENT_ENROLEMENT.version,
      subject_type: SUJET_AVATAR,
    };

    /* ── Le nettoyage de MA source, et de rien d'autre ─────────────────────
       `cleConservee` est la cle que la ligne vivante designe MAINTENANT. Si
       on ne peut pas la relire, on ne sait pas laquelle proteger : on ne
       retire RIEN. Un objet orphelin se retrouve ; une source active
       supprimee ne se retrouve pas. */
    const retirerMaSource = async (vivant: AvatarVivant | null): Promise<void> => {
      await retirerSourceAvatar(userId, nouvelleCle, vivant?.source_object_key ?? null);
    };
    const abandonner = async (code: 'avatar_concurrent' | 'avatar_superseded' = 'avatar_concurrent') => {
      const relu = await lireAvatarVivant(userId);
      if (!relu.ok) {
        console.warn(`[Avatar] Nettoyage differe pour ${nouvelleCle} : gagnant inconnu (${relu.erreur}).`);
        return conflit(code);
      }
      await retirerMaSource(relu.avatar);
      return conflit(code);
    };

    // F. La transition.
    let avatarId: string;
    let nouvelleVersion: number;
    if (!actuel) {
      const { data: inseree, error: insertError } = await supabaseAdmin
        .from('user_avatars')
        .insert({
          user_id: userId,
          provider: 'heygen',
          avatar_type: kind,
          provider_avatar_id: null,
          provider_asset_id: null,
          name,
          status: ETAT_SOURCE_PRETE,
          source_object_key: nouvelleCle,
          source_url: null,
          validated_at: null,
          version: 1,
          deleted_at: null,
          training_error: null,
          ...consentement,
        })
        .select('id, version')
        .single();
      if (inseree && !insertError) {
        avatarId = inseree.id;
        nouvelleVersion = inseree.version;
      } else if (insertError?.code === '23505') {
        // L'index « un seul avatar vivant par compte » : une autre premiere
        // inscription a gagne pendant qu'on deposait la source. Certain.
        return abandonner();
      } else {
        // ⚠️ ERREUR INCERTAINE : le serveur a pu commiter avant que la
        // reponse ne se perde. On relit AVANT de toucher au stockage.
        console.error('[Avatar] Insert incertain :', insertError?.message ?? 'reponse vide');
        const relu = await lireAvatarVivant(userId);
        if (!relu.ok) {
          console.warn(`[Avatar] Nettoyage differe pour ${nouvelleCle} : relecture impossible (${relu.erreur}).`);
          return erreurServeur("Votre avatar n'a pas pu etre enregistre. Reessayez.", 'avatar_insert_failed');
        }
        if (relu.avatar && relu.avatar.source_object_key === nouvelleCle && relu.avatar.version === 1) {
          // L'insertion est bien la : on continue comme si elle avait repondu.
          avatarId = relu.avatar.id;
          nouvelleVersion = relu.avatar.version;
        } else if (relu.avatar) {
          return abandonner();
        } else {
          await retirerMaSource(null);
          return erreurServeur("Votre avatar n'a pas pu etre enregistre. Reessayez.", 'avatar_insert_failed');
        }
      }
    } else {
      let transition: Awaited<ReturnType<typeof commencerNouvelleVersionAvatar>>;
      try {
        transition = await commencerNouvelleVersionAvatar({
          userId,
          avatarId: actuel.id,
          versionAttendue: actuel.version,
          complement: {
            source_object_key: nouvelleCle,
            source_url: null,
            avatar_type: kind,
            name,
            ...consentement,
          },
        });
      } catch (erreurCas) {
        // ⚠️ ERREUR INCERTAINE, meme regle : relire avant de nettoyer.
        console.error('[Avatar] Transition incertaine :', erreurCas instanceof Error ? erreurCas.message : String(erreurCas));
        const relu = await lireAvatarVivant(userId);
        if (!relu.ok) {
          console.warn(`[Avatar] Nettoyage differe pour ${nouvelleCle} : relecture impossible (${relu.erreur}).`);
          return erreurServeur("Votre avatar n'a pas pu etre remplace. Reessayez.", 'avatar_replace_failed');
        }
        const v = relu.avatar;
        if (v && v.id === actuel.id && v.version === actuel.version + 1 && v.source_object_key === nouvelleCle) {
          transition = { ok: true, avatar: { id: v.id, user_id: userId, status: v.status, version: v.version, deleted_at: null, source_object_key: v.source_object_key } };
        } else if (v && v.id === actuel.id && v.version === actuel.version && v.source_object_key === actuel.source_object_key) {
          // Rien n'a bouge : notre mutation n'a pas ete appliquee.
          await retirerMaSource(v);
          return erreurServeur("Votre avatar n'a pas pu etre remplace. Reessayez.", 'avatar_replace_failed');
        } else if (v) {
          return abandonner();
        } else {
          await retirerMaSource(null);
          return erreurServeur("Votre avatar n'a pas pu etre remplace. Reessayez.", 'avatar_replace_failed');
        }
      }
      if (!transition.ok) {
        if (transition.motif === 'source_invalide') {
          await retirerMaSource(actuel);
          return erreurServeur('Source invalide.', 'avatar_source_invalid');
        }
        return abandonner();
      }
      avatarId = transition.avatar.id;
      nouvelleVersion = transition.avatar.version;
    }

    // H. L'ancienne source n'a plus de ligne qui la designe : on la retire.
    //    APRES la transition, jamais avant — et jamais la nouvelle.
    if (ancienneCle) await retirerSourceAvatar(userId, ancienneCle, nouvelleCle);

    // I. Le fournisseur, a partir des octets recus (jamais d'une URL).
    //    Son resultat — succes comme echec — n'est ecrit QUE sur la version
    //    qu'il concerne : `where id and version and source_object_key and
    //    deleted_at is null`. Trois issues, tenues STRICTEMENT a part :
    //      - ecrit, 1 ligne          → cette version, a jour ;
    //      - pas d'erreur, 0 ligne   → une version plus recente existe :
    //                                  cette reponse est perimee, 409 ;
    //      - ERREUR de la base       → on ne sait pas : on relit et on
    //                                  reconcilie. Une panne n'est pas une
    //                                  concurrence, et ne se deguise pas en 409.
    const estCetteVersion = (v: AvatarVivant | null) =>
      !!v && v.id === avatarId && v.version === nouvelleVersion && v.source_object_key === nouvelleCle;

    const fallbackName = isVideo ? 'video.mp4' : 'photo.jpg';
    let chezFournisseur: { avatarId: string; assetId: string; status: string };
    try {
      const asset = await uploadAsset(new Blob([buffer], { type: file.type }), file.name || fallbackName);
      const cree = await createAvatarFromAsset(asset.assetId, name, kind);
      chezFournisseur = { avatarId: cree.avatarId, assetId: asset.assetId, status: cree.status };
    } catch (erreurFournisseur) {
      const message = erreurFournisseur instanceof HeyGenError
        ? erreurFournisseur.message
        : "Le fournisseur n'a pas pu creer l'avatar.";
      const { data: marquees, error: erreurMarque } = await supabaseAdmin
        .from('user_avatars')
        .update({ status: 'failed', training_error: message })
        .eq('id', avatarId)
        .eq('version', nouvelleVersion)
        .eq('source_object_key', nouvelleCle)
        .is('deleted_at', null)
        .select('id');
      if (erreurMarque) {
        console.error(`[Avatar] Echec fournisseur non persiste pour ${avatarId} v${nouvelleVersion} : ${erreurMarque.message}`);
        const relu = await lireAvatarVivant(userId);
        if (relu.ok && relu.avatar && !estCetteVersion(relu.avatar)) return conflit('avatar_superseded');
        if (relu.ok && estCetteVersion(relu.avatar) && relu.avatar!.status === 'failed') throw erreurFournisseur;
        return erreurServeur(
          "Le fournisseur a refuse la source et l'echec n'a pas pu etre enregistre. Reessayez.",
          'avatar_failure_persistence_failed',
        );
      }
      if (!marquees || marquees.length === 0) {
        console.warn(`[Avatar] Echec fournisseur perime pour ${avatarId} v${nouvelleVersion} : une version plus recente existe.`);
        return conflit('avatar_superseded');
      }
      throw erreurFournisseur;
    }

    const attendu = {
      provider_avatar_id: chezFournisseur.avatarId,
      provider_asset_id: chezFournisseur.assetId,
      status: chezFournisseur.status,
      training_error: null,
    };
    const { data: rows, error: erreurProvider } = await supabaseAdmin
      .from('user_avatars')
      .update(attendu)
      .eq('id', avatarId)
      .eq('version', nouvelleVersion)
      .eq('source_object_key', nouvelleCle)
      .is('deleted_at', null)
      .select();
    let row: AvatarVivant | undefined = rows?.[0];
    if (erreurProvider) {
      // Le fournisseur a bien cree l'avatar ; la base n'a pas repondu. On
      // relit : ecrit malgre tout, perime, ou vraiment non persiste.
      console.error(`[Avatar] Fournisseur non persiste pour ${avatarId} v${nouvelleVersion} : ${erreurProvider.message}`);
      const relu = await lireAvatarVivant(userId);
      if (!relu.ok) {
        return erreurServeur(
          "Votre avatar a ete cree chez le fournisseur mais n'a pas pu etre enregistre. Reessayez.",
          'avatar_provider_persistence_failed',
        );
      }
      if (relu.avatar && !estCetteVersion(relu.avatar)) return conflit('avatar_superseded');
      if (
        estCetteVersion(relu.avatar)
        && relu.avatar!.provider_avatar_id === attendu.provider_avatar_id
        && relu.avatar!.provider_asset_id === attendu.provider_asset_id
      ) {
        row = relu.avatar!;
      } else {
        return erreurServeur(
          "Votre avatar a ete cree chez le fournisseur mais n'a pas pu etre enregistre. Reessayez.",
          'avatar_provider_persistence_failed',
        );
      }
    } else if (!row) {
      console.warn(`[Avatar] Reponse fournisseur perimee pour ${avatarId} v${nouvelleVersion} : une version plus recente existe.`);
      return conflit('avatar_superseded');
    }

    return NextResponse.json({ success: true, data: { avatar: sansSourceUrl(row) } });
  } catch (error) {
    if (error instanceof HeyGenError) {
      console.error(
        `[Avatar][HeyGen] Creation refusee — code=${error.code} http=${error.httpStatus} : ${error.message}`,
      );
      return NextResponse.json(
        { success: false, error: error.message, code: error.code },
        { status: error.httpStatus },
      );
    }
    console.error('[Avatar] Create failed:', error);
    return NextResponse.json(
      { success: false, error: "La creation de l'avatar a echoue." },
      { status: 500 },
    );
  }
}
