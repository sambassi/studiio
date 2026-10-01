/**
 * RENDU HYBRIDE — ffmpeg monte le plan Smart Montage, Remotion ne dessine
 * que les images fixes des surimpressions. Comparé en local au rendu
 * Remotion complet sur le vrai plan de 18 extraits (staging 30/09) :
 * 729 images des deux côtés, écart moyen 2,6/255, musique calée à 0 ms.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { argumentsHybride, imagesSegment, type EntreeHybride } from '@/lib/render/hybride/filtre';
import { estEligibleHybride } from '@/lib/render/hybride/rendu';

const base = (over: Partial<EntreeHybride> = {}): EntreeHybride => ({
  segments: [
    { source: 'a.mp4', debut: 0, fin: 1.848, depuis: 4.5 },
    { source: 'b.mp4', debut: 1.848, fin: 3.608, depuis: 5.4, vitesse: 0.6 },
  ],
  duree: 3.608, fps: 30, largeur: 1080, hauteur: 1920,
  voile: 'voile.png', filigrane: 'fili.png',
  surimpressions: [{ texte: 'titre.png', debut: 0, fin: 2 }],
  musique: { source: 'm.mp3', volume: 0.4 },
  voix: [{ source: 'v.mp3', depart: 1.5, volume: 1 }],
  sortie: 'out.mp4',
  ...over,
});

describe('commande ffmpeg (pure)', () => {
  const args = argumentsHybride(base());
  const fc = args[args.indexOf('-filter_complex') + 1];

  it('bornes des extraits = celles de Remotion (arrondi à l image)', () => {
    expect(imagesSegment({ debut: 0, fin: 1.848 }, 30)).toBe(55);
    expect(imagesSegment({ debut: 1.848, fin: 3.608 }, 30)).toBe(53);
    expect(fc).toContain('trim=end_frame=55');
    expect(fc).toContain('trim=end_frame=53');
  });

  it('positionnement avant -i, ralenti par setpts, recadrage cover 9:16', () => {
    expect(args.join(' ')).toContain('-ss 4.5 -t 2.833 -i a.mp4');
    expect(fc).toContain('setpts=(PTS-STARTPTS)/0.6');
    // Recadrage cover centré COUPÉ AVANT la mise à l'échelle (perf).
    expect(fc).toContain("crop='min(iw\\,ih*1080/1920)':'min(ih\\,iw*1920/1080)',scale=1080:1920:flags=bicubic");
  });

  it('image fixe décodée UNE fois puis répétée ; zone utile seule posée', () => {
    expect(args.filter((x) => x === '-loop')).toEqual([]);
    expect(fc).toContain('loop=loop=59:size=1:start=0,setpts=N/(30*TB)');
    const avecBoite = argumentsHybride({ ...base(), surimpressions: [{ texte: 't.png', debut: 0, fin: 2, boite: [52, 150, 890, 124] }] })
      .join(' ');
    expect(avecBoite).toContain('crop=890:124:52:150,loop=');
    expect(avecBoite).toContain("overlay=x=52:y='150+round(");
  });

  it('surimpressions : fondu de 9 images, texte qui glisse de 24 px, fenêtre à son instant', () => {
    expect(fc).toContain('fade=t=in:start_frame=0:nb_frames=9:alpha=1');
    expect(fc).toContain('*24)');
    expect(fc).toContain('eof_action=pass');
  });

  it('audio : musique en boucle, voix retardée, volumes fixes, sans normalisation', () => {
    expect(args.join(' ')).toContain('-stream_loop -1 -i m.mp3');
    expect(fc).toContain('volume=0.4');
    expect(fc).toContain('adelay=1500|1500');
    expect(fc).toContain('amix=inputs=2:normalize=0');
  });

  it('horodatage régulier en sortie (pas de doublon / saut d image)', () => {
    expect(fc).toContain('setpts=N/(30*TB)[vout]');
    expect(args).toContain('passthrough');
  });
});

describe('zone utile d\'une image fixe', () => {
  it('rectangle des pixels non transparents, bornes paires, marge', async () => {
    const { boiteAlpha } = await import('@/lib/render/hybride/rendu');
    const L = 40; const H = 30;
    const px = new Uint8Array(L * H * 4);
    for (let y = 11; y < 17; y++) for (let x = 7; x < 21; x++) px[(y * L + x) * 4 + 3] = 200;
    expect(boiteAlpha(px, L, H)).toEqual([4, 8, 20, 12]);
    expect(boiteAlpha(new Uint8Array(L * H * 4), L, H)).toBeNull();
  });
});

describe('éligibilité (sinon rendu Remotion complet)', () => {
  const plan = [{ url: 'a', debut: 0, fin: 1, depuis: 0 }, { url: 'b', debut: 1, fin: 2, depuis: 0 }];
  const s = { titre: [0, 1] as [number, number], cartes: [], cta: null, voix: {} };
  it('plan + surimpressions + son des rushes coupé : oui', () => {
    expect(estEligibleHybride({ title: 't', montage: plan, surimpressions: s, rushMuted: true } as never)).toBe(true);
  });
  it('séquence plein écran, son des rushes, images-clés : non', () => {
    expect(estEligibleHybride({ title: 't', montage: plan, surimpressions: s, rushMuted: true, introDuration: 3 } as never)).toBe(false);
    expect(estEligibleHybride({ title: 't', montage: plan, surimpressions: s, rushMuted: false } as never)).toBe(false);
    expect(estEligibleHybride({ title: 't', montage: plan, surimpressions: null, rushMuted: true } as never)).toBe(false);
    expect(estEligibleHybride({ title: 't', montage: plan, surimpressions: s, rushMuted: true, audioKeyframes: [{}] } as never)).toBe(false);
  });
});

let ffmpegOk = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpegOk = false; }

describe('ffmpeg réel', () => {
  it.skipIf(!ffmpegOk)('chaque extrait montre SA source, au bon instant, avec ralenti, surimpression et musique', () => {
    const d = mkdtempSync(join(tmpdir(), 'studiio-hybride-'));
    const src = (nom: string, couleur: string, rate: number) => {
      const f = join(d, nom);
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${couleur}:s=640x360:r=${rate}:d=10`, '-c:v', 'libx264', '-g', String(rate), '-pix_fmt', 'yuv420p', '-y', f]);
      return f;
    };
    const rouge = src('rouge.mp4', 'red', 25);
    const vert = src('vert.mp4', 'green', 30);
    const bleu = src('bleu.mp4', 'blue', 60);
    const png = join(d, 'texte.png');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=white@1.0:s=1080x1920,format=rgba', '-vf', "geq=r=255:g=255:b=255:a='if(lt(Y,200),255,0)'", '-frames:v', '1', '-y', png]);
    const mus = join(d, 'm.mp3');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-y', mus]);
    const out = join(d, 'out.mp4');
    const segments = [
      { source: rouge, debut: 0, fin: 1.2, depuis: 1 },
      { source: vert, debut: 1.2, fin: 2.1, depuis: 2, vitesse: 0.6 },
      { source: bleu, debut: 2.1, fin: 3.5, depuis: 3 },
    ];
    execFileSync('ffmpeg', argumentsHybride({
      segments, duree: 3.5, fps: 30, largeur: 1080, hauteur: 1920, voile: null, filigrane: null,
      surimpressions: [{ texte: png, debut: 1.5, fin: 3 }], musique: { source: mus, volume: 0.4 }, voix: [], sortie: out,
    }));
    const n = Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', out]).toString().trim());
    expect(n).toBe(105);
    const pixel = (frame: number, y: number) => {
      const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', out, '-vf', `select=eq(n\\,${frame}),format=rgb24,crop=2:2:540:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-']);
      return Array.from(raw);
    };
    const domine = (p: number[]) => ['R', 'G', 'B'][p.slice(0, 3).indexOf(Math.max(...p.slice(0, 3)))];
    expect(domine(pixel(10, 1000))).toBe('R');   // extrait 1 : rouge
    expect(domine(pixel(50, 1000))).toBe('G');   // extrait 2 : vert (ralenti)
    expect(domine(pixel(90, 1000))).toBe('B');   // extrait 3 : bleu
    expect(pixel(75, 100).every((c) => c > 200)).toBe(true);   // surimpression visible (bande blanche)
    expect(domine(pixel(20, 100))).toBe('R');   // hors fenêtre : pas de surimpression
    const vol = execFileSync('ffmpeg', ['-hide_banner', '-i', out, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    expect(vol).not.toContain('max_volume: -91');
  }, 120_000);
});

describe('ffmpeg réel — optimisation des surimpressions', () => {
  it.skipIf(!ffmpegOk)('poser la seule zone utile donne la même vidéo que poser l\'image entière (écarts d\'arrondi seulement)', async () => {
    const { boiteAlpha } = await import('@/lib/render/hybride/rendu');
    const d = mkdtempSync(join(tmpdir(), 'studiio-boite-'));
    const src = join(d, 's.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', src]);
    const png = join(d, 't.png');
    // Texte : bande opaque + bord semi-transparent, le reste transparent.
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=white@1.0:s=1080x1920,format=rgba', '-vf',
      "geq=r=255:g=40:b=200:a='if(between(Y,300,360)*between(X,100,900),255,if(between(Y,296,364)*between(X,96,904),90,0))'", '-frames:v', '1', '-y', png]);
    const rgba = execFileSync('ffmpeg', ['-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 64e6 });
    const boite = boiteAlpha(rgba, 1080, 1920);
    expect(boite).toEqual([94, 294, 814, 74]);
    const rendre = (b: typeof boite, nom: string) => {
      const out = join(d, nom);
      execFileSync('ffmpeg', argumentsHybride({
        segments: [{ source: src, debut: 0, fin: 1.5, depuis: 0 }, { source: src, debut: 1.5, fin: 2.5, depuis: 1 }],
        duree: 2.5, fps: 30, largeur: 1080, hauteur: 1920, voile: null, filigrane: png, boiteFiligrane: b,
        surimpressions: [{ texte: png, debut: 0.4, fin: 2.2, boite: b }], musique: null, voix: [], sortie: out,
      }));
      return out;
    };
    const entiere = rendre(null, 'entiere.mp4');
    const zone = rendre(boite, 'zone.mp4');
    const n = (f: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', f]).toString().trim());
    expect(n(zone)).toBe(n(entiere));
    // PSNR minimal par image : > 50 dB = au plus un niveau d'écart (arrondis).
    const journal = execFileSync('sh', ['-c', `ffmpeg -hide_banner -i "${zone}" -i "${entiere}" -lavfi psnr -f null - 2>&1 | grep -o 'min:[0-9.inf]*'`]).toString().trim();
    const min = journal === 'min:inf' ? Infinity : Number(journal.replace('min:', ''));
    expect(min).toBeGreaterThan(50);
  }, 120_000);
});

describe('ffmpeg réel — conseiller', () => {
  it.skipIf(!ffmpegOk)('le MÊME passage écrit la vidéo de base sans textes en petit ; les textes sont mesurés dessus', async () => {
    const d = mkdtempSync(join(tmpdir(), 'studiio-hybride-base-'));
    const src = (nom: string, couleur: string) => {
      const f = join(d, nom);
      execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${couleur}:s=640x360:r=25:d=6`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', f]);
      return f;
    };
    const blanc = src('blanc.mp4', 'white');
    const noir = src('noir.mp4', 'black');
    const png = join(d, 'texte.png');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=white@1.0:s=1080x1920,format=rgba', '-vf', "geq=r=255:g=255:b=255:a='if(between(Y,100,180),255,0)'", '-frames:v', '1', '-y', png]);
    const out = join(d, 'out.mp4');
    const base = join(d, 'base.gray');
    execFileSync('ffmpeg', argumentsHybride({
      segments: [{ source: blanc, debut: 0, fin: 2, depuis: 0 }, { source: noir, debut: 2, fin: 3.5, depuis: 0 }],
      duree: 3.5, fps: 30, largeur: 1080, hauteur: 1920, voile: null, filigrane: null,
      surimpressions: [{ texte: png, debut: 0.5, fin: 3 }], musique: null, voix: [], sortie: out, analyseBase: base,
    }));
    const n = Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', out]).toString().trim());
    expect(n).toBe(105); // la vidéo finale n'est pas touchée
    const brut = readFileSync(base);
    expect(brut.length).toBe(14 * 72 * 128); // 3,5 s à 4 images/s, 72×128
    // Base SANS textes : blanc puis noir, la bande de texte n'y est pas.
    expect(brut[1 * 72 * 128 + 10 * 72 + 36]).toBeGreaterThan(230);
    expect(brut[12 * 72 * 128 + 10 * 72 + 36]).toBeLessThan(25);
    const { mesurerTextes } = await import('@/lib/render/hybride/mesures-textes');
    const m = await mesurerTextes({ ffmpeg: 'ffmpeg', baseBrute: base, textes: [{ cible: 'accroche', texte: 'x', image: png, debut: 0.5, fin: 3 }] });
    expect(m).toHaveLength(1);
    expect(m![0].geometrie.lignesPx[0]).toBeGreaterThanOrEqual(76);
    expect(m![0].geometrie.lignesPx[0]).toBeLessThanOrEqual(84);
    expect(m![0].fond[1]).toBeGreaterThan(0.5); // fond blanc derrière (voile compris) pendant l'affichage
  }, 120_000);
});

describe('imports compatibles webpack (serveur Next)', () => {
  it('aucun import DYNAMIQUE d\'un module Node qui est une fonction (stream, events) dans le code serveur', () => {
    // Compilé par webpack, `await import('stream')` n'expose QUE `default` :
    // `Readable` valait undefined en staging et tout rendu hybride retombait
    // sur Remotion (« reading 'fromWeb' », 01/10).
    const { execFileSync } = require('child_process') as typeof import('child_process');
    let sortie = '';
    // grep rend le code 1 quand il ne trouve rien : c'est le cas attendu.
    try { sortie = execFileSync('grep', ['-rnE', "import\\(['\"](node:)?(stream|events)['\"]\\)", 'src/lib', 'src/app'], { encoding: 'utf-8' }); } catch { sortie = ''; }
    const trouves = sortie
      .split('\n').filter(Boolean)
      // Les commentaires qui expliquent le piège ne comptent pas.
      .filter((l) => !/^[^:]+:\d+:\s*(\/\/|\*)/.test(l));
    expect(trouves).toEqual([]);
  });

  it('la copie des sources utilise des imports statiques', () => {
    const r = readFileSync(resolve(process.cwd(), 'src/lib/render/hybride/rendu.ts'), 'utf-8');
    expect(r).toContain("import { Readable } from 'stream';");
    expect(r).toContain("import { pipeline } from 'stream/promises';");
  });
});

describe('repli jamais muet', () => {
  it('chaque condition non remplie est nommée', async () => {
    const { raisonNonEligibleHybride } = await import('@/lib/render/hybride/rendu');
    const ok = { montage: [{}, {}], surimpressions: {}, rushMuted: true, introDuration: 0, cardsDuration: 0, ctaDuration: 0 } as never;
    expect(raisonNonEligibleHybride(ok)).toBeNull();
    expect(raisonNonEligibleHybride({ ...(ok as object), rushMuted: false, rushVolume: 0.5 } as never)).toBe('son des rushes conservé');
    expect(raisonNonEligibleHybride({ ...(ok as object), surimpressions: null } as never)).toMatch(/surimpression/);
  });
});

describe('câblage Autopilote', () => {
  it('hybride d abord, rendu Remotion en secours, moteur mesuré', () => {
    const r = readFileSync(resolve(process.cwd(), 'src/lib/autopilot/render.ts'), 'utf-8');
    expect(r).toContain('let hybrideRaison = raisonNonEligibleHybride(input.design);');
    expect(r).toContain("moteur = 'REMOTION_FALLBACK';");
    expect(r).toContain('MOTEUR_RENDU=REMOTION_FALLBACK — HYBRID_FALLBACK_REASON=');
    expect(r).toContain('rendu = await renderCreerSimple({ jobId: input.jobId, design: input.design, onProgress });');
    const p = readFileSync(resolve(process.cwd(), 'src/lib/autopilot/produire.ts'), 'utf-8');
    expect(p).toContain("MOTEUR_RENDU: moteur ?? 'REMOTION',");
    expect(p).toContain('HYBRID_FALLBACK_REASON: hybrideRaison');
  });
});
