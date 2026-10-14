/**
 * CONTRAT — C-SOCIAL-CLEANUP : l'état de publication propre à UN post ne
 * fuit ni vers une copie (« Dupliquer »), ni vers un envoi ultérieur.
 *
 * (A) `metadata.canalEmail` est lié au post (`pour`) : la copie d'un post
 *     mixte Instagram + Email envoie SON email, une fois.
 * (B) `zernioPartiel` / `zernioResultatsReseaux` disparaissent quand ils ne
 *     sont plus vrais (preuve retirée, ou nouvel envoi non partiel), sans
 *     jamais effacer un partiel COURANT.
 *
 * Tout est simulé (aucun appel Zernio, aucune base, aucun email).
 * Ne pas modifier pour faire passer la CI (docs/FEATURE_LOCKS.md).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { etat, zernio, autres, post, lancerCron, reinitialiser, ligne, webhook, reprogrammer } from './helpers/socialHarness';

vi.mock('@/lib/db/supabase', async () => (await import('./helpers/socialHarness')).moduleSupabase());
vi.mock('@/lib/social/zernio', async (orig) => {
  const vrai = await orig<typeof import('@/lib/social/zernio')>();
  const { zernio } = await import('./helpers/socialHarness');
  return { ...vrai, createPost: zernio.createPost, uploadMedia: zernio.uploadMedia, trouverPostStudiio: vi.fn(async () => null) };
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

const ev = (event: string, studiioPostId: string, zid: string, platforms: unknown[] = []) => ({
  id: `evt-${event}-${zid}`, event,
  post: { id: zid, status: event.replace('post.', ''), platforms, metadata: { studiioPostId } },
});

/** « Dupliquer » du Calendrier : POST /api/posts avec la metadata COMPLÈTE de l'original. */
const dupliquer = (src: string, id: string) => {
  const o = ligne(src);
  etat.base.scheduled_posts.push({ ...o, id, status: 'scheduled', metadata: structuredClone(o.metadata) });
};

describe('C-SOCIAL-CLEANUP (A) — canalEmail lié au post', () => {
  it('la preuve email porte l id du post', async () => {
    etat.base.scheduled_posts = [post('p1', { platforms: ['Instagram', 'Email'] })];
    await lancerCron(true);
    expect(ligne('p1').metadata.canalEmail).toMatchObject({ etat: 'envoye', pour: 'p1' });
  });

  it('copie d un post mixte Instagram + Email : la copie envoie SON email, une seule fois', async () => {
    etat.base.scheduled_posts = [post('p1', { platforms: ['Instagram', 'Email'] })];
    await lancerCron(true);
    expect(autres.sendEmail).toHaveBeenCalledTimes(1);
    dupliquer('p1', 'p2');
    zernio.createPost.mockImplementationOnce(async () => ({ _id: 'zernio-post-2' }));
    await lancerCron(true);
    expect(autres.sendEmail).toHaveBeenCalledTimes(2);
    expect(zernio.createPost).toHaveBeenCalledTimes(2);
    expect(ligne('p2').metadata).toMatchObject({ zernioPostId: 'zernio-post-2', zernioForPostId: 'p2' });
    expect(ligne('p2').metadata.canalEmail).toMatchObject({ etat: 'envoye', pour: 'p2' });
    // L'original n'est pas touché, et aucun passage suivant ne renvoie.
    expect(ligne('p1').metadata.canalEmail).toMatchObject({ etat: 'envoye', pour: 'p1' });
    reprogrammer('p1'); reprogrammer('p2');
    await lancerCron(true);
    expect(autres.sendEmail).toHaveBeenCalledTimes(2);
  });

  it('copie dont l original est `en_cours` : la copie envoie quand même son email', async () => {
    etat.base.scheduled_posts = [post('p2', {
      platforms: ['Instagram', 'Email'],
      metadata: { renderedVideoUrl: 'https://cdn.example/rendus/montage.mp4', canalEmail: { etat: 'en_cours', pour: 'p1' } },
    })];
    await lancerCron(true);
    expect(autres.sendEmail).toHaveBeenCalledTimes(1);
    expect(ligne('p2').metadata.canalEmail).toMatchObject({ etat: 'envoye', pour: 'p2' });
  });

  it('preuve SANS `pour` (antérieure au lien) → prudence : considérée comme celle du post, pas de renvoi', async () => {
    etat.base.scheduled_posts = [post('p1', {
      platforms: ['Instagram', 'Email'],
      metadata: { renderedVideoUrl: 'https://cdn.example/rendus/montage.mp4', canalEmail: { etat: 'envoye' } },
    })];
    await lancerCron(true);
    expect(autres.sendEmail).not.toHaveBeenCalled();
  });
});

