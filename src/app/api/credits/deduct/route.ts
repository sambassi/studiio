import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { deductCredits } from '@/lib/credits/guard';

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { cost, reason, format } = await req.json();
    const n = Number(cost) || 0;
    if (n <= 0) return NextResponse.json({ ok: false, error: 'invalid cost' }, { status: 400 });
    const result = await deductCredits(session.user.id, n, reason || `render:${format || 'reel'}`);
    return NextResponse.json(result, { status: result.ok ? 200 : 402 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'deduct failed' }, { status: 500 });
  }
}
