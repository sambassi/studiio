import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import {
  uploadAsset,
  createPhotoAvatar,
  listVoices,
  pickDefaultVoice,
  HeyGenError,
} from '@/lib/avatar/heygen';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 Mo
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Texte de consentement stocke avec l'avatar — sert de preuve datee. */
const CONSENT_TEXT =
  "Je certifie etre la personne visible sur l'image et j'autorise Studiio a en creer un avatar anime.";

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

    const avatar = avatars?.[0] ?? null;

    // Voix : non bloquant pour l'affichage, mais on renvoie explicitement une
    // voix par defaut. L'UI ne doit jamais proposer un choix "vide" : un
    // voice_id absent ou vide fait echouer /v3/videos en 400.
    const allVoices = await listVoices();
    const voices = allVoices
      .filter((v) => {
        const lang = (v.language || '').toLowerCase();
        return !lang || lang.startsWith('fr') || lang.startsWith('en');
      })
      .slice(0, 60);

    const defaultVoiceId = pickDefaultVoice(voices)?.voiceId ?? null;

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
 * POST /api/avatar/create — cree l'avatar HeyGen a partir d'une photo.
 *
 * Consentement OBLIGATOIRE : sans `consent=true`, la requete est refusee avant
 * tout appel a HeyGen. On ne cree un avatar que de sa propre personne.
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
            "Le consentement est obligatoire : vous devez certifier etre la personne sur l'image.",
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

    if (file.type.startsWith('video/')) {
      // Scope assume : l'avatar HeyGen v3 se cree a partir d'une image fixe.
      // Creer un avatar depuis une video releve d'un autre produit HeyGen
      // (avatar video/instant), non implemente ici.
      return NextResponse.json(
        {
          success: false,
          error:
            "Pour l'instant, l'avatar se cree a partir d'une photo (JPG, PNG ou WebP). Extrayez une image nette de votre visage depuis votre video.",
        },
        { status: 400 },
      );
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
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

    const buffer = Buffer.from(await file.arrayBuffer());

    // 1. Copie de l'image source sur notre stockage (tracabilite du consentement).
    //    Non bloquant : si le stockage echoue, on cree quand meme l'avatar.
    let sourceUrl: string | null = null;
    try {
      const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
      const storagePath = `${userId}/avatar/source-${Date.now()}.${ext}`;
      const { error: upErr } = await supabaseAdmin.storage
        .from('media')
        .upload(storagePath, buffer, { contentType: file.type, upsert: true });
      if (!upErr) {
        const { data: pub } = supabaseAdmin.storage.from('media').getPublicUrl(storagePath);
        sourceUrl = pub?.publicUrl ?? null;
      } else {
        console.warn('[Avatar] Source image upload failed:', upErr.message);
      }
    } catch (e) {
      console.warn('[Avatar] Source image upload threw:', e);
    }

    // 2. Upload chez HeyGen puis creation de l'avatar photo.
    const asset = await uploadAsset(new Blob([buffer], { type: file.type }), file.name || 'photo.jpg');
    const avatar = await createPhotoAvatar(asset.assetId, name);

    // 3. Persistance (un avatar par utilisateur : on remplace le precedent).
    await supabaseAdmin.from('user_avatars').delete().eq('user_id', userId);

    const { data: row, error: insertError } = await supabaseAdmin
      .from('user_avatars')
      .insert({
        user_id: userId,
        provider: 'heygen',
        provider_avatar_id: avatar.avatarId,
        provider_asset_id: asset.assetId,
        name,
        status: avatar.status,
        source_url: sourceUrl,
        consent_at: new Date().toISOString(),
        consent_text: CONSENT_TEXT,
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
