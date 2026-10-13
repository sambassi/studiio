/**
 * Progression de « Produire maintenant » : étape et pourcentage RÉELS du
 * pipeline en cours pour l'utilisateur connecté (`lib/autopilot/progression`).
 * `null` quand rien n'est en cours.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lireProgression, lireResultat } from '@/lib/autopilot/progression';
import { suiviProductionJumeau, avancerFileDuCompte } from '@/lib/autopilot/suivi-jumeau-manuel';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const progression = lireProgression(userId);
  const resultat = lireResultat(userId);
  // Production AVEC JUMEAU : rien en mémoire, le montage attend en file. On
  // relit son état PROUVÉ (file + post réellement présent dans le Calendrier)
  // et, tant qu'il est en préparation, on fait avancer la file de ce compte.
  let jumeau = null;
  if (!progression && !resultat) {
    jumeau = await suiviProductionJumeau(userId).catch(() => null);
    if (jumeau?.etat === 'en_preparation') avancerFileDuCompte(userId);
  }
  return NextResponse.json({ success: true, progression, resultat, jumeau });
}
