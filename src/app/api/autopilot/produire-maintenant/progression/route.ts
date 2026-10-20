/**
 * Progression de « Produire maintenant » : étape et pourcentage RÉELS du
 * pipeline en cours pour l'utilisateur connecté (`lib/autopilot/progression`).
 * `null` quand rien n'est en cours.
 *
 * `?date=YYYY-MM-DD&time=HH:MM` (facultatif) : le créneau de la production que
 * l'écran SUIT. Sans avatar, l'état vit en mémoire du processus ; s'il n'y est
 * plus (redémarrage), le serveur relit le Calendrier pour CE créneau et répond
 * `manuel: { etat: 'depose', post }` (post relu) ou `manuel: { etat: 'perdue' }`
 * — jamais un ancien dépôt d'une autre production présenté comme celui-ci.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lireProgression, lireResultat } from '@/lib/autopilot/progression';
import {
  suiviProductionJumeau, avancerFileDuCompte, creneauDepuisRequete, jobIdManuel, suiviProductionManuelle,
} from '@/lib/autopilot/suivi-jumeau-manuel';

export const dynamic = 'force-dynamic';

export async function GET(req?: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  let suivi: { date: string; time: string } | null = null;
  try {
    const u = req?.url ? new URL(req.url) : null;
    suivi = u ? creneauDepuisRequete(u.searchParams.get('date'), u.searchParams.get('time')) : null;
  } catch { suivi = null; }
  const progression = lireProgression(userId);
  const resultat = lireResultat(userId);
  // Production AVEC JUMEAU : rien en mémoire, le montage attend en file. On
  // relit son état PROUVÉ (file + post réellement présent dans le Calendrier)
  // et, tant qu'il est en préparation, on fait avancer la file de ce compte.
  let jumeau = null;
  let manuel = null;
  if (!progression && !resultat) {
    jumeau = await suiviProductionJumeau(userId).catch(() => null);
    if (jumeau?.etat === 'en_preparation') avancerFileDuCompte(userId);
    // L'écran suit un créneau PRÉCIS : un dépôt / un échec jumeau d'une AUTRE
    // production (plus ancienne) n'est pas le sien.
    if (suivi && jumeau && jumeau.etat !== 'en_preparation' && jumeau.jobId !== jobIdManuel(userId, suivi.date, suivi.time)) jumeau = null;
    if (suivi && !jumeau) manuel = await suiviProductionManuelle(userId, suivi.date, suivi.time).catch(() => null);
  }
  return NextResponse.json({ success: true, progression, resultat, jumeau, manuel });
}
