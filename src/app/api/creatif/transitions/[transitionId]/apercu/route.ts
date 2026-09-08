/**
 * A_3d2 — L'APERÇU D'UNE TRANSITION, CALCULÉ PAR LE VRAI MOTEUR.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUNE ANIMATION CSS. C'EST LE MÊME FILTRE QUE LA VIDÉO
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Un `circleopen`, un `pixelize` ou un `hblur` ne se refont pas en CSS : ce
 * sont des transformations par pixel, pas des translations d'élément. Une
 * grille qui les approcherait montrerait vingt-neuf mouvements qui ne
 * ressemblent pas au montage — et chaque écart passerait pour un bug.
 *
 * Cette route applique donc le FILTRE que le rendu appliquera, avec le même
 * ffmpeg, et selon la même règle par famille :
 *
 *   • `xfade` → `xfade=transition=<effet>` — un recouvrement ;
 *   • `fondu-couleur` → deux `fade` internes puis `concat`, exactement comme
 *     `filtreTransition` — donc SANS recouvrement, ce qui est justement leur
 *     différence visible ;
 *   • `coupe` → `concat`, et rien d'autre.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ UN GIF, ET C'EST UNE DÉCISION MESURÉE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le WebP animé pesait quatre fois moins — 4 Ko contre 35 — mais ffmpeg ne
 * sait pas le relire, et `libwebp_anim` fabrique des cadences fausses : sans
 * `-r`, chaque image durait 669 ms au lieu de 62 ; avec `-r`, plus aucune
 * durée n'était écrite. Un aperçu dont on ne peut vérifier ni la vitesse ni
 * le contenu n'est pas un aperçu, c'est une promesse.
 *
 * Le GIF, lui, se relit par ffmpeg ET par n'importe quel outil : 23 images,
 * 36 a 80 Ko, ~50 ms de fabrication. C'est ce qui rend ce chemin
 * vérifiable, et c'est ce qui a décidé.
 */
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { auth } from '@/lib/auth/config';
import { cheminFfmpeg } from '@/lib/ffmpeg/binaires';
import {
  transitionCreativeParId, DUREE_TRANSITION_MIN_MS, DUREE_TRANSITION_MAX_MS,
} from '@/lib/creatif/transitions';
import { resoudreVignette, ouvrirVignette } from '@/lib/autopilot/analyse/vignettes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Une carte de grille : petite, et jamais négociée par le client. */
const LARGEUR = 240;
const HAUTEUR = 135;
const CADENCE = 15;
/** Ce que chaque plan tient à l'écran avant et après le passage. */
const PLAN_SECONDES = 1.0;
const TIMEOUT_MS = 10_000;

/**
 * Les deux images de démonstration, faites par nous.
 *
 * ⚠️ AUCUN MÉDIA TIERS. Une photo d'illustration téléchargée entrerait sans
 * licence dans une capture d'écran ou une démo. Deux dégradés aux couleurs de
 * la marque suffisent à voir un mouvement — et ils appartiennent à Studiio.
 */
const DEMO: readonly [string, string] = [
  `gradients=s=${LARGEUR}x${HAUTEUR}:c0=0x7C3AED:c1=0xEC4899:n=2:d=${PLAN_SECONDES}:r=${CADENCE}`,
  `gradients=s=${LARGEUR}x${HAUTEUR}:c0=0x0A0A0F:c1=0xD91CD2:n=2:d=${PLAN_SECONDES}:r=${CADENCE}`,
];

function lancer(args: string[], entrees: (Buffer | null)[]): Promise<Buffer> {
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
    /* Une seule image peut passer par `pipe:0` ; la seconde, s'il y en a une,
       est écrite dans un fichier temporaire par l'appelant. Ici, les deux
       vignettes arrivent concaténées dans le MÊME flux `image2pipe`, que
       ffmpeg découpe tout seul — c'est ce que ce format sait faire. */
    const utiles = entrees.filter((e): e is Buffer => e !== null);
    if (utiles.length > 0) proc.stdin.end(Buffer.concat(utiles));
    else proc.stdin.end();
  });
}

/** Les vignettes du compte, si l'analyse lui appartient. Sinon `null`. */
async function vignettes(userId: string, analyseId: string | null) {
  if (!analyseId) return null;
  const images: Buffer[] = [];
  for (const rang of [0, 1]) {
    /* ⚠️ LA PROPRIÉTÉ EST VÉRIFIÉE PAR LE SERVICE, PAS ICI. `resoudreVignette`
       refuse l'analyse d'autrui — le même contrôle que la route des
       vignettes, et non une seconde lecture qui pourrait en oublier une
       moitié. */
    const { vignette } = await resoudreVignette(userId, analyseId, rang);
    if (!vignette) break;
    const flux = await ouvrirVignette(vignette);
    const bouts: Buffer[] = [];
    for await (const c of flux as AsyncIterable<Buffer>) bouts.push(c);
    images.push(Buffer.concat(bouts));
  }
  // Il en faut DEUX : une transition entre une image et elle-même ne montre
  // rien. Une seule vignette, et on retombe sur la démonstration.
  return images.length === 2 ? images : null;
}

