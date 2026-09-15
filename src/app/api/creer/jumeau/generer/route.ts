/**
 * POST /api/creer/jumeau/generer — lancer LA vidéo du jumeau.
 *
 * Corps : `{ textes: string[], aspectRatio?: '9:16'|'16:9'|'1:1' }`. Rien
 * d'autre n'est lu : l'avatar, sa version, la voix, ses prononciations sont
 * relus par le moteur (`genererVideoJumeau`). Réponse : l'identifiant de
 * génération à suivre par GET /api/avatar/status (polling, re-hébergement),
 * ou un refus nommé — 503 moteur inactif, 409 jumeau non prêt, 402 crédits,
 * 502 fournisseur. Jamais un succès sans vidéo lancée.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { genererVideoJumeau } from '@/lib/avatar/moteur-jumeau';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  let textes: string[] = [];
  let aspectRatio: string | undefined;
  try {
    const corps = (await req.json()) as { textes?: unknown; aspectRatio?: unknown } | null;
    if (Array.isArray(corps?.textes)) textes = corps!.textes.filter((t): t is string => typeof t === 'string').slice(0, 20);
    if (typeof corps?.aspectRatio === 'string') aspectRatio = corps.aspectRatio;
  } catch { textes = []; }

  const r = await genererVideoJumeau({ userId: session.user.id, textes, aspectRatio });
  if (r.ok) {
    return NextResponse.json({ success: true, data: { generationId: r.generationId, status: r.status, avatarVersion: r.avatarVersion, dejaEnCours: r.dejaEnCours, spoken: r.spoken } });
  }
  const statut = r.motif === 'moteur_indisponible' ? 503
    : r.motif === 'credits_insuffisants' ? 402
    : r.motif === 'texte_absent' || r.motif === 'texte_trop_long' ? 400
    : r.motif === 'fournisseur_voix' || r.motif === 'fournisseur_avatar' ? 502
    : r.motif === 'base' ? 500
    : 409;
  return NextResponse.json({ success: false, error: r.message, code: r.motif }, { status: statut });
}
