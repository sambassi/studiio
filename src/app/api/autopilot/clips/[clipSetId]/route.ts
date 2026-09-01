/**
 * M3-F — LA LECTURE D'UN JEU DE CLIPS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CETTE ROUTE FAIT, ET CE QU'ELLE NE FAIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Elle lit une ligne, et rien d'autre. C'est par elle que l'écran suit
 * l'avancement d'un découpage lancé en 202 : `en_attente`, `en_cours`, puis
 * `reussie` avec ses clips ou `echouee` avec son motif.
 *
 * ⚠️ ELLE N'ÉCRIT RIEN, ET NE FERME RIEN. Consulter l'état d'un travail ne
 * doit pas le terminer : un écran qui rafraîchit toutes les cinq secondes
 * tuerait le découpage qu'il regarde. La récupération des jeux abandonnés
 * appartient à la RELANCE — c'est-à-dire à `creerSet`, et à lui seul. C'est
 * la leçon que la lecture d'analyse de M3-B3 avait déjà tirée.
 *
 * ⚠️ AUCUNE URL SIGNÉE N'EST RENDUE. Chaque clip donne son compartiment et sa
 * clé ; l'accès aux octets passe par le relais de stockage existant, avec sa
 * propre signature brève. Une URL rendue ici serait recopiée par l'écran,
 * conservée, et périmée le lendemain.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lireSetParId } from '@/lib/autopilot/analyse/clip-service';
import { diagnosticSur } from '@/lib/autopilot/analyse/clip-extraction';
import { identifiantValide } from '@/lib/autopilot/analyse/clip-contrat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Une lecture indexée. Rien de plus. */
export const maxDuration = 15;

const SOCLE_ABSENT = 'La table des clips n’existe pas encore sur ce serveur.';

export async function GET(
  _req: NextRequest, { params }: { params: { clipSetId: string } },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!identifiantValide(params.clipSetId)) {
      return NextResponse.json(
        { ok: false, error: 'Identifiant invalide.', motif: 'identifiant_invalide' },
        { status: 422 },
      );
    }

    const { set, motif } = await lireSetParId(session.user.id, params.clipSetId);
    if (motif === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    // Inconnu ou appartenant à autrui : même réponse. Un 403 confirmerait
    // l'existence du travail d'un tiers.
    if (!set) {
      return NextResponse.json({ ok: false, error: 'Clips introuvables' }, { status: 404 });
    }

    return NextResponse.json(
      { ok: true, clipSet: set },
      // `private, no-store` : la réponse dépend de la session, et un cache
      // partagé qui la garderait la servirait au visiteur suivant.
      { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e: unknown) {
    // ⚠️ LE MESSAGE INTERNE NE PART PAS AU CLIENT.
    //
    // Les exceptions qui remontent ici viennent de PostgREST, de MinIO ou de
    // ffmpeg. Leurs messages nomment des tables, des colonnes, des chemins,
    // des hôtes — nous avons vu un « postgres 10.0.0.4:5432 refuse la
    // connexion » sortir d'une lecture ratée. Un 500 est une panne de NOTRE
    // côté : l'appelant n'a rien à en corriger, et rien à en apprendre.
    //
    // Le diagnostic va au journal, URLs masquées, et lui seul.
    console.error(
      `[autopilote][clips] panne inattendue : ${diagnosticSur(
        e instanceof Error ? e.message : String(e),
      )}`,
    );
    return NextResponse.json(
      { ok: false, error: 'Une erreur interne est survenue.', motif: 'erreur_interne' },
      { status: 500 },
    );
  }
}
