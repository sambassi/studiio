import { NextRequest, NextResponse } from 'next/server';
import { finaliserJumeauxPrets } from '@/lib/autopilot/jumeau-async';

/**
 * FINALISEUR DÉDIÉ DES MONTAGES-JUMEAU — la latence, pas la correction.
 *
 * Le cron horaire de l'Autopilote finalise DÉJÀ les montages dont le jumeau
 * est prêt (c'est le filet de sécurité : tout finit par se rendre en moins
 * d'une heure). Ce point d'entrée existe pour être appelé PLUS SOUVENT — par
 * exemple toutes les 5 minutes — afin qu'un montage lancé par « Produire
 * maintenant » arrive dans le Calendrier peu après la fin de sa génération,
 * pas à la prochaine heure ronde.
 *
 * ⚠️ MÊME AUTHENTIFICATION que les autres crons : `Authorization: Bearer
 * $CRON_SECRET`. Aucun navigateur, aucune session — c'est un déclencheur
 * planifié (tâche Coolify), pas une route d'écran.
 *
 * ⚠️ IL NE FAIT QU'UNE CHOSE : faire avancer les générations en file et rendre
 * celles qui sont prêtes. Il ne décide d'aucun nouveau montage (c'est le rôle
 * du cron horaire) — donc le déclencher souvent ne produit jamais de vidéo en
 * trop, il ne fait qu'accélérer celles déjà lancées.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    // Borné : plusieurs montages peuvent être prêts en même temps, mais chaque
    // rendu coûte du temps — on en rend quelques-uns par passe, le reste au
    // prochain déclenchement.
    const res = await finaliserJumeauxPrets({ max: 4 });
    return NextResponse.json({ success: true, ...res });
  } catch (e) {
    console.error('[Autopilote/Jumeau/Cron]', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: 'Finalisation impossible.' }, { status: 500 });
  }
}
