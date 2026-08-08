import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, logAdminAction } from '@/lib/admin';
import { publicationOuverte, definirPublicationOuverte } from '@/lib/social/publishing';

/**
 * Le coupe-circuit global de la publication réseaux.
 *
 * ⚠️ IL COUPE TOUT LE MONDE D'UN COUP, et c'est sa raison d'être : le jour où
 * Zernio tombe, où sa facturation est suspendue, ou où un réseau change ses
 * règles, il faut pouvoir arrêter la publication sans désactiver les comptes
 * un par un ni redéployer.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  return NextResponse.json({ success: true, enabled: await publicationOuverte() });
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await requireAdmin();
  if (error) return error;

  const { enabled } = await req.json().catch(() => ({})) as { enabled?: unknown };
  if (typeof enabled !== 'boolean') {
    return NextResponse.json({ success: false, error: '`enabled` booléen requis.' }, { status: 400 });
  }
  const ok = await definirPublicationOuverte(enabled);
  if (!ok) {
    return NextResponse.json({ success: false, error: 'Enregistrement impossible.' }, { status: 500 });
  }
  // Un interrupteur qui ouvre la publication a tous les utilisateurs merite
  // une trace : c'est une decision, pas un reglage d'affichage.
  logAdminAction({
    adminEmail: session!.user!.email || 'inconnu',
    action: enabled ? 'publication_reseaux_ouverte' : 'publication_reseaux_fermee',
  });
  return NextResponse.json({ success: true, enabled });
}
