/**
 * CONTRAT — C-NO-DUPLICATE-PUBLISH, volet « confirmation perdue ».
 *
 * Complète social-no-duplicate.contract.test.ts (bugs 1-4 corrigés) sur les
 * cas limites introduits par le correctif :
 * - marqueur de tentative (`metadata.zernioTentative`) écrit AVANT createPost,
 *   et sa clé envoyée comme `Idempotency-Key` ;
 * - reset des « bloqués » : marqueur sans preuve → `failed` + confirmationPerdue,
 *   jamais `scheduled` ;
 * - « Réessayer » après confirmation perdue : Zernio est interrogé d'abord
 *   (trouvé / absent / recherche en erreur / clé expirée / trouvé en échec) ;
 * - envoi partiel : état explicite, résultats par réseau conservés.
 *
 * ⚠️ AUCUN RÉSEAU : Zernio, base, stockage, e-mail simulés ; `fetch` lève.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { etat, zernio, autres, post, lancerCron, reinitialiser, ligne, webhook, reprogrammer, IL_Y_A_UNE_HEURE } from './helpers/socialHarness';

const recherche = vi.hoisted(() => ({ trouverPostStudiio: vi.fn() }));

vi.mock('@/lib/db/supabase', async () => (await import('./helpers/socialHarness')).moduleSupabase());
vi.mock('@/lib/social/zernio', async (orig) => {
  const vrai = await orig<typeof import('@/lib/social/zernio')>();
  const { zernio } = await import('./helpers/socialHarness');
  return { ...vrai, createPost: zernio.createPost, uploadMedia: zernio.uploadMedia, trouverPostStudiio: recherche.trouverPostStudiio };
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

beforeEach(() => {
  reinitialiser();
  recherche.trouverPostStudiio.mockReset().mockResolvedValue(null);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete process.env.ZERNIO_API_KEY; });

const vieillir = (id: string) => { ligne(id).updated_at = IL_Y_A_UNE_HEURE(); };
const cleEnvoyee = (n: number) => (zernio.createPost.mock.calls[n] as unknown[])[1] as { idempotencyKey?: string } | undefined;
const IL_Y_A = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
const tentative = (le = IL_Y_A(1), pour = 'p1') => ({ cle: 'cle-ancienne', pour, le });

/** Un délai dépassé sur createPost : la réponse de Zernio est perdue. */
async function delaiDepasse() {
  const { ZernioError } = await vi.importActual<typeof import('@/lib/social/zernio')>('@/lib/social/zernio');
  zernio.createPost.mockRejectedValueOnce(new ZernioError('Zernio /posts injoignable : This operation was aborted', 503));
}

