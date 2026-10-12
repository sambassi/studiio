import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin';
import { supabaseAdmin as supabase } from '@/lib/db/supabase';

const LANDING_KEY = 'landing_page_content';

// GET /api/admin/landing — fetch landing page content
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', LANDING_KEY)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found

    const content = data?.value
      ? (typeof data.value === 'string' ? JSON.parse(data.value) : data.value)
      : null;

    return NextResponse.json({ success: true, content });
  } catch (error) {
    console.error('Landing content fetch error:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch landing content' }, { status: 500 });
  }
}

// PATCH /api/admin/landing — update landing page content (partial or full)
export async function PATCH(req: NextRequest) {
  const { error: authErr, session } = await requireAdmin();
  if (authErr) return authErr;

  try {
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: 'Corps invalide' }, { status: 400 });
    }

    // Contenu existant, pour la fusion. ⚠️ Une lecture en ÉCHEC arrête tout :
    // fusionner dans `{}` puis écrire effacerait toute la page d'accueil.
    const { data: existing, error: lecture } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', LANDING_KEY)
      .maybeSingle();
    if (lecture) {
      console.error('Landing content read error:', lecture.message);
      return NextResponse.json({ success: false, error: 'Failed to update landing content' }, { status: 500 });
    }

    const currentContent = existing?.value
      ? (typeof existing.value === 'string' ? JSON.parse(existing.value) : existing.value)
      : {};

    // Deep merge: body overwrites existing keys
    const merged = { ...currentContent, ...body };

    // Colonnes RÉELLES de `app_settings` : key, value, updated_at (pas
    // `updated_by`, absente en production). L'auteur va à `audit_log`.
    const { error: ecriture } = await supabase
      .from('app_settings')
      .upsert({
        key: LANDING_KEY,
        value: JSON.stringify(merged),
        updated_at: new Date().toISOString(),
      });
    // Jamais de « succès » si l'écriture a échoué.
    if (ecriture) {
      console.error('Landing content update error:', ecriture.message);
      return NextResponse.json({ success: false, error: 'Failed to update landing content' }, { status: 500 });
    }

    await logAdminAction({
      adminEmail: session!.user!.email!,
      action: 'update_landing_page',
      targetType: 'landing',
      details: { sections: Object.keys(body) },
    });

    return NextResponse.json({ success: true, content: merged });
  } catch (error) {
    console.error('Landing content update error:', error);
    return NextResponse.json({ success: false, error: 'Failed to update landing content' }, { status: 500 });
  }
}
