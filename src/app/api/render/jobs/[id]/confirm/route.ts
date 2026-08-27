import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lireRendu, confirmerRendu, cloreRendu } from '@/lib/rendus/service';
import { verifierObjet } from '@/lib/storage/verifier-objet';

/**
 * Confirme une tentative — et c'est la SEULE porte par laquelle un credit
 * peut partir.
 *
 * Le corps est ignore. Deliberement : rien de ce que le navigateur pourrait
 * dire ici ne constituerait une preuve. Le serveur relit la tentative, va
 * REGARDER l'objet a la cle qu'il avait lui-meme attribuee, et ne debite que
 * s'il l'y trouve, du bon type et d'une taille plausible.
 *
 * Un objet absent ou invalide clot la tentative en `failed` : aucun debit, et
 * elle ne pourra plus etre confirmee. Un stockage injoignable la laisse
 * ouverte — la panne est de notre cote, pas la faute de l'utilisateur.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { rendu, socleAbsent } = await lireRendu(session.user.id, params.id);
    if (socleAbsent) {
      return NextResponse.json(
        { ok: false, error: 'Rendu indisponible : migration des rendus non appliquee.' },
        { status: 503 },
      );
    }
    // Inconnue ou appartenant a autrui : meme reponse. Distinguer les deux
    // revelerait l'existence d'une tentative d'un tiers.
    if (!rendu) {
      return NextResponse.json({ ok: false, error: 'Rendu introuvable' }, { status: 404 });
    }

    // Deja confirmee : on rend le meme resultat, sans rien re-verifier ni
    // re-debiter. Un double clic ou une reprise reseau aboutit ici.
    if (rendu.etat === 'confirmed') {
      const r = await confirmerRendu(session.user.id, rendu.id, 0, '');
      return NextResponse.json({ ok: true, etat: 'confirmed', dejaConfirme: true, balance: r.solde });
    }

    const preuve = await verifierObjet(rendu.bucket, rendu.cle_objet, session.user.id);

    if (!preuve.ok) {
      if (preuve.motif === 'stockage_injoignable') {
        return NextResponse.json(
          { ok: false, error: 'Stockage injoignable', motif: preuve.motif }, { status: 503 },
        );
      }
      await cloreRendu(session.user.id, rendu.id, 'failed', preuve.motif || 'objet invalide');
      return NextResponse.json(
        { ok: false, error: 'Aucun montage valide a cette cle', motif: preuve.motif },
        { status: 422 },
      );
    }

    const r = await confirmerRendu(
      session.user.id, rendu.id, preuve.taille, preuve.contentType,
    );

    if (r.motif === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: 'Rendu indisponible : migration des rendus non appliquee.' },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        ok: r.ok, etat: r.etat, balance: r.solde,
        dejaConfirme: r.dejaConfirme, motif: r.motif,
        taille: preuve.taille,
      },
      { status: r.ok ? 200 : 402 },
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'confirmation impossible';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