describe('C-SOCIAL-CLEANUP (B) — état partiel nettoyé quand il n est plus vrai', () => {
  it('partial → cancelled : preuve ET état partiel retirés', async () => {
    etat.base.scheduled_posts = [post('p1')];
    await lancerCron(false);
    await webhook(ev('post.partial', 'p1', 'zernio-post-1', [{ platform: 'instagram', status: 'published' }, { platform: 'tiktok', status: 'failed' }]));
    expect(ligne('p1').metadata.zernioPartiel).toBe(true);
    await webhook(ev('post.cancelled', 'p1', 'zernio-post-1'));
    expect(ligne('p1').status).toBe('failed');
    expect(ligne('p1').metadata).not.toHaveProperty('zernioPostId');
    expect(ligne('p1').metadata).not.toHaveProperty('zernioPartiel');
    expect(ligne('p1').metadata).not.toHaveProperty('zernioResultatsReseaux');
  });

  it('partial → cancelled → Réessayer (envoi OK) → une reprogrammation ultérieure n annonce PAS un partiel périmé', async () => {
    etat.base.scheduled_posts = [post('p1')];
    await lancerCron(false);
    await webhook(ev('post.partial', 'p1', 'zernio-post-1', [{ platform: 'instagram', status: 'published' }, { platform: 'tiktok', status: 'failed' }]));
    await webhook(ev('post.cancelled', 'p1', 'zernio-post-1'));
    zernio.createPost.mockImplementationOnce(async () => ({ _id: 'zernio-post-2' }));
    reprogrammer('p1');
    await lancerCron(false);
    expect(zernio.createPost).toHaveBeenCalledTimes(2);
    expect(ligne('p1').metadata).toMatchObject({ zernioPostId: 'zernio-post-2', zernioForPostId: 'p1' });
    expect(ligne('p1').metadata).not.toHaveProperty('zernioPartiel');
    reprogrammer('p1');
    await lancerCron(false);
    expect(zernio.createPost).toHaveBeenCalledTimes(2);
    expect(String(ligne('p1').metadata.error ?? '')).not.toMatch(/partiellement/);
  });

  it('partiel hérité par une preuve écrasée sans webhook (nouvel envoi non partiel) → nettoyé', async () => {
    etat.base.scheduled_posts = [post('p1', {
      metadata: {
        renderedVideoUrl: 'https://cdn.example/rendus/montage.mp4',
        zernioPartiel: true, zernioResultatsReseaux: [{ platform: 'instagram', success: true }],
      },
    })];
    await lancerCron(false);
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
    expect(ligne('p1').metadata).not.toHaveProperty('zernioPartiel');
    expect(ligne('p1').metadata).not.toHaveProperty('zernioResultatsReseaux');
  });

  it('copie d un original partiel : un envoi unique, la copie n hérite PAS du partiel ; l original le garde', async () => {
    etat.base.scheduled_posts = [post('p1')];
    await lancerCron(false);
    await webhook(ev('post.partial', 'p1', 'zernio-post-1', [{ platform: 'instagram', status: 'published' }]));
    dupliquer('p1', 'p2');
    zernio.createPost.mockImplementationOnce(async () => ({ _id: 'zernio-post-2' }));
    await lancerCron(false);
    expect(zernio.createPost).toHaveBeenCalledTimes(2);
    expect(ligne('p2').metadata).toMatchObject({ zernioPostId: 'zernio-post-2', zernioForPostId: 'p2' });
    expect(ligne('p2').metadata).not.toHaveProperty('zernioPartiel');
    expect(ligne('p1').metadata.zernioPartiel).toBe(true);
  });

  it('partiel COURANT : Réessayer reste bloqué (aucun nouvel envoi), partiel conservé', async () => {
    etat.base.scheduled_posts = [post('p1')];
    await lancerCron(false);
    await webhook(ev('post.partial', 'p1', 'zernio-post-1', [{ platform: 'instagram', status: 'published' }, { platform: 'tiktok', status: 'failed' }]));
    reprogrammer('p1');
    await lancerCron(false);
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
    expect(ligne('p1').status).toBe('failed');
    expect(String(ligne('p1').metadata.error)).toMatch(/partiellement/);
    expect(ligne('p1').metadata).toMatchObject({ zernioPostId: 'zernio-post-1', zernioPartiel: true });
  });
});
