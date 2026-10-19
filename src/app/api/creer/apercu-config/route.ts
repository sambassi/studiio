import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { apercuPlanActif } from '@/lib/creer/apercu-plan-config';
import { politiquePourRole } from '@/lib/facturation/politique';

/**
 * M3-a PR3 — l'APERÇU RAPIDE du plan de montage est-il proposé à ce compte ?
 *
 * Vrai SEULEMENT si : session ; interrupteur serveur
 * `STUDIIO_APERCU_PLAN_ENABLED` exactement `"true"` ; rôle `admin` relu EN
 * BASE (jamais la session, jamais la liste d'e-mails). Toute erreur ⇒ `false`.
 *
 * Route sœur de `/api/creer/montage-config` (qui reste `{ passages }` seule).
 * L'aperçu rapide ne fait que du calcul local et des GET de médias : la route
 * n'autorise que son AFFICHAGE, elle ne touche ni crédits ni rendu. Aucun
 * corps ni paramètre n'est lu. Réponse : `{ apercuPlan }`, jamais mise en cache.
 */
export const dynamic = 'force-dynamic';

const repondre = (apercuPlan: boolean) =>
  NextResponse.json({ apercuPlan }, { headers: { 'Cache-Control': 'private, no-store' } });

export async function GET() {
  try {
    const session = await auth();
    const id = session?.user?.id;
    if (!id) return repondre(false);
    if (!apercuPlanActif()) return repondre(false);
    const { data, error } = await supabaseAdmin.from('users').select('role').eq('id', id).maybeSingle();
    if (error || !data) return repondre(false);
    return repondre(politiquePourRole((data as { role?: unknown }).role) === 'partner_cost_only');
  } catch {
    return repondre(false);
  }
}
