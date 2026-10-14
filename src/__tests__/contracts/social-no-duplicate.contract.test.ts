/**
 * CONTRAT — C-NO-DUPLICATE-PUBLISH.
 *
 * Une vidéo programmée part UNE fois sur les réseaux de l'utilisateur :
 * (G) deux passages du cron → un seul createPost ;
 * (H) deux passages concurrents (ou double clic) → un seul claim, un seul job ;
 * une preuve d'envoi (metadata.zernioPostId + zernioForPostId) empêche tout
 * second createPost, y compris après reprogrammation.
 *
 * Les `it.fails` documentent des BUGS RÉELS démontrés ici, non corrigés (la
 * publication fonctionne en production et n'est pas réécrite dans ce lot).
 * Quand un correctif arrive, le test devient rouge (« expected to fail ») :
 * retirer alors `.fails`, il devient un contrat vert.
 * Ne pas modifier pour faire passer la CI (docs/FEATURE_LOCKS.md).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { etat, zernio, post, lancerCron, reinitialiser, ligne, webhook, reprogrammer, IL_Y_A_UNE_HEURE } from './helpers/socialHarness';

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

/** Le webhook n'est pas arrivé et le seuil des posts « bloqués » (10 min) est franchi. */
const vieillir = (id: string) => { ligne(id).updated_at = IL_Y_A_UNE_HEURE(); };

describe('C-NO-DUPLICATE-PUBLISH (G) — passages successifs', () => {
  it('deux passages → un seul uploadMedia, un seul createPost, preuve liée au post', async () => {
    etat.base.scheduled_posts = [post('p1')];
    await lancerCron(false);
    expect(ligne('p1').status).toBe('publishing');
    expect(ligne('p1').metadata).toMatchObject({ zernioPostId: 'zernio-post-1', zernioForPostId: 'p1' });
    vieillir('p1');
    await lancerCron(false);
    await lancerCron(true);
    expect(zernio.uploadMedia).toHaveBeenCalledTimes(1);
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
    expect(ligne('p1').status).toBe('publishing');
     // Défense en profondeur : le reset des « bloqués » ne rend JAMAIS à
    // `scheduled` un post portant sa propre preuve d'envoi.
    expect(etat.ecritures.some((e) => e.maj.status === 'scheduled' && e.ids.includes('p1'))).toBe(false);
  });

  it('webhook post.published puis nouveaux passages → publié, aucun renvoi', async () => {
    etat.base.scheduled_posts = [post('p1')];
    await lancerCron(false);
    await webhook({ event: 'post.published', data: { _id: 'zernio-post-1', metadata: { studiioPostId: 'p1' } } });
    expect(ligne('p1').status).toBe('published');
    vieillir('p1');
    await lancerCron(false);
    await lancerCron(true);
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
    expect(ligne('p1').status).toBe('published');
  });

  it('reprogrammé alors que la preuve de CE post existe → aucun second createPost', async () => {
    etat.base.scheduled_posts = [post('p1')];
    await lancerCron(false);
    reprogrammer('p1');
    await lancerCron(false);
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
    expect(zernio.uploadMedia).toHaveBeenCalledTimes(1);
  });
});

describe('C-NO-DUPLICATE-PUBLISH (H) — concurrence', () => {
  it('deux passages simultanés → un seul claim, un seul createPost', async () => {
    etat.base.scheduled_posts = [post('p1')];
    const [a, b] = await Promise.all([lancerCron(false), lancerCron(false)]);
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
    const traites = [...(a.results ?? []), ...(b.results ?? [])];
    expect(traites).toHaveLength(1);
    const claims = etat.ecritures.filter((e) => e.maj.status === 'publishing' && e.ids.includes('p1'));
    expect(claims.length).toBeGreaterThanOrEqual(1);
  });

  it('trois passages simultanés sur deux posts → chaque post envoyé exactement une fois', async () => {
    etat.base.scheduled_posts = [post('p1'), post('p2')];
    zernio.createPost.mockImplementation(async (i: any) => ({ _id: `z-${i.metadata.studiioPostId}` }));
    await Promise.all([lancerCron(false), lancerCron(false), lancerCron(false)]);
    const ids = zernio.createPost.mock.calls.map((c) => c[0].metadata.studiioPostId).sort();
    expect(ids).toEqual(['p1', 'p2']);
  });
});

