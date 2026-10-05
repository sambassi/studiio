/**
 * GET /api/creer/jumeau/verification — le jumeau existe-t-il VRAIMENT chez
 * les fournisseurs ? Lectures gratuites uniquement (aucune génération,
 * aucune synthèse). Aucun identifiant fournisseur ne sort d'ici.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { verifierJumeauChezFournisseurs } from '@/lib/avatar/verification-fournisseurs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  try {
    const data = await verifierJumeauChezFournisseurs(session.user.id);
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    console.error('[Creer][jumeau][verification]', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: 'Vérification impossible. Réessayez.' }, { status: 500 });
  }
}
