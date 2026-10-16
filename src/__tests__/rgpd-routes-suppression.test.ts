import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signerPourTest } from '@/lib/rgpd/meta-signed-request';
import { A, B, dependances } from './helpers/rgpd-faux';

/**
 * Routes de suppression — callback Meta signée, page de statut réelle,
 * suppression par l'utilisateur authentifié (pour soi seul), route admin.
 * Base, stockage et registre sont SIMULÉS ; aucun appel Meta, aucune donnée réelle.
 */

const SECRET = 'secret-meta-de-test-pas-un-vrai';
let jeu = dependances();
const authMock = vi.fn();
const requireAdminMock = vi.fn();

vi.mock('@/lib/rgpd/adaptateurs', () => ({ dependancesReelles: () => jeu.deps }));
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/admin', () => ({
  isAdmin: (e: string | null | undefined) => e === 'admin@studiio.test',
  requireAdmin: () => requireAdminMock(),
  logAdminAction: async () => undefined,
}));
vi.mock('@/lib/db/supabase', () => ({ supabaseAdmin: { from: () => { throw new Error('base réelle interdite'); } } }));

const dataDeletion = await import('@/app/api/data-deletion/route');
const suppressionUtilisateur = await import('@/app/api/user/suppression/route');
const adminUser = await import('@/app/api/admin/users/[id]/route');

const signed = (userId: string, secret = SECRET) =>
  signerPourTest({ algorithm: 'HMAC-SHA256', issued_at: 1760000000, user_id: userId }, secret);

const postMeta = (corps: string, type = 'application/x-www-form-urlencoded') =>
  dataDeletion.POST(new Request('http://localhost/api/data-deletion', {
    method: 'POST', headers: { 'content-type': type }, body: corps,
  }) as never);

const getStatut = async (code: string) => {
  const { NextRequest } = await import('next/server');
  return dataDeletion.GET(new NextRequest(`http://localhost/api/data-deletion?code=${code}`));
};

beforeEach(() => {
  jeu = dependances();
  vi.stubEnv('FACEBOOK_CLIENT_SECRET', SECRET);
  vi.stubEnv('META_INSTAGRAM_APP_SECRET', '');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://studiio.pro');
  authMock.mockReset();
  requireAdminMock.mockReset();
});

describe('POST /api/data-deletion (callback Meta)', () => {
  it('signature valide (form-urlencoded) → demande créée et exécutée, { url, confirmation_code }', async () => {
    const res = await postMeta(`signed_request=${encodeURIComponent(signed('1000001'))}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.confirmation_code).toMatch(/^[0-9a-f]{32}$/);
    expect(body.url).toBe(`https://studiio.pro/api/data-deletion?code=${body.confirmation_code}`);
    const d = jeu.registre.demandes.get(body.confirmation_code)!;
    expect(d.portee).toBe('meta');
    expect(d.statut).toBe('terminee');
    // Seules les données Meta de A : les jetons Facebook/Instagram de A partent, rien d'autre.
    expect(jeu.base.tables.social_accounts.map((r) => r.id).sort()).toEqual(['sa-a-yt', 'sa-b-fb']);
    expect(jeu.base.tables.users.find((u) => u.id === A)!.email).toBe('a@exemple.test');
  });

  it('accepte aussi un corps JSON', async () => {
    const res = await postMeta(JSON.stringify({ signed_request: signed('1000002') }), 'application/json');
    expect(res.status).toBe(200);
    expect(jeu.base.tables.social_accounts.map((r) => r.id).sort()).toEqual(['sa-a-fb', 'sa-a-ig', 'sa-a-yt']);
  });

  it.each([
    ['mauvais secret', () => `signed_request=${encodeURIComponent(signed('1000001', 'autre-secret'))}`, 401],
    ['charge modifiée', () => {
      const [sig] = signed('1000001').split('.');
      const charge = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: '1000002' })).toString('base64url');
      return `signed_request=${sig}.${charge}`;
    }, 401],
    ['sans signature', () => `signed_request=${Buffer.from(JSON.stringify({ user_id: '1000001' })).toString('base64url')}`, 400],
    ['absent', () => 'autre=1', 400],
  ])('%s → refus, rien enregistré, rien supprimé', async (_nom, corps, statut) => {
    const avant = JSON.stringify(jeu.base.tables);
    const res = await postMeta(corps());
    expect(res.status).toBe(statut);
    expect(jeu.registre.demandes.size).toBe(0);
    expect(JSON.stringify(jeu.base.tables)).toBe(avant);
  });

  it('algorithme autre que HMAC-SHA256 refusé même bien signé', async () => {
    const r = signerPourTest({ algorithm: 'none', user_id: '1000001' }, SECRET);
    expect((await postMeta(`signed_request=${r}`)).status).toBe(400);
  });

  it('secret non configuré → 503, rien enregistré', async () => {
    vi.stubEnv('FACEBOOK_CLIENT_SECRET', '');
    vi.stubEnv('FACEBOOK_SECRET', '');
    expect((await postMeta(`signed_request=${signed('1000001')}`)).status).toBe(503);
    expect(jeu.registre.demandes.size).toBe(0);
  });

  it('identifiant non rattaché → url + code, et le statut dit `en_attente` (pas « completed »)', async () => {
    const body = await (await postMeta(`signed_request=${signed('424242')}`)).json();
    const st = await (await getStatut(body.confirmation_code)).json();
    expect(st.statut).toBe('en_attente');
    expect(JSON.stringify(st)).not.toMatch(/completed|424242/);
  });
});

