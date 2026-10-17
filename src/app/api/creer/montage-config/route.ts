import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { montagePassagesActif } from '@/lib/creer/montage-passages-config';
import { politiqueDeLUtilisateur, politiquePourRole } from '@/lib/facturation/politique';

/**
 * M3-a PR2 — la méthode B (« passages ») peut-elle être PROPOSÉE à ce compte ?
 *
 * Vrai SEULEMENT si : session ; interrupteur serveur
 * `STUDIIO_MONTAGE_PASSAGES_ENABLED` exactement `"true"` ; rôle `admin` relu EN
 * BASE (jamais la liste d'e-mails, jamais la session) ; ET le compte est
 * `partner_cost_only` pour la facturation (invariant : B n'est montré qu'à un
 * compte qui ne consomme aucun crédit commercial). Toute erreur ⇒ `false`.
 *
 * Ce n'est PAS une frontière de sécurité : le plan B est calculé dans le
 * navigateur, sur les rushes du compte. La route n'autorise que l'AFFICHAGE du
 * choix ; la facturation reste décidée par le serveur à la réservation et à la
 * confirmation du rendu, qui ne reçoivent jamais la méthode. Aucun corps ni
 * paramètre n'est lu. Réponse : `{ passages }` seule, jamais mise en cache.
 */
export const dynamic = 'force-dynamic';

const repondre = (passages: boolean) =>
  NextResponse.json({ passages }, { headers: { 'Cache-Control': 'private, no-store' } });

export async function GET() {
  try {
    const session = await auth();
    const id = session?.user?.id;
    if (!id) return repondre(false);
    if (!montagePassagesActif()) return repondre(false);
    const { data, error } = await supabaseAdmin.from('users').select('role').eq('id', id).maybeSingle();
    if (error || !data || politiquePourRole((data as { role?: unknown }).role) !== 'partner_cost_only') return repondre(false);
    const { politique } = await politiqueDeLUtilisateur(id);
    return repondre(politique === 'partner_cost_only');
  } catch {
    return repondre(false);
  }
}
