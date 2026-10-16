import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, logAdminAction, isAdmin } from '@/lib/admin';
import {
  creerDemandeCompte, executerDemande, statutPublic, uidValide,
} from '@/lib/rgpd/suppression-donnees';
import { dependancesReelles } from '@/lib/rgpd/adaptateurs';
import { supabaseAdmin } from '@/lib/db/supabase';
import { ApiResponse } from '@/lib/types/api';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse<ApiResponse<any>>> {
  try {
    const { error: adminError } = await requireAdmin();
    if (adminError) return adminError as NextResponse;

    const userId = params.id;

    // Get user details
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (userError) throw userError;
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // Get videos count
    const { count: videosCount } = await supabaseAdmin
      .from('videos')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    // Get posts count
    const { count: postsCount } = await supabaseAdmin
      .from('scheduled_posts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    // Get transactions
    const { data: transactions } = await supabaseAdmin
      .from('credit_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(10);

    const enrichedUser = {
      ...user,
      videosCount: videosCount || 0,
      postsCount: postsCount || 0,
      recentTransactions: transactions || [],
    };

    return NextResponse.json({
      success: true,
      data: enrichedUser,
    });
  } catch (error) {
    console.error('Error fetching user details:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch user details' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse<ApiResponse<any>>> {
  try {
    const { error: adminError, session } = await requireAdmin();
    if (adminError) return adminError as NextResponse;

    const userId = params.id;
    const body = await req.json();
    const { credits, plan, role, blocked } = body;

    // Validate update data
    const updateData: any = {};
    if (credits !== undefined) updateData.credits = credits;
    if (plan) updateData.plan = plan;
    if (role) updateData.role = role;
    if (blocked !== undefined) updateData.blocked = blocked;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw error;

    // Log the action
    await logAdminAction({
      adminEmail: session!.user.email!,
      action: 'update_user',
      targetType: 'user',
      targetId: userId,
      details: updateData,
    });

    return NextResponse.json({
      success: true,
      data,
      message: 'User updated successfully',
    });
  } catch (error) {
    console.error('Error updating user:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update user' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse<ApiResponse<any>>> {
  try {
    const { error: adminError, session } = await requireAdmin();
    if (adminError) return adminError as NextResponse;

    const userId = params.id;
    // Suppression RÉELLE (base + stockage), plus un simple `deleted_at` :
    // voir src/lib/rgpd/suppression-donnees.ts. L'identifiant doit être un
    // UUID canonique — il fixe les préfixes de stockage purgés.
    if (!uidValide(userId)) {
      return NextResponse.json({ success: false, error: 'Invalid user id' }, { status: 400 });
    }

    const deps = { ...dependancesReelles(), estCompteProtege: isAdmin };
    const demande = await creerDemandeCompte(userId, 'admin', deps);
    const d = await executerDemande(demande.code, deps);

    await logAdminAction({
      adminEmail: session!.user.email!,
      action: 'delete_user',
      targetType: 'user',
      targetId: userId,
      details: { confirmationCode: d.code, statut: d.statut, motif: d.motif ?? null },
    });

    const ok = d.statut === 'terminee';
    return NextResponse.json({
      success: ok,
      data: statutPublic(d),
      message: ok
        ? 'User data deleted (account anonymized, billing records kept)'
        : `Deletion ${d.statut}${d.motif ? ` (${d.motif})` : ''} — rerun to resume`,
    }, { status: ok ? 200 : d.motif === 'verifications:abonnement_actif' ? 409 : 202 });
  } catch (error) {
    console.error('Error deleting user:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete user' },
      { status: 500 }
    );
  }
}
