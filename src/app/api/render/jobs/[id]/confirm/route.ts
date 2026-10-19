import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lireRendu } from '@/lib/rendus/service';
import { confirmerAvecPreuve } from '@/lib/rendus/confirmation';
import { promouvoirDepot } from '@/lib/rendus/depot';

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

    // ── PR-C : le DEPOT de l'URL presignee ───────────────────────────
    // L'URL presignee (mode direct) n'ecrit jamais la cle du rendu, mais son
    // depot. Tant que la tentative est `reserved`, on recopie le depot sur la
    // cle du rendu ; ensuite, plus jamais : un envoi tardif vers le depot,
    // meme avec une URL encore valide, n'atteint plus le montage confirme.
    // Sans endpoint public, aucun depot ne peut exister : rien n'est tente.
    // Le debit, lui, reste entierement dans `confirmerAvecPreuve`, inchange.
    if (rendu.etat === 'reserved' && process.env.MINIO_PUBLIC_ENDPOINT) {
      const promotion = await promouvoirDepot(rendu.bucket, rendu.cle_objet);
      if (promotion === 'injoignable') {
        return NextResponse.json(
          { ok: false, error: 'Stockage injoignable', motif: 'stockage_injoignable' },
          { status: 503 },
        );
      }
    }

    // Preuve + politique : la logique vit dans `confirmerAvecPreuve`, la
    // MEME porte que celle du rendu serveur (A2.3).
    const issue = await confirmerAvecPreuve(session.user.id, rendu);
    return NextResponse.json(issue.body, { status: issue.status });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'confirmation impossible';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
