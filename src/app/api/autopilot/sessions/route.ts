import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { creerSession, listerSessions } from '@/lib/autopilot/tournage/service';
import {
  CHAMPS_INTERDITS_TOURNAGE, titreValide, contexteValide, metadataValide,
} from '@/lib/autopilot/tournage/contrat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Le message unique quand la migration n'est pas encore appliquée. */
const SOCLE_ABSENT =
  'Sessions de tournage indisponibles : migration '
  + '2026-08-31-shoot-sessions-rushes.sql non appliquée sur ce serveur.';

/**
 * Les sessions de tournage de l'utilisateur connecté.
 *
 * `GET` liste les siennes, les plus récentes d'abord. `POST` en crée une.
 *
 * `user_id` vient de `auth()`, jamais du corps : les champs qui le
 * porteraient sont REFUSÉS en 422, pas ignorés. Un champ ignoré laisse
 * croire qu'il a compté — et c'est précisément ce qu'espère celui qui
 * l'envoie.
 */
export async function GET(_req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { sessions, motif } = await listerSessions(session.user.id);
    if (motif === 'socle_absent') {
      return NextResponse.json({ ok: false, error: SOCLE_ABSENT }, { status: 503 });
    }
    return NextResponse.json({ ok: true, sessions });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'lecture impossible';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

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

    const interdit = CHAMPS_INTERDITS_TOURNAGE.find(
      (c) => Object.prototype.hasOwnProperty.call(corps, c),
    );
    if (interdit) {
      return NextResponse.json(
        { ok: false, error: `Le champ « ${interdit} » est decide par le serveur.` },
        { status: 422 },
      );
    }

    const titre = titreValide(corps.titre);
    if (!titre) {
      return NextResponse.json(
        { ok: false, error: 'Titre requis, non vide, 200 caracteres au plus.' },
        { status: 422 },
      );
    }
    const ctx = contexteValide(corps.contexte);
    if (!ctx.ok) {
      return NextResponse.json(
        { ok: false, error: 'Contexte invalide : texte de 2000 caracteres au plus.' },
        { status: 422 },
      );
    }
    const meta = metadataValide(corps.metadata);
    if (!meta.ok) {
      return NextResponse.json(
        { ok: false, error: 'metadata doit etre un objet.' }, { status: 422 },
      );
    }

    const r = await creerSession(session.user.id, titre, ctx.valeur, meta.valeur);
    if (r.motif === 'socle_absent') {
      return NextResponse.json({ ok: false, error: SOCLE_ABSENT }, { status: 503 });
    }
    return NextResponse.json({ ok: true, session: r.session }, { status: 201 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'creation impossible';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
