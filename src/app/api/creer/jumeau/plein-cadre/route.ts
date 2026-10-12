/**
 * POST /api/creer/jumeau/plein-cadre { url, format } — l'URL de jumeau à
 * MONTER : l'original s'il est propre, sinon sa version plein cadre dérivée
 * (bandes incrustées retirées localement, `jumeau-plein-cadre.ts`).
 *
 * Session obligatoire ; le jumeau doit appartenir au compte (sinon 404, rien
 * n'est lu). Aucun appel fournisseur, aucun crédit. Idempotent : la version
 * dérivée est réutilisée d'un montage à l'autre.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { jumeauPleinCadre } from '@/lib/avatar/jumeau-plein-cadre';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  let corps: { url?: unknown; format?: unknown } | null = null;
  try { corps = await req.json(); } catch { corps = null; }
  const url = typeof corps?.url === 'string' && corps.url.length <= 2048 ? corps.url : null;
  if (!url) return NextResponse.json({ success: false, error: 'Requête invalide.' }, { status: 400 });
  const r = await jumeauPleinCadre({ url, userId: session.user.id, format: corps?.format });
  // Refus NEUTRE : ni clé, ni propriétaire — comme un objet absent.
  if (r.statut === 'refus' || !r.url) return NextResponse.json({ success: false, error: 'Média introuvable.' }, { status: 404 });
  return NextResponse.json(
    { success: true, data: { url: r.url, pleinCadre: r.statut === 'derive' || r.statut === 'derive-existant' || r.statut === 'deja-plein-cadre' } },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
