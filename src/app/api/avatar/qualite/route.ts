/**
 * POST /api/avatar/qualite — `{ avatarId, qualite: 'standard'|'qualite'|'premium' }`.
 * Enregistre la qualité CHOISIE dans Mon avatar pour CET avatar : elle devient
 * le moteur de toutes ses générations (Mon avatar, aperçu, Créer, Autopilote).
 * L'avatar doit être un avatar vivant du compte. Aucun fournisseur appelé.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { avatarVivantDuCompte } from '@/lib/avatar/lecture';
import { ecrireQualiteAvatar, estQualiteRendu } from '@/lib/avatar/qualite-sauvegardee';
import { MOTEUR_PAR_QUALITE } from '@/lib/avatar/moteurs';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  const corps = (await req.json().catch(() => null)) as { avatarId?: unknown; qualite?: unknown } | null;
  const avatarId = typeof corps?.avatarId === 'string' ? corps.avatarId : '';
  if (!estQualiteRendu(corps?.qualite)) return NextResponse.json({ success: false, error: 'Qualité de rendu inconnue.' }, { status: 400 });
  const lu = await avatarVivantDuCompte(session.user.id, avatarId || undefined);
  if (!lu.ok) return NextResponse.json({ success: false, error: 'Votre avatar n’a pas pu être lu.' }, { status: 500 });
  if (!lu.avatar || lu.avatar.id !== avatarId) return NextResponse.json({ success: false, error: 'Avatar introuvable.' }, { status: 404 });
  const r = await ecrireQualiteAvatar(session.user.id, avatarId, corps!.qualite as Parameters<typeof ecrireQualiteAvatar>[2]);
  if (!r.ok) return NextResponse.json({ success: false, error: 'La qualité n’a pas pu être enregistrée.' }, { status: 500 });
  const qualite = corps!.qualite as keyof typeof MOTEUR_PAR_QUALITE;
  return NextResponse.json({ success: true, data: { avatarId, qualite, moteur: MOTEUR_PAR_QUALITE[qualite] } });
}
