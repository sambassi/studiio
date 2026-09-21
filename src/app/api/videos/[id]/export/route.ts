import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { resolveExportableUrl } from '@/lib/videos/playable-url';

/**
 * URL telechargeable, ou `null`.
 *
 * Une valeur venue de `scheduled_posts.metadata` a ete ecrite par un
 * navigateur : seule une URL absolue `http:` / `https:` est renvoyee au
 * client. Un chemin nu, `javascript:`, `file:` ou une chaine vide valent
 * « rien a exporter ».
 */
function urlTelechargeableOuNull(valeur: unknown): string | null {
  if (typeof valeur !== 'string' || valeur.length === 0) return null;
  try {
    const { protocol } = new URL(valeur);
    return protocol === 'http:' || protocol === 'https:' ? valeur : null;
  } catch {
    return null;
  }
}

// POST /api/videos/[id]/export - Get export URL for a video
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { data: video, error } = await supabase
      .from('videos')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', session.user.id)
      .single();

    if (video && !error) {
      // Montage, puis rush, puis affiche — la cascade vit dans un seul endroit,
      // partage avec la Bibliotheque et le repost.
      const url = resolveExportableUrl(video);

      if (!url) {
        return NextResponse.json({ success: false, error: 'No exportable file found' }, { status: 404 });
      }

      return NextResponse.json({ success: true, url, title: video.title });
    }

    // La Bibliotheque (`GET /api/videos`) fusionne `videos` ET `scheduled_posts` :
    // une video de Serie y porte l'id d'un post. Meme proprietaire, meme
    // reponse. Un post d'un autre compte ou inexistant → 404 identique, sans
    // rien reveler. Priorite : `metadata.renderedVideoUrl` (le montage) puis
    // `media_url`. `metadata.videoUrl` est volontairement ignore : ambigu, il
    // porte le RUSH pour l'editeur avance (voir `lib/videos/playable-url.ts`).
    const { data: post, error: postError } = await supabase
      .from('scheduled_posts')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', session.user.id)
      .single();

    if (postError || !post) {
      return NextResponse.json({ success: false, error: 'Video not found' }, { status: 404 });
    }

    const meta = post.metadata && typeof post.metadata === 'object'
      ? (post.metadata as Record<string, unknown>)
      : {};
    const montage = urlTelechargeableOuNull(meta.renderedVideoUrl);
    // Un post qui n'a qu'une image, et aucun montage, n'est pas une video.
    const postUrl = montage
      ?? (post.media_type === 'video' ? urlTelechargeableOuNull(post.media_url) : null);

    if (!postUrl) {
      return NextResponse.json({ success: false, error: 'No exportable file found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, url: postUrl, title: post.title });
  } catch (error) {
    console.error('Error exporting video:', error);
    return NextResponse.json({ success: false, error: 'Failed to export video' }, { status: 500 });
  }
}
