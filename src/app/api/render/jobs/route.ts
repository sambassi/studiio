import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { supabaseAdmin } from '@/lib/db/supabase';
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

    const { data: signe, error: eSigne } = await supabaseAdmin
      .storage.from(rendu.bucket).createSignedUploadUrl(rendu.cle);

    if (eSigne || !signe?.signedUrl) {
      return NextResponse.json(
        { ok: false, error: 'Televersement indisponible' }, { status: 503 },
      );
    }

    // URL publique de LA cle attribuee — pour que l'appelant puisse la poser
    // comme media d'un post sans jamais inventer de chemin.
    const base = process.env.PUBLIC_STORAGE_URL
      || (process.env.NEXT_PUBLIC_APP_URL
        ? `${process.env.NEXT_PUBLIC_APP_URL}/storage/v1/object/public`
        : '/storage/v1/object/public');

    return NextResponse.json({
      ok: true,
      jobId: rendu.id,
      cout: rendu.cout,
      uploadUrl: signe.signedUrl,
      publicUrl: `${base}/${rendu.bucket}/${rendu.cle}`,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'reservation impossible';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