describe('Marqueur de tentative', () => {
  it('écrit AVANT createPost, lié au post, et sa clé part en Idempotency-Key', async () => {
    etat.base.scheduled_posts = [post('p1')];
    let vuAuMomentDeLEnvoi: any = null;
    zernio.createPost.mockImplementationOnce(async () => {
      vuAuMomentDeLEnvoi = ligne('p1').metadata.zernioTentative;
      return { _id: 'zernio-post-1' };
    });
    await lancerCron(false);
    expect(vuAuMomentDeLEnvoi).toMatchObject({ pour: 'p1' });
    expect(typeof vuAuMomentDeLEnvoi.cle).toBe('string');
    expect(cleEnvoyee(0)?.idempotencyKey).toBe(vuAuMomentDeLEnvoi.cle);
    expect(ligne('p1').metadata).toMatchObject({ zernioPostId: 'zernio-post-1', zernioForPostId: 'p1' });
    // Les métadonnées existantes sont conservées.
    expect(ligne('p1').metadata.renderedVideoUrl).toBe('https://cdn.example/rendus/montage.mp4');
  });

  it('marqueur impossible à écrire → AUCUN createPost (rien n\'est parti)', async () => {
    etat.base.scheduled_posts = [post('p1')];
    etat.panneEcriture = (table, maj) => table === 'scheduled_posts' && !!maj.metadata?.zernioTentative;
    await lancerCron(false);
    expect(zernio.createPost).not.toHaveBeenCalled();
    expect(ligne('p1').status).toBe('failed');
  });

  it('preuve en échec au 1er essai, écrite au 2e → preuve présente, aucun « confirmation perdue »', async () => {
    etat.base.scheduled_posts = [post('p1')];
    let pannes = 1;
    etat.panneEcriture = (table, maj) => table === 'scheduled_posts' && !!maj.metadata?.zernioPostId && pannes-- > 0;
    await lancerCron(false);
    expect(ligne('p1').metadata).toMatchObject({ zernioPostId: 'zernio-post-1', zernioForPostId: 'p1' });
    vieillir('p1');
    await lancerCron(false);
    expect(ligne('p1').status).toBe('publishing');
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
  });

  it('copie (Dupliquer) portant le marqueur d\'un AUTRE post → ignoré : nouvelle clé, aucune recherche', async () => {
    etat.base.scheduled_posts = [post('copie', { metadata: { renderedVideoUrl: 'https://cdn.example/r.mp4', zernioTentative: tentative(IL_Y_A(1), 'original') } })];
    await lancerCron(false);
    expect(recherche.trouverPostStudiio).not.toHaveBeenCalled();
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
    expect(cleEnvoyee(0)?.idempotencyKey).not.toBe('cle-ancienne');
    expect(ligne('copie').metadata.zernioTentative.pour).toBe('copie');
  });

  it('refus net de Zernio APRÈS envoi (4xx) → échec classique, marqueur retiré', async () => {
    etat.base.scheduled_posts = [post('p1')];
    const { ZernioError } = await vi.importActual<typeof import('@/lib/social/zernio')>('@/lib/social/zernio');
    zernio.createPost.mockRejectedValueOnce(new ZernioError('refus', 400, undefined, 'VALIDATION', 'contenu invalide'));
    await lancerCron(false);
    expect(ligne('p1').status).toBe('failed');
    expect(ligne('p1').metadata).not.toHaveProperty('zernioTentative');
    expect(ligne('p1').metadata.confirmationPerdue).toBeUndefined();
    // Republier est alors sans risque : aucune recherche.
    reprogrammer('p1');
    await lancerCron(false);
    expect(recherche.trouverPostStudiio).not.toHaveBeenCalled();
    expect(zernio.createPost).toHaveBeenCalledTimes(2);
  });
});

describe('Reset des posts bloqués', () => {
  it('publishing + marqueur sans preuve → failed « confirmation perdue », jamais scheduled', async () => {
    const t = tentative();
    etat.base.scheduled_posts = [post('p1', { status: 'publishing', updated_at: IL_Y_A_UNE_HEURE(), metadata: { renderedVideoUrl: 'x', zernioTentative: t } })];
    await lancerCron(false);
    expect(ligne('p1').status).toBe('failed');
    expect(ligne('p1').metadata).toMatchObject({ confirmationPerdue: true, zernioTentative: t, renderedVideoUrl: 'x' });
    expect(ligne('p1').metadata.error).toMatch(/Confirmation perdue/);
    expect(etat.ecritures.some((e) => e.maj.status === 'scheduled' && e.ids.includes('p1'))).toBe(false);
    expect(zernio.createPost).not.toHaveBeenCalled();
  });

  it('publishing SANS marqueur ni preuve (crash avant envoi) → remis à scheduled, comme avant', async () => {
    etat.base.scheduled_posts = [post('p1', { status: 'publishing', updated_at: IL_Y_A_UNE_HEURE() })];
    await lancerCron(false);
    expect(etat.ecritures.some((e) => e.maj.status === 'scheduled' && e.ids.includes('p1'))).toBe(true);
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
  });
});