describe('GET /api/data-deletion?code=', () => {
  it('reflète l’état RÉEL, sans donnée personnelle', async () => {
    jeu.stockage.panneApres = 0; // n'affecte pas la portée Meta
    const body = await (await postMeta(`signed_request=${signed('1000001')}`)).json();
    const res = await getStatut(body.confirmation_code);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const st = await res.json();
    expect(st.statut).toBe('terminee');
    expect(st.confirmation_code).toBe(body.confirmation_code);
    const s = JSON.stringify(st);
    expect(s).not.toContain(A);
    expect(s).not.toContain('1000001');
    expect(s).not.toContain('@');
  });

  it('statut partiel quand une étape a échoué', async () => {
    jeu.base.enPanne.add('social_accounts');
    const body = await (await postMeta(`signed_request=${signed('1000001')}`)).json();
    const st = await (await getStatut(body.confirmation_code)).json();
    expect(st.statut).toBe('partielle');
    expect(st.etapes.find((e: any) => e.etape === 'comptes_sociaux_meta').statut).toBe('echec');
  });

  it('code inconnu ou malformé → 404', async () => {
    expect((await getStatut('0'.repeat(31) + 'f')).status).toBe(404);
    expect((await getStatut('../../x')).status).toBe(404);
  });
});

describe('POST /api/user/suppression (soi-même uniquement)', () => {
  const appel = (corps: unknown) => suppressionUtilisateur.POST(new Request('http://localhost/api/user/suppression', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps),
  }) as never);

  it('sans session → 401, rien supprimé', async () => {
    authMock.mockResolvedValue(null);
    expect((await appel({ confirmation: 'SUPPRIMER' })).status).toBe(401);
    expect(jeu.registre.demandes.size).toBe(0);
  });

  it('sans phrase de confirmation → 400', async () => {
    authMock.mockResolvedValue({ user: { id: A, email: 'a@exemple.test' } });
    expect((await appel({})).status).toBe(400);
    expect(jeu.registre.demandes.size).toBe(0);
  });

  it('supprime le compte de la SESSION, jamais celui désigné dans le corps', async () => {
    authMock.mockResolvedValue({ user: { id: A, email: 'a@exemple.test' } });
    const res = await appel({ confirmation: 'SUPPRIMER', userId: B, user_id: B });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.statut).toBe('terminee');
    expect(jeu.base.tables.videos.filter((r) => r.user_id === A)).toEqual([]);
    expect(jeu.base.tables.videos.filter((r) => r.user_id === B).length).toBe(1);
    expect(jeu.base.tables.users.find((u) => u.id === B)!.email).toBe('b@exemple.test');
  });

  it('abonnement actif → 409, rien supprimé', async () => {
    authMock.mockResolvedValue({ user: { id: B, email: 'b@exemple.test' } });
    expect((await appel({ confirmation: 'SUPPRIMER' })).status).toBe(409);
    expect(jeu.base.tables.videos.filter((r) => r.user_id === B).length).toBe(1);
  });

  it('panne de stockage → 202 et statut `partielle` (jamais succès)', async () => {
    authMock.mockResolvedValue({ user: { id: A, email: 'a@exemple.test' } });
    jeu.stockage.panneApres = 0;
    const res = await appel({ confirmation: 'SUPPRIMER' });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.data.statut).toBe('partielle');
  });
});

describe('DELETE /api/admin/users/[id]', () => {
  const appel = (id: string) => adminUser.DELETE(new Request('http://localhost') as never, { params: { id } });

  it('non admin → refus de requireAdmin, rien supprimé', async () => {
    const { NextResponse } = await import('next/server');
    requireAdminMock.mockResolvedValue({ error: NextResponse.json({}, { status: 403 }), session: null });
    expect((await appel(A)).status).toBe(403);
    expect(jeu.registre.demandes.size).toBe(0);
  });

  it('identifiant invalide → 400', async () => {
    requireAdminMock.mockResolvedValue({ error: null, session: { user: { id: 'x', email: 'admin@studiio.test' } } });
    expect((await appel('../..')).status).toBe(400);
    expect(jeu.registre.demandes.size).toBe(0);
  });

  it('admin → suppression réelle de la cible seule', async () => {
    requireAdminMock.mockResolvedValue({ error: null, session: { user: { id: 'x', email: 'admin@studiio.test' } } });
    const res = await appel(A);
    expect(res.status).toBe(200);
    expect((await res.json()).data.statut).toBe('terminee');
    expect(jeu.base.tables.videos.filter((r) => r.user_id === A)).toEqual([]);
    expect(jeu.base.tables.videos.filter((r) => r.user_id === B).length).toBe(1);
  });
});
