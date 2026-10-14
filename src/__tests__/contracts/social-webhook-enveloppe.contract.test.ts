/**
 * CONTRAT — webhook Zernio : enveloppe DOCUMENTÉE par le fournisseur.
 *
 * Spécification OpenAPI publique Zernio (docs.zernio.com/api/openapi) :
 * - `WebhookPayloadPost` : `{ id, event, post: { id, status, platforms[], metadata }, timestamp }`.
 *   La `metadata` libre passée à la création revient sous `post.metadata`
 *   (changelog Zernio du 2026-07-09). Il n'y a AUCUNE enveloppe `data`.
 * - `WebhookPayloadAccountConnected/Disconnected` :
 *   `{ id, event, account: { accountId, profileId, platform, username }, timestamp }`.
 *
 * Les anciennes fixtures `{ event, data: {...} }` avaient été écrites d'après
 * le code, pas d'après la doc : le webhook ignorait en silence les vrais
 * événements. Les deux formes restent acceptées.
 *
 * ⚠️ AUCUN RÉSEAU : Zernio, base, stockage, e-mail simulés.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'crypto';
import { etat, post, lancerCron, reinitialiser, ligne, webhook, reprogrammer, WEBHOOK_SECRET, zernio } from './helpers/socialHarness';

const espion = vi.hoisted(() => ({ upserts: [] as Array<{ table: string; valeurs: Record<string, unknown> }> }));

vi.mock('@/lib/db/supabase', async () => {
  const h = await import('./helpers/socialHarness');
  const m = h.moduleSupabase();
  const from = m.supabaseAdmin.from;
  // Le harnais ignore `upsert` : on l'observe ici, sans changer son comportement.
  const client = {
    ...m.supabaseAdmin,
    from: (t: string) => {
      const c = from(t);
      const upsert = c.upsert;
      c.upsert = (v: Record<string, unknown>, o?: unknown) => { espion.upserts.push({ table: t, valeurs: v }); return upsert(v, o); };
      return c;
    },
  };
  return { supabaseAdmin: client, supabase: client };
});
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

beforeEach(() => {
  reinitialiser();
  espion.upserts = [];
});

/** Événement post au format OpenAPI `WebhookPayloadPost`. */
const evenementPost = (event: string, platforms: unknown[], metadata: Record<string, unknown> = { studiioPostId: 'p1' }) => ({
  id: `evt-${event}`,
  event,
  post: {
    id: 'zernio-post-1', content: 'Légende', status: event.replace('post.', ''),
    scheduledFor: new Date().toISOString(), platforms, metadata,
  },
  timestamp: new Date().toISOString(),
});

/** POST brut, signature au choix — pour les cas de refus. */
async function posterBrut(corps: string, signature: string | null) {
  const { POST } = await import('@/app/api/social/zernio/webhook/route');
  return POST(new NextRequest('http://localhost:3000/api/social/zernio/webhook', {
    method: 'POST', body: corps, headers: signature ? { 'x-zernio-signature': signature } : {},
  }));
}
const signer = (corps: string) => createHmac('sha256', WEBHOOK_SECRET).update(corps, 'utf8').digest('hex');

