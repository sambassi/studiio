import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { resolveExportableUrl } from '@/lib/videos/playable-url';
import { buildEditablePostRow, editablePostId, parisToday, pickLinkedPost } from '@/lib/videos/editable-post';

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
 * - au plus UN post, même en concurrence : le post est inséré sous une clé
 *   primaire DÉTERMINISTE (`editablePostId(user, vidéo)`). Deux requêtes
 *   simultanées visent la même clé ; Postgres n'en valide qu'une, l'autre reçoit
 *   `23505` et renvoie la ligne existante. Aucune migration, aucune suppression ;
 * - relu après création : la réponse vient de la base, pas de l'insert ;
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

    const postId = editablePostId(userId, video.id);
    const row = { id: postId, ...buildEditablePostRow(video, userId, parisToday(), resolveExportableUrl(video)) };
    const { error: insertError } = await supabase
      .from('scheduled_posts')
      .insert(row)
      .select('id')
      .single();
    // `23505` : une requête concurrente (double clic, second onglet) a inséré
    // la même clé juste avant — c'est le post qu'on cherchait, pas une erreur.
    const collision = insertError?.code === '23505';
    if (insertError && !collision) throw insertError;

    // Relecture APRÈS création : la base fait foi.
    const winner = pickLinkedPost(await linkedPosts(video.id, userId));
    if (winner) {
      return NextResponse.json({ success: true, postId: winner.id, created: !collision && winner.id === postId });
    }
    // Collision sur une ligne qui n'est plus reliée à la vidéo (son `video_id`
    // a été retiré depuis) : c'est tout de même le post modifiable de CETTE
    // vidéo pour CE compte — on le rend plutôt que d'en créer un autre.
    const { data: propre } = await supabase
      .from('scheduled_posts')
      .select('id')
      .eq('id', postId)
      .eq('user_id', userId)
      .maybeSingle();
    if (propre) return NextResponse.json({ success: true, postId: propre.id, created: false });
    return NextResponse.json({ success: false, error: 'Editable post conflict' }, { status: 409 });
  } catch (error) {
    console.error('Error creating editable post from video:', error);
    return NextResponse.json({ success: false, error: 'Failed to create editable post' }, { status: 500 });
  }
}
