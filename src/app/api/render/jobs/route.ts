import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import {
  urlRelais, urlSortieSure, urlPubliqueRendu,
} from '@/lib/rendus/cible-upload';
import {
  reserverRendu, OPERATIONS, FORMATS, CHAMPS_INTERDITS_RENDU,
  type Operation, type Format,
} from '@/lib/rendus/service';

/**
 * Ouvre une tentative de rendu.
 *
 * Le corps ne porte que `{ operation, format }` — deux valeurs contraintes a
 * une liste. Tout le reste est fabrique ici : l'identifiant, la cle de
 * stockage, le cout (lu dans `tarifs_rendu`), et l'utilisateur (la session).
 *
 * La reponse contient l'URL pre-signee vers LA cle attribuee. Le navigateur
 * ne peut ecrire que la, et c'est exactement cet objet que le serveur ira
 * regarder avant de confirmer.
 *
 * Reserver ne debite RIEN.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try { body = await req.json(); } catch {
      return NextResponse.json({ ok: false, error: 'Corps JSON invalide' }, { status: 400 });
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return NextResponse.json({ ok: false, error: 'Corps invalide' }, { status: 422 });
    }
    const corps = body as Record<string, unknown>;

    const interdit = CHAMPS_INTERDITS_RENDU.find(
      (c) => Object.prototype.hasOwnProperty.call(corps, c),
    );
    if (interdit) {
      return NextResponse.json(
        { ok: false, error: `Le champ « ${interdit} » est decide par le serveur.` },
        { status: 422 },
      );
    }

    const operation = corps.operation as Operation;
    const format = corps.format as Format;
    if (!OPERATIONS.includes(operation)) {
      return NextResponse.json({ ok: false, error: 'operation invalide' }, { status: 400 });
    }
    if (!FORMATS.includes(format)) {
      return NextResponse.json({ ok: false, error: 'format invalide' }, { status: 400 });
    }

    const { rendu, motif } = await reserverRendu(session.user.id, operation, format);
    if (!rendu) {
      if (motif === 'socle_absent') {
        return NextResponse.json(
          { ok: false, error: 'Rendu indisponible : migration des rendus non appliquee.' },
          { status: 503 },
        );
      }
      return NextResponse.json({ ok: false, error: motif || 'reservation impossible' }, { status: 400 });
    }

    // ── OU LE NAVIGATEUR ENVOIE ──────────────────────────────────────
    // PR-C : AUCUNE URL presignee n'est remise ici. Elle l'etait, valable
    // 900 s, alors que la composition n'avait pas commence -- et elle visait
    // la cle du rendu, si bien qu'elle reecrivait encore le montage apres sa
    // confirmation. La cible directe (courte, vers le DEPOT) est desormais
    // demandee APRES la composition : `POST /api/render/jobs/<id>/upload`.
    //
    // La reservation rend le relais same-origin : il relit l'etat en base et
    // refuse toute ecriture hors `reserved`. C'est aussi la cible qu'utilise
    // un onglet ouvert avant ce deploiement : il continue de fonctionner.
    const cible = { url: urlRelais(rendu.id), mode: 'relais' as const };

    // Garde de dernier recours : rien d'inatteignable ou de non chiffre ne
    // sort d'ici.
    if (!urlSortieSure(cible.url)) {
      return NextResponse.json(
        { ok: false, error: 'Televersement indisponible' }, { status: 503 },
      );
    }

    return NextResponse.json({
      ok: true,
      jobId: rendu.id,
      cout: rendu.cout,
      uploadUrl: cible.url,
      uploadMode: cible.mode,
      // URL de LA cle attribuee, pour poser le montage comme media d'un post
      // APRES la confirmation (`rendreEtFacturer` ne la livre qu'alors).
      // PR-C : elle est INUTILISABLE avant -- le relais de lecture ne sert
      // `<uid>/rendus/…` qu'a la session du proprietaire (ou a un jeton qu'il
      // a lui-meme obtenu), et en mode direct rien n'est a cette cle avant
      // que `/confirm` n'y recopie le depot. Gardee dans la reponse pour les
      // onglets ouverts avant le deploiement, qui la lisent ici.
      publicUrl: urlPubliqueRendu(rendu.bucket, rendu.cle),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'reservation impossible';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
