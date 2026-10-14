/**
 * CONTRAT — C-SOCIAL-PUBLISHING + C-SOCIAL-TEXT.
 *
 * Le post préparé = le post du Calendrier = ce qui part chez Zernio :
 * - (A) les BONS réseaux, et seulement eux, chacun avec SON compte ;
 * - (E) la BONNE vidéo (celle du post, sans substitution) ;
 * - (F) la BONNE légende, envoyée telle quelle ; repli sur le titre ;
 * - (I) les données du Calendrier sont exactement l'entrée du job.
 *
 * Tout est simulé (aucun appel Zernio, aucune base) : voir helpers/socialHarness.ts.
 * Ne pas modifier pour faire passer la CI (docs/FEATURE_LOCKS.md).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { etat, zernio, post, lancerCron, reinitialiser, ligne } from './helpers/socialHarness';

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

beforeEach(() => reinitialiser());
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const envoi = () => zernio.createPost.mock.calls[0][0];

describe('C-SOCIAL-PUBLISHING (A) — les bons réseaux, les bons comptes', () => {
  it('libellés du Calendrier → exactement les réseaux demandés et connectés, rien d autre', async () => {
    etat.comptes = [
      { platform: 'instagram', accountId: 'acc-ig' },
      { platform: 'facebook', accountId: 'acc-fb' },
      { platform: 'youtube', accountId: 'acc-yt' },
      { platform: 'tiktok', accountId: 'acc-tt' },
    ];
    etat.base.scheduled_posts = [post('p1', { platforms: ['Instagram', 'YouTube'] })];
    const r = await lancerCron(true);
    expect(r.results[0]).toMatchObject({ success: true, details: 'Zernio' });
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
    const cibles = envoi().platforms.map((c: any) => [c.platform, c.accountId]);
    expect(cibles).toEqual([['instagram', 'acc-ig'], ['youtube', 'acc-yt']]);
  });

  it('identifiants canoniques (Autopilote) et doublons → un compte par réseau', async () => {
    etat.comptes = [{ platform: 'instagram', accountId: 'acc-ig' }, { platform: 'facebook', accountId: 'acc-fb' }];
    etat.base.scheduled_posts = [post('p1', { platforms: ['facebook', 'Facebook', 'instagram'] })];
    await lancerCron(true);
    expect(envoi().platforms.map((c: any) => c.accountId)).toEqual(['acc-fb', 'acc-ig']);
  });

  it('réseau demandé sans compte → échec explicite, rien n est envoyé', async () => {
    etat.comptes = [{ platform: 'instagram', accountId: 'acc-ig' }];
    etat.base.scheduled_posts = [post('p1', { platforms: ['Facebook'] })];
    const r = await lancerCron(true);
    expect(r.results[0].success).toBe(false);
    expect(zernio.createPost).not.toHaveBeenCalled();
    expect(ligne('p1').status).toBe('failed');
    expect(String(ligne('p1').metadata.error)).toMatch(/Aucun compte connecté/);
  });

  it('le post Zernio porte l identifiant Studiio (corrélation webhook) et part MAINTENANT', async () => {
    etat.base.scheduled_posts = [post('p1')];
    await lancerCron(true);
    expect(envoi().metadata).toEqual({ studiioPostId: 'p1' });
    expect(envoi().publishNow).toBe(true);
    expect(envoi().scheduledFor).toBeUndefined();
  });
});

describe('C-SOCIAL-PUBLISHING (E) — la bonne vidéo', () => {
  it('le média du post est celui téléversé, et l URL Zernio rendue est celle publiée', async () => {
    etat.base.scheduled_posts = [post('p1', {
      media_url: 'https://cdn.example/rendus/p1-final.mp4',
      metadata: { renderedVideoUrl: 'https://cdn.example/rendus/p1-final.mp4' },
    })];
    zernio.uploadMedia.mockResolvedValueOnce('https://zernio.example/tmp/p1.mp4');
    await lancerCron(true);
    expect(zernio.uploadMedia).toHaveBeenCalledTimes(1);
    expect(zernio.uploadMedia.mock.calls[0][0]).toBe('https://cdn.example/rendus/p1-final.mp4');
    expect(zernio.uploadMedia.mock.calls[0][2]).toBe('video/mp4');
    expect(zernio.uploadMedia.mock.calls[0][3]).toBe('user-1');
    expect(envoi().mediaUrl).toBe('https://zernio.example/tmp/p1.mp4');
  });

  it('sans media_url, le montage rendu (metadata.renderedVideoUrl) est publié', async () => {
    etat.base.scheduled_posts = [post('p1', {
      media_url: null, metadata: { renderedVideoUrl: 'https://cdn.example/rendus/rendu.mp4' },
    })];
    await lancerCron(true);
    expect(zernio.uploadMedia.mock.calls[0][0]).toBe('https://cdn.example/rendus/rendu.mp4');
  });

  it('jamais le rush brut (metadata.videoUrl / rawVideoUrl) ni la vidéo liée à la place du montage', async () => {
    etat.base.scheduled_posts = [post('p1', {
      media_url: null,
      videos: { video_url: 'https://cdn.example/rush/brut.mp4' },
      metadata: { videoUrl: 'https://cdn.example/rush/brut.mp4', rawVideoUrl: 'https://cdn.example/rush/brut.mp4' },
    })];
    const r = await lancerCron(true);
    expect(zernio.uploadMedia).not.toHaveBeenCalled();
    expect(zernio.createPost).not.toHaveBeenCalled();
    expect(r.results[0].success).toBe(false);
    expect(ligne('p1').status).toBe('failed');
  });

  /*
   * PRÉCÉDENCE DOCUMENTÉE (comportement actuel, verrouillé) : sur le chemin
   * Zernio, `media_url` PRIME sur `metadata.renderedVideoUrl`
   * (preparerMediaZernio, route.ts). ⚠️ L'ancien chemin Meta direct fait
   * l'inverse (renderedVideoUrl d'abord, route.ts « STRICT Priority »).
   * Le Calendrier écrit les deux à la même valeur ; s'ils divergent, c'est
   * media_url qui part. Changer cet ordre est un changement de comportement
   * produit : il doit faire rougir ce contrat.
   */
  it('media_url et renderedVideoUrl divergents → media_url est publié (précédence actuelle)', async () => {
    etat.base.scheduled_posts = [post('p1', {
      media_url: 'https://cdn.example/rendus/media-url.mp4',
      metadata: { renderedVideoUrl: 'https://cdn.example/rendus/rendered.mp4' },
    })];
    await lancerCron(true);
    expect(zernio.uploadMedia.mock.calls[0][0]).toBe('https://cdn.example/rendus/media-url.mp4');
  });
});

