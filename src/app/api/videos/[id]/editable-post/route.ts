import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { resolveExportableUrl } from '@/lib/videos/playable-url';
import { buildEditablePostRow, parisToday, pickLinkedPost } from '@/lib/videos/editable-post';

/**
 * POST /api/videos/[id]/editable-post — le post modifiable d'une vidéo.
 *
 * Renvoie le `scheduled_posts` relié à la vidéo (`video_id`), et le crée s'il
 * n'existe pas. Appelé par le bouton « Modifier » de la Bibliothèque, après
 * confirmation explicite de l'utilisateur.
 *
 * Garanties :
 * - owner-scopé : la vidéo ET le post sont lus avec `user_id` de la session ;
 * - idempotent : un post relié existant est renvoyé tel quel, sans écriture ;
 * - au plus UN post : sans contrainte d'unicité en base, deux requêtes
 *   concurrentes peuvent insérer chacune le sien. Après l'insert, chacune relit
 *   les posts reliés et désigne le même gagnant (`pickLinkedPost`,
 *   déterministe) ; celle qui a perdu supprime SA ligne, et seulement elle ;
 * - la vidéo n'est jamais modifiée (contrairement à `repost`, qui la passe en
 *   `published`) ; aucun rendu, aucun crédit, aucun fournisseur.
 */

async function linkedPosts(videoId: string, userId: string) {
  const { data, error } = await supabase
    .from('scheduled_posts')
    .select('id, created_at')
    .eq('video_id', videoId)
    .eq('user_id', userId);
  if (error) throw error;
  return (data ?? []) as { id: string; created_at: string | null }[];
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { data: video } = await supabase
      .from('videos')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', userId)
      .maybeSingle();
    if (!video) {
      return NextResponse.json({ success: false, error: 'Video not found' }, { status: 404 });
    }

    const existing = pickLinkedPost(await linkedPosts(video.id, userId));
    if (existing) {
      return NextResponse.json({ success: true, postId: existing.id, created: false });
    }

    const row = buildEditablePostRow(video, userId, parisToday(), resolveExportableUrl(video));
    const { data: created, error: insertError } = await supabase
      .from('scheduled_posts')
      .insert(row)
      .select('id')
      .single();
    if (insertError || !created) throw insertError ?? new Error('insert sans ligne');

    const winner = pickLinkedPost(await linkedPosts(video.id, userId));
    if (winner && winner.id !== created.id) {
      // Une requête concurrente a gagné : on retire NOTRE ligne, rien d'autre.
      await supabase.from('scheduled_posts').delete().eq('id', created.id).eq('user_id', userId);
      return NextResponse.json({ success: true, postId: winner.id, created: false });
    }

    return NextResponse.json({ success: true, postId: created.id, created: true });
  } catch (error) {
    console.error('Error creating editable post from video:', error);
    return NextResponse.json({ success: false, error: 'Failed to create editable post' }, { status: 500 });
  }
}
