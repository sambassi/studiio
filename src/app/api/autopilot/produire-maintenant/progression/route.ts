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
 *
 * Sans avatar, l'état est AUSSI persistant (`lireProductionDirecte`, ligne
 * `manuel-direct` d'`autopilot_jumeau_attente`) : après un redémarrage, une
 * production vivante (autre processus) se relit comme `progression` — le
 * panneau et le bandeau du Calendrier la suivent —, et son issue (déposée,
 * échouée, interrompue) comme `resultat` pour le créneau SUIVI. `production`
 * (additif) : le créneau de la production en cours, pour qu'un écran qui ne
 * la suivait pas (autre onglet) la retrouve à sa fin.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lireProgression, lireResultat, LIBELLES_ETAPES, type EtapeProduction, type Progression } from '@/lib/autopilot/progression';
import {
  suiviProductionJumeau, avancerFileDuCompte, creneauDepuisRequete, jobIdManuel, suiviProductionManuelle,
  lireProductionDirecte,
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
  let progression: Progression | null = lireProgression(userId);
  let resultat: Record<string, unknown> | null = lireResultat(userId);
  let production: { date: string; time: string } | null = null;
  // Rien en mémoire de CE processus : l'état PERSISTANT de la production sans
  // avatar (redémarrage, autre processus).
  if (!progression && !resultat) {
    const direct = await lireProductionDirecte(userId).catch(() => null);
    if (direct?.etat === 'en_cours') {
      const etape = (Object.keys(LIBELLES_ETAPES).includes(direct.etape) ? direct.etape : 'analyse') as EtapeProduction;
      progression = {
        pourcent: direct.pourcent, etape, libelle: LIBELLES_ETAPES[etape], majA: direct.majA,
        avancement: etape === 'composition' ? direct.avancement : null,
      };
      production = { date: direct.date, time: direct.time };
    } else if (direct && suivi && direct.date === suivi.date && direct.time === suivi.time) {
      // Issue du créneau SUIVI par cet écran — jamais celle d'une autre production.
      resultat = direct.etat === 'depose'
        ? {
          success: true, postId: direct.post.postId, calendrierUrl: '/dashboard/calendar',
          scheduledDate: direct.post.scheduledDate, scheduledTime: direct.post.scheduledTime,
          ...(direct.timezone ? { timezone: direct.timezone } : {}), status: 'draft', platforms: [],
          videoUrl: direct.post.videoUrl, ...(direct.title ? { title: direct.title } : {}),
        }
        : { success: false, error: direct.message, ...(direct.code ? { code: direct.code } : {}) };
    }
  }
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
  return NextResponse.json({ success: true, progression, resultat, jumeau, manuel, ...(production ? { production } : {}) });
}
