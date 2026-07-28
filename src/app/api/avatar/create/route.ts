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

/** Textes de consentement stockes avec l'avatar — preuve datee. */
const CONSENT_TEXT: Record<AvatarKind, string> = {
  photo:
    "Je certifie etre la personne visible sur l'image et j'autorise Studiio a en creer un avatar anime.",
  video:
    "Je certifie etre la personne visible dans la video et j'autorise Studiio et HeyGen a l'utiliser pour entrainer un avatar a mon effigie.",
};

/** Statuts HeyGen consideres comme « avatar utilisable ». */
const READY_STATUSES = ['completed', 'ready', 'success'];

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
      .order('created_at', { ascending: false })
      .limit(1);

    let avatar = avatars?.[0] ?? null;

    // Entrainement en cours ? On rafraichit le statut depuis HeyGen a chaque
    // consultation, ce qui permet a l'UI de simplement re-interroger cette
    // route pour suivre l'avancement — sans route supplementaire.
    if (avatar && !READY_STATUSES.includes(avatar.status)) {
      const training = await getAvatarTrainingStatus(avatar.provider_avatar_id);
      if (training && training.status !== avatar.status) {
        const patch: Record<string, unknown> = { status: training.status };
        if (training.status === 'failed' && training.error) {
          patch.training_error = training.error;
        }
        const { data: updated } = await supabaseAdmin
          .from('user_avatars')
          .update(patch)
          .eq('id', avatar.id)
          .select()
          .single();
        if (updated) avatar = updated;
        console.log(
          `[Avatar][HeyGen] Statut d'entrainement resynchronise pour ${avatar.provider_avatar_id}: ${training.status}`,
        );
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

    // 1. Copie du fichier source sur notre stockage (tracabilite du consentement).
    //    Non bloquant : si le stockage echoue, on cree quand meme l'avatar.
    let sourceUrl: string | null = null;
    try {
      const extByType: Record<string, string> = {
        'image/png': 'png',
        'image/webp': 'webp',
        'image/jpeg': 'jpg',
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'video/quicktime': 'mov',
      };
      const ext = extByType[file.type] ?? (isVideo ? 'mp4' : 'jpg');
      const storagePath = `${userId}/avatar/source-${Date.now()}.${ext}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from('media')
        .upload(storagePath, buffer, { contentType: file.type, upsert: true });
      if (!upErr) {
        const { data: pub } = supabaseAdmin.storage.from('media').getPublicUrl(storagePath);
        sourceUrl = pub?.publicUrl ?? null;
      } else {
        console.warn('[Avatar] Source upload failed:', upErr.message);
      }
    } catch (e) {
      console.warn('[Avatar] Source upload threw:', e);
    }

    // 2. Upload chez HeyGen puis creation de l'avatar (photo ou digital twin).
    const fallbackName = isVideo ? 'video.mp4' : 'photo.jpg';
    const asset = await uploadAsset(
      new Blob([buffer], { type: file.type }),
      file.name || fallbackName,
    );
    const avatar = await createAvatarFromAsset(asset.assetId, name, kind);

    // 3. Persistance (un avatar par utilisateur : on remplace le precedent).
    await supabaseAdmin.from('user_avatars').delete().eq('user_id', userId);

    const { data: row, error: insertError } = await supabaseAdmin
      .from('user_avatars')
      .insert({
        user_id: userId,
        provider: 'heygen',
        avatar_type: kind,
        provider_avatar_id: avatar.avatarId,
        provider_asset_id: asset.assetId,
        name,
        status: avatar.status,
        source_url: sourceUrl,
        consent_at: new Date().toISOString(),
        consent_text: CONSENT_TEXT[kind],
      })
      .select()
      .single();

    if (insertError) {
      console.error('[Avatar] Insert failed:', insertError);
      return NextResponse.json(
        { success: false, error: "Avatar cree chez HeyGen mais non enregistre. Reessayez." },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, data: { avatar: row } });
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
