/**
 * Test réel staging du 30/09 (13:43) : RUSH_ANALYSIS_MS=120041 — les trois
 * analyses (dont un rush 4K 60 i/s) ont dépassé leur délai EN PARALLÈLE,
 * aucun plan, montage simple sur un seul rush de 3 s.
 * Correctifs : images-clés seulement (repli décodage complet si trop rares),
 * rush sans piste audio accepté, rushes analysés un par un.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { instantsShowinfo, analyserRushServeur } from '@/lib/creer/analyse-rush-serveur';
import { planMontage } from '@/lib/creer/smart-montage';

let ffmpegOk = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpegOk = false; }

describe('analyse serveur', () => {
  it('lit les instants des images dans showinfo', () => {
    const j = '[Parsed_showinfo_3] n:0 pts:0 pts_time:0 duration\n[Parsed_showinfo_3] n:1 pts:120 pts_time:2.5 x';
    expect(instantsShowinfo(j)).toEqual([0, 2.5]);
  });

  it('les rushes sont analysés UN PAR UN, et les échecs sont écrits', () => {
    const p = readFileSync(resolve(process.cwd(), 'src/lib/autopilot/produire.ts'), 'utf-8');
    expect(p).toContain('for (const [i, u] of liste.entries()) {');
    expect(p).toContain('const r = await analyserRushServeurCache(u, secondes[i]);');
    expect(p).not.toContain('await Promise.all(liste.map((u, i) => analyserRushServeurCache(');
    expect(p).toContain('{ analysesEchouees }');
    const a = readFileSync(resolve(process.cwd(), 'src/lib/creer/analyse-rush-serveur.ts'), 'utf-8');
    expect(a).toContain("'-skip_frame', 'nokey'");
  });

  it.skipIf(!ffmpegOk)('ffmpeg réel : rush SANS audio, rush à une seule image-clé, rush long → 3 analyses, plan multi-rush', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studiio-analyse-'));
    const muet = join(dir, 'muet.mp4');       // 3 s, aucune piste audio
    const uneCle = join(dir, 'unecle.mp4');   // 12 s, une seule image-clé
    const long = join(dir, 'long.mp4');       // 20 s, image-clé toutes les secondes, avec son
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x568:rate=30:duration=3', '-c:v', 'libx264', '-y', muet]);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'mandelbrot=size=320x568:rate=30', '-t', '12', '-c:v', 'libx264', '-g', '1000', '-keyint_min', '1000', '-sc_threshold', '0', '-y', uneCle]);
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x568:rate=30:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-c:v', 'libx264', '-g', '30', '-c:a', 'aac', '-shortest', '-y', long]);
    const analyses = [];
    for (const [f, d] of [[muet, 3], [uneCle, 12], [long, 20]] as const) {
      const a = await analyserRushServeur(f, d);
      expect(a, f).not.toBeNull();
      expect(a!.echantillons.length).toBeGreaterThanOrEqual(3);
      analyses.push(a!);
    }
    const plan = planMontage(analyses, 20)!;
    expect(plan.length).toBeGreaterThanOrEqual(4);
    expect(new Set(plan.map((s) => s.url)).size).toBeGreaterThanOrEqual(2);
  }, 120_000);
});
