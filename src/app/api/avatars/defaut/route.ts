/** POST /api/avatars/defaut — { avatarId } devient l'avatar utilisé par défaut. */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { definirParDefaut } from '@/lib/avatar/versions';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  let avatarId: unknown = null;
  try { avatarId = ((await req.json()) as { avatarId?: unknown } | null)?.avatarId ?? null; } catch { avatarId = null; }
  if (typeof avatarId !== 'string' || !UUID.test(avatarId)) {
    return NextResponse.json({ success: false, error: 'Avatar introuvable.' }, { status: 404 });
  }
  const ok = await definirParDefaut(session.user.id, avatarId);
  if (!ok) return NextResponse.json({ success: false, error: 'Avatar introuvable.' }, { status: 404 });
  return NextResponse.json({ success: true, data: { avatarId } });
}
