import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { messageJumeauCreer as message } from '@/lib/avatar/jumeau-creer';
import { etatJumeauPourCreer, preparerJumeauPourCreer } from '@/lib/avatar/jumeau-serveur';

/**
 * A_8h — « UTILISER MON CLONE » DANS LE PARCOURS « CREER ».
 *
 * ═════════════════════════════════════════════════════════════════════════
 * GET  → l'etat du jumeau pour ce compte, tel que le portail le juge
 * POST → le contrat d'une creation avec le jumeau : identite + parole
 * ═════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ LE NAVIGATEUR N'ENVOIE NI AVATAR NI VOIX. Le corps du POST ne porte que
 * le texte affiche ; l'avatar est celui du compte, la voix celle choisie dans
 * « Ma voix ». Un `avatarId` ou `userVoiceId` glisse dans la requete n'est
 * jamais lu — il n'y a donc rien a falsifier.
 *
 * ⚠️ ET RIEN NE REVIENT QUI DESIGNE UN FOURNISSEUR. L'ecran travaille avec
 * les references Studiio (`user_avatars.id`, `user_voices.id`) et des noms.
 *
 * ⚠️ LE MOTEUR N'EXISTE PAS ENCORE (A_8_FINAL). Un contrat « pret » est
 * renvoye avec `moteur: 'indisponible'` : l'ecran le dit, et ne produit
 * aucune video ordinaire a la place — le meme etat nomme qu'Autopilote
 * (`jumeau_indisponible`).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const etat = await etatJumeauPourCreer(session.user.id);
  if (etat.etat === 'bloque') {
    return NextResponse.json({ ok: true, etat: 'bloque', motif: etat.motif, message: message(etat.motif) });
  }
  return NextResponse.json({
    ok: true, etat: 'pret', identite: etat.identite, voix: etat.voix, moteur: 'indisponible',
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  let corps: Record<string, unknown>;
  try { corps = (await req.json()) as Record<string, unknown>; } catch {
    return NextResponse.json({ ok: false, error: 'Corps JSON invalide' }, { status: 400 });
  }

  const issue = await preparerJumeauPourCreer(session.user.id, corps.displayScript);
  if (issue.etat !== 'pret') {
    const motif = issue.etat === 'bloque' ? issue.motif : 'avatar_absent';
    return NextResponse.json({ ok: false, motif, error: message(motif) }, { status: 409 });
  }
  return NextResponse.json({
    ok: true,
    etat: 'pret',
    identite: issue.identite,
    parole: {
      displayScript: issue.parole.displayScript,
      spokenScript: issue.parole.spokenScript,
      langue: issue.parole.langue,
      // La voix par sa reference Studiio et son nom — jamais l'identifiant du
      // fournisseur.
      voix: { userVoiceId: issue.parole.voix.userVoiceId, nom: issue.parole.voix.nom },
    },
    /* Le contrat est complet ; ce qui manque est le moteur qui l'anime. */
    moteur: 'indisponible',
    motif: 'jumeau_indisponible',
  });
}