describe('« Réessayer » après confirmation perdue — Zernio interrogé d\'abord', () => {
  async function confirmationPerdue() {
    etat.base.scheduled_posts = [post('p1')];
    await delaiDepasse();
    await lancerCron(false);
    expect(ligne('p1').status).toBe('failed');
    expect(ligne('p1').metadata.confirmationPerdue).toBe(true);
    expect(ligne('p1').metadata.error).toMatch(/Confirmation perdue/);
    const cle = ligne('p1').metadata.zernioTentative.cle as string;
    expect(cleEnvoyee(0)?.idempotencyKey).toBe(cle);
    reprogrammer('p1');
    return cle;
  }

  it('trouvé chez Zernio (en cours) → aucun createPost, preuve écrite, publishing', async () => {
    await confirmationPerdue();
    recherche.trouverPostStudiio.mockResolvedValueOnce({ _id: 'z-retrouve', status: 'publishing', metadata: { studiioPostId: 'p1' } });
    await lancerCron(false);
    expect(recherche.trouverPostStudiio).toHaveBeenCalledWith('p1', expect.objectContaining({ accountId: 'acc-ig' }));
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
    expect(ligne('p1').status).toBe('publishing');
    expect(ligne('p1').metadata).toMatchObject({ zernioPostId: 'z-retrouve', zernioForPostId: 'p1' });
    expect(ligne('p1').metadata.confirmationPerdue).toBeUndefined();
  });

  it('trouvé chez Zernio déjà publié → published, aucun createPost', async () => {
    await confirmationPerdue();
    recherche.trouverPostStudiio.mockResolvedValueOnce({ _id: 'z-retrouve', status: 'published' });
    await lancerCron(false);
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
    expect(ligne('p1').status).toBe('published');
  });

  it('trouvé en partiel → failed explicite, preuve gardée, réseaux en échec listés', async () => {
    await confirmationPerdue();
    recherche.trouverPostStudiio.mockResolvedValueOnce({
      _id: 'z-retrouve', status: 'partial',
      platforms: [{ platform: 'instagram', status: 'published' }, { platform: 'tiktok', status: 'failed', errorMessage: 'refus' }],
    });
    await lancerCron(false);
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
    expect(ligne('p1').status).toBe('failed');
    expect(ligne('p1').metadata).toMatchObject({ zernioPostId: 'z-retrouve', zernioForPostId: 'p1', zernioPartiel: true });
    expect(ligne('p1').metadata.error).toMatch(/partiellement.*tiktok/);
  });

  it('absent chez Zernio (clé < 24 h) → UN createPost, avec la MÊME clé d\'idempotence', async () => {
    const cle = await confirmationPerdue();
    await lancerCron(false);
    expect(zernio.createPost).toHaveBeenCalledTimes(2);
    expect(cleEnvoyee(1)?.idempotencyKey).toBe(cle);
    expect(ligne('p1').status).toBe('publishing');
    expect(ligne('p1').metadata).toMatchObject({ zernioPostId: 'zernio-post-1', zernioForPostId: 'p1' });
  });

  it('recherche en erreur → AUCUN createPost, failed + confirmation requise', async () => {
    await confirmationPerdue();
    recherche.trouverPostStudiio.mockRejectedValueOnce(new Error('Zernio injoignable'));
    await lancerCron(false);
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
    expect(ligne('p1').status).toBe('failed');
    expect(ligne('p1').metadata).toMatchObject({ confirmationRequise: true });
    expect(ligne('p1').metadata.zernioTentative).toBeTruthy();
    expect(ligne('p1').metadata.error).toMatch(/Impossible de vérifier/);
  });

  it('confirmation explicite de l\'utilisateur (publierSansVerification) → envoi avec la même clé, drapeaux retirés', async () => {
    const cle = await confirmationPerdue();
    recherche.trouverPostStudiio.mockRejectedValueOnce(new Error('Zernio injoignable'));
    await lancerCron(false);
    reprogrammer('p1');
    ligne('p1').metadata.publierSansVerification = true;
    await lancerCron(false);
    expect(recherche.trouverPostStudiio).toHaveBeenCalledTimes(1);
    expect(zernio.createPost).toHaveBeenCalledTimes(2);
    expect(cleEnvoyee(1)?.idempotencyKey).toBe(cle);
    expect(ligne('p1').metadata.publierSansVerification).toBeUndefined();
    expect(ligne('p1').metadata.confirmationRequise).toBeUndefined();
  });

  it('absent mais tentative > 24 h (clé expirée) → AUCUN createPost, confirmation requise', async () => {
    etat.base.scheduled_posts = [post('p1', { metadata: { renderedVideoUrl: 'x', zernioTentative: tentative(IL_Y_A(30)) } })];
    await lancerCron(false);
    expect(zernio.createPost).not.toHaveBeenCalled();
    expect(ligne('p1').status).toBe('failed');
    expect(ligne('p1').metadata).toMatchObject({ confirmationRequise: true });
  });

  it('trouvé en échec chez Zernio → rien n\'est parti : nouvel envoi avec une NOUVELLE clé', async () => {
    etat.base.scheduled_posts = [post('p1', { metadata: { renderedVideoUrl: 'x', zernioTentative: tentative() } })];
    recherche.trouverPostStudiio.mockResolvedValueOnce({ _id: 'z-echoue', status: 'failed' });
    await lancerCron(false);
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
    expect(cleEnvoyee(0)?.idempotencyKey).not.toBe('cle-ancienne');
  });
});