describe('C-SOCIAL-TEXT (F) — la légende, telle quelle', () => {
  const LEGENDE = '  Bouge avec nous !\n\n#afroboost #danse — 18h30 « Genève » & co <3  \n🔥 ';

  it('caption envoyée octet pour octet (espaces, sauts de ligne, hashtags, caractères spéciaux)', async () => {
    etat.base.scheduled_posts = [post('p1', { caption: LEGENDE, title: 'TITRE QUI NE DOIT PAS PARTIR' })];
    await lancerCron(true);
    expect(envoi().content).toBe(LEGENDE);
  });

  it('caption absente → repli sur le titre', async () => {
    etat.base.scheduled_posts = [post('p1', { caption: null, title: 'Mon titre' })];
    await lancerCron(true);
    expect(envoi().content).toBe('Mon titre');
  });

  it('caption vide → repli sur le titre ; ni l un ni l autre → chaîne vide (jamais "undefined"/"null")', async () => {
    etat.base.scheduled_posts = [post('p1', { caption: '', title: 'Mon titre' })];
    await lancerCron(true);
    expect(envoi().content).toBe('Mon titre');

    reinitialiser();
    etat.base.scheduled_posts = [post('p2', { caption: null, title: null })];
    await lancerCron(true);
    expect(envoi().content).toBe('');
  });
});

describe('C-SOCIAL-PUBLISHING (I) — données du Calendrier = entrée du job', () => {
  it('réseaux, vidéo, légende et identifiant envoyés sont ceux de la ligne relue en base', async () => {
    etat.comptes = [{ platform: 'instagram', accountId: 'acc-ig' }, { platform: 'facebook', accountId: 'acc-fb' }];
    const calendrier = post('cal-42', {
      platforms: ['Facebook', 'Instagram'],
      caption: 'Légende du Calendrier',
      media_url: 'https://cdn.example/rendus/cal-42.mp4',
      metadata: { renderedVideoUrl: 'https://cdn.example/rendus/cal-42.mp4', design: { titleFont: 'Anton' } },
    });
    etat.base.scheduled_posts = [calendrier];
    await lancerCron(true);

    const e = envoi();
    expect(e.content).toBe(calendrier.caption);
    expect(e.platforms.map((c: any) => c.platform)).toEqual(['facebook', 'instagram']);
    expect(zernio.uploadMedia.mock.calls[0][0]).toBe(calendrier.media_url);
    expect(e.metadata.studiioPostId).toBe(calendrier.id);
    // Le job n'a rien effacé de ce que le Calendrier sait afficher.
    expect(ligne('cal-42').metadata.design).toEqual({ titleFont: 'Anton' });
    expect(ligne('cal-42').metadata.zernioForPostId).toBe('cal-42');
  });
});

describe('C-SOCIAL-PUBLISHING (A) — canaux sans compte social', () => {
  it('post Email seul → l email part à l auteur, Zernio n est pas appelé', async () => {
    const { autres } = await import('./helpers/socialHarness');
    etat.base.scheduled_posts = [post('p1', { platforms: ['Email'] })];
    await lancerCron(true);
    expect(zernio.createPost).not.toHaveBeenCalled();
    expect(autres.sendEmail).toHaveBeenCalledTimes(1);
    expect(autres.sendEmail.mock.calls[0][0].to).toBe('auteur@test.local');
  });

  /*
   * BUG RÉEL (5) : un post mixte (Email + un réseau Zernio) prend le chemin
   * Zernio, qui se termine par `continue` (route.ts:517) : la boucle des
   * canaux où vit l'Email n'est jamais atteinte. L'email n'est JAMAIS envoyé,
   * sans erreur ni trace dans le Calendrier.
   */
  it.fails('BUG RÉEL (5) : post mixte Instagram + Email → l email doit aussi partir', async () => {
    const { autres } = await import('./helpers/socialHarness');
    etat.base.scheduled_posts = [post('p1', { platforms: ['Instagram', 'Email'] })];
    await lancerCron(true);
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
    expect(autres.sendEmail).toHaveBeenCalledTimes(1);
  });
});
