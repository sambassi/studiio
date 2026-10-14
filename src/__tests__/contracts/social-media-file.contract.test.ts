/**
 * CONTRAT — C-SOCIAL-MEDIA-FILE (chemin cron → Zernio).
 *
 * (J/K/L) un MP4 9:16, 1:1 ou 16:9 part TEL QUEL : la même URL est remise à
 * uploadMedia, sans téléchargement, sans conversion, sans FFmpeg.
 * WebM : converti en MP4 (échelle à ratio conservé) puis publié ; si la
 * conversion échoue, REFUSÉ explicitement — jamais envoyé.
 * Les octets eux-mêmes (uploadMedia → PUT présigné) : social-media-bytes.contract.test.ts.
 * Ne pas modifier pour faire passer la CI (docs/FEATURE_LOCKS.md).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { etat, zernio, autres, post, lancerCron, reinitialiser, ligne } from './helpers/socialHarness';

vi.mock('@/lib/db/supabase', async () => (await import('./helpers/socialHarness')).moduleSupabase());
vi.mock('@/lib/social/zernio', async (orig) => {
  const vrai = await orig<typeof import('@/lib/social/zernio')>();
  const { zernio } = await import('./helpers/socialHarness');
  return { ...vrai, createPost: zernio.createPost, uploadMedia: zernio.uploadMedia };
});
vi.mock('@/lib/social/publishing', async (orig) => {
  const { etat } = await import('./helpers/socialHarness');
  return {
    ...(await orig<typeof import('@/lib/social/publishing')>()),
    comptesConnectes: async () => etat.comptes.map((c) => ({ username: null, ...c })),
    droitDePublier: async () => ({ autorise: true }),
  };
});
vi.mock('@/lib/storage/fetch-media', async () => ({ downloadMediaToFile: (await import('./helpers/socialHarness')).autres.downloadMediaToFile }));
vi.mock('@/lib/ffmpeg/transcode-to-mp4', async () => ({ transcodeWebmToMp4WithLadder: (await import('./helpers/socialHarness')).autres.transcode }));
vi.mock('@/lib/social/token-refresh', () => ({ getValidToken: async () => 'jeton' }));
vi.mock('@/lib/email/resend', async () => ({ sendEmail: (await import('./helpers/socialHarness')).autres.sendEmail, sendEmailSilent: () => {} }));
vi.mock('@/lib/social/whatsapp', () => ({
  isWhatsAppEnabled: () => false, canUseWhatsApp: () => false, broadcastWhatsApp: vi.fn(),
  resolveRecipients: () => [], MAX_RECIPIENTS: 0, formatBroadcastFailures: () => '',
}));
vi.mock('@/lib/social/subscribers', () => ({ fetchSubscribers: async () => [], unsubscribeUrl: () => 'https://studiio.pro/desabo' }));
vi.mock('@/lib/email/unsubscribe', () => ({
  unsubscribeEndpoint: () => '', filterSuppressed: async (l: unknown[]) => l,
  isSuppressed: async () => false, canUnsubscribe: async () => false,
}));
vi.mock('@/lib/admin', () => ({ isAdmin: () => false }));
vi.mock('child_process', async (orig) => {
  const vrai = await orig<typeof import('child_process')>();
  const { autres } = await import('./helpers/socialHarness');
  return { ...vrai, default: { ...vrai, execFile: autres.execFile }, execFile: autres.execFile };
});
vi.mock('fs/promises', async (orig) => {
  const vrai = await orig<typeof import('fs/promises')>();
  const fx = {
    readFile: async () => Buffer.from('mp4-produit-par-ffmpeg'),
    unlink: async () => undefined,
    access: async () => { throw new Error('absent'); },
  };
  return { ...vrai, ...fx, default: { ...vrai, ...fx } };
});

beforeEach(() => reinitialiser());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const RATIOS = [
  { nom: '9:16 (reel)', url: 'https://cdn.example/user-1/rendus/reel-1080x1920.mp4', format: 'reel' },
  { nom: '1:1 (carré)', url: 'https://cdn.example/user-1/rendus/carre-1080x1080.mp4', format: 'reel' },
  { nom: '16:9 (tv)', url: 'https://cdn.example/user-1/rendus/tv-1920x1080.mp4', format: 'tv' },
];

describe.each(RATIOS)('C-SOCIAL-MEDIA-FILE — MP4 $nom', ({ url, format }) => {
  it('la même URL est remise à uploadMedia, sans téléchargement ni conversion', async () => {
    etat.base.scheduled_posts = [post('p1', { media_url: url, format, metadata: { renderedVideoUrl: url, format } })];
    const r = await lancerCron(true);
    expect(r.results[0].success).toBe(true);
    expect(zernio.uploadMedia).toHaveBeenCalledTimes(1);
    expect(zernio.uploadMedia.mock.calls[0]).toEqual([url, 'studiio-p1.mp4', 'video/mp4', 'user-1']);
    expect(autres.downloadMediaToFile).not.toHaveBeenCalled();
    expect(autres.transcode).not.toHaveBeenCalled();
    expect(autres.execFile).not.toHaveBeenCalled();
    expect(etat.stockage.size).toBe(0);
  });

  it('avec hasAudio mais sans piste séparée → toujours tel quel', async () => {
    etat.base.scheduled_posts = [post('p1', { media_url: url, metadata: { renderedVideoUrl: url, hasAudio: true, musicUrl: null, voiceUrl: null } })];
    await lancerCron(true);
    expect(zernio.uploadMedia.mock.calls[0][0]).toBe(url);
    expect(autres.execFile).not.toHaveBeenCalled();
  });
});

describe('C-SOCIAL-MEDIA-FILE — WebM (comportement actuel documenté)', () => {
  const WEBM = 'https://cdn.example/user-1/rendus/montage.webm';

  it('WebM → conversion MP4 (échelle ladder) puis publication du MP4 converti, sous le préfixe du propriétaire', async () => {
    etat.base.scheduled_posts = [post('p1', { media_url: WEBM, metadata: { renderedVideoUrl: WEBM } })];
    const r = await lancerCron(true);
    expect(autres.downloadMediaToFile).toHaveBeenCalledTimes(1);
    expect(autres.downloadMediaToFile.mock.calls[0][0]).toBe(WEBM);
    expect(autres.transcode).toHaveBeenCalledTimes(1);
    const [chemin] = [...etat.stockage.keys()];
    expect(chemin).toMatch(/^user-1\/converted\/converted_\d+\.mp4$/);
    expect(zernio.uploadMedia.mock.calls[0][0]).toBe(`https://cdn.example/media/${chemin}`);
    expect(r.results[0].success).toBe(true);
  });

  it('conversion WebM en échec → refus explicite, rien n est envoyé à Zernio', async () => {
    autres.transcode.mockRejectedValueOnce(new Error('ffmpeg exit 1'));
    etat.base.scheduled_posts = [post('p1', { media_url: WEBM, metadata: { renderedVideoUrl: WEBM } })];
    const r = await lancerCron(true);
    expect(zernio.uploadMedia).not.toHaveBeenCalled();
    expect(zernio.createPost).not.toHaveBeenCalled();
    expect(r.results[0].success).toBe(false);
    expect(ligne('p1').status).toBe('failed');
    expect(String(ligne('p1').metadata.error)).toMatch(/MP4/);
  });

  it('format non vidéo (.gif) → refusé, jamais envoyé', async () => {
    const GIF = 'https://cdn.example/user-1/rendus/anim.gif';
    etat.base.scheduled_posts = [post('p1', { media_url: GIF, metadata: { renderedVideoUrl: GIF } })];
    await lancerCron(true);
    expect(zernio.uploadMedia).not.toHaveBeenCalled();
    expect(ligne('p1').status).toBe('failed');
  });
});

describe('C-SOCIAL-MEDIA-FILE — BUG (6) CORRIGÉ : un son déjà embarqué n est jamais re-muxé', () => {
  /*
   * BUG RÉEL (6) — CORRIGÉ. preparerMediaZernio re-muxait la musique dès que
   * `hasAudio && (musicUrl || voiceUrl)`. Or l'Assistant (AssistantWizard),
   * l'Autopilote (design.ts) et l'éditeur avancé posent `hasAudio: true` +
   * `musicUrl` quand la musique est DÉJÀ EMBARQUÉE dans le rendu. FFmpeg
   * (-map 0:v:0 -map 1:a:0 -shortest) REMPLAÇAIT la piste mixée par la seule
   * musique. Désormais ffprobe décide, montage composé ou non : piste audio
   * présente → fichier d'origine tel quel ; sonde en échec → tel quel ; vidéo
   * MUETTE + musique/voix séparées → muxée. (Pas de court-circuit sur
   * `renderedVideoUrl` : le compositeur retombe en mode rapide SANS piste
   * audio quand le chargement du son échoue, alors que hasAudio + musicUrl
   * sont écrits — ces montages doivent recevoir leur musique.)
   */
  const MUSIQUE = 'https://cdn.example/user-1/musique.mp3';
  const sonde = (sortie: string | Error) => {
    autres.execFile.mockImplementation((...a: unknown[]) => {
      const cb = a[a.length - 1] as (e: Error | null, r?: { stdout: string; stderr: string }) => void;
      const args = a[1] as string[];
      if (args.includes('-select_streams')) {
        if (sortie instanceof Error) cb(sortie);
        else cb(null, { stdout: sortie, stderr: '' });
        return;
      }
      cb(null, { stdout: '', stderr: '' });
    });
  };

  it('BUG RÉEL (6) : un rendu déjà mixé (hasAudio + musicUrl) doit partir tel quel', async () => {
    // CORRIGÉ
    const RENDU = 'https://cdn.example/user-1/rendus/mixe.mp4';
    sonde('1\n');
    etat.base.scheduled_posts = [post('p1', {
      media_url: RENDU,
      metadata: { renderedVideoUrl: RENDU, hasAudio: true, musicUrl: MUSIQUE, voiceUrl: null },
    })];
    await lancerCron(true);
    expect(autres.execFile).toHaveBeenCalledTimes(1); // la sonde seule, aucun FFmpeg
    expect(zernio.uploadMedia.mock.calls[0][0]).toBe(RENDU);
  });

  it('rendu déjà mixé : rien réécrit — les octets publiés sont ceux du fichier d origine', async () => {
    const RENDU = 'https://cdn.example/user-1/rendus/mixe.mp4';
    sonde('1\n');
    etat.base.scheduled_posts = [post('p1', {
      media_url: RENDU,
      metadata: { renderedVideoUrl: RENDU, hasAudio: true, musicUrl: MUSIQUE, voiceUrl: 'https://cdn.example/user-1/voix.mp3' },
    })];
    const r = await lancerCron(true);
    expect(r.results[0].success).toBe(true);
    expect(zernio.uploadMedia.mock.calls[0]).toEqual([RENDU, 'studiio-p1.mp4', 'video/mp4', 'user-1']);
    expect(autres.execFile).toHaveBeenCalledTimes(1);
    expect(etat.stockage.size).toBe(0);
  });

  it('rendu WebM déjà mixé : converti en MP4 (conversion qui garde le son), jamais re-muxé', async () => {
    const WEBM = 'https://cdn.example/user-1/rendus/mixe.webm';
    sonde('1\n');
    etat.base.scheduled_posts = [post('p1', {
      media_url: WEBM, metadata: { renderedVideoUrl: WEBM, hasAudio: true, musicUrl: MUSIQUE },
    })];
    await lancerCron(true);
    expect(autres.transcode).toHaveBeenCalledTimes(1);
    expect(autres.execFile).toHaveBeenCalledTimes(1); // la sonde seule
  });

  it('montage composé MUET (compositeur en mode rapide, son non chargé) + musique séparée → muxé', async () => {
    const MUET = 'https://cdn.example/user-1/rendus/montage-muet.mp4';
    sonde('');
    etat.base.scheduled_posts = [post('p1', {
      media_url: MUET, metadata: { renderedVideoUrl: MUET, hasAudio: true, musicUrl: MUSIQUE },
    })];
    await lancerCron(true);
    const ffmpeg = autres.execFile.mock.calls.find((c) => !(c[1] as string[]).includes('-select_streams'));
    expect((ffmpeg![1] as string[]).join(' ')).toContain('-map 0:v:0 -map 1:a:0');
    expect(zernio.uploadMedia.mock.calls[0][0]).toMatch(/\/converted\/muxed_\d+\.mp4$/);
  });

  it('montage composé, ffprobe en échec → le fichier d origine part tel quel', async () => {
    const RENDU = 'https://cdn.example/user-1/rendus/mixe.mp4';
    sonde(Object.assign(new Error('spawn ffprobe ENOENT'), { code: 'ENOENT' }));
    etat.base.scheduled_posts = [post('p1', {
      media_url: RENDU, metadata: { renderedVideoUrl: RENDU, hasAudio: true, musicUrl: MUSIQUE },
    })];
    await lancerCron(true);
    expect(autres.execFile).toHaveBeenCalledTimes(1);
    expect(zernio.uploadMedia.mock.calls[0][0]).toBe(RENDU);
    expect(etat.stockage.size).toBe(0);
  });

  it('sans montage composé, vidéo MUETTE + musique séparée → toujours muxée (comportement historique)', async () => {
    const MUETTE = 'https://cdn.example/user-1/rendus/muette.mp4';
    sonde('');
    etat.base.scheduled_posts = [post('p1', {
      media_url: MUETTE, metadata: { renderedVideoUrl: undefined, hasAudio: true, musicUrl: MUSIQUE },
    })];
    await lancerCron(true);
    const ffmpeg = autres.execFile.mock.calls.find((c) => !(c[1] as string[]).includes('-select_streams'));
    expect((ffmpeg![1] as string[]).join(' ')).toContain('-map 0:v:0 -map 1:a:0');
    expect(zernio.uploadMedia.mock.calls[0][0]).toMatch(/\/converted\/muxed_\d+\.mp4$/);
  });

  it('sans montage composé, la vidéo a DÉJÀ une piste audio (ffprobe) → envoyée telle quelle', async () => {
    const SONORE = 'https://cdn.example/user-1/rendus/sonore.mp4';
    sonde('1\n');
    etat.base.scheduled_posts = [post('p1', {
      media_url: SONORE, metadata: { renderedVideoUrl: undefined, hasAudio: true, musicUrl: MUSIQUE },
    })];
    await lancerCron(true);
    expect(autres.execFile).toHaveBeenCalledTimes(1); // la sonde seule, aucun FFmpeg
    expect(zernio.uploadMedia.mock.calls[0][0]).toBe(SONORE);
    expect(etat.stockage.size).toBe(0);
  });

  it('ffprobe en échec → défaut sûr : le fichier d origine part tel quel, aucun FFmpeg', async () => {
    const SOURCE = 'https://cdn.example/user-1/rendus/inconnu.mp4';
    sonde(Object.assign(new Error('spawn ffprobe ENOENT'), { code: 'ENOENT' }));
    etat.base.scheduled_posts = [post('p1', {
      media_url: SOURCE, metadata: { renderedVideoUrl: undefined, hasAudio: true, musicUrl: MUSIQUE },
    })];
    const r = await lancerCron(true);
    expect(autres.execFile).toHaveBeenCalledTimes(1);
    expect(zernio.uploadMedia.mock.calls[0][0]).toBe(SOURCE);
    expect(r.results[0].success).toBe(true);
  });

  it('ancien chemin (post Email seul) : un rendu déjà mixé n est pas re-muxé non plus', async () => {
    const RENDU = 'https://cdn.example/user-1/rendus/mixe.mp4';
    etat.base.scheduled_posts = [post('p1', {
      platforms: ['Email'], media_url: RENDU,
      metadata: { renderedVideoUrl: RENDU, hasAudio: true, musicUrl: MUSIQUE },
    })];
    sonde('1\n');
    await lancerCron(true);
    expect(autres.execFile).toHaveBeenCalledTimes(1); // la sonde seule, aucun FFmpeg
    expect(autres.sendEmail).toHaveBeenCalledTimes(1);
  });
});
