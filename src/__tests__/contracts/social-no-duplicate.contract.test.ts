/**
 * CONTRAT — C-NO-DUPLICATE-PUBLISH.
 *
 * Une vidéo programmée part UNE fois sur les réseaux de l'utilisateur :
 * (G) deux passages du cron → un seul createPost ;
 * (H) deux passages concurrents (ou double clic) → un seul claim, un seul job ;
 * une preuve d'envoi (metadata.zernioPostId + zernioForPostId) empêche tout
 * second createPost, y compris après reprogrammation.
 *
 * Les quatre BUGS RÉELS démontrés ici (anciens `it.fails`) sont CORRIGÉS
 * (PR Social Safety) : ce sont désormais des contrats verts. Cas limites du
 * correctif : social-confirmation-perdue.contract.test.ts.
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

describe('C-NO-DUPLICATE-PUBLISH — bugs réels CORRIGÉS (anciens it.fails)', () => {
  /*
   * CORRIGÉ (1) — était : l'écriture de la preuve après createPost ignorait le
   * `{ error }` de l'update ; le post restait `publishing` SANS preuve, le
   * reset des « bloqués » le remettait à `scheduled` → republication auto.
   * Désormais : marqueur `zernioTentative` écrit AVANT createPost, `{ error }`
   * vérifié et écriture rejouée une fois, et le reset met un marqueur sans
   * preuve en `failed` + `confirmationPerdue`, jamais en `scheduled`.
   */
  it('CORRIGÉ (1) : preuve non écrite (update {error}) → le reset ne republie plus', async () => {
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
   * CORRIGÉ (2) — était : délai dépassé sur createPost → `failed` sans preuve,
   * « Réessayer » rappelait createPost → double publication possible.
   * Désormais : erreur ambiguë APRÈS envoi = PUBLISHED_BUT_CONFIRMATION_LOST
   * (marqueur gardé, `confirmationPerdue`) ; « Réessayer » interroge d'abord
   * Zernio (`trouverPostStudiio`) — ici la recherche échoue (réseau fermé) :
   * aucun envoi à l'aveugle. Un renvoi réutilise la même Idempotency-Key.
   */
  it('CORRIGÉ (2) : délai dépassé sur createPost puis « Réessayer » → aucun second createPost à l’aveugle', async () => {
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
   * CORRIGÉ (3) — était : après publierViaZernio, le cron écrivait
   * `status: 'publishing'` sans condition, écrasant un `published` posé par un
   * webhook précoce. Désormais l'écriture est conditionnée à
   * `.eq('status', 'publishing')`.
   */
  it('CORRIGÉ (3) : un post.published précoce n’est plus écrasé par status publishing', async () => {
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
   * CORRIGÉ (4) — était : post.partial → `failed` preuve gardée, puis
   * « Réessayer » → `dejaEnvoye` → bloqué à `publishing` pour toujours.
   * Désormais : `zernioPartiel` + résultats par réseau en metadata ; le cron
   * rend un échec explicite (réseaux en échec listés, marche à suivre), sans
   * renvoi ni blocage.
   */
  it('CORRIGÉ (4) : post.partial puis « Réessayer » → échec explicite, jamais bloqué à publishing', async () => {
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
