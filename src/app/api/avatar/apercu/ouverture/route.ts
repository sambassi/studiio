/**
 * POST /api/avatar/apercu/ouverture — « Voir mon avatar ».
 *
 * Délivre le JETON d'ouverture, exigé ensuite par la validation. Il n'existe
 * que pour un aperçu PRÊT de la version COURANTE d'un clone entraîné et non
 * validé ; tout autre état → 409, sans jeton. Aucun paramètre n'est lu.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { avatarVivantDuCompte } from '@/lib/avatar/lecture';
import { apercuDuClone, jetonOuvertureApercu } from '@/lib/avatar/apercu';
import { etatAvatar } from '@/lib/avatar/contrat';

export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;
  const lecture = await avatarVivantDuCompte(userId);
  if (!lecture.ok) return NextResponse.json({ success: false, error: "Votre avatar n'a pas pu être lu." }, { status: 500 });
  if (!lecture.avatar) return NextResponse.json({ success: false, error: 'Aucun avatar.', code: 'avatar_absent' }, { status: 404 });
  const a = lecture.avatar;
  const etat = etatAvatar(a);
  if (etat !== 'entraine_non_valide') {
    return NextResponse.json({ success: false, error: "Votre avatar n'est pas prêt à être visionné.", code: `avatar_${etat}` }, { status: 409 });
  }
  let apercu;
  try {
    apercu = await apercuDuClone(userId, a.id, a.version);
  } catch (e) {
    console.error('[Avatar][apercu] lecture impossible :', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ success: false, error: "L'aperçu n'a pas pu être lu." }, { status: 500 });
  }
  if (apercu.statut !== 'pret') {
    return NextResponse.json(
      { success: false, error: "L'aperçu réel de votre avatar n'est pas encore disponible.", code: `apercu_${apercu.statut}` },
      { status: 409 },
    );
  }
  let jeton: string;
  try {
    jeton = jetonOuvertureApercu({ userId, avatarId: a.id, version: a.version, generationId: apercu.generationId });
  } catch (e) {
    console.error('[Avatar][apercu] jeton impossible :', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ success: false, error: "L'ouverture n'a pas pu être enregistrée." }, { status: 500 });
  }
  return NextResponse.json({
    success: true,
    data: { avatarId: a.id, version: a.version, generationId: apercu.generationId, url: apercu.url, jeton },
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