describe('C-NO-DUPLICATE-PUBLISH — BUGS RÉELS documentés (it.fails, non corrigés)', () => {
  /*
   * BUG RÉEL (1) : publishViaZernio.ts:287-306 — l'écriture de la preuve après
   * createPost ignore le `{ error }` renvoyé par l'update (seule une exception
   * est rattrapée). Si elle échoue, le post reste `publishing` SANS preuve ;
   * après 10 min le reset des « bloqués » le remet à `scheduled` et le passage
   * suivant RECRÉE le post chez Zernio → double publication automatique.
   */
  it.fails('BUG RÉEL (1) : preuve non écrite (update {error}) → le reset republie automatiquement', async () => {
    etat.base.scheduled_posts = [post('p1')];
    etat.panneEcriture = (table, maj) => table === 'scheduled_posts' && !!maj.metadata?.zernioPostId;
    await lancerCron(false);
    etat.panneEcriture = null;
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
    vieillir('p1');
    await lancerCron(false);
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
  });

  /*
   * BUG RÉEL (2) : createPost dépasse son délai (20 s) ou la réponse se perd
   * → ZernioError 503, `reessayable: true`, post `failed` SANS preuve. Rien
   * ne distingue FAILED_BEFORE_PUBLISH de PUBLISHED_BUT_CONFIRMATION_LOST :
   * « Réessayer » rappelle createPost alors que Zernio avait peut-être créé
   * le post → double publication.
   */
  it.fails('BUG RÉEL (2) : délai dépassé sur createPost puis « Réessayer » → second createPost', async () => {
    etat.base.scheduled_posts = [post('p1')];
    const { ZernioError } = await vi.importActual<typeof import('@/lib/social/zernio')>('@/lib/social/zernio');
    zernio.createPost.mockRejectedValueOnce(new ZernioError('Zernio /posts injoignable : This operation was aborted', 503));
    await lancerCron(false);
    expect(ligne('p1').status).toBe('failed');
    reprogrammer('p1');
    await lancerCron(false);
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
  });

  /*
   * BUG RÉEL (3) : route.ts:503-511 — après publierViaZernio, le cron écrit
   * `status: 'publishing'` SANS condition sur le statut courant. Un webhook
   * `post.published` arrivé entre createPost et cette écriture est écrasé :
   * le post reste `publishing` alors qu'il est publié.
   */
  it.fails('BUG RÉEL (3) : un post.published précoce est écrasé par status publishing', async () => {
    etat.base.scheduled_posts = [post('p1')];
    zernio.createPost.mockImplementationOnce(async () => {
      // Le webhook arrive avant que le cron ait fini sa propre écriture.
      ligne('p1').status = 'published';
      return { _id: 'zernio-post-1' };
    });
    await lancerCron(false);
    expect(ligne('p1').status).toBe('published');
  });

  /*
   * BUG RÉEL (4) : webhook post.partial → `failed` mais la preuve est GARDÉE
   * (voulu : ne pas republier les réseaux déjà servis). « Réessayer » du
   * Calendrier conserve metadata (preuve comprise) → le cron répond
   * `dejaEnvoye`, remet `publishing`, aucun webhook ne viendra, et le reset
   * exclut les preuves valides : post bloqué à `publishing` pour toujours,
   * sans message.
   */
  it.fails('BUG RÉEL (4) : post.partial puis « Réessayer » → bloqué à publishing sans fin', async () => {
    etat.base.scheduled_posts = [post('p1')];
    await lancerCron(false);
    await webhook({ event: 'post.partial', data: { _id: 'zernio-post-1', metadata: { studiioPostId: 'p1' } } });
    expect(ligne('p1').status).toBe('failed');
    reprogrammer('p1');
    await lancerCron(false);
    vieillir('p1');
    await lancerCron(false);
    expect(zernio.createPost).toHaveBeenCalledTimes(1); // pas de doublon : ça, c'est tenu
    expect(ligne('p1').status).not.toBe('publishing'); // mais l'état final doit être explicite
  });
});
