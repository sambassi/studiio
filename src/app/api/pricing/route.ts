import { NextResponse } from 'next/server';
import { getPlans, getPacks } from '@/lib/pricing/fetch';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [plans, packs] = await Promise.all([getPlans(), getPacks()]);
  return NextResponse.json({ plans, packs });
}
