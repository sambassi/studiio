/**
 * POST /api/avatars/versions/:versionId — { action, jeton? }
 * Voir `executerActionVersion` : synchroniser, apercu, utiliser, garder, revenir.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { executerActionVersion, ACTIONS_VERSION, type ActionVersion } from '@/lib/avatar/actions-version';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { versionId: string } }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  type Corps = { action?: unknown; jeton?: unknown };
  let corps: Corps | null = null;
  try { corps = (await req.json()) as Corps | null; } catch { corps = null; }
  const action = corps?.action;
  if (typeof action !== 'string' || !(ACTIONS_VERSION as readonly string[]).includes(action)) {
    return NextResponse.json({ success: false, error: 'Action inconnue.' }, { status: 400 });
  }
  const r = await executerActionVersion(session.user.id, action as ActionVersion, params.versionId, corps?.jeton ?? null);
  if (r.ok) return NextResponse.json({ success: true, data: r.data }, { headers: { 'Cache-Control': 'private, no-store' } });
  return NextResponse.json({ success: false, error: r.message, code: r.code }, { status: r.statut });
}
