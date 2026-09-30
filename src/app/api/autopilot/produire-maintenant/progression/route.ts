/**
 * Progression de « Produire maintenant » : étape et pourcentage RÉELS du
 * pipeline en cours pour l'utilisateur connecté (`lib/autopilot/progression`).
 * `null` quand rien n'est en cours.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lireProgression, lireResultat } from '@/lib/autopilot/progression';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ success: true, progression: lireProgression(userId), resultat: lireResultat(userId) });
}
