import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { requireCredits } from '@/lib/credits/guard';

export async function GET(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, balance: 0, error: 'Unauthorized' }, { status: 401 });
    }
    const r = await requireCredits(session.user.id, 0);
    return NextResponse.json({ ok: true, balance: r.balance });
  } catch (e: any) {
    return NextResponse.json({ ok: false, balance: 0, error: e?.message || 'failed' }, { status: 500 });
  }
}
