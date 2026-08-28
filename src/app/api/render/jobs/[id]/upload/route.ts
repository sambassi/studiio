import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { auth } from '@/lib/auth/config';
import { lireRendu, cloreRendu } from '@/lib/rendus/service';
import { clientMinio } from '@/lib/storage/minio-client';
import {
  TAILLE_MAXIMALE, typeTeleversementAutorise,
} from '@/lib/rendus/cible-upload';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Le relais d'envoi d'un montage — same-origin, authentifie, lie a UNE
 * tentative.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UNE ROUTE DE PLUS, ALORS QUE `/api/storage/upload` EXISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Ce relais-la prend le bucket et le chemin dans la QUERY : c'est le client
 * qui les designe. Ca convient a un rush, dont la cle n'engage rien. Ca ne
 * convient pas a un rendu, dont la cle EST la preuve : le contrat dit que
 * bucket et cle sont decides par le serveur, et rien d'autre ne doit pouvoir
 * les designer.
 *
 * Ici, le seul parametre est l'identifiant de la tentative. Bucket et cle
 * sont relus dans `public.rendus`, pour l'utilisateur de la session. Un
 * client qui voudrait ecrire ailleurs n'a aucun champ pour le dire.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ECHEC = TENTATIVE CLOSE, PAS TENTATIVE OUVERTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Tout refus ici clot la tentative en `failed`. Une tentative laissee
 * `reserved` ne debiterait rien -- mais elle resterait confirmable, et un
 * fichier ecrit plus tard a la meme cle par un autre chemin pourrait la
 * valider. La clore est ce qui rend l'echec definitif.
 *
 * Une seule exception : le stockage injoignable la laisse ouverte, comme a
 * la confirmation. La panne est de notre cote.
 */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
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
    // Inconnue ou appartenant a autrui : meme reponse, pour ne pas reveler
    // l'existence de la tentative d'un tiers.
    if (!rendu) {
      return NextResponse.json({ ok: false, error: 'Rendu introuvable' }, { status: 404 });
    }

    // Deja confirmee, annulee ou echouee : on n'ecrit plus a cette cle. Sans
    // cette garde, un envoi tardif remplacerait le fichier d'un montage deja
    // paye et livre.
    if (rendu.etat !== 'reserved') {
      return NextResponse.json(
        { ok: false, error: 'Tentative close', motif: 'non_reserve', etat: rendu.etat },
        { status: 409 },
      );
    }

    const contentType = req.headers.get('content-type') || '';
    if (!typeTeleversementAutorise(contentType)) {
      await cloreRendu(session.user.id, rendu.id, 'failed', `type refuse: ${contentType.slice(0, 60)}`);
      return NextResponse.json(
        { ok: false, error: 'Type de fichier refuse', motif: 'type_refuse' },
        { status: 415 },
      );
    }

    const annoncee = Number(req.headers.get('content-length') || 0);
    if (annoncee > TAILLE_MAXIMALE) {
      await cloreRendu(session.user.id, rendu.id, 'failed', `trop gros: ${annoncee}`);
      return NextResponse.json(
        { ok: false, error: 'Montage trop volumineux', motif: 'trop_gros' },
        { status: 413 },
      );
    }

    if (!req.body) {
      await cloreRendu(session.user.id, rendu.id, 'failed', 'corps absent');
      return NextResponse.json(
        { ok: false, error: 'Corps absent', motif: 'corps_absent' }, { status: 400 },
      );
    }

    // Bucket et cle viennent de la LIGNE, jamais de la requete.
    const bucket = rendu.bucket;
    const cle = rendu.cle_objet;
    const client = clientMinio();

    try {
      await client.putObject(
        bucket, cle,
        Readable.fromWeb(req.body as never),
        annoncee || undefined,
        { 'Content-Type': contentType.split(';')[0].trim() },
      );
    } catch (e: unknown) {
      await cloreRendu(session.user.id, rendu.id, 'failed', 'ecriture echouee');
      const message = e instanceof Error ? e.message : 'ecriture echouee';
      return NextResponse.json(
        { ok: false, error: message, motif: 'ecriture_echouee' }, { status: 502 },
      );
    }

    // Durabilite : un `putObject` qui resout doit etre immediatement
    // `statObject`-able. La production a deja montre des ecritures qui
    // repondaient 200 puis 404 a la lecture. Repondre un succes non verifie
    // enverrait la confirmation regarder une cle vide.
    let taille = 0;
    try {
      const st = await client.statObject(bucket, cle);
      taille = Number(st.size ?? 0);
    } catch {
      await cloreRendu(session.user.id, rendu.id, 'failed', 'ecriture non durable');
      return NextResponse.json(
        { ok: false, error: 'Ecriture non durable', motif: 'non_durable' }, { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, taille });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'televersement impossible';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
