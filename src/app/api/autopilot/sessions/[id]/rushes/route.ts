import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { indexerRush, listerRushes } from '@/lib/autopilot/tournage/service';
import {
  CHAMPS_INTERDITS_TOURNAGE, metadataValide, NOM_ORIGINE_MAX,
} from '@/lib/autopilot/tournage/contrat';
import { bucketAutorise } from '@/lib/storage/buckets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SOCLE_ABSENT =
  'Sessions de tournage indisponibles : migration '
  + '2026-08-31-shoot-sessions-rushes.sql non appliquée sur ce serveur.';

/** Ce que l'écran comprend quand le stockage refuse l'objet. */
const REFUS_STOCKAGE: Record<string, string> = {
  objet_absent: 'Le fichier n’est pas arrivé jusqu’au stockage.',
  cle_hors_perimetre: 'Ce fichier n’appartient pas à votre espace.',
  type_refuse: 'Ce fichier n’est pas une vidéo exploitable.',
  trop_petit: 'Le fichier est vide ou incomplet.',
  stockage_injoignable: 'Le stockage est momentanément injoignable. Réessayez.',
};

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { rushes, motif } = await listerRushes(session.user.id, params.id);
    if (motif === 'socle_absent') {
      return NextResponse.json({ ok: false, error: SOCLE_ABSENT }, { status: 503 });
    }
    if (motif === 'session_introuvable') {
      return NextResponse.json({ ok: false, error: 'Session introuvable' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, rushes });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'lecture impossible';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * Indexe un rush déjà téléversé dans cette session.
 *
 * Le corps ne porte que la CLÉ de l'objet — `bucket` et `path`, exactement ce
 * que `/api/upload/signed-url` a attribué — plus un nom d'origine facultatif.
 * Ni identité, ni rang, ni état : le serveur les décide.
 *
 * Le fichier est VÉRIFIÉ dans le stockage avant d'être indexé. Le navigateur
 * téléverse directement vers MinIO : l'application n'est pas dans le chemin
 * de la requête et ne peut rien déduire d'un « c'est envoyé » qu'on lui
 * rapporte.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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

    const bucket = typeof corps.bucket === 'string' ? corps.bucket.trim() : '';
    const cleObjet = typeof corps.path === 'string' ? corps.path.trim() : '';
    if (!bucket || !cleObjet) {
      return NextResponse.json(
        { ok: false, error: '`bucket` et `path` sont requis.' }, { status: 422 },
      );
    }
    // Le compartiment vient du navigateur : il passe par la MEME liste
    // blanche que les deux chemins d'envoi. Sans elle, un nom libre
    // laisserait viser un compartiment que l'application ne gere pas.
    if (!bucketAutorise(bucket)) {
      return NextResponse.json(
        { ok: false, error: 'Compartiment de stockage non autorise.' }, { status: 422 },
      );
    }
    const nomBrut = corps.nomOrigine;
    if (nomBrut !== undefined && nomBrut !== null && typeof nomBrut !== 'string') {
      return NextResponse.json(
        { ok: false, error: '`nomOrigine` doit etre une chaine.' }, { status: 422 },
      );
    }
    const nomOrigine = typeof nomBrut === 'string' && nomBrut.trim()
      ? nomBrut.trim().slice(0, NOM_ORIGINE_MAX) : null;

    const meta = metadataValide(corps.metadata);
    if (!meta.ok) {
      return NextResponse.json(
        { ok: false, error: 'metadata doit etre un objet.' }, { status: 422 },
      );
    }

    const r = await indexerRush(session.user.id, params.id, {
      bucket, cleObjet, nomOrigine, metadata: meta.valeur,
    });

    if (r.motif === 'socle_absent') {
      return NextResponse.json({ ok: false, error: SOCLE_ABSENT }, { status: 503 });
    }
    if (r.motif === 'session_introuvable') {
      return NextResponse.json({ ok: false, error: 'Session introuvable' }, { status: 404 });
    }
    if (r.motif === 'objet_absent') {
      const cause = r.refusStockage ?? '';
      // Le stockage injoignable est de notre côté : 503, pas 422.
      const statut = cause === 'stockage_injoignable' ? 503 : 422;
      return NextResponse.json(
        {
          ok: false,
          error: REFUS_STOCKAGE[cause] ?? 'Le fichier n’a pas pu être vérifié.',
          motif: cause || null,
        },
        { status: statut },
      );
    }
    return NextResponse.json({ ok: true, rush: r.rush }, { status: 201 });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'indexation impossible';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
