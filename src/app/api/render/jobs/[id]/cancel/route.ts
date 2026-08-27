import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { cloreRendu } from '@/lib/rendus/service';

/**
 * Ferme une tentative sans debiter.
 *
 * Appelee quand la composition ou le televersement echoue cote navigateur.
 * Elle ne peut PAS rouvrir une tentative deja confirmee : `clore_rendu`
 * n'agit que sur `reserved`, sinon on pourrait annuler apres coup un rendu
 * deja paye et livre.
 *
 * Le motif vient du client et n'est que du diagnostic : il n'entre dans
 * aucune decision.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    let motif = 'abandon';
    try {
      const corps = await req.json();
      if (corps && typeof corps.motif === 'string') motif = corps.motif.slice(0, 200);
    } catch { /* corps facultatif */ }

    const r = await cloreRendu(session.user.id, params.id, 'cancelled', motif);
    return NextResponse.json({ ok: r.ok, etat: r.etat }, { status: r.ok ? 200 : 409 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'cloture impossible';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