describe('Webhooks et état explicite', () => {
  it('post.failed retire aussi le marqueur : la reprogrammation republie sans recherche', async () => {
    etat.base.scheduled_posts = [post('p1')];
    await lancerCron(false);
    await webhook({ event: 'post.failed', data: { _id: 'zernio-post-1', metadata: { studiioPostId: 'p1' } } });
    expect(ligne('p1').metadata).not.toHaveProperty('zernioTentative');
    reprogrammer('p1');
    await lancerCron(false);
    expect(recherche.trouverPostStudiio).not.toHaveBeenCalled();
    expect(zernio.createPost).toHaveBeenCalledTimes(2);
  });

  it('post.partial : résultats par réseau gardés (format docs : post.platforms[]) et message explicite', async () => {
    etat.base.scheduled_posts = [post('p1')];
    await lancerCron(false);
    await webhook({
      event: 'post.partial',
      // Enveloppe documentée seule : metadata ET platforms sous `post` (jamais
      // `data.metadata` mêlé à `post.platforms`, contrat C-SOCIAL-WEBHOOK-ENVELOPPE).
      post: {
        id: 'zernio-post-1', metadata: { studiioPostId: 'p1' },
        platforms: [{ platform: 'instagram', status: 'published' }, { platform: 'youtube', status: 'failed', error: 'quota' }],
      },
    });
    expect(ligne('p1').status).toBe('failed');
    expect(ligne('p1').metadata).toMatchObject({
      zernioPostId: 'zernio-post-1', zernioPartiel: true,
      zernioResultatsReseaux: [{ platform: 'instagram', success: true }, { platform: 'youtube', success: false, error: 'quota' }],
    });
    // « Réessayer » : résultats vidés côté Calendrier, mais l'échec reste explicite.
    reprogrammer('p1');
    await lancerCron(false);
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
    expect(ligne('p1').status).toBe('failed');
    expect(ligne('p1').metadata.error).toMatch(/partiellement.*youtube/);
  });

  it('un post.failed précoce (pendant createPost) n\'est pas écrasé par publishing', async () => {
    etat.base.scheduled_posts = [post('p1')];
    zernio.createPost.mockImplementationOnce(async () => {
      ligne('p1').status = 'failed';
      return { _id: 'zernio-post-1' };
    });
    await lancerCron(false);
    expect(ligne('p1').status).toBe('failed');
  });
});

