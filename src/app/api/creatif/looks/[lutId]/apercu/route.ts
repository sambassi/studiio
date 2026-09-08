/**
 * A_3a — L'APERÇU D'UN LOOK, CALCULÉ PAR LE VRAI MOTEUR.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUN FILTRE CSS. C'EST LA MÊME LUT QUE LA VIDÉO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Approcher un look en CSS (`filter: saturate(1.3)`) coûte trois lignes et
 * ment : le navigateur ne connaît ni `lut3d`, ni l'espace de couleur, ni
 * l'interpolation tétraédrique. La grille montrerait alors des vignettes qui
 * ne ressemblent pas au rendu, et chaque écart passerait pour un bug.
 *
 * Cette route applique donc LE FICHIER `.cube` que le rendu appliquera, avec
 * le même filtre, via le même ffmpeg. Sur une image, pas sur une vidéo : une
 * vignette de quelques kilo-octets, pas un encodage.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUI EST SERVI, ET À QUI
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La source est la vignette d'une analyse — donc un rush qui appartient à la
 * personne connectée, et le service de lecture le vérifie. Sans analyse, on
 * sert une mire fabriquée ici : aucun média tiers n'entre dans ce chemin.
 */
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { auth } from '@/lib/auth/config';
import { cheminFfmpeg } from '@/lib/ffmpeg/binaires';
import { resoudreLut } from '@/lib/autopilot/analyse/rendu-lut';
import {
  resoudreVignette, ouvrirVignette,
} from '@/lib/autopilot/analyse/vignettes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Une vignette d'aperçu est petite : au-delà, ce n'est pas la nôtre. */
const LARGEUR_APERCU = 320;
const TIMEOUT_MS = 8_000;

/**
 * La mire de repli, faite par nous.
 *
 * ⚠️ AUCUN MÉDIA TIERS. Une photo d'illustration téléchargée entrerait sans
 * licence dans une capture d'écran ou une démo.
 */
const MIRE = ['-f', 'lavfi', '-i', `smptebars=size=${LARGEUR_APERCU}x180:duration=1`];

function lancer(args: string[], entree?: Buffer): Promise<Buffer> {
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
    if (entree) proc.stdin.end(entree); else proc.stdin.end();
  });
}

export async function GET(
  req: NextRequest, { params }: { params: { lutId: string } },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    /* ⚠️ L'IDENTIFIANT EST RÉSOLU PAR LE MOTEUR, pas concaténé ici. Un look
       inconnu ne produit aucun chemin, et cette route ne peut donc pas
       devenir une lecture de fichier arbitraire. */
    const issue = resoudreLut({ active: true, lutId: params.lutId, intensite: 1 });
    if (issue.sorte !== 'appliquee') {
      return NextResponse.json({ ok: false, error: 'Look inconnu' }, { status: 404 });
    }

    // ── La source : la vignette du rush, ou la mire ─────────────────────
    let entree: Buffer | null = null;
    const analyseId = req.nextUrl.searchParams.get('analyse');
    if (analyseId) {
      /* ⚠️ LA PROPRIETE EST VERIFIEE PAR LE SERVICE, PAS ICI. `resoudreVignette`
         refuse l'analyse d'autrui et la vignette hors perimetre — le meme
         controle que la route des vignettes, et non une seconde lecture qui
         pourrait en oublier une moitie. */
      const { vignette } = await resoudreVignette(userId, analyseId, 0);
      if (vignette) {
        const flux = await ouvrirVignette(vignette);
        const morceaux: Buffer[] = [];
        for await (const c of flux as AsyncIterable<Buffer>) morceaux.push(c);
        entree = Buffer.concat(morceaux);
      }
    }

    const args = [
      '-hide_banner', '-v', 'error',
      ...(entree ? ['-f', 'image2pipe', '-i', 'pipe:0'] : MIRE),
      '-frames:v', '1',
      '-vf', `scale=${LARGEUR_APERCU}:-2,`
        + `lut3d=file='${issue.lut.chemin}':interp=tetrahedral`,
      '-f', 'image2', '-vcodec', 'mjpeg', '-q:v', '6', 'pipe:1',
    ];
    const jpeg = await lancer(args, entree ?? undefined);

    return new NextResponse(jpeg as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        /* Le fichier ne change que si le look change, et son identifiant
           porte sa version : un cache long est sûr, et c'est ce qui rend la
           grille instantanée au second affichage. */
        'Cache-Control': 'private, max-age=86400, immutable',
      },
    });
  } catch {
    // Le message n'est PAS repris : il porterait un chemin.
    return NextResponse.json({ ok: false, error: 'Aperçu indisponible' }, { status: 503 });
  }
}
