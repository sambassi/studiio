/**
 * GET /api/cron/providers-health — santé du FINANCEMENT des fournisseurs.
 *
 * Planifié (Coolify Scheduled Task, `Authorization: Bearer CRON_SECRET`,
 * toutes les 15 min recommandé) :
 *   1. lit le solde de chaque fournisseur qui l'expose officiellement
 *      (lecture seule — Studiio ne déclenche JAMAIS de paiement) ; alertes
 *      INFO (recharge constatée) / WARNING (solde faible) / CRITICAL ;
 *   2. reprend les générations d'avatar EN ATTENTE du fournisseur dont le
 *      solde est revenu — sans navigateur ouvert (reprise unique, atomique).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/db/supabase';
import { isCronAuthorized } from '@/lib/cron/auth';
import { CAPACITES, FOURNISSEURS_SURVEILLES, verifierFournisseur } from '@/lib/fournisseurs/sante';
import { PREFIXE_ATTENTE } from '@/lib/avatar/attente-fournisseur';
import { reprendreGenerationEnAttente } from '@/lib/avatar/moteur-jumeau';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Reprises par passage : borné, pour ne pas lancer une rafale de vidéos d'un coup. */
const REPRISES_PAR_PASSAGE = 10;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const soldes: Record<string, unknown> = {};
  for (const id of FOURNISSEURS_SURVEILLES) {
    if (!CAPACITES[id].soldeApi) { soldes[id] = 'non mesurable'; continue; }
    try {
      const etat = await verifierFournisseur(id);
      soldes[id] = etat ? { statut: etat.statut, solde: etat.solde, devise: etat.devise } : 'vérification déjà en cours';
    } catch (e) {
      soldes[id] = { erreur: e instanceof Error ? e.message : String(e) };
    }
  }

  const reprises: Record<string, string> = {};
  const { data: enAttente, error } = await supabaseAdmin
    .from('avatar_generations')
    .select('*')
    .eq('status', 'pending')
    .is('provider_video_id', null)
    .like('provider_error', `${PREFIXE_ATTENTE}%`)
    .order('created_at', { ascending: true })
    .limit(REPRISES_PAR_PASSAGE);
  if (!error) {
    for (const ligne of (enAttente ?? []) as Array<Parameters<typeof reprendreGenerationEnAttente>[0]>) {
      try {
        reprises[ligne.id] = await reprendreGenerationEnAttente(ligne);
      } catch (e) {
        reprises[ligne.id] = `erreur : ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  }

  console.log('[Cron/Fournisseurs]', JSON.stringify({ soldes, reprises }));
  return NextResponse.json({ success: true, soldes, reprises, lectureAttente: error ? error.message : 'ok' });
}
