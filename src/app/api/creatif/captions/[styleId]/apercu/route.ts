/**
 * A_4c — L'APERÇU D'UN STYLE DE SOUS-TITRE, PAR LE VRAI MOTEUR.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ LE MÊME DOCUMENT ASS QUE LA VIDÉO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un karaoké se remplit avec `\kf`, un mot actif repeint une portion de
 * texte : ni l'un ni l'autre ne s'imite en CSS. La carte affiche donc une
 * image animée fabriquée par `documentCaptions` — la MÊME fonction que le
 * rendu — passée au MÊME `libass`.
 *
 * ⚠️ UNE PHRASE DE DÉMONSTRATION, PAS LA TRANSCRIPTION. La grille sert à
 * comparer trente et un styles ; y mettre la vraie parole d'un rush ferait
 * trente et un documents différents, incomparables entre eux, et enverrait le
 * texte du compte dans trente et une images de cache.
 */
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { auth } from '@/lib/auth/config';
import { cheminFfmpeg } from '@/lib/ffmpeg/binaires';
import { styleCaptionParId, POSITIONS_CAPTION } from '@/lib/creatif/captions';
import { documentCaptions } from '@/lib/autopilot/analyse/captions-ass';
import { filtreSousTitres } from '@/lib/autopilot/analyse/rendu-ass';
import type { MotMonte } from '@/lib/autopilot/analyse/captions-timeline';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LARGEUR = 288;
const HAUTEUR = 162;
const CADENCE = 15;
const TIMEOUT_MS = 12_000;

/**
 * ⚠️ LA MÊME PHRASE POUR TOUS, ET ELLE EST DE NOUS.
 *
 * Six mots suffisent à montrer un découpage, un mot actif et un remplissage.
 * Les durées sont régulières : l'aperçu compare des STYLES, pas des débits.
 */
const DEMO: readonly MotMonte[] = [
  'Bouge', 'avec', 'nous', 'dès', 'aujourd’hui', '!',
].map((texte, i) => ({
  debutSecondes: i * 0.42,
  finSecondes: i * 0.42 + 0.4,
  texte,
  ordrePlan: 1,
}));

function lancer(args: string[]): Promise<Buffer> {
  return new Promise((resoudre, rejeter) => {
    const proc = spawn(cheminFfmpeg(), args);
    const morceaux: Buffer[] = [];
    const minuterie = setTimeout(() => proc.kill('SIGKILL'), TIMEOUT_MS);
    proc.stdout.on('data', (d: Buffer) => morceaux.push(d));
    proc.on('error', (e) => { clearTimeout(minuterie); rejeter(e); });
    proc.on('close', (code) => {
      clearTimeout(minuterie);
      if (code === 0 && morceaux.length > 0) resoudre(Buffer.concat(morceaux));
      else rejeter(new Error('apercu indisponible'));
    });
    proc.stdin.end();
  });
}

/** Une couleur `#rrggbb`, ou rien. Le reste ne franchit pas cette porte. */
function couleur(v: string | null, defaut: string): string {
  return v !== null && /^#[0-9a-fA-F]{6}$/.test(v) ? v : defaut;
}

export async function GET(
  req: NextRequest, { params }: { params: { styleId: string } },
) {
  let dossier: string | null = null;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    /* ⚠️ L'IDENTIFIANT EST RÉSOLU DANS LE CATALOGUE. Un style inconnu ne
       produit aucun document, donc aucune commande. */
    const base = styleCaptionParId(params.styleId);
    if (base === null) {
      return NextResponse.json({ ok: false, error: 'Style inconnu' }, { status: 404 });
    }
    const positionBrute = req.nextUrl.searchParams.get('position');
    const position = (POSITIONS_CAPTION as readonly string[]).includes(positionBrute ?? '')
      ? positionBrute as typeof base.position : base.position;
    const style = { ...base, position };

    const doc = documentCaptions(
      DEMO, style,
      { largeur: LARGEUR, hauteur: HAUTEUR, margeHautPct: 6, margeBasPct: 8 },
      {
        texte: couleur(req.nextUrl.searchParams.get('texte'), '#FFFFFF'),
        accent: couleur(req.nextUrl.searchParams.get('accent'), '#EC4899'),
      },
    );
    if (doc === null) {
      return NextResponse.json({ ok: false, error: 'Aperçu indisponible' }, { status: 503 });
    }

    dossier = await mkdtemp(join(tmpdir(), 'apercu-caption-'));
    const ass = join(dossier, 'c.ass');
    await writeFile(ass, doc.contenu, 'utf8');

    const args = [
      '-hide_banner', '-v', 'error', '-nostdin',
      // Un fond neutre, fabriqué ici : aucun média tiers dans ce chemin.
      '-f', 'lavfi', '-i',
      `gradients=s=${LARGEUR}x${HAUTEUR}:c0=0x1A1A24:c1=0x0A0A0F:n=2:d=3:r=${CADENCE}`,
      '-filter_complex',
      `[0:v]${filtreSousTitres(ass, null)},format=yuv420p[x];`
      + '[x]split[x1][x2];[x1]palettegen=max_colors=48:stats_mode=diff[p];'
      + '[x2][p]paletteuse=dither=bayer:bayer_scale=5[v]',
      '-map', '[v]', '-f', 'gif', 'pipe:1',
    ];
    const gif = await lancer(args);

    return new NextResponse(gif as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'image/gif',
        /* L'adresse porte l'identifiant, la version du moteur, la position et
           les deux couleurs : deux aperçus identiques ont la même adresse. */
        'Cache-Control': 'private, max-age=86400, immutable',
      },
    });
  } catch {
    // Le message n'est PAS repris : il porterait un chemin.
    return NextResponse.json({ ok: false, error: 'Aperçu indisponible' }, { status: 503 });
  } finally {
    if (dossier) await rm(dossier, { recursive: true, force: true }).catch(() => {});
  }
}
