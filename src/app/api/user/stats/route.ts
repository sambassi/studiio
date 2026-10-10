import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';

/**
 * Compteurs du tableau de bord, pour le compte connecte uniquement.
 *
 * - `videos`    : lignes de `videos` appartenant a l'utilisateur ;
 * - `published` : `scheduled_posts` au statut `published` ;
 * - `scheduled` : `scheduled_posts` au statut `scheduled` (a venir).
 *
 * Requetes `head: true` : on ne lit que le nombre, jamais les lignes.
 * En cas d'echec, on renvoie `null` et non `0` : un zero invente ferait
 * croire a un compte vide.
 */
export async function GET(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const compter = (table: 'videos' | 'scheduled_posts', statut?: string) => {
      let q = supabaseAdmin
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);
      if (statut) q = q.eq('status', statut);
      return q;
    };

    const [videos, published, scheduled] = await Promise.all([
      compter('videos'),
      compter('scheduled_posts', 'published'),
      compter('scheduled_posts', 'scheduled'),
    ]);

    const valeur = (r: { count: number | null; error: unknown }) =>
      r.error || typeof r.count !== 'number' ? null : r.count;

    return NextResponse.json({
      ok: true,
      videos: valeur(videos),
      published: valeur(published),
      scheduled: valeur(scheduled),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'failed';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
