import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe/client';
import { requireAdmin, logAdminAction } from '@/lib/admin';
import { invalidatePricingCache } from '@/lib/pricing/fetch';
import { calculerSynchro, appliquerSynchro } from '@/lib/stripe/synchro';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/pricing/sync-stripe
 *
 * Corps : `{ confirm?: boolean }`. Par défaut (dryRun), renvoie le diff
 * proposé sans rien écrire. Avec `confirm: true`, écrit — et seulement si
 * aucune offre n'est en erreur (prix manquant ou ambigu chez Stripe).
 * Lecture Stripe seule : aucun prix ni produit n'est créé ou modifié.
 * Mode TEST/LIVE déduit de la clé : un produit ou prix de l'autre mode est
 * une erreur, donc bloque toute écriture (cf. `lib/stripe/produits`).
 */
export async function POST(req: NextRequest) {
  const garde = await requireAdmin();
  if (garde.error) return garde.error;
  const adminEmail = garde.session!.user!.email!;

  let confirm = false;
  try {
    const body = await req.json();
    confirm = body?.confirm === true;
  } catch {}

  let resultat;
  try {
    resultat = await calculerSynchro(stripe as any);
  } catch (e: any) {
    console.error('[sync-stripe]', e?.message);
    return NextResponse.json({ success: false, error: e?.message || 'lecture impossible' }, { status: 502 });
  }
  const { mode, lignes, erreurs } = resultat;
  const aEcrire = lignes.filter((l) => l.modifie).length;

  if (!confirm) {
    await logAdminAction({ adminEmail, action: 'pricing.sync_stripe.dry_run', details: { mode, aEcrire, erreurs } });
    return NextResponse.json({ success: erreurs.length === 0, dryRun: true, mode, lignes, erreurs, aEcrire });
  }

  if (erreurs.length > 0) {
    return NextResponse.json({ success: false, dryRun: false, mode, lignes, erreurs, error: 'Synchronisation refusée : erreurs à corriger dans Stripe' }, { status: 422 });
  }

  try {
    const ecrites = await appliquerSynchro(lignes);
    invalidatePricingCache();
    await logAdminAction({
      adminEmail, action: 'pricing.sync_stripe',
      details: { mode, ecrites, lignes: lignes.filter((l) => l.modifie).map((l) => ({ table: l.table, key: l.key, champs: l.champs })) },
    });
    return NextResponse.json({ success: true, dryRun: false, mode, lignes, erreurs, ecrites });
  } catch (e: any) {
    console.error('[sync-stripe] ecriture', e?.message);
    return NextResponse.json({ success: false, error: e?.message || 'écriture impossible' }, { status: 500 });
  }
}