describe('Revue — clé du repli sans couverture, statut rendu par createPost, bypass à usage unique', () => {
  it('repli sans couverture (422) → clé DÉRIVÉE distincte, notée dans le marqueur', async () => {
    etat.base.scheduled_posts = [post('p1', { metadata: { renderedVideoUrl: 'https://cdn.example/r.mp4', cover: { mode: 'frame', frameMs: 1500 } } })];
    const { ZernioError } = await vi.importActual<typeof import('@/lib/social/zernio')>('@/lib/social/zernio');
    zernio.createPost.mockRejectedValueOnce(new ZernioError('couverture refusee', 422));
    await lancerCron(false);
    expect(zernio.createPost).toHaveBeenCalledTimes(2);
    const cle = ligne('p1').metadata.zernioTentative.cle as string;
    expect(cleEnvoyee(0)?.idempotencyKey).toBe(cle);
    expect(cleEnvoyee(1)?.idempotencyKey).toBe(`${cle}:sans-couverture`);
    expect(ligne('p1').metadata.zernioTentative.cleSansCouverture).toBe(`${cle}:sans-couverture`);
    expect(ligne('p1').metadata).toMatchObject({ zernioPostId: 'zernio-post-1', zernioForPostId: 'p1' });
  });

  it('« Réessayer » après un renvoi sans couverture → repasse par la clé dérivée, sans retenter la couverture', async () => {
    etat.base.scheduled_posts = [post('p1', { metadata: {
      renderedVideoUrl: 'https://cdn.example/r.mp4', cover: { mode: 'frame', frameMs: 1500 },
      zernioTentative: { ...tentative(), cleSansCouverture: 'cle-ancienne:sans-couverture' },
    } })];
    await lancerCron(false);
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
    expect(cleEnvoyee(0)?.idempotencyKey).toBe('cle-ancienne:sans-couverture');
  });

  it('createPost rend le post ORIGINAL en échec (rejeu de clé) → failed, preuve et marqueur retirés', async () => {
    etat.base.scheduled_posts = [post('p1', { metadata: { renderedVideoUrl: 'x', zernioTentative: tentative() } })];
    zernio.createPost.mockResolvedValueOnce({ _id: 'z-orig', status: 'failed', platforms: [{ platform: 'instagram', status: 'failed', errorMessage: 'refus' }] } as any);
    await lancerCron(false);
    expect(ligne('p1').status).toBe('failed');
    expect(ligne('p1').metadata).not.toHaveProperty('zernioPostId');
    expect(ligne('p1').metadata).not.toHaveProperty('zernioTentative');
    // Republier ensuite : nouvelle clé, pas de rejeu du post échoué.
    reprogrammer('p1');
    await lancerCron(false);
    expect(zernio.createPost).toHaveBeenCalledTimes(2);
    expect(cleEnvoyee(1)?.idempotencyKey).not.toBe('cle-ancienne');
  });

  it('createPost rend un post partiel → état partiel explicite, preuve gardée', async () => {
    etat.base.scheduled_posts = [post('p1')];
    zernio.createPost.mockResolvedValueOnce({ _id: 'z-part', status: 'partial', platforms: [{ platform: 'instagram', status: 'published' }, { platform: 'tiktok', status: 'failed', errorMessage: 'non' }] } as any);
    await lancerCron(false);
    expect(ligne('p1').status).toBe('failed');
    expect(ligne('p1').metadata).toMatchObject({ zernioPostId: 'z-part', zernioForPostId: 'p1', zernioPartiel: true });
    expect(ligne('p1').metadata.error).toMatch(/partiellement.*tiktok/);
  });

  it('createPost rend un post déjà publié → published', async () => {
    etat.base.scheduled_posts = [post('p1')];
    zernio.createPost.mockResolvedValueOnce({ _id: 'z-pub', status: 'published' } as any);
    await lancerCron(false);
    expect(ligne('p1').status).toBe('published');
    expect(ligne('p1').metadata).toMatchObject({ zernioPostId: 'z-pub', zernioForPostId: 'p1' });
  });

  it('le bypass publierSansVerification ne revient jamais par l écriture d échec (copie périmée du cron)', async () => {
    etat.base.scheduled_posts = [post('p1', { metadata: {
      renderedVideoUrl: 'x', zernioTentative: tentative(), confirmationRequise: true, publierSansVerification: true,
    } })];
    await delaiDepasse();
    await lancerCron(false);
    expect(ligne('p1').status).toBe('failed');
    expect(ligne('p1').metadata.publierSansVerification).toBeUndefined();
    expect(ligne('p1').metadata.confirmationRequise).toBeUndefined();
    expect(ligne('p1').metadata.confirmationPerdue).toBe(true);
  });

  it('échec AVANT envoi (aucun compte connecté) : le bypass publierSansVerification est consommé, jamais conservé', async () => {
    etat.comptes = [];
    etat.base.scheduled_posts = [post('p1', { metadata: {
      renderedVideoUrl: 'x', zernioTentative: tentative(), confirmationRequise: true, publierSansVerification: true,
    } })];
    await lancerCron(false);
    expect(ligne('p1').status).toBe('failed');
    expect(zernio.createPost).not.toHaveBeenCalled();
    expect(ligne('p1').metadata.publierSansVerification).toBeUndefined();
  });

  it('échec AVANT envoi (montage périmé) : le bypass publierSansVerification est consommé, jamais conservé', async () => {
    etat.base.scheduled_posts = [post('p1', { metadata: {
      renderedVideoUrl: 'x', montagePerime: true, zernioTentative: tentative(), confirmationRequise: true, publierSansVerification: true,
    } })];
    await lancerCron(false);
    expect(ligne('p1').status).toBe('failed');
    expect(zernio.createPost).not.toHaveBeenCalled();
    expect(ligne('p1').metadata.publierSansVerification).toBeUndefined();
  });
});

