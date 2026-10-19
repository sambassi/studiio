import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { isAdmin } from '@/lib/admin';
import {
  creerDemandeCompte, executerDemande, statutPublic, uidValide,
} from '@/lib/rgpd/suppression-donnees';
import { dependancesReelles } from '@/lib/rgpd/adaptateurs';
import { marquerCompteSupprime } from '@/lib/auth/etat-compte';

export const dynamic = 'force-dynamic';

/** Phrase exigée dans le corps : une suppression ne part jamais par accident. */
const PHRASE_CONFIRMATION = 'SUPPRIMER';

/**
 * POST /api/user/suppression — l'utilisateur authentifié supprime SON compte.
 *
 * L'identifiant vient de la SESSION, et d'elle seule : le corps ne peut
 * désigner aucun autre compte (il ne porte que la phrase de confirmation).
 * Réponse : le statut réel (`terminee`, `partielle`, `echec`…) et le code,
 * qui permet de suivre la demande sur `/api/data-deletion?code=…`.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!uidValide(userId)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  let corps: { confirmation?: unknown } = {};
  try { corps = await req.json(); } catch { corps = {}; }
  if (corps?.confirmation !== PHRASE_CONFIRMATION) {
    return NextResponse.json(
      { success: false, error: `Confirmation requise : envoyez { "confirmation": "${PHRASE_CONFIRMATION}" }.` },
      { status: 400 },
    );
  }

  // Compte administrateur : refusé AVANT toute écriture (aucune demande
  // enregistrée). La garde `verifications` de la bibliothèque reste en renfort.
  if (isAdmin(session?.user?.email)) {
    return NextResponse.json(
      { success: false, error: 'Compte administrateur protégé : il ne peut pas être supprimé par cette route.' },
      { status: 403 },
    );
  }

  const deps = { ...dependancesReelles(), estCompteProtege: isAdmin };
  let code: string;
  try {
    code = (await creerDemandeCompte(userId, 'utilisateur', deps)).code;
  } catch (e) {
    console.error('[rgpd] demande utilisateur non enregistrée :', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: 'Service indisponible, réessayez.' }, { status: 503 });
  }
  try {
    const d = await executerDemande(code, deps);
    // Compte anonymisé : sa session tombe tout de suite sur cette instance.
    if (d.etapes.some((e) => e.id === 'compte' && e.statut === 'terminee')) marquerCompteSupprime(userId);
    if (d.motif === 'verifications:abonnement_actif') {
      return NextResponse.json(
        { success: false, error: 'Résiliez d’abord votre abonnement, puis relancez la suppression.', data: statutPublic(d) },
        { status: 409 },
      );
    }
    if (d.motif === 'verifications:compte_protege') {
      return NextResponse.json({ success: false, error: 'Ce compte ne peut pas être supprimé ici.', data: statutPublic(d) }, { status: 403 });
    }
    return NextResponse.json({ success: d.statut === 'terminee', data: statutPublic(d) }, { status: d.statut === 'terminee' ? 200 : 202 });
  } catch (e) {
    console.error('[rgpd] exécution utilisateur interrompue :', e instanceof Error ? e.message : e);
    return NextResponse.json({ success: false, error: 'Suppression interrompue, elle sera reprise.', data: { confirmation_code: code } }, { status: 503 });
  }
}
