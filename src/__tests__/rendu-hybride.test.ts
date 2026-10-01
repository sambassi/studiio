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
    expect(fc).toContain('scale=1080:1920:force_original_aspect_ratio=increase');
    expect(fc).toContain('crop=1080:1920');
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

describe('câblage Autopilote', () => {
  it('hybride d abord, rendu Remotion en secours, moteur mesuré', () => {
    const r = readFileSync(resolve(process.cwd(), 'src/lib/autopilot/render.ts'), 'utf-8');
    expect(r).toContain('if (estEligibleHybride(input.design)) {');
    expect(r).toContain('rendu = await renderCreerSimple({ jobId: input.jobId, design: input.design, onProgress });');
    const p = readFileSync(resolve(process.cwd(), 'src/lib/autopilot/produire.ts'), 'utf-8');
    expect(p).toContain("MOTEUR_RENDU: moteur ?? 'remotion',");
  });
});
