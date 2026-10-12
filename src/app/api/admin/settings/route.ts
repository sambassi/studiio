import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

// GET /api/admin/settings
export async function GET(_req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const { data, error: dbError } = await supabase
      .from('app_settings')
      .select('*');

    if (dbError) throw dbError;

    const settings: Record<string, any> = {};
    data?.forEach((s) => {
      settings[s.key] = typeof s.value === 'string' ? JSON.parse(s.value) : s.value;
    });

    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error('Admin settings error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch settings' }, { status: 500 });
  }
}

// PATCH /api/admin/settings
export async function PATCH(req: NextRequest) {
  const { error, session } = await requireAdmin();
  if (error) return error;

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length === 0) {
      return NextResponse.json({ success: false, error: 'Corps invalide' }, { status: 400 });
    }

    // ⚠️ Colonnes RÉELLES de `app_settings` en production : key, value,
    // updated_at — PAS `updated_by` (déclarée par la vieille migration 004,
    // absente de la base) : l'écrire faisait échouer chaque enregistrement.
    // L'auteur reste tracé dans `audit_log` (logAdminAction ci-dessous).
    // Un seul upsert pour toutes les clés : tout est enregistré, ou rien.
    const maintenant = new Date().toISOString();
    const lignes = Object.entries(body).map(([key, value]) => ({
      key,
      value: JSON.stringify(value),
      updated_at: maintenant,
    }));
    const { error: ecriture } = await supabase.from('app_settings').upsert(lignes);
    // Jamais de « succès » si l'écriture a échoué.
    if (ecriture) {
      console.error('Admin settings update error:', ecriture.message);
      return NextResponse.json({ success: false, error: 'Failed to update settings' }, { status: 500 });
    }

    await logAdminAction({
      adminEmail: session!.user!.email!,
      action: 'update_settings',
      targetType: 'setting',
      details: body,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin settings update error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update settings' }, { status: 500 });
  }
}
