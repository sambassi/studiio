import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { SOURCE_REFERENCE, normaliserTaux, normaliserTauxEur } from '@/lib/tarifs/change';

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

const URL_USD = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=CHF';
// CHF → EUR : la seule part flottante d'un prix en franc CFA, qui est arrimé
// à l'euro à parité fixe. La BCE ne publie pas le XOF, et c'est normal : ce
// n'est pas un taux de marché.
const URL_EUR = 'https://api.frankfurter.dev/v1/latest?base=CHF&symbols=EUR';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const lire = async (url: string) => {
    const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as { date?: unknown; rates?: Record<string, unknown> };
  };

  try {
    const [usd, eur] = await Promise.all([lire(URL_USD), lire(URL_EUR)]);
    const taux = normaliserTaux({ chfParUsd: usd?.rates?.CHF, le: usd?.date, source: SOURCE_REFERENCE });
    const tauxEur = normaliserTauxEur({ eurParChf: eur?.rates?.EUR, le: eur?.date, source: SOURCE_REFERENCE });
    if (!taux) throw new Error('réponse inexploitable');
    return NextResponse.json(
      { success: true, change: taux, changeEur: tauxEur },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e) {
    console.error('[admin/tarifs/taux] lecture impossible :', e instanceof Error ? e.message : e);
    return NextResponse.json(
      { success: false, error: 'Taux de référence indisponible. Saisis-le à la main, avec sa date.' },
      { status: 503 },
    );
  }
}
