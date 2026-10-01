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

export interface SegmentHybride {
  /** Fichier lisible par ffmpeg (proxy / URL interne). */
  source: string;
  debut: number;
  fin: number;
  depuis: number;
  vitesse?: number;
}

export interface FenetreSurimpression {
  /** Image fixe du TEXTE (glisse à l'entrée). */
  texte: string;
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
  surimpressions: FenetreSurimpression[];
  musique: { source: string; volume: number } | null;
  voix: Array<{ source: string; depart: number; volume: number }>;
  sortie: string;
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
      + `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=bicubic,crop=${W}:${H},setsar=1,`
      + `fps=${fps},tpad=stop_mode=clone:stop=${images},trim=end_frame=${images},setpts=PTS-STARTPTS[v${k}]`,
    );
    etiquettesVideo.push(`[v${k}]`);
    n += 1;
  });
  filtres.push(`${etiquettesVideo.join('')}concat=n=${e.segments.length}:v=1:a=0,format=yuva420p[base0]`);

  // ── 2. Surimpressions : voile (fixe) + texte (glisse), fondu 0,3 s ──
  const bord = Math.max(1, Math.round(0.3 * fps));
  let courant = 'base0';
  let etape = 0;
  const poser = (image: string, debutImg: number, dureeImg: number, glisse: boolean) => {
    const i = n;
    // L'image n'est lue QUE pendant sa fenêtre (décoder 1080×1920 à chaque
    // image de toute la vidéo coûterait plus que le montage lui-même), puis
    // décalée à son instant.
    args.push('-loop', '1', '-framerate', String(fps), '-t', f3(dureeImg / fps), '-i', image);
    n += 1;
    // Opacité : entrée et sortie de `bord` images — `CoucheOverlayAnimee`.
    const sortie = Math.max(0, dureeImg - bord);
    filtres.push(
      `[${i}:v]format=rgba,fade=t=in:start_frame=0:nb_frames=${bord}:alpha=1,`
      + `fade=t=out:start_frame=${sortie}:nb_frames=${bord}:alpha=1,setpts=PTS-STARTPTS+${debutImg}/(${fps}*TB)[s${etape}]`,
    );
    const y = glisse ? `'round((1-min(1\\,max(0\\,(n-${debutImg})/${bord})))*24)'` : '0';
    filtres.push(`[${courant}][s${etape}]overlay=x=0:y=${y}:eof_action=pass:format=auto[base${etape + 1}]`);
    courant = `base${etape + 1}`;
    etape += 1;
  };
  for (const o of e.surimpressions) {
    const debutImg = Math.round(o.debut * fps);
    const dureeImg = Math.max(1, Math.round((o.fin - o.debut) * fps));
    if (e.voile) poser(e.voile, debutImg, dureeImg, false);
    poser(o.texte, debutImg, dureeImg, true);
  }
  if (e.filigrane) {
    const i = n;
    args.push('-loop', '1', '-framerate', String(fps), '-t', f3(e.duree), '-i', e.filigrane);
    n += 1;
    filtres.push(`[${courant}][${i}:v]overlay=0:0:format=auto[base${etape + 1}]`);
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
  return args;
}
