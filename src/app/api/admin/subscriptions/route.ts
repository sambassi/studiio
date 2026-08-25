import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';
import { PaginatedResponse, ApiResponse } from '@/lib/types/api';

/**
 * /api/admin/subscriptions — administration des abonnements.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI A CHANGE, ET POURQUOI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Les deux gestionnaires se contentaient d'un `auth()` : ils exigeaient une
 * session, pas un administrateur. Sous le prefixe `/api/admin`, cette
 * nuance donnait a TOUT compte connecte :
 *
 *   - en GET, la liste des abonnements de TOUS les comptes — `user_id`,
 *     `plan`, `status`, `stripe_customer_id`, `stripe_subscription_id`,
 *     sans le moindre filtre de propriete ;
 *   - en PATCH, la modification de N'IMPORTE QUEL abonnement par son `id`,
 *     la aussi sans filtre de propriete.
 *
 * Les deux passent desormais par `requireAdmin()`, le meme helper que les
 * dix-neuf autres routes de `/api/admin`. Aucun second mecanisme
 * d'autorisation n'est introduit : l'identite vient de la session serveur,
 * jamais d'un role, d'un e-mail ou d'un en-tete fourni par le client.
 *
 * Le controle est la PREMIERE instruction de chaque gestionnaire : aucune
 * requete en base, aucune lecture du corps, aucune analyse de la query n'a
 * lieu avant lui. Un non-administrateur ne declenche donc aucun acces aux
 * donnees, et sa reponse est identique qu'il existe des abonnements ou non —
 * rien ne permet d'en deduire l'existence.
 */

export async function GET(req: NextRequest): Promise<NextResponse<PaginatedResponse<any>>> {
  try {
    // Avant tout le reste : ni requete, ni lecture de parametre tant que
    // l'appelant n'est pas un administrateur. 401 sans session, 403 sinon.
    // Le helper renvoie `{ success: false, error }`, qui ne satisfait pas le
    // type de retour `PaginatedResponse` declare ici — c'est vrai de toutes
    // les routes admin, et sans consequence : l'interface teste `res.ok`
    // avant de lire le corps. La double assertion l'assume explicitement,
    // plutot que de laisser trainer une erreur de typage.
    const { error: adminError } = await requireAdmin();
    if (adminError) return adminError as unknown as NextResponse<PaginatedResponse<any>>;

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const offset = (page - 1) * limit;

    const { data, error, count } = await supabase
      .from('subscriptions')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      data: data || [],
      total: count || 0,
      page,
      limit,
      hasMore: offset + limit < (count || 0),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, data: [], total: 0, page: 1, limit: 20, hasMore: false },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest): Promise<NextResponse<ApiResponse<any>>> {
  try {
    // Idem : le corps de la requete n'est meme pas lu tant que l'appelant
    // n'est pas administrateur.
    const { error: adminError } = await requireAdmin();
    if (adminError) return adminError as NextResponse<ApiResponse<any>>;

    const body = await req.json();
    const { id, ...updates } = body;

    const { data, error } = await supabase
      .from('subscriptions')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to update subscription' },
      { status: 500 }
    );
  }
}
