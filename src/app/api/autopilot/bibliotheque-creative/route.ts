/**
 * A_3e1 — LA BIBLIOTHÈQUE CRÉATIVE : FAVORIS, ET PLUS TARD PRESETS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UNE ROUTE À PART DE `/api/autopilot/profil-creatif`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * « Mon style » écrit `design_style.profilCreatif` ; les favoris écrivent
 * `design_style.bibliothequeCreative`. Deux clés, deux écrivains, et donc
 * aucune façon pour l'un d'effacer l'autre — même si les deux partent au même
 * instant. C'est exactement la règle qui a été posée pour « Mon objectif ».
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LE `userId` VIENT DE LA SESSION, ET DE NULLE PART AILLEURS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Aucun champ du corps ne le porte, aucun paramètre d'URL ne le porte. Lire
 * ou écrire les favoris d'autrui n'est pas « interdit » : c'est inexprimable.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import {
  MESSAGES_BIBLIOTHEQUE, lireBibliothequeUtilisateur,
  enregistrerBibliothequeUtilisateur,
} from '@/lib/autopilot/analyse/profil-compte';
import { listerCreatifsRecents } from '@/lib/autopilot/analyse/rendu-service';
import { recentsDepuisUsages, FAVORIS_VIDES } from '@/lib/creatif/bibliotheque';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;
  const bibliotheque = await lireBibliothequeUtilisateur(userId);

  /* ⚠️ LES RÉCENTS SONT DÉDUITS DES RENDUS, PAS STOCKÉS. Un rendu réussi est
     déjà la preuve qu'un choix a servi ; une seconde liste mise à jour après
     coup mentirait dès le premier enregistrement manqué. Et si le socle des
     rendus n'est pas là, la grille perd ses « Récents » — elle ne casse pas. */
  let recents = FAVORIS_VIDES;
  try {
    recents = recentsDepuisUsages(await listerCreatifsRecents(userId));
  } catch {
    // Le message n'est PAS repris : il porterait un détail de base.
  }

  return NextResponse.json({ ok: true, bibliotheque, recents });
}

export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  let corps: unknown;
  try { corps = await req.json(); } catch { corps = null; }
  if (!corps || typeof corps !== 'object') {
    return NextResponse.json({ ok: false, error: 'Corps invalide' }, { status: 400 });
  }

  const r = await enregistrerBibliothequeUtilisateur(
    session.user.id, (corps as Record<string, unknown>).bibliotheque,
  );
  if (!r.ok) {
    return NextResponse.json(
      { ok: false, error: MESSAGES_BIBLIOTHEQUE[r.motif] },
      { status: r.motif === 'store_indisponible' ? 503 : 500 },
    );
  }
  return NextResponse.json({ ok: true, bibliotheque: r.bibliotheque });
}
