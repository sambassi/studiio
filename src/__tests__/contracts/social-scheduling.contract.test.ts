/**
 * CONTRAT — C-SCHEDULING + C-SOCIAL-TIMEZONE.
 *
 * (B) la bonne date, (C) la bonne heure, (D) le bon fuseau : un post
 * programmé à 18:30 Europe/Paris part à 18:30 heure de Paris — ni à 17:29,
 * ni à 18:29, jamais le lendemain — y compris les jours de changement d'heure,
 * et dans le fuseau de `metadata.timezone` quand il est fourni.
 *
 * L'horloge est fixée (vi.setSystemTime, Date seul) ; le cron tourne SANS
 * `force` : c'est son filtre « dû » qui est verrouillé.
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

beforeEach(() => {
  reinitialiser();
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** Lance un passage du cron à l'instant UTC donné ; rend vrai si le post est parti chez Zernio. */
async function publieA(instantUtc: string, p: Record<string, any>): Promise<boolean> {
  reinitialiser();
  vi.setSystemTime(new Date(instantUtc));
  etat.base.scheduled_posts = [post('p', p)];
  await lancerCron(false);
  return zernio.createPost.mock.calls.length === 1;
}

describe('C-SCHEDULING (B, C) — 18:30 Europe/Paris, heure d été (UTC+2)', () => {
  const p = { scheduled_date: '2026-10-14', scheduled_time: '18:30:00', metadata: { renderedVideoUrl: 'https://cdn.example/r.mp4' } };

  it('17:29 Paris (15:29Z) → pas publié', async () => {
    expect(await publieA('2026-10-14T15:29:00Z', p)).toBe(false);
    expect(ligne('p').status).toBe('scheduled');
  });
  it('18:29 Paris (16:29Z) → pas publié', async () => {
    expect(await publieA('2026-10-14T16:29:59Z', p)).toBe(false);
  });
  it('18:30 Paris (16:30Z) → publié, maintenant', async () => {
    expect(await publieA('2026-10-14T16:30:00Z', p)).toBe(true);
    expect(zernio.createPost.mock.calls[0][0].publishNow).toBe(true);
  });
  it('en retard (19:10 Paris) → publié au passage suivant', async () => {
    expect(await publieA('2026-10-14T17:10:00Z', p)).toBe(true);
  });
  it('à 18:30 UTC le jour J, l heure de Paris (20:30) est dépassée → déjà publié (pas d interprétation UTC)', async () => {
    expect(await publieA('2026-10-14T16:31:00Z', { ...p, scheduled_time: '18:30' })).toBe(true);
  });
});

describe('C-SCHEDULING (B) — jamais le lendemain, jamais la veille', () => {
  it('post du 15 à 18:30 : à 18:30 le 14 → pas publié', async () => {
    expect(await publieA('2026-10-14T16:30:00Z', { scheduled_date: '2026-10-15', scheduled_time: '18:30' })).toBe(false);
  });
  it('post du 15 à 00:15 Paris : 23:00 le 14 (Paris) → non ; 00:15 le 15 (22:15Z le 14) → oui', async () => {
    const p = { scheduled_date: '2026-10-15', scheduled_time: '00:15' };
    expect(await publieA('2026-10-14T21:00:00Z', p)).toBe(false);
    expect(await publieA('2026-10-14T22:15:00Z', p)).toBe(true);
  });
  it('post du 14 à 23:30 Paris : 23:29 Paris → non ; publié le 14 à 23:30 Paris (21:30Z), pas le lendemain', async () => {
    const p = { scheduled_date: '2026-10-14', scheduled_time: '23:30' };
    expect(await publieA('2026-10-14T21:29:00Z', p)).toBe(false);
    expect(await publieA('2026-10-14T21:30:00Z', p)).toBe(true);
  });
});

describe('C-SOCIAL-TIMEZONE (D) — changements d heure Europe/Paris', () => {
  it('printemps 29/03/2026 (passage UTC+1 → UTC+2) : 10:00 Paris = 08:00Z', async () => {
    const p = { scheduled_date: '2026-03-29', scheduled_time: '10:00' };
    expect(await publieA('2026-03-29T07:59:00Z', p)).toBe(false);
    expect(await publieA('2026-03-29T08:00:00Z', p)).toBe(true);
  });
  it('automne 25/10/2026 (passage UTC+2 → UTC+1) : 10:00 Paris = 09:00Z', async () => {
    const p = { scheduled_date: '2026-10-25', scheduled_time: '10:00' };
    expect(await publieA('2026-10-25T08:59:00Z', p)).toBe(false);
    expect(await publieA('2026-10-25T09:00:00Z', p)).toBe(true);
  });
  it('veille du passage d hiver : 24/10 18:30 Paris = 16:30Z (encore UTC+2)', async () => {
    const p = { scheduled_date: '2026-10-24', scheduled_time: '18:30' };
    expect(await publieA('2026-10-24T16:29:00Z', p)).toBe(false);
    expect(await publieA('2026-10-24T16:30:00Z', p)).toBe(true);
  });
});

describe('C-SOCIAL-TIMEZONE (D) — fuseau du post (metadata.timezone)', () => {
  const p = {
    scheduled_date: '2026-10-14', scheduled_time: '09:00',
    metadata: { timezone: 'America/New_York', renderedVideoUrl: 'https://cdn.example/r.mp4' },
  };
  it('09:00 New York = 13:00Z : à 09:00 Paris (07:00Z) → pas publié', async () => {
    expect(await publieA('2026-10-14T07:00:00Z', p)).toBe(false);
  });
  it('08:59 New York → non ; 09:00 New York → oui', async () => {
    expect(await publieA('2026-10-14T12:59:00Z', p)).toBe(false);
    expect(await publieA('2026-10-14T13:00:00Z', p)).toBe(true);
  });
  it('fuseau absent → Europe/Paris par défaut', async () => {
    const sansFuseau = { scheduled_date: '2026-10-14', scheduled_time: '09:00', metadata: { renderedVideoUrl: 'https://cdn.example/r.mp4' } };
    expect(await publieA('2026-10-14T06:59:00Z', sansFuseau)).toBe(false);
    expect(await publieA('2026-10-14T07:00:00Z', sansFuseau)).toBe(true);
  });
  it('fuseau invalide → repli Europe/Paris, jamais une publication immédiate', async () => {
    const invalide = { scheduled_date: '2026-10-14', scheduled_time: '09:00', metadata: { timezone: 'Mars/Olympus', renderedVideoUrl: 'https://cdn.example/r.mp4' } };
    expect(await publieA('2026-10-14T06:59:00Z', invalide)).toBe(false);
    expect(await publieA('2026-10-14T07:00:00Z', invalide)).toBe(true);
  });
});

describe('C-SCHEDULING — statut', () => {
  it('un brouillon dû n est jamais publié, même en retard', async () => {
    reinitialiser();
    vi.setSystemTime(new Date('2026-10-14T20:00:00Z'));
    etat.base.scheduled_posts = [post('p', { status: 'draft', scheduled_date: '2026-10-14', scheduled_time: '18:30' })];
    await lancerCron(false);
    await lancerCron(true);
    expect(zernio.createPost).not.toHaveBeenCalled();
    expect(ligne('p').status).toBe('draft');
  });
});
