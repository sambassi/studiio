/**
 * PROXY DE RENDU — un rush 4K / 60 i/s est rendu depuis une copie 1080p
 * 30 i/s créée une fois (cache). Test réel staging 30/09 17:00 :
 * REMOTION_RENDER_MS = 1 160 669 (19 min) pour 24 s avec un rush 4K 60 i/s.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { besoinProxy, cleProxy, urlPubliqueVoisine, argumentsProxy } from '@/lib/render/proxy-rendu';

describe('règles du proxy', () => {
  it('seulement au-delà de 1080p ou de 30 i/s', () => {
    expect(besoinProxy({ largeur: 2160, hauteur: 3840, fps: 60 })).toBe(true);
    expect(besoinProxy({ largeur: 1080, hauteur: 1920, fps: 60 })).toBe(true);
    expect(besoinProxy({ largeur: 1920, hauteur: 1080, fps: 25 })).toBe(false);
    expect(besoinProxy({ largeur: 1080, hauteur: 1920, fps: 30 })).toBe(false);
  });

  it('cache : clé stable pour un même fichier, nouvelle si le fichier change, sous le dossier du propriétaire', () => {
    const a = cleProxy('media/u1/library/lv_0.mp4', 233761833);
    expect(a).toBe(cleProxy('media/u1/library/lv_0.mp4', 233761833));
    expect(a).not.toBe(cleProxy('media/u1/library/lv_0.mp4', 233761834));
    expect(a.startsWith('u1/proxies/')).toBe(true);
    expect(a.endsWith('-1080p30.mp4')).toBe(true);
  });

  it('URL publique du proxy sur le même hôte', () => {
    expect(urlPubliqueVoisine('https://staging.studiio.pro/storage/v1/object/public/media/u1/library/x.mp4', 'media', 'u1/proxies/p.mp4'))
      .toBe('https://staging.studiio.pro/storage/v1/object/public/media/u1/proxies/p.mp4');
  });
});

let ffmpegOk = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpegOk = false; }

describe('ffmpeg réel', () => {
  it.skipIf(!ffmpegOk)('un rush portrait 60 i/s devient 1080×1920 à 30 i/s, même durée, son gardé', () => {
    const dir = mkdtempSync(join(tmpdir(), 'studiio-proxy-'));
    const src = join(dir, 'src.mp4');
    const out = join(dir, 'proxy.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1440x2560:rate=60:duration=2',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', '-y', src]);
    execFileSync('ffmpeg', argumentsProxy(src, out));
    const info = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,r_frame_rate:format=duration', '-of', 'json', out]).toString();
    const j = JSON.parse(info);
    const v = j.streams.find((s: { codec_type: string }) => s.codec_type === 'video');
    expect([v.width, v.height]).toEqual([1080, 1920]);
    expect(v.r_frame_rate).toBe('30/1');
    expect(j.streams.some((s: { codec_type: string }) => s.codec_type === 'audio')).toBe(true);
    expect(Math.abs(Number(j.format.duration) - 2)).toBeLessThan(0.15);
  }, 60_000);
});

describe('câblage Autopilote', () => {
  it('le RENDU reçoit les proxys ; le plan et les métadonnées gardent les URL originales', () => {
    const p = readFileSync(resolve(process.cwd(), 'src/lib/autopilot/produire.ts'), 'utf-8');
    expect(p).toContain('const p = await urlRenduPourRush(u);');
    expect(p).toContain('userId, jobId, design: designRendu,');
    expect(p).toContain('RENDER_PROXY_MS: proxyMs,');
    // Les métadonnées s'écrivent à partir de `design` (URL d'origine), pas de `designRendu`.
    expect(p).toContain('post: postUtilise, design, videoUrl, thumbnailUrl');
  });
});
