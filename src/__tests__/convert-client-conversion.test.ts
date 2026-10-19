/**
 * PR-F, côté navigateur et échelle ffmpeg.
 *
 * - `appelerConversionMp4` : un 429 est attendu (`Retry-After`) puis
 *   retenté, l'écran est prévenu ; à l'échéance, le 429 revient tel quel ;
 *   un abandon pendant l'attente arrête tout.
 * - `plafondConversionServeur` : la valeur vient du serveur, `null` sinon.
 * - Repli Bureau (`convertWebmToMp4ServerSide`) : refus AVANT téléversement
 *   si le Blob dépasse le plafond du serveur ; chemin nominal inchangé
 *   (signed-url → PUT → POST to-mp4 → GET mp4) ; 429 retenté.
 * - `transcodeWebmToMp4WithLadder` : un abandon TUE le processus et arrête
 *   l'échelle (vrai `execFile`, faux ffmpeg qui dort).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { chmodSync, mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  appelerConversionMp4,
  messageSourceTropVolumineuse,
  plafondConversionServeur,
} from '@/lib/convert/client-conversion';

const json = (corps: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(corps), { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });

const MESSAGE_429 = 'Une conversion est déjà en cours sur votre compte. Patientez quelques instants, puis réessayez.';
const r429 = (retry = '0') => json({ success: false, error: MESSAGE_429 }, { status: 429, headers: { 'retry-after': retry } });

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('appelerConversionMp4', () => {
  it('429 puis 200 → retente après Retry-After et prévient l\'écran', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(r429('0'))
      .mockResolvedValueOnce(json({ success: true, mp4Url: 'u' }));
    const onAttente = vi.fn();
    const res = await appelerConversionMp4('/x.webm', { fetchImpl, onAttente });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // `Retry-After: 0` → plancher 1 s, jamais une rafale.
    expect(onAttente).toHaveBeenCalledWith(MESSAGE_429, 1);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ videoUrl: '/x.webm' });
  });

  it('ne retente pas s\'il ne reste plus de quoi couvrir le pire cas serveur', async () => {
    const { PIRE_CAS_SERVEUR_CONVERSION_MS } = await import('@/lib/ffmpeg/limiteur-conversions');
    const fetchImpl = vi.fn().mockResolvedValue(r429('30'));
    // 30 s d'attente + 780 s de pire cas > 800 s restants → pas de nouvel essai.
    const res = await appelerConversionMp4('/x.webm', { fetchImpl, echeanceMs: PIRE_CAS_SERVEUR_CONVERSION_MS + 20_000 });
    expect(res.status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('échéance atteinte → le 429 revient tel quel, message explicite lisible', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(r429('30'));
    const res = await appelerConversionMp4('/x.webm', { fetchImpl, echeanceMs: 1000 });
    expect(res.status).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await res.json()).error).toBe(MESSAGE_429);
  });

  it('abandon pendant l\'attente → AbortError, plus aucun appel', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(r429('30'));
    const c = new AbortController();
    const p = appelerConversionMp4('/x.webm', { fetchImpl, signal: c.signal });
    await new Promise((r) => setTimeout(r, 5));
    c.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('plafondConversionServeur', () => {
  it('lit maxOctets du serveur', async () => {
    const f = vi.fn().mockResolvedValue(json({ success: true, maxOctets: 1234 }));
    expect(await plafondConversionServeur(f)).toBe(1234);
    expect(f).toHaveBeenCalledWith('/api/convert/to-mp4', { method: 'GET' });
  });
  it('serveur injoignable / refus / valeur absurde → null (le serveur tranchera)', async () => {
    expect(await plafondConversionServeur(vi.fn().mockRejectedValue(new Error('net')))).toBeNull();
    expect(await plafondConversionServeur(vi.fn().mockResolvedValue(json({}, { status: 401 })))).toBeNull();
    expect(await plafondConversionServeur(vi.fn().mockResolvedValue(json({ maxOctets: -1 })))).toBeNull();
  });
});

describe('Repli Bureau — convertWebmToMp4ServerSide', () => {
  async function scenario(opts: { max: number; taille: number; premier429?: boolean }) {
    const appels: string[] = [];
    let conv = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const methode = init?.method ?? 'GET';
      appels.push(`${methode} ${url}`);
      if (url === '/api/convert/to-mp4' && methode === 'GET') return json({ success: true, maxOctets: opts.max });
      if (url === '/api/upload/signed-url') {
        return json({ success: true, signedUrl: '/put-ici', publicUrl: '/storage/v1/object/public/media/u1/convert/1-desktop-export-1.webm' });
      }
      if (url === '/put-ici') return new Response(null, { status: 200 });
      if (url === '/api/convert/to-mp4' && methode === 'POST') {
        conv += 1;
        if (opts.premier429 && conv === 1) return r429('0');
        return json({ success: true, mp4Url: '/mp4-ici', attempt: '1080p CRF28' });
      }
      if (url === '/mp4-ici') return new Response(new Uint8Array(4096), { headers: { 'content-type': 'video/mp4' } });
      throw new Error(`appel inattendu ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const { convertWebmToMp4ServerSide } = await import('@/lib/video-composer');
    const blob = new Blob([new Uint8Array(opts.taille)], { type: 'video/webm' });
    return { appels, essai: convertWebmToMp4ServerSide(blob) };
  }

  it('Blob plus gros que le plafond serveur → refus AVANT tout téléversement', async () => {
    const { appels, essai } = await scenario({ max: 2048, taille: 4096 });
    await expect(essai).rejects.toThrow(messageSourceTropVolumineuse(4096, 2048));
    expect(appels).toEqual(['GET /api/convert/to-mp4']);
  });

  it('chemin nominal inchangé : signed-url → PUT → POST to-mp4 → GET mp4', async () => {
    const { appels, essai } = await scenario({ max: 300 * 1024 * 1024, taille: 4096 });
    const mp4 = await essai;
    expect(mp4.size).toBe(4096);
    expect(mp4.type).toContain('mp4');
    expect(appels).toEqual([
      'GET /api/convert/to-mp4',
      'POST /api/upload/signed-url',
      'PUT /put-ici',
      'POST /api/convert/to-mp4',
      'GET /mp4-ici',
    ]);
  });

  it('429 sur la conversion → retentée, puis MP4 rendu', async () => {
    const { appels, essai } = await scenario({ max: 300 * 1024 * 1024, taille: 4096, premier429: true });
    expect((await essai).size).toBe(4096);
    expect(appels.filter((a) => a === 'POST /api/convert/to-mp4')).toHaveLength(2);
    expect(appels.filter((a) => a === 'POST /api/upload/signed-url')).toHaveLength(1); // pas de re-téléversement
  });
});

describe('transcodeWebmToMp4WithLadder — abandon', () => {
  it('ne se règle qu\'à la MORT réelle du processus, même s\'il ignore SIGTERM', async () => {
    const { transcodeWebmToMp4WithLadder } = await vi.importActual<typeof import('@/lib/ffmpeg/transcode-to-mp4')>('@/lib/ffmpeg/transcode-to-mp4');
    const { existsSync, readFileSync } = await import('fs');
    const dossier = mkdtempSync(join(tmpdir(), 'prf-ffmpeg-'));
    const faux = join(dossier, 'ffmpeg');
    const pidFichier = join(dossier, 'pid');
    // Ignore SIGTERM (hérité par exec) : seul SIGKILL l'arrête.
    writeFileSync(faux, `#!/bin/sh\ntrap '' TERM\necho $$ > "${pidFichier}"\nexec sleep 30\n`);
    chmodSync(faux, 0o755);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const c = new AbortController();
    const p = transcodeWebmToMp4WithLadder(faux, '/in.webm', join(dossier, 'out.mp4'), '[T]', { signal: c.signal });
    for (let i = 0; i < 500 && !existsSync(pidFichier); i++) await new Promise((r) => setTimeout(r, 10));
    const pid = Number(readFileSync(pidFichier, 'utf8').trim());
    c.abort();
    await expect(p).rejects.toThrow(/abandonnée/);
    // Au règlement, le processus n'existe plus.
    expect(() => process.kill(pid, 0)).toThrow();
  }, 20000);

  it('le signal TUE le ffmpeg en cours et arrête l\'échelle (pas de palier suivant)', async () => {
    const { transcodeWebmToMp4WithLadder } = await vi.importActual<typeof import('@/lib/ffmpeg/transcode-to-mp4')>('@/lib/ffmpeg/transcode-to-mp4');
    // Un faux ffmpeg qui dort 30 s : seul un vrai kill le fait finir vite.
    const dossier = mkdtempSync(join(tmpdir(), 'prf-ffmpeg-'));
    const faux = join(dossier, 'ffmpeg');
    writeFileSync(faux, `#!/bin/sh\necho x >> "${join(dossier, 'lancements')}"\nexec sleep 30\n`);
    chmodSync(faux, 0o755);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const c = new AbortController();
    const debut = Date.now();
    const p = transcodeWebmToMp4WithLadder(faux, '/in.webm', join(dossier, 'out.mp4'), '[T]', { signal: c.signal });
    // N'abandonne qu'une fois le faux ffmpeg RÉELLEMENT lancé.
    const { existsSync } = await import('fs');
    for (let i = 0; i < 500 && !existsSync(join(dossier, 'lancements')); i++) await new Promise((r) => setTimeout(r, 10));
    expect(existsSync(join(dossier, 'lancements'))).toBe(true);
    c.abort();
    const erreur = await p.catch((e: Error) => e);
    expect(erreur, String(erreur)).toBeInstanceOf(Error);
    expect(Date.now() - debut).toBeLessThan(5000);
    const { readFileSync } = await import('fs');
    expect(readFileSync(join(dossier, 'lancements'), 'utf8').trim().split('\n')).toHaveLength(1);
  }, 15000);
});