describe('Événements post — enveloppe documentée `post`', () => {
  it('post.published → published', async () => {
    etat.base.scheduled_posts = [post('p1')];
    await lancerCron(false);
    expect(ligne('p1').status).toBe('publishing');
    const res = await webhook(evenementPost('post.published', [{ platform: 'instagram', status: 'published', accountId: 'acc-ig' }]));
    expect(res.status).toBe(200);
    expect(ligne('p1').status).toBe('published');
  });

  it('post.failed → failed, preuve d\'envoi retirée, metadata fusionnée', async () => {
    etat.base.scheduled_posts = [post('p1')];
    await lancerCron(false);
    expect(ligne('p1').metadata.zernioPostId).toBe('zernio-post-1');
    await webhook(evenementPost('post.failed', [{ platform: 'instagram', status: 'failed', error: 'refus' }]));
    expect(ligne('p1').status).toBe('failed');
    expect(ligne('p1').metadata).not.toHaveProperty('zernioPostId');
    expect(ligne('p1').metadata).not.toHaveProperty('zernioForPostId');
    expect(ligne('p1').metadata.renderedVideoUrl).toBe('https://cdn.example/rendus/montage.mp4');
  });

  it('post.partial → état partiel explicite, résultats par réseau, preuve gardée', async () => {
    etat.base.scheduled_posts = [post('p1')];
    await lancerCron(false);
    await webhook(evenementPost('post.partial', [
      { platform: 'instagram', status: 'published' },
      { platform: 'tiktok', status: 'failed', error: 'x' },
    ]));
    expect(ligne('p1').status).toBe('failed');
    expect(ligne('p1').metadata).toMatchObject({
      zernioPostId: 'zernio-post-1', zernioForPostId: 'p1', zernioPartiel: true,
      zernioResultatsReseaux: [{ platform: 'instagram', success: true }, { platform: 'tiktok', success: false, error: 'x' }],
    });
    expect(ligne('p1').metadata.error).toMatch(/partiellement.*tiktok/);
    reprogrammer('p1');
    await lancerCron(false);
    expect(ligne('p1').status).toBe('failed');
  });

  it('sans studiioPostId → aucune écriture, 200', async () => {
    etat.base.scheduled_posts = [post('p1', { status: 'publishing' })];
    const res = await webhook(evenementPost('post.published', [], {}));
    expect(res.status).toBe(200);
    expect(ligne('p1').status).toBe('publishing');
    expect(etat.ecritures).toHaveLength(0);
  });

  it('événement inconnu → 200, aucune écriture', async () => {
    etat.base.scheduled_posts = [post('p1', { status: 'publishing' })];
    const res = await webhook(evenementPost('post.recycled', []));
    expect(res.status).toBe(200);
    expect(etat.ecritures).toHaveLength(0);
    expect(espion.upserts).toHaveLength(0);
  });
});

describe('Événement périmé ou rejoué — il ne vise pas le post Zernio courant', () => {
  const ancien = (event: string) => ({ ...evenementPost(event, [{ platform: 'instagram', status: 'failed' }]),
    post: { ...evenementPost(event, []).post, id: 'zernio-post-ANCIEN' } });

  it('post.failed d un ANCIEN post Zernio (rejoué) → ignoré : la preuve courante est gardée, pas de republication', async () => {
    etat.base.scheduled_posts = [post('p1')];
    await lancerCron(false);
    expect(ligne('p1').metadata.zernioPostId).toBe('zernio-post-1');
    await webhook(ancien('post.failed'));
    expect(ligne('p1').status).toBe('publishing');
    expect(ligne('p1').metadata.zernioPostId).toBe('zernio-post-1');
    reprogrammer('p1');
    await lancerCron(false);
    expect(zernio.createPost).toHaveBeenCalledTimes(1);
  });

  it('post.published / post.partial d un ANCIEN post Zernio → ignorés', async () => {
    etat.base.scheduled_posts = [post('p1')];
    await lancerCron(false);
    await webhook(ancien('post.published'));
    expect(ligne('p1').status).toBe('publishing');
    await webhook(ancien('post.partial'));
    expect(ligne('p1').status).toBe('publishing');
    expect(ligne('p1').metadata).not.toHaveProperty('zernioPartiel');
  });

  it('événement sans identifiant de post Zernio (ancienne forme) → appliqué comme avant', async () => {
    etat.base.scheduled_posts = [post('p1')];
    await lancerCron(false);
    await webhook({ event: 'post.published', data: { metadata: { studiioPostId: 'p1' } } });
    expect(ligne('p1').status).toBe('published');
  });
});

