/**
 * RENDU HYBRIDE — la commande ffmpeg, construite à partir du plan (PUR).
 *
 *   plan Smart Montage V3 ──▶ ffmpeg : coupe, ralenti, recadrage 9:16,
 *                                      mise bout à bout, audio
 *   surimpressions      ──▶ images fixes (Remotion `renderStill`) posées par
 *                           ffmpeg avec le MÊME fondu / glissement que le
 *                           rendu complet (0,3 s, 24 px)
 *
 * Chromium ne voit plus aucune image vidéo : il ne dessine que quelques
 * images fixes. Les règles de temps reprennent EXACTEMENT celles de la
 * composition Remotion (`CreerSimpleMontage`) :
 *   - extrait k : de round(debut·fps) à round(fin·fps) (images), lu depuis
 *     `depuis`, à `vitesse` (ralenti) ;
 *   - recadrage « cover » centré (objectFit: cover) ;
 *   - surimpression : de round(a·fps), durée max(1, round((b−a)·fps)),
 *     opacité = min(entrée, sortie) sur round(0,3·fps) images, texte glissant
 *     de 24 px à l'entrée, voile fixe ;
 *   - musique en boucle, volumes CONSTANTS (`mixAt` sans images-clés).
 */

import { BASE_L, BASE_H, BASE_FPS } from '@/lib/creer/conseiller/lisibilite';

export interface SegmentHybride {
  /** Fichier lisible par ffmpeg (proxy / URL interne). */
  source: string;
  debut: number;
  fin: number;
  depuis: number;
  vitesse?: number;
}

/** Zone non transparente d'une image fixe (px de la vidéo) : x, y, largeur, hauteur. */
export type BoiteImage = [number, number, number, number];

export interface FenetreSurimpression {
  /** Image fixe du TEXTE (glisse à l'entrée). */
  texte: string;
  /** Zone utile du texte : seule elle est animée et posée (le reste est transparent). */
  boite?: BoiteImage | null;
  debut: number;
  fin: number;
}

export interface EntreeHybride {
  segments: SegmentHybride[];
  /** Durée totale (s) = celle du plan. */
  duree: number;
  fps: number;
  largeur: number;
  hauteur: number;
  /** Voile dégradé, posé sous chaque texte (sans glissement). */
  voile: string | null;
  /** Filigrane, présent tout du long. */
  filigrane: string | null;
  /** Zone utile du filigrane. */
  boiteFiligrane?: BoiteImage | null;
  surimpressions: FenetreSurimpression[];
  musique: { source: string; volume: number } | null;
  voix: Array<{ source: string; depart: number; volume: number }>;
  sortie: string;
  /**
   * CONSEILLER : écrit AUSSI la vidéo de base (sans textes) en petit
   * (`BASE_L`×`BASE_H` gris, `BASE_FPS` i/s) dans ce fichier, dans le même
   * passage. Absent : rien de plus.
   */
  analyseBase?: string | null;
}

const f3 = (n: number) => (Math.round(n * 1000) / 1000).toString();

/** Images de l'extrait, comme Remotion (bornes arrondies à l'image). Pur. */
export function imagesSegment(s: { debut: number; fin: number }, fps: number): number {
  return Math.max(1, Math.round(s.fin * fps) - Math.round(s.debut * fps));
}

