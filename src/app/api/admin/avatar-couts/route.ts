/**
 * GET /api/admin/avatar-couts — ADMIN uniquement. Les générations d'avatar
 * avec leur fournisseur, leur coût externe, le prix Studiio et la marge —
 * y compris les usages admin (0 crédit Studiio, coût externe réel).
 * Ces informations ne sortent JAMAIS vers un utilisateur.
 */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { supabaseAdmin } from '@/lib/db/supabase';

export const dynamic = 'force-dynamic';

const COLONNES_COUT = 'provider_cost_eur, studiio_credits, studiio_price_eur, margin_eur, admin_usage, provider_error';
const COLONNES_BASE = 'id, user_id, provider, provider_video_id, status, intention, credits_charged, credits_refunded, duration_seconds, error_message, created_at';

export async function GET() {
  const { error: adminError } = await requireAdmin();
  if (adminError) return adminError as NextResponse;

  let migrationAppliquee = true;
  const lire = (colonnes: string) => supabaseAdmin.from('avatar_generations').select(colonnes).order('created_at', { ascending: false }).limit(200);
  let { data, error } = await lire(`${COLONNES_BASE}, ${COLONNES_COUT}`);
  if (error) {
    // Migration 2026-10-06-avatar-couts.sql pas encore appliquée : la liste
    // reste lisible, sans les colonnes de coût.
    migrationAppliquee = false;
    ({ data, error } = await lire(COLONNES_BASE));
  }
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  const lignes = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const somme = (k: string, filtre: (l: Record<string, unknown>) => boolean = () => true) =>
    lignes.filter(filtre).reduce((t, l) => t + (typeof l[k] === 'number' ? (l[k] as number) : Number(l[k] ?? 0) || 0), 0);
  return NextResponse.json({
    success: true,
    data: {
      migrationAppliquee,
      generations: lignes,
      totaux: {
        providerCostEur: somme('provider_cost_eur'),
        providerCostAdminEur: somme('provider_cost_eur', (l) => l.admin_usage === true),
        studiioPriceEur: somme('studiio_price_eur'),
        marginEur: somme('margin_eur'),
        nonMesurees: lignes.filter((l) => l.provider_cost_eur === null || l.provider_cost_eur === undefined).length,
      },
    },
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
