import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { estModeDemonstration } from '@/lib/apercu/mode-demo';

/**
 * `GET /api/mode` — la base servie est-elle une base de prévisualisation ?
 *
 * Les écrans sont rendus par le navigateur : ils ne peuvent pas lire
 * `process.env`. Cette route leur dit, en un booléen, s'ils doivent afficher
 * le bandeau « données fictives ».
 *
 * Session exigée — un visiteur anonyme n'a rien à apprendre de la
 * configuration du serveur. Et en production la réponse est toujours `false`,
 * par construction (`estModeDemonstration`).
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json(
    { success: true, demonstration: estModeDemonstration() },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
