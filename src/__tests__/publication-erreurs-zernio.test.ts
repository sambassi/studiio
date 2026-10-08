/**
 * Le vrai motif d'un refus Zernio arrive jusqu'au Calendrier.
 *
 * Production, 2026-10-08, post 7f4998ac : Zernio a répondu
 * `403 ACCOUNT_DISCONNECTED` (« Account … (instagram "afroboosteur") is
 * disconnected… token expired or was revoked ») ; Studiio n'affichait que
 * « Le réseau a refusé la publication. », et le compte restait « connecté ».
 *
 * Aucun appel réseau réel : `fetch` est doublé.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { traduireErreurZernio, sansParametresUrl } from '@/lib/social/erreursZernio';

const COMPTE_IG = '6ac791582c36053db83a68da';
const CORPS_403 = {
  error: `Account ${COMPTE_IG} (instagram "afroboosteur") is disconnected and cannot be posted to. The platform token expired or was revoked. Please reconnect the account. After reconnecting, refresh your account IDs from GET /v1/accounts.`,
  code: 'ACCOUNT_DISCONNECTED',
};
const CIBLES = [{ platform: 'instagram', accountId: COMPTE_IG }];

// ── Base en mémoire minimale ─────────────────────────────────────────────
type Ligne = Record<string, any>;
const base: Record<string, Ligne[]> = {};
vi.mock('@/lib/db/supabase', () => {
  const chaine = (table: string) => {
    const filtres: Array<(l: Ligne) => boolean> = [];
    let maj: Ligne | null = null;
    const exec = () => {
      const lignes = (base[table] ?? []).filter((l) => filtres.every((f) => f(l)));
      if (maj) for (const l of lignes) Object.assign(l, maj);
      return { data: lignes.map((l) => ({ ...l })), error: null };
    };
    const b: any = {
      select: () => b, update: (v: Ligne) => { maj = v; return b; },
      eq: (c: string, v: unknown) => { filtres.push((l) => l[c] === v); return b; },
      limit: () => b,
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(exec()).then(res, rej),
    };
    return b;
  };
  const client = { from: (t: string) => chaine(t) };
  return { supabaseAdmin: client, supabase: client };
});
vi.mock('@/lib/admin', () => ({ isAdmin: () => true }));

describe('traduction pure', () => {
  it('ACCOUNT_DISCONNECTED : nomme le réseau, demande la reconnexion, désigne le compte', () => {
    const t = traduireErreurZernio({ status: 403, code: CORPS_403.code, detail: CORPS_403.error }, CIBLES);
    expect(t.motif).toBe('Instagram doit être reconnecté : son autorisation a expiré ou a été révoquée. Reconnectez-le dans Réseaux sociaux.');
    expect(t.motif).not.toContain('Le réseau a refusé la publication');
    expect(t.details).toEqual([{ platform: 'Instagram', success: false, error: 'compte à reconnecter' }]);
    expect(t.technique).toMatchObject({ status: 403, code: 'ACCOUNT_DISCONNECTED' });
    expect(t.technique.message).toContain('token expired or was revoked');
    expect(t.compteDeconnecte).toBe(COMPTE_IG);
  });
  it('compte nommé HORS des cibles : jamais marqué déconnecté', () => {
    const t = traduireErreurZernio({ status: 403, code: 'ACCOUNT_DISCONNECTED', detail: CORPS_403.error }, [{ platform: 'tiktok', accountId: 'autre' }]);
    expect(t.compteDeconnecte).toBeNull();
  });
  it('refus inconnu : le message du réseau est montré, pas une phrase générique', () => {
    const t = traduireErreurZernio({ status: 400, code: 'VALIDATION', detail: 'TikTok: privacy_level is required' }, [{ platform: 'tiktok', accountId: 'a' }]);
    expect(t.motif).toBe('Refus du réseau : TikTok: privacy_level is required');
    expect(t.details[0]).toEqual({ platform: 'TikTok', success: false, error: 'TikTok: privacy_level is required' });
  });
  it('402 : facturation ; 429 : quota ; sans message : statut HTTP', () => {
    expect(traduireErreurZernio({ status: 402 }, CIBLES).motif).toContain('suspendu');
    expect(traduireErreurZernio({ status: 429 }, CIBLES).motif).toContain('réessayez plus tard');
    expect(traduireErreurZernio({ status: 500 }, CIBLES).motif).toContain('HTTP 500');
  });
  it('jamais de paramètres d’URL (signatures, jetons) dans le diagnostic', () => {
    expect(sansParametresUrl('fetch https://s3.example/x.mp4?X-Amz-Signature=abc&token=t failed')).toBe('fetch https://s3.example/x.mp4 failed');
  });
});

describe('client Zernio : le corps d’erreur est lu (code + message)', () => {
  beforeEach(() => { process.env.ZERNIO_API_KEY = 'cle-de-test'; });
  afterEach(() => { vi.unstubAllGlobals(); });
  it('403 ACCOUNT_DISCONNECTED → ZernioError.code / .detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(CORPS_403), { status: 403 })));
    const { createPost, ZernioError } = await import('@/lib/social/zernio');
    const err = await createPost({ content: 'x', platforms: CIBLES, mediaUrl: 'https://z/x.mp4', publishNow: true } as never).catch((e) => e);
    expect(err).toBeInstanceOf(ZernioError);
    expect(err.status).toBe(403);
    expect(err.code).toBe('ACCOUNT_DISCONNECTED');
    expect(err.detail).toBe(CORPS_403.error);
  });
});

describe('publierViaZernio : le refus réel remonte, le compte passe « déconnecté »', () => {
  beforeEach(() => {
    process.env.ZERNIO_API_KEY = 'cle-de-test';
    base.scheduled_posts = [{ id: 'post-1', metadata: {} }];
    base.users = [{ id: 'user-1', email: 'admin@x', publishing_enabled: true, zernio_profile_id: 'p' }];
    base.zernio_accounts = [
      { user_id: 'user-1', account_id: COMPTE_IG, platform: 'instagram', username: 'afroboosteur', status: 'connected' },
      { user_id: 'user-1', account_id: 'tt', platform: 'tiktok', username: 't', status: 'connected' },
    ];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/media/presign')) return new Response(JSON.stringify({ uploadUrl: 'https://z/up', publicUrl: 'https://z/x.mp4' }), { status: 200 });
      if (String(url).includes('/posts')) return new Response(JSON.stringify(CORPS_403), { status: 403 });
      return new Response(new Uint8Array(10), { status: 200, headers: { 'content-type': 'video/mp4' } });
    }));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('motif lisible, détail par réseau, cause technique ; seul le compte nommé est marqué déconnecté', async () => {
    const { publierViaZernio } = await import('@/lib/social/publishViaZernio');
    const r = await publierViaZernio({ id: 'post-1', userId: 'user-1', caption: 'x', mediaUrl: 'https://cdn.example/m.mp4', platforms: ['Instagram'] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motif).toContain('Instagram doit être reconnecté');
    expect(r.details).toEqual([{ platform: 'Instagram', success: false, error: 'compte à reconnecter' }]);
    expect(r.technique?.code).toBe('ACCOUNT_DISCONNECTED');
    expect(base.zernio_accounts.find((c) => c.platform === 'instagram')?.status).toBe('disconnected');
    expect(base.zernio_accounts.find((c) => c.platform === 'tiktok')?.status).toBe('connected');
  });
});
