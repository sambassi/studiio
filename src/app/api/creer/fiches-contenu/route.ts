import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { fichesContenuServeur } from '@/lib/creer/fiche-contenu-serveur';

/**
 * M2-a — Fiches de contenu des rushes du compte —
 * `GET /api/creer/fiches-contenu?url=<rush>&url=<rush>` (≤ 12).
 *
 * Le PROPRIÉTAIRE est celui de la session : chaque URL passe la garde de
 * lecture au nom de ce compte (`classerUrlLecture`), et la clé de la fiche est
 * dérivée côté serveur. Une URL d'un autre compte rend `fiche: null` — rien
 * n'est lu. Consultatif : jamais lu par le rendu ; aucune IA, aucun appel
 * hors MinIO. Lecture du cache d'abord : la 2e ouverture ne recalcule rien.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_URLS = 12;

export async function GET(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const urls = new URL(req.url).searchParams.getAll('url')
    .filter((u) => typeof u === 'string' && u.length > 0 && u.length <= 2048)
    .slice(0, MAX_URLS);
  if (!urls.length) return NextResponse.json({ success: true, fiches: [] });
  const fiches = await fichesContenuServeur(urls, userId, { delaiMs: 6000 });
  return NextResponse.json({ success: true, fiches });
}
