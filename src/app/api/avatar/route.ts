/**
 * DELETE /api/avatar — supprimer SON avatar (suppression logique).
 *
 * Ce que la personne obtient : sa ligne quitte l'écran (`deleted_at`), la
 * source d'enrôlement — son visage — est retirée du stockage, ses vidéos
 * déjà produites restent. Ce qu'on ne lui promet pas : la suppression chez
 * le fournisseur, que le client ne sait pas faire — la réponse le dit
 * (`fournisseur: 'non_disponible'`), l'écran le répète.
 *
 * Toute la règle vit dans `@/lib/avatar/suppression` ; cette route ne fait
 * que la session et les codes HTTP. Aucun paramètre n'est lu : le compte
 * vient de la session, l'avatar de la base.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supprimerAvatarActif } from '@/lib/avatar/suppression';

export const dynamic = 'force-dynamic';

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const resultat = await supprimerAvatarActif(session.user.id);
  if (resultat.ok) {
    return NextResponse.json({
      success: true,
      data: {
        avatarId: resultat.avatarId,
        version: resultat.version,
        dejaSupprime: resultat.dejaSupprime,
        sourceRetiree: resultat.sourceRetiree,
        fournisseur: resultat.fournisseur,
      },
    });
  }
  switch (resultat.motif) {
    case 'aucun_avatar':
      return NextResponse.json({ success: false, error: "Vous n'avez aucun avatar à supprimer.", code: 'avatar_absent' }, { status: 404 });
    case 'version_concurrente':
      return NextResponse.json(
        { success: false, error: 'Votre avatar vient d’être remplacé. Rechargez la page.', code: 'avatar_superseded' },
        { status: 409 },
      );
    default:
      console.error(`[Avatar][suppression] ${resultat.motif} pour ${session.user.id} : ${resultat.erreur}`);
      return NextResponse.json(
        { success: false, error: "Votre avatar n'a pas pu être supprimé. Réessayez.", code: `avatar_delete_${resultat.motif}` },
        { status: 500 },
      );
  }
}