describe('Canal e-mail d un post mixte — fusion de la seule clé canalEmail', () => {
  it('relecture impossible après l envoi → n écrit PAS une copie périmée (preuve retirée entre-temps non ressuscitée)', async () => {
    etat.base.scheduled_posts = [post('p1', { platforms: ['Instagram', 'Email'] })];
    autres.sendEmail.mockImplementationOnce(async () => {
      // Pendant l'envoi : un webhook post.failed retire la preuve, puis la base devient illisible.
      const m = { ...ligne('p1').metadata };
      delete m.zernioPostId; delete m.zernioForPostId;
      ligne('p1').metadata = m;
      etat.panneLecture = (t) => t === 'scheduled_posts';
      return { success: true };
    });
    await lancerCron(false);
    etat.panneLecture = null;
    expect(autres.sendEmail).toHaveBeenCalledTimes(1);
    expect(ligne('p1').metadata).not.toHaveProperty('zernioPostId');
    // Reste « en_cours » : jamais renvoyé, jamais une copie périmée réécrite.
    expect(ligne('p1').metadata.canalEmail.etat).toBe('en_cours');
  });
});

describe('Client Zernio — recherche et idempotence (fetch simulé, aucun appel réel)', () => {
  it('createPost envoie Idempotency-Key ; trouverPostStudiio lit GET /posts et compare metadata.studiioPostId', async () => {
    process.env.ZERNIO_API_KEY = 'cle-test';
    const vrai = await vi.importActual<typeof import('@/lib/social/zernio')>('@/lib/social/zernio');
    const appels: Array<{ url: string; init: any }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      appels.push({ url, init });
      const corps = init?.method === 'POST'
        ? { post: { _id: 'z1' } }
        : { posts: [{ _id: 'autre', metadata: { studiioPostId: 'p2' } }, { _id: 'z1', status: 'published', metadata: { studiioPostId: 'p1' } }], pagination: { pages: 1 } };
      return new Response(JSON.stringify(corps), { status: 200 });
    }));
    await vrai.createPost({ content: 'x', platforms: [] }, { idempotencyKey: 'k-1' });
    expect(appels[0].init.headers['Idempotency-Key']).toBe('k-1');

    const trouve = await vrai.trouverPostStudiio('p1', { depuis: '2026-10-14T10:00:00.000Z', accountId: 'acc-ig' });
    expect(trouve?._id).toBe('z1');
    const u = new URL(appels[1].url);
    expect(u.pathname).toBe('/api/v1/posts');
    expect(Object.fromEntries(u.searchParams)).toEqual({ source: 'zernio', fromDate: '2026-10-13', limit: '50', offset: '0', accountId: 'acc-ig' });
    expect(appels[1].init.method).toBe('GET');
  });

  it('absent sur la dernière page → null ; réponse sans liste → lève (jamais « absent » par défaut)', async () => {
    process.env.ZERNIO_API_KEY = 'cle-test';
    const vrai = await vi.importActual<typeof import('@/lib/social/zernio')>('@/lib/social/zernio');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ posts: [], pagination: { pages: 1 } }), { status: 200 })));
    await expect(vrai.trouverPostStudiio('p1', { depuis: new Date().toISOString() })).resolves.toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ erreur: true }), { status: 200 })));
    await expect(vrai.trouverPostStudiio('p1', { depuis: new Date().toISOString() })).rejects.toThrow();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    await expect(vrai.trouverPostStudiio('p1', { depuis: new Date().toISOString() })).rejects.toThrow();
  });

  it('trop de pages pour conclure → lève', async () => {
    process.env.ZERNIO_API_KEY = 'cle-test';
    const vrai = await vi.importActual<typeof import('@/lib/social/zernio')>('@/lib/social/zernio');
    const pleine = Array.from({ length: 50 }, (_, i) => ({ _id: `z${i}`, metadata: { studiioPostId: `autre-${i}` } }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ posts: pleine, pagination: { pages: 99 } }), { status: 200 })));
    await expect(vrai.trouverPostStudiio('p1', { depuis: new Date().toISOString() })).rejects.toThrow(/non concluante/);
  });
});