describe('Événements post — ancienne enveloppe `data` toujours acceptée', () => {
  it('post.published au format `data` → published', async () => {
    etat.base.scheduled_posts = [post('p1')];
    await lancerCron(false);
    await webhook({ event: 'post.published', data: { _id: 'zernio-post-1', metadata: { studiioPostId: 'p1' } } });
    expect(ligne('p1').status).toBe('published');
  });
});

describe('Événements compte — enveloppe documentée `account`', () => {
  const compte = { accountId: 'acc-ig', profileId: 'prof-1', platform: 'instagram', username: 'moi', displayName: 'Moi' };

  it('account.connected → compte rattaché à l\'utilisateur du profil', async () => {
    etat.base.users = [{ id: 'user-1', zernio_profile_id: 'prof-1' }];
    await webhook({ id: 'evt-a', event: 'account.connected', account: compte, timestamp: new Date().toISOString() });
    expect(espion.upserts).toHaveLength(1);
    expect(espion.upserts[0]).toMatchObject({
      table: 'zernio_accounts',
      valeurs: { user_id: 'user-1', profile_id: 'prof-1', account_id: 'acc-ig', platform: 'instagram', username: 'moi', status: 'connected' },
    });
  });

  it('account.connected au format `data` → même effet (ancienne forme)', async () => {
    etat.base.users = [{ id: 'user-1', zernio_profile_id: 'prof-1' }];
    await webhook({ event: 'account.connected', data: compte });
    expect(espion.upserts[0]).toMatchObject({
      valeurs: { user_id: 'user-1', account_id: 'acc-ig', platform: 'instagram', username: 'moi', status: 'connected' },
    });
  });

  it('account.disconnected → statut disconnected', async () => {
    etat.base.zernio_accounts = [{ id: 'z1', account_id: 'acc-ig', status: 'connected' }];
    await webhook({
      id: 'evt-d', event: 'account.disconnected',
      account: { ...compte, disconnectionType: 'unintentional', reason: 'token expiré' },
      timestamp: new Date().toISOString(),
    });
    expect(etat.base.zernio_accounts[0].status).toBe('disconnected');
  });

  it('profil inconnu → aucun rattachement', async () => {
    await webhook({ id: 'evt-a', event: 'account.connected', account: compte, timestamp: new Date().toISOString() });
    expect(espion.upserts).toHaveLength(0);
  });
});

describe('Signature — inchangée', () => {
  const corps = JSON.stringify(evenementPost('post.published', []));

  it('sans secret configuré → 503, rien n\'est traité', async () => {
    delete process.env.ZERNIO_WEBHOOK_SECRET;
    etat.base.scheduled_posts = [post('p1', { status: 'publishing' })];
    const res = await posterBrut(corps, signer(corps));
    expect(res.status).toBe(503);
    expect(ligne('p1').status).toBe('publishing');
  });

  it('non signé ou signature invalide → 401', async () => {
    etat.base.scheduled_posts = [post('p1', { status: 'publishing' })];
    expect((await posterBrut(corps, null)).status).toBe(401);
    expect((await posterBrut(corps, 'deadbeef')).status).toBe(401);
    expect(ligne('p1').status).toBe('publishing');
  });

  it('signature vérifiée sur le corps BRUT, avant tout parsing', async () => {
    etat.base.scheduled_posts = [post('p1', { status: 'publishing' })];
    // Corps reformaté : même JSON, octets différents → refusé.
    const reformate = JSON.stringify(JSON.parse(corps), null, 2);
    expect((await posterBrut(reformate, signer(corps))).status).toBe(401);
    // JSON invalide mal signé → 401 (et non 400) : la signature passe d'abord.
    expect((await posterBrut('{pas du json', 'deadbeef')).status).toBe(401);
    // Corps à espaces atypiques, correctement signé → accepté.
    const espace = corps.replace('{', '{   ');
    expect((await posterBrut(espace, signer(espace))).status).toBe(200);
    expect(ligne('p1').status).toBe('published');
  });
});
