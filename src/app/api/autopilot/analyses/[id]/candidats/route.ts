/**
 * M3-C — LA ROUTE DES CANDIDATS DE MONTAGE.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'ELLE GARANTIT, ET DANS QUEL ORDRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. La session, et rien d'autre, décide de `user_id`.
 *   2. L'analyse est lue AVEC le filtre de propriété : une analyse d'autrui
 *      ne revient pas, donc il n'y a rien à décider ici.
 *   3. Elle doit être `reussie` : générer des candidats depuis une analyse
 *      échouée reviendrait à travailler sur un résultat qu'on sait faux.
 *   4. La ligne de génération est créée AVANT tout travail — elle existe
 *      donc même si le processus meurt.
 *   5. L'idempotence est portée par `rush_candidate_sets_active_unique`, EN
 *      BASE. Cette route ne fait aucun `select` qui autoriserait l'insertion.
 *   6. Le moteur est appelé UNE fois. Aucune reprise.
 *
 * ⚠️ AUCUN DÉBIT DE CRÉDITS. `usage` est une mesure. Ce fichier n'importe pas
 * `@/lib/credits`, et un test le vérifie.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { lireAnalyse } from '@/lib/autopilot/analyse/service';
import { lireDerniereGeneration } from '@/lib/autopilot/analyse/candidat-service';
import {
  SOCLE_CANDIDATS_ABSENT, genererCandidatsPourAnalyse,
} from '@/lib/autopilot/analyse/candidat-orchestration';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Le budget de la plateforme.
 *
 * Une requête au fournisseur bornée à quarante secondes, plus la lecture de
 * huit images. Cent vingt secondes laissent une marge large sans jamais
 * laisser une génération courir indéfiniment.
 */
export const maxDuration = 120;

/** Le message d'un socle non appliqué — le même esprit qu'en M3-B1. */

/** Ce que chaque motif d'étape dit à l'écran, et avec quel statut. */

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    // L'analyse d'abord : une génération ne se lit pas sans son analyse, et
    // le filtre de propriété vit dans cette lecture.
    const { analyse, motif } = await lireAnalyse(userId, params.id);
    if (motif === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_CANDIDATS_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    // Inconnue ou appartenant à autrui : même réponse. Un 403 confirmerait
    // l'existence de l'analyse d'un tiers.
    if (!analyse) {
      return NextResponse.json({ ok: false, error: 'Analyse introuvable' }, { status: 404 });
    }

    const { generation, motif: motifGen } = await lireDerniereGeneration(userId, params.id);
    if (motifGen === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_CANDIDATS_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    return NextResponse.json({ ok: true, generation });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 },
    );
  }
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    /* ⚠️ L'ORCHESTRATION A DÉMÉNAGÉ — LA ROUTE N'EN GARDE QUE L'HABILLAGE.
       Les 200 lignes qui vivaient ici sont dans `candidat-orchestration.ts`,
       mot pour mot : seuls les quatorze `NextResponse.json(x, {status:n})`
       sont devenus `reponse(x, n)`. La raison n'est pas esthétique — tant que
       ce bloc était ici, « Trouver les meilleurs passages » exigeait une
       session, et l'Autopilote automatique devait attendre qu'un humain
       clique. Le cron appelle désormais la MÊME fonction. */
    const r = await genererCandidatsPourAnalyse(userId, params.id);
    return NextResponse.json(r.corps, { status: r.statut });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erreur' }, { status: 500 },
    );
  }
}