export async function GET(
  req: NextRequest, { params }: { params: { transitionId: string } },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    /* ⚠️ L'IDENTIFIANT EST RÉSOLU DANS LE CATALOGUE, jamais recopié dans la
       commande. Un identifiant inconnu ne produit aucun nom de filtre. */
    const tr = transitionCreativeParId(params.transitionId);
    if (tr === null) {
      return NextResponse.json({ ok: false, error: 'Transition inconnue' }, { status: 404 });
    }

    const brut = Number(req.nextUrl.searchParams.get('duree'));
    const ms = Number.isFinite(brut) && brut > 0
      ? Math.min(DUREE_TRANSITION_MAX_MS, Math.max(DUREE_TRANSITION_MIN_MS, brut))
      : tr.dureeDefautMs;
    const d = ms / 1000;

    const paire = await vignettes(session.user.id, req.nextUrl.searchParams.get('analyse'));

    const entrees = paire
      ? ['-f', 'image2pipe', '-framerate', String(CADENCE), '-i', 'pipe:0']
      : ['-f', 'lavfi', '-i', DEMO[0], '-f', 'lavfi', '-i', DEMO[1]];
    /* Deux vignettes arrivent dans un seul flux ; il faut alors les tenir à
       l'écran, ce que `loop` fait sur des images fixes. */
    const prep = paire
      ? `[0:v]select='eq(n\\,0)',loop=loop=-1:size=1,trim=duration=${PLAN_SECONDES},`
        + `scale=${LARGEUR}:${HAUTEUR},setsar=1,fps=${CADENCE},format=yuv420p[a];`
        + `[0:v]select='eq(n\\,1)',loop=loop=-1:size=1,trim=duration=${PLAN_SECONDES},`
        + `scale=${LARGEUR}:${HAUTEUR},setsar=1,fps=${CADENCE},format=yuv420p[b]`
      : `[0:v]scale=${LARGEUR}:${HAUTEUR},setsar=1,fps=${CADENCE},format=yuv420p[a];`
        + `[1:v]scale=${LARGEUR}:${HAUTEUR},setsar=1,fps=${CADENCE},format=yuv420p[b]`;

    /* ── LA MÊME RÈGLE QUE LE RENDU, FAMILLE PAR FAMILLE ─────────────── */
    let passage: string;
    if (tr.moteur === 'xfade' && tr.xfadeId) {
      const offset = PLAN_SECONDES - d;
      passage = `[a][b]xfade=transition=${tr.xfadeId}:duration=${d.toFixed(3)}`
        + `:offset=${offset.toFixed(3)}[x]`;
    } else if (tr.moteur === 'fondu-couleur') {
      // Exactement `filtreTransition` : deux fondus INTERNES, puis `concat`.
      const couleur = tr.id === 'flash' ? 'white' : 'black';
      const depart = (PLAN_SECONDES - d).toFixed(3);
      passage = `[a]fade=t=out:st=${depart}:d=${d.toFixed(3)}:color=${couleur}[af];`
        + `[b]fade=t=in:st=0:d=${d.toFixed(3)}:color=${couleur}[bf];`
        + '[af][bf]concat=n=2:v=1:a=0[x]';
    } else {
      passage = '[a][b]concat=n=2:v=1:a=0[x]';
    }

    const args = [
      '-hide_banner', '-v', 'error', '-nostdin',
      ...entrees,
      '-filter_complex',
      `${prep};${passage};`
      // Une palette calculée sur la séquence elle-même : sans elle, un dégradé
      // devient une bouillie de bandes.
      + '[x]split[x1][x2];[x1]palettegen=max_colors=48:stats_mode=diff[p];'
      + '[x2][p]paletteuse=dither=bayer:bayer_scale=5[v]',
      '-map', '[v]', '-f', 'gif', 'pipe:1',
    ];
    const gif = await lancer(args, paire ?? []);

    return new NextResponse(gif as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'image/gif',
        /* ⚠️ LE CACHE EST DÉTERMINISTE. L'adresse porte l'identifiant, la
           version du catalogue, la durée et l'analyse : deux aperçus
           identiques ont la même adresse, et un changement de version en
           donne une autre. Rien n'est recalculé au survol. */
        'Cache-Control': 'private, max-age=86400, immutable',
      },
    });
  } catch {
    // Le message n'est PAS repris : il porterait un chemin.
    return NextResponse.json({ ok: false, error: 'Aperçu indisponible' }, { status: 503 });
  }
}
