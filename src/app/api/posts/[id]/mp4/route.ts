import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { produireMp4DuPost } from '@/lib/rendus/mp4-durable-serveur';

// Hérité de Vercel ; sans effet en auto-hébergé. La conversion est bornée par
// l'échelle ffmpeg partagée (`transcode-to-mp4.ts`).
export const maxDuration = 300;

const STATUTS: Record<string, number> = {
  post_introuvable: 404,
  non_applicable: 200,
  non_confirme: 409,
  occupe: 429,
  telechargement: 502,
  conversion: 500,
  sortie_invalide: 500,
  depot: 500,
  perime: 409,
};

/**
 * POST /api/posts/[id]/mp4 — produit le MP4 DURABLE du montage de ce post.
 *
 * Après la confirmation serveur d'un rendu WebM (`<uid>/rendus/<uuid>.webm`),
 * un vrai MP4 H.264/AAC `+faststart` est déposé à côté (`<uuid>.mp4`) et le
 * post pointe dessus (`renderedVideoUrl`, `mp4Durable: true` — le post reste régénérable).
 *
 * Le corps est ignoré : tout est relu en base sous le compte de la session.
 * La conversion n'écoute PAS l'abandon du client : fermer l'onglet ne
 * l'interrompt pas, le post est mis à jour quand elle aboutit.
 * Un échec laisse le WebM et le signale (`mp4Indisponible`).
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  if (typeof params?.id !== 'string' || !/^[0-9a-zA-Z-]{1,64}$/.test(params.id)) {
    return NextResponse.json({ ok: false, motif: 'post_introuvable' }, { status: 404 });
  }
  try {
    const issue = await produireMp4DuPost(userId, params.id);
    if (issue.ok) return NextResponse.json(issue);
    return NextResponse.json(issue, {
      status: STATUTS[issue.motif] ?? 500,
      ...(issue.motif === 'occupe' ? { headers: { 'Retry-After': '30' } } : {}),
    });
  } catch (err) {
    console.error('[MP4-DURABLE] inattendu', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, motif: 'conversion' }, { status: 500 });
  }
}
