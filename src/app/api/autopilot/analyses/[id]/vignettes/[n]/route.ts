import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { auth } from '@/lib/auth/config';
import {
  resoudreVignette, ouvrirVignette, indexVignetteValide, TYPE_VIGNETTE,
} from '@/lib/autopilot/analyse/vignettes';

/**
 * Une vignette d'analyse, servie par l'application — jamais par une URL.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE LE NAVIGATEUR PEUT DEMANDER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Deux choses, et deux seulement : un identifiant d'analyse et un ENTIER.
 * Ni compartiment, ni clé, ni chemin — ces paramètres n'existent pas, ni
 * dans le chemin, ni dans la chaîne de requête, ni dans un corps qui n'est
 * jamais lu. La clé est LUE dans la ligne `rush_analyses`, relue sous
 * `.eq('user_id', …)`, à la position demandée.
 *
 * C'est là toute la différence avec une URL pré-signée : il n'y a pas de clé
 * à valider, parce qu'aucune clé ne peut entrer. Le raisonnement complet est
 * dans `src/lib/autopilot/analyse/vignettes.ts`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI UNE ROUTE SÉPARÉE DE `GET …/rushes/[id]/analyse`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Parce que celle-là rend du JSON d'ÉTAT, appelée en boucle pendant qu'une
 * analyse tourne, et que sa réponse ne doit contenir — deux tests le
 * vérifient — ni compartiment, ni clé, ni `://`. Un octet d'image n'a rien à
 * y faire.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI PAS SOUS `/rushes/[id]/…`
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La propriété d'une analyse suffit : `lireAnalyse` filtre sur `user_id`, et
 * une analyse appartient à un seul rush, lui-même à un seul utilisateur.
 * Ajouter le rush au chemin obligerait à le relire à CHAQUE vignette — huit
 * lectures de plus par planche, sur le processus Node qui fait aussi tourner
 * ffmpeg, pour une garantie déjà acquise.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 404 PARTOUT, ET C'EST VOLONTAIRE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Analyse inconnue, analyse d'autrui, index hors liste, clé incohérente :
 * une seule et même réponse. Un 403 sur l'analyse d'un tiers confirmerait
 * son existence ; un 404 distinct par cause laisserait énumérer.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SOCLE_ANALYSE_ABSENT =
  'Analyses indisponibles : migration '
  + '2026-09-01-rush-analyses.sql non appliquée sur ce serveur.';

const introuvable = () => NextResponse.json(
  { ok: false, error: 'Vignette introuvable' }, { status: 404 },
);

/**
 * Les en-têtes de la réponse image.
 *
 * `Content-Type` est DÉCIDÉ par nous (`TYPE_VIGNETTE`), jamais lu sur
 * l'objet : un fichier déposé par un autre chemin ne doit pas pouvoir se
 * faire servir en HTML depuis notre origine. `nosniff` ferme la seconde
 * moitié de la même porte, et la politique `default-src 'none'` la troisième.
 *
 * `no-store` : la réponse dépend de la session. Un cache — navigateur
 * partagé, intermédiaire — la servirait à qui n'y a pas droit.
 */
const ENTETES_IMAGE: Record<string, string> = {
  'Content-Type': TYPE_VIGNETTE,
  'Content-Disposition': 'inline',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cache-Control': 'private, no-store, max-age=0',
};

export async function GET(
  _req: NextRequest, { params }: { params: { id: string; n: string } },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    // L'index est validé AVANT toute lecture : un segment qui n'est pas un
    // entier ne doit pas coûter une requête à la base.
    const index = indexVignetteValide(params.n ?? '');
    if (index === null) return introuvable();

    const { vignette, motif } = await resoudreVignette(userId, params.id, index);
    if (motif === 'socle_absent') {
      return NextResponse.json(
        { ok: false, error: SOCLE_ANALYSE_ABSENT, motif: 'socle_absent' }, { status: 503 },
      );
    }
    // `analyse_introuvable`, `vignette_introuvable`, `vignette_hors_perimetre` :
    // une seule réponse pour les trois. Voir l'en-tête de fichier.
    if (!vignette) return introuvable();

    let flux: NodeJS.ReadableStream;
    try {
      flux = await ouvrirVignette(vignette);
    } catch {
      // Objet disparu, stockage injoignable, délai dépassé. On ne distingue
      // pas : le message ne dirait rien d'utile à un écran, et une cause
      // détaillée renseignerait sur le stockage.
      return NextResponse.json(
        { ok: false, error: 'Vignette illisible', motif: 'stockage_injoignable' },
        { status: 502 },
      );
    }

    // Le flux Node devient un flux web SANS être matérialisé : pas de
    // `Buffer`, pas de `arrayBuffer()`, pas de fichier temporaire. Les octets
    // vont de MinIO à la réponse.
    const corps = Readable.toWeb(Readable.from(flux)) as ReadableStream;
    return new NextResponse(corps, { status: 200, headers: ENTETES_IMAGE });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'lecture de vignette impossible';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
