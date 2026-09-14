import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import {
  MESSAGES_PROFIL_COMPTE, lireJumeauUtilisateur, enregistrerJumeauUtilisateur,
} from '@/lib/autopilot/analyse/profil-compte';
import {
  lireConfigJumeau, MESSAGES_JUMEAU, JUMEAU_DESACTIVE,
} from '@/lib/avatar/jumeau';
import { resoudreJumeauDuCompte } from '@/lib/avatar/jumeau-serveur';

/**
 * A_8f — « UTILISER MON CLONE DANS AUTOPILOTE ».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LE `userId` VIENT DE LA SESSION, ET DE NULLE PART AILLEURS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le corps porte un `avatarId` et un `userVoiceId` — deux identifiants que
 * n'importe qui peut ecrire. Ils ne sont donc jamais crus : les deux lignes
 * sont relues EN FILTRANT PAR LE COMPTE, et c'est la ligne relue qui decide.
 * Designer l'avatar d'autrui n'est pas « interdit » ici, c'est sans effet.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ ON N'ACTIVE PAS CE QUI NE POURRAIT PAS SERVIR
 * ─────────────────────────────────────────────────────────────────────────
 *
 * L'activation passe par le MEME portail que la generation. Enregistrer un
 * opt-in qui echouerait ensuite, video apres video, laisserait quelqu'un
 * devant un reglage « actif » sans qu'aucun ecran ne dise pourquoi rien ne
 * sort. La seule exception est la VOIX : elle peut manquer au moment de la
 * configuration, et l'ecran l'annonce — mais la generation, elle, restera
 * fermee tant qu'elle manque.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const jumeau = await lireJumeauUtilisateur(session.user.id);
  return NextResponse.json({ ok: true, jumeau });
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

  const demande = lireConfigJumeau((json as { jumeau?: unknown })?.jumeau ?? json);

  /* Eteindre ne demande aucune preuve : on n'exige pas d'un compte qu'il
     prouve la validite de son clone pour cesser de s'en servir. */
  if (!demande.active) {
    const ecriture = await enregistrerJumeauUtilisateur(userId, {
      ...JUMEAU_DESACTIVE,
      avatarId: demande.avatarId,
      avatarVersion: demande.avatarVersion,
      userVoiceId: demande.userVoiceId,
    });
    if (!ecriture.ok) return echecEcriture(ecriture.motif);
    return NextResponse.json({ ok: true, jumeau: ecriture.jumeau });
  }

  /* ⚠️ LE PORTAIL DE GENERATION, PAS UNE SECONDE LECTURE. Deux jeux de regles
     finiraient par diverger, et le jour ou ils divergeraient un compte
     activerait un clone que la generation refuserait ensuite en silence. */
  const { issue, avatar, voix } = await resoudreJumeauDuCompte(userId, demande);

  /* La voix manquante est le SEUL blocage qui n'empeche pas de configurer :
     l'ecran affiche « Voix a configurer », et la generation reste fermee.

     ⚠️ MAIS UNE VOIX DESIGNEE ET INTROUVABLE EST REFUSEE, PAS EFFACEE — A_8g.
     Un `userVoiceId` qui ne resout pas sous CE compte — inexistant, ou a
     quelqu'un d'autre — n'est pas « pas de voix » : c'est une demande qu'on
     ne peut pas honorer, et on le dit. L'ecrire a NULL en silence laisserait
     croire que le choix a ete pris. */
  const voixDemandee = demande.userVoiceId !== null;
  if (issue.etat === 'bloque' && (issue.motif !== 'voix_absente' || voixDemandee)) {
    return NextResponse.json(
      { ok: false, motif: issue.motif, error: MESSAGES_JUMEAU[issue.motif] },
      { status: 409 },
    );
  }
  if (issue.etat === 'desactive') {
    return NextResponse.json(
      { ok: false, motif: 'avatar_absent', error: MESSAGES_JUMEAU.avatar_absent },
      { status: 409 },
    );
  }

  /* ⚠️ LA VERSION EST RECOPIEE DE LA LIGNE, PAS DU CORPS. Le navigateur ne
     decide pas de quelle version de la personne il s'agit. */
  const versionLigne = (avatar as { version?: unknown } | null)?.version;
  const ecriture = await enregistrerJumeauUtilisateur(userId, {
    active: true,
    avatarId: demande.avatarId,
    avatarVersion: typeof versionLigne === 'number' ? versionLigne : null,
    userVoiceId: voix ? demande.userVoiceId : null,
  });
  if (!ecriture.ok) return echecEcriture(ecriture.motif);
  return NextResponse.json({
    ok: true,
    jumeau: ecriture.jumeau,
    // L'ecran doit pouvoir dire « Voix a configurer » sans redemander.
    voixPrete: voix !== null,
  });
}

function echecEcriture(motif: 'store_indisponible' | 'ecriture_impossible') {
  return NextResponse.json(
    { ok: false, error: MESSAGES_PROFIL_COMPTE[motif], motif },
    { status: motif === 'store_indisponible' ? 503 : 500 },
  );
}
