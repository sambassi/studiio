/**
 * UX-A1 — LE RENDU D'UNE SESSION, POUR L'ÉCRAN.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QU'ELLE FAIT, ET CE QU'ELLE NE FAIT PAS
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Elle répond à UNE question : « ce tournage a-t-il produit une vidéo ? ».
 *
 * ⚠️ ELLE NE LANCE RIEN. Pas de rendu, pas de plan, pas de clip, pas de
 * ffmpeg, pas de place de capacité, pas de crédit. Un GET qui déclencherait
 * du travail serait rejoué par chaque préchargement de lien, chaque sonde de
 * disponibilité et chaque rafraîchissement d'onglet. La création appartient
 * au POST de M3-H, et à lui seul.
 *
 * ⚠️ ELLE N'ÉCRIT RIEN NON PLUS — pas même une récupération de rendus
 * abandonnés. C'est la leçon de M3-B3, reprise en M3-F, M3-G et par la
 * lecture d'un rendu : consulter l'avancement ne doit pas le terminer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * UN RENDU, PAS UNE LISTE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `rendu` est au singulier, et c'est délibéré. La base sait porter plusieurs
 * rendus par session — un par format et par durée cible — mais rien dans le
 * produit ne sait aujourd'hui les distinguer autrement que par leurs
 * dimensions. Rendre un tableau que l'écran nommerait « version courte » /
 * « version longue » inventerait une donnée que le serveur n'a pas.
 *
 * ⚠️ ET C'EST `renduPublic` QUI PROJETTE, comme partout ailleurs en M3-H :
 * ni `montagePlanId`, ni méthode d'encodage, ni compartiment, ni clé de
 * stockage, ni relevé d'exécution. Le fichier se lit par la route sœur
 * `/api/autopilot/rendus-montage/[renduId]/fichier`, qui refait le contrôle
 * de propriété à chaque requête.
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth/config';
import { identifiantValide } from '@/lib/autopilot/analyse/clip-contrat';
import { lireRenduDeSession } from '@/lib/autopilot/analyse/rendu-session';
import { renduPublic } from '@/lib/autopilot/analyse/rendu-presentation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** Quatre lectures indexées, aucun travail. */
export const maxDuration = 15;

const SOCLE_ABSENT = 'La création vidéo n’est pas encore activée sur ce serveur.';

export async function GET(
  _req: NextRequest, { params }: { params: { id: string } },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!identifiantValide(params.id)) {
      return NextResponse.json(
        { ok: false, error: 'Identifiant invalide.', motif: 'identifiant_invalide' },
        { status: 422 },
      );
    }

    const { rendu, motif } = await lireRenduDeSession(session.user.id, params.id);

    if (motif === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    // Inconnue ou appartenant à autrui : même réponse. Un 403 confirmerait
    // l'existence du tournage d'un tiers.
    if (motif === 'session_introuvable') {
      return NextResponse.json(
        { ok: false, error: 'Session introuvable' }, { status: 404 },
      );
    }

    return NextResponse.json(
      { ok: true, rendu: rendu ? renduPublic(rendu) : null },
      // `private, no-store` : la réponse dépend de la session, et un cache
      // partagé qui la garderait la servirait au visiteur suivant.
      { status: 200, headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (e: unknown) {
    // ⚠️ LE DÉTAIL PART AU JOURNAL, PAS DANS LA RÉPONSE. Un message de
    // PostgREST nomme des tables et des colonnes.
    console.error(
      '[autopilote][rendu-session] lecture impossible :',
      e instanceof Error ? e.message : String(e),
    );
    return NextResponse.json(
      { ok: false, error: 'Une erreur interne est survenue.', motif: 'erreur_interne' },
      { status: 500 },
    );
  }
}
