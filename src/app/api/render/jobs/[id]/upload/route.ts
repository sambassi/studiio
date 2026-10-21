import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';
import { auth } from '@/lib/auth/config';
import { lireRendu, cloreRendu } from '@/lib/rendus/service';
import {
  clientMinio, signeurPublic, clientEnvoiDecoupe, signeurPartiesPublic,
} from '@/lib/storage/minio-client';
import { ACTIONS_DECOUPE, traiterActionDecoupe, type ActionDecoupe } from '@/lib/rendus/depot-multipart';
import {
  TAILLE_MAXIMALE, typeTeleversementAutorise,
  cibleTeleversement, urlSortieSure, PRESIGNE_TTL_S,
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

/**
 * POST : la cible d'envoi d'un montage DEJA compose (PR-C).
 *
 * Meme route que le relais, autre methode : `POST` demande OU envoyer, `PUT`
 * envoie par le relais. Le client des rendus ne parle ainsi qu'aux routes
 * jobs / upload / confirm / cancel (contrat `rendu-serveur-isolement`).
 *
 * Appelee par `rendreEtFacturer` entre la composition et le PUT -- jamais a
 * la reservation : une URL presignee remise avant la composition devait
 * survivre a celle-ci (900 s), et survivait d'autant a la confirmation.
 *
 * Remise seulement :
 *   - au proprietaire de la tentative (inconnue ou d'autrui -> 404, meme
 *     reponse, pour ne pas reveler l'existence d'une tentative d'un tiers) ;
 *   - tant qu'elle est `reserved` (confirmee, annulee, echouee -> 409).
 *
 * Mode direct : URL presignee de `PRESIGNE_TTL_S` secondes vers le DEPOT
 * (`cleDepot`), que seul `/confirm` recopie sur la cle du rendu, et seulement
 * tant que la tentative est `reserved`. Sinon : le relais same-origin.
 *
 * Aucun champ de la requete ne designe bucket ni cle : ils viennent de la ligne.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ENVOI DECOUPE (corps JSON `{ action: 'multipart-…' }`)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un montage volumineux part en morceaux de 8 Mio, chacun re-essayable,
 * vers le MEME depot (`lib/rendus/depot-multipart.ts`). Sans corps, la route
 * repond exactement comme avant : la cible d'un envoi en un bloc.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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
    if (!rendu) {
      return NextResponse.json({ ok: false, error: 'Rendu introuvable' }, { status: 404 });
    }
    // Corps facultatif : absent ou illisible = la question historique.
    let corps: Record<string, unknown> = {};
    try {
      const texte = await req.text();
      if (texte) corps = JSON.parse(texte) ?? {};
    } catch { corps = {}; }
    const action = typeof corps.action === 'string' ? corps.action : '';
    if ((ACTIONS_DECOUPE as readonly string[]).includes(action)) {
      try {
        const issue = await traiterActionDecoupe(rendu, action as ActionDecoupe, corps, {
          client: clientEnvoiDecoupe(),
          signeur: signeurPartiesPublic(),
        });
        return NextResponse.json(issue.body, { status: issue.status });
      } catch (e: unknown) {
        // Jamais l'URL ni l'identifiant d'envoi dans le journal : l'action et
        // le message du SDK suffisent au diagnostic.
        const message = e instanceof Error ? e.message.slice(0, 200) : 'stockage';
        console.error(`[Rendus] ${action} a echoue :`, message);
        return NextResponse.json(
          { ok: false, motif: 'stockage_injoignable', error: 'Stockage injoignable' },
          { status: 503 },
        );
      }
    }

    if (rendu.etat !== 'reserved') {
      return NextResponse.json(
        { ok: false, error: 'Tentative close', motif: 'non_reserve', etat: rendu.etat },
        { status: 409 },
      );
    }

    const cible = await cibleTeleversement(
      rendu.id, rendu.bucket, rendu.cle_objet, signeurPublic(),
    );
    if (!urlSortieSure(cible.url)) {
      return NextResponse.json(
        { ok: false, error: 'Televersement indisponible' }, { status: 503 },
      );
    }

    return NextResponse.json({
      ok: true,
      uploadUrl: cible.url,
      uploadMode: cible.mode,
      ...(cible.mode === 'direct' ? { expireDansS: PRESIGNE_TTL_S } : {}),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'cible indisponible';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
