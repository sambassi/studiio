import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { SOURCE_REFERENCE, normaliserTaux } from '@/lib/tarifs/change';

/**
 * TAUX DE RÉFÉRENCE USD → CHF — `GET /api/admin/tarifs/taux`, ADMIN SEULEMENT.
 *
 * Lit le taux de référence de la BCE (api.frankfurter.dev, sans clé) et le
 * rend AVEC SA DATE. Cette route NE L'ENREGISTRE PAS : l'admin le voit, puis
 * l'enregistre par le PUT habituel. Un taux qui s'enregistrerait seul
 * changerait les verdicts de rentabilité sans décision humaine.
 *
 * Échec réseau : 503 et aucun taux. Jamais de valeur de repli inventée.
 */
export const dynamic = 'force-dynamic';

const URL_REFERENCE = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=CHF';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  try {
    const r = await fetch(URL_REFERENCE, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const corps = (await r.json()) as { date?: unknown; rates?: { CHF?: unknown } };
    const taux = normaliserTaux({
      chfParUsd: corps?.rates?.CHF,
      le: corps?.date,
      source: SOURCE_REFERENCE,
    });
    if (!taux) throw new Error('réponse inexploitable');
    return NextResponse.json({ success: true, change: taux }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    console.error('[admin/tarifs/taux] lecture impossible :', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { success: false, error: 'Taux de référence indisponible. Saisis-le à la main, avec sa date.' },
      { status: 503 },
    );
  }
}
