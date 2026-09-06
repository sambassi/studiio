import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import {
  MESSAGES_PROFIL_COMPTE, enregistrerProfilCreatifUtilisateur,
  lireProfilCreatifUtilisateur,
} from '@/lib/autopilot/analyse/profil-compte';
import { lireProfilCreatif } from '@/lib/autopilot/analyse/profil-creatif';
import {
  MESSAGES_LOGO, verifierLogo,
} from '@/lib/autopilot/analyse/logo-source';

/**
 * LOT 2B ETAPE 3 — « MON STYLE » : LE PROFIL CREATIF PAR DEFAUT DU COMPTE.
 *
 * ---------------------------------------------------------------------------
 * POURQUOI UNE ROUTE A PART DE `/api/autopilot/config`
 * ---------------------------------------------------------------------------
 *
 * Le `PUT` de la configuration ecrit TOUTES les colonnes : cadence, mode,
 * plateformes, plancher de credits, rushes. Y brancher « Mon style »
 * obligerait l'ecran a renvoyer la configuration entiere pour changer une
 * couleur — et le premier champ oublie remettrait une cadence ou un mode a sa
 * valeur par defaut, silencieusement.
 *
 * Cette route ne touche qu'a `design_style.profilCreatif`, en lire-modifier-
 * ecrire. Elle ne peut rien casser d'autre.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ LE `userId` VIENT DE LA SESSION, ET DE NULLE PART AILLEURS
 * ---------------------------------------------------------------------------
 *
 * Aucun champ du corps ne le porte, aucun parametre d'URL ne le porte. Lire
 * ou ecrire le style d'un autre compte n'est donc pas « interdit » : c'est
 * inexprimable. C'est la meme regle que `user_id` dans
 * `CHAMPS_INTERDITS_RENDU`.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const profil = await lireProfilCreatifUtilisateur(session.user.id);
  // `profil: null` n'est pas une erreur : c'est « ce compte n'a pas encore de
  // style ». L'ecran affiche « Style par defaut » et propose de le configurer.
  return NextResponse.json({ ok: true, profil });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  let json: unknown;
  try { json = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: 'Corps JSON invalide' }, { status: 400 });
  }

  // ⚠️ LE MEME LECTEUR FERME QUE LA ROUTE DE RENDU, PAS UN SECOND. Un schema
  // permissif ici laisserait entrer dans la base un champ que le rendu
  // refuse : le style serait « enregistre » et sans effet.
  const lecture = lireProfilCreatif(json);
  if (!lecture.ok) {
    return NextResponse.json(
      { ok: false, error: lecture.message, motif: lecture.motif }, { status: 422 },
    );
  }

  // ⚠️ LA PROPRIETE DU LOGO EST VERIFIEE ICI AUSSI, PAS SEULEMENT AU RENDU.
  //
  // Sans cela, la cle d'un tiers s'installerait dans le style du compte : le
  // rendu la refuserait ensuite, video apres video, et l'utilisateur verrait
  // un style enregistre qui echoue sans qu'aucun ecran ne dise pourquoi. Une
  // garde placee seulement en aval laisse toujours une donnee fausse
  // s'installer en amont.
  const marque = lecture.profil.marque;
  if (marque?.logoActif && marque.logo) {
    const v = await verifierLogo(marque.logo, userId);
    if (!v.ok) {
      const statut = v.motif === 'stockage_injoignable' ? 503 : 422;
      return NextResponse.json(
        { ok: false, error: MESSAGES_LOGO[v.motif], motif: v.motif }, { status: statut },
      );
    }
  }

  const ecriture = await enregistrerProfilCreatifUtilisateur(userId, lecture.profil);
  if (!ecriture.ok) {
    const statut = ecriture.motif === 'store_indisponible' ? 503 : 500;
    return NextResponse.json(
      { ok: false, error: MESSAGES_PROFIL_COMPTE[ecriture.motif], motif: ecriture.motif },
      { status: statut },
    );
  }
  return NextResponse.json({ ok: true, profil: ecriture.profil });
}
