import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
import { retirerSourceAvatar } from '@/lib/avatar/source';
import { enregistrerJumeauUtilisateur } from '@/lib/autopilot/analyse/profil-compte';
import { JUMEAU_DESACTIVE } from '@/lib/avatar/jumeau';

/**
 * A_8f — « SUPPRIMER MA PREPARATION ».
 *
 * ═════════════════════════════════════════════════════════════════════════
 * ⚠️ CE N'EST PAS « SUPPRIMER MON CLONE », ET LE MOT COMPTE
 * ═════════════════════════════════════════════════════════════════════════
 *
 * Tant que `provider_avatar_id` est NULL, il n'y a pas de clone : il y a une
 * video de reference, mesuree et rangee, que personne n'a jamais envoyee
 * nulle part. La supprimer est une operation entierement locale, et elle est
 * sure. Appeler cela « supprimer mon clone » ferait croire qu'un modele
 * distant vient de disparaitre.
 *
 * ⚠️ ET SI UN CLONE EXISTE VRAIMENT, CETTE ROUTE REFUSE. Elle ne sait pas
 * supprimer chez le fournisseur, et pretendre l'avoir fait serait le pire des
 * mensonges : la personne croirait son visage retire d'un service ou il
 * resterait. La suppression complete appartient a A_8_FINAL.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * CE QUI SURVIT, ET CE N'EST PAS NEGOCIABLE
 * ═════════════════════════════════════════════════════════════════════════
 *
 *   - LES VIDEOS DEJA PRODUITES. La cle etrangere est `set null` depuis A_8b
 *     precisement pour cela : supprimer sa preparation ne vide pas la
 *     bibliotheque de quelqu'un.
 *   - LE MEDIA D'ORIGINE DE LA MEDIATHEQUE. L'inscription en fait une COPIE
 *     dans le namespace prive ; seule la copie part.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const { data: avatar } = await supabaseAdmin
    .from('user_avatars')
    .select('id, user_id, provider_avatar_id, source_object_key, deleted_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!avatar) {
    return NextResponse.json(
      { ok: false, error: 'Vous n’avez aucune préparation à supprimer.' }, { status: 404 },
    );
  }

  const ligne = avatar as Record<string, unknown>;
  /* ⚠️ LA CLE EST RETENUE AVANT TOUTE ECRITURE. La mise a jour ci-dessous la
     met a NULL ; relire le champ apres coup rendrait `null`, et l'objet
     resterait dans le stockage sans que rien ne le designe plus — l'orphelin
     que le lot precedent a passe son temps a supprimer. */
  const cleSource = ligne.source_object_key;
  const chezFournisseur = typeof ligne.provider_avatar_id === 'string'
    && (ligne.provider_avatar_id as string).length > 0;

  /* ⚠️ LE REFUS EST EXPLICITE, ET IL DIT LA VERITE. */
  if (chezFournisseur) {
    return NextResponse.json({
      ok: false,
      motif: 'clone_chez_fournisseur',
      error: 'La suppression complète sera disponible lorsque la gestion du '
        + 'clone sera activée. Votre clone existe encore chez notre fournisseur.',
    }, { status: 409 });
  }

  /* ⚠️ L'OPT-IN AUTOPILOTE TOMBE EN PREMIER. Laisser un reglage « actif »
     designer une preparation supprimee produirait un blocage nomme a chaque
     creneau, pour un clone que la personne vient elle-meme de retirer. */
  await enregistrerJumeauUtilisateur(userId, JUMEAU_DESACTIVE);

  /* Suppression douce : la fiche part de l'ecran sans emporter l'historique.
     La colonne existe depuis A_8b et attendait ce workflow. */
  const { error: erreurMaj } = await supabaseAdmin
    .from('user_avatars')
    .update({ deleted_at: new Date().toISOString(), source_object_key: null })
    .eq('id', ligne.id as string)
    .eq('user_id', userId)
    .is('deleted_at', null);

  if (erreurMaj) {
    return NextResponse.json(
      { ok: false, error: 'Votre préparation n’a pas pu être supprimée.' }, { status: 500 },
    );
  }

  /* ⚠️ L'OBJET APRES LA LIGNE, JAMAIS AVANT. Si la mise a jour avait echoue,
     on serait sorti au-dessus — et la video serait restee, designee par une
     ligne encore valide. Retirer d'abord aurait laisse une fiche pointant
     vers un objet disparu. */
  const retiree = await retirerSourceAvatar(userId, cleSource);

  return NextResponse.json({ ok: true, sourceRetiree: retiree });
}