export function argumentsHybride(e: EntreeHybride): string[] {
  const { fps, largeur: W, hauteur: H } = e;
  const totalImages = Math.round(e.duree * fps);
  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:2', '-y'];
  const filtres: string[] = [];
  let n = 0;

  // ── 1. Extraits : un input par extrait, positionné AVANT -i (rapide et
  // exact en réencodage), juste la matière nécessaire (+1 s de marge). ──
  const etiquettesVideo: string[] = [];
  e.segments.forEach((s, k) => {
    const vitesse = s.vitesse && s.vitesse > 0 ? s.vitesse : 1;
    const images = imagesSegment(s, fps);
    const besoinSource = (images / fps) * vitesse + 1;
    args.push('-ss', f3(Math.max(0, s.depuis)), '-t', f3(besoinSource), '-i', s.source);
    filtres.push(
      `[${n}:v]setpts=(PTS-STARTPTS)/${vitesse},`
      // Recadrage « cover » centré, COUPÉ AVANT la mise à l'échelle : une
      // source 16:9 n'est plus agrandie à 3413×1920 pour en jeter les deux
      // tiers. Même cadre (centré, à moins d'un pixel près).
      + `crop='min(iw\\,ih*${W}/${H})':'min(ih\\,iw*${H}/${W})',scale=${W}:${H}:flags=bicubic,setsar=1,`
      + `fps=${fps},tpad=stop_mode=clone:stop=${images},trim=end_frame=${images},setpts=PTS-STARTPTS[v${k}]`,
    );
    etiquettesVideo.push(`[v${k}]`);
    n += 1;
  });
  if (e.analyseBase) {
    filtres.push(`${etiquettesVideo.join('')}concat=n=${e.segments.length}:v=1:a=0,format=yuva420p,split=2[base0][analyse0]`);
    filtres.push(`[analyse0]fps=${BASE_FPS},scale=${BASE_L}:${BASE_H}:flags=area,format=gray[analyse]`);
  } else {
    filtres.push(`${etiquettesVideo.join('')}concat=n=${e.segments.length}:v=1:a=0,format=yuva420p[base0]`);
  }

  // ── 2. Surimpressions : voile (fixe) + texte (glisse), fondu 0,3 s ──
  const bord = Math.max(1, Math.round(0.3 * fps));
  let courant = 'base0';
  let etape = 0;
  // ⚠️ Chaque image fixe est DÉCODÉE UNE FOIS puis répétée (`loop`) : avec
  // `-loop 1` à l'entrée, le PNG 1080×1920 était redécodé à CHAQUE image de
  // sa fenêtre. Et seule sa zone utile (`boite`) est animée et posée : le
  // reste est transparent, le poser ne change rien. Mesuré sur le plan DANSE.
  const fixe = (i: number, nbImages: number, boite: BoiteImage | null | undefined) => (
    `[${i}:v]format=rgba${boite ? `,crop=${boite[2]}:${boite[3]}:${boite[0]}:${boite[1]}` : ''},`
    + `loop=loop=${Math.max(0, nbImages - 1)}:size=1:start=0,setpts=N/(${fps}*TB)`
  );
  const poser = (image: string, debutImg: number, dureeImg: number, glisse: boolean, boite?: BoiteImage | null) => {
    const i = n;
    args.push('-i', image);
    n += 1;
    // Opacité : entrée et sortie de `bord` images — `CoucheOverlayAnimee`.
    const sortie = Math.max(0, dureeImg - bord);
    filtres.push(
      `${fixe(i, dureeImg, boite)},fade=t=in:start_frame=0:nb_frames=${bord}:alpha=1,`
      + `fade=t=out:start_frame=${sortie}:nb_frames=${bord}:alpha=1,setpts=PTS-STARTPTS+${debutImg}/(${fps}*TB)[s${etape}]`,
    );
    const x = boite ? boite[0] : 0;
    const y0 = boite ? boite[1] : 0;
    const y = glisse ? `'${y0}+round((1-min(1\\,max(0\\,(n-${debutImg})/${bord})))*24)'` : String(y0);
    filtres.push(`[${courant}][s${etape}]overlay=x=${x}:y=${y}:eof_action=pass:format=auto[base${etape + 1}]`);
    courant = `base${etape + 1}`;
    etape += 1;
  };
  for (const o of e.surimpressions) {
    const debutImg = Math.round(o.debut * fps);
    const dureeImg = Math.max(1, Math.round((o.fin - o.debut) * fps));
    if (e.voile) poser(e.voile, debutImg, dureeImg, false);
    poser(o.texte, debutImg, dureeImg, true, o.boite);
  }
  if (e.filigrane) {
    const i = n;
    args.push('-i', e.filigrane);
    n += 1;
    const b = e.boiteFiligrane;
    filtres.push(`${fixe(i, totalImages, b)}[fil]`);
    filtres.push(`[${courant}][fil]overlay=${b ? b[0] : 0}:${b ? b[1] : 0}:format=auto[base${etape + 1}]`);
    courant = `base${etape + 1}`;
    etape += 1;
  }
  // Horodatage RÉGULIER : image N à N/fps. Sans lui, la synchronisation des
  // surimpressions laissait des horodatages irréguliers, que le multiplexeur
  // « corrigeait » en doublant / sautant des images — le montage glissait de
  // plusieurs secondes par rapport au plan.
  filtres.push(`[${courant}]format=yuv420p,trim=end_frame=${totalImages},setpts=N/(${fps}*TB)[vout]`);

  // ── 3. Audio : musique en boucle + voix à leurs départs, volumes fixes ──
  const pistes: string[] = [];
  if (e.musique) {
    args.push('-stream_loop', '-1', '-i', e.musique.source);
    filtres.push(`[${n}:a]atrim=0:${f3(e.duree)},asetpts=PTS-STARTPTS,volume=${e.musique.volume}[am]`);
    pistes.push('[am]');
    n += 1;
  }
  e.voix.forEach((v, k) => {
    args.push('-i', v.source);
    const ms = Math.max(0, Math.round(v.depart * 1000));
    filtres.push(`[${n}:a]adelay=${ms}|${ms},volume=${v.volume}[av${k}]`);
    pistes.push(`[av${k}]`);
    n += 1;
  });
  if (pistes.length === 0) {
    filtres.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${f3(e.duree)}[aout]`);
  } else {
    filtres.push(`${pistes.join('')}amix=inputs=${pistes.length}:normalize=0:duration=longest,atrim=0:${f3(e.duree)},aformat=channel_layouts=stereo:sample_rates=48000[aout]`);
  }

  args.push(
    '-filter_complex', filtres.join(';'),
    '-map', '[vout]', '-map', '[aout]',
    '-fps_mode', 'passthrough',
    // Mêmes réglages que le rendu Remotion (`worker.ts`).
    '-c:v', 'libx264', '-preset', 'veryfast', '-b:v', '8M', '-maxrate', '12M', '-bufsize', '16M',
    '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    e.sortie,
  );
  if (e.analyseBase) args.push('-map', '[analyse]', '-f', 'rawvideo', '-pix_fmt', 'gray', '-y', e.analyseBase);
  return args;
}
