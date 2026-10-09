/**
 * GET /api/avatar/apercu — l'état de l'aperçu RÉEL du clone courant.
 *
 * Répond ce que la base sait, et rien de plus : `aucun` (jamais généré pour
 * cette version), `en_cours`, `echec`, `indisponible` (générée mais sans
 * vidéo re-hébergée exploitable), `pret` (URL de la vidéo générée). Aucune
 * vidéo n'est inventée ; sans aperçu prêt, la validation reste fermée.
 *
 * `renduRecent` (avatar validé seulement) : la dernière vidéo terminée de la
 * VERSION ACTIVE — un exemple de résultat, `null` s'il n'y en a pas.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { avatarVivantDuCompte } from '@/lib/avatar/lecture';
import { apercuDuClone, renduRecentDuClone } from '@/lib/avatar/apercu';
import { etatAvatar } from '@/lib/avatar/contrat';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  const lecture = await avatarVivantDuCompte(session.user.id);
  if (!lecture.ok) {
    return NextResponse.json({ success: false, error: "Votre avatar n'a pas pu être lu." }, { status: 500 });
  }
  if (!lecture.avatar) {
    return NextResponse.json({ success: false, error: 'Aucun avatar.', code: 'avatar_absent' }, { status: 404 });
  }
  const a = lecture.avatar;
  try {
    const etat = etatAvatar(a);
    const apercu = await apercuDuClone(session.user.id, a.id, a.version);
    // Le rendu récent n'a de sens que pour un avatar ACTIF (validé) : c'est un
    // exemple produit avec la version utilisée par Créer et l'Autopilote.
    const renduRecent = etat === 'valide' ? await renduRecentDuClone(session.user.id, a.id, a.version) : null;
    return NextResponse.json({
      success: true,
      data: { avatarId: a.id, version: a.version, etat, apercu, renduRecent },
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    console.error('[Avatar][apercu] lecture impossible :', e instanceof Error ? e.message : String(e));
    return NextResponse.json({ success: false, error: "L'aperçu n'a pas pu être lu." }, { status: 500 });
  }
}
