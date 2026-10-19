import { describe, it, expect, vi, beforeEach } from 'vitest';
import { A, B, dependances } from './helpers/rgpd-faux';

/**
 * Garde-fous avant mise en production : un administrateur ne peut supprimer
 * ni son propre compte, ni l'autre compte administrateur — ni par
 * POST /api/user/suppression, ni par DELETE /api/admin/users/[id].
 * Refus AVANT toute écriture : aucune demande enregistrée, aucune écriture.
 * Base, stockage et registre SIMULÉS.
 */

let jeu = dependances();
const authMock = vi.fn();
const requireAdminMock = vi.fn();
const ADMINS = ['admin@studiio.test', 'admin2@studiio.test'];

vi.mock('@/lib/rgpd/adaptateurs', () => ({ dependancesReelles: () => jeu.deps }));
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));
vi.mock('@/lib/admin', () => ({
  isAdmin: (e: string | null | undefined) => ADMINS.includes((e ?? '').toLowerCase()),
  requireAdmin: () => requireAdminMock(),
  logAdminAction: async () => undefined,
}));
vi.mock('@/lib/db/supabase', () => ({ supabaseAdmin: { from: () => { throw new Error('base réelle interdite'); } } }));

const suppressionUtilisateur = await import('@/app/api/user/suppression/route');
const adminUser = await import('@/app/api/admin/users/[id]/route');

const PHRASE = 'SUPPRIMER DÉFINITIVEMENT';
const ecritures = () => jeu.base.appels.filter((a) => a.op !== 'select');
const rienEcrit = () => {
  expect(jeu.registre.demandes.size).toBe(0);
  expect(ecritures()).toEqual([]);
  expect(jeu.stockage.appelsSupprimer).toBe(0);
  expect(jeu.base.tables.videos.filter((r) => r.user_id === A).length).toBe(1);
};

const postUtilisateur = (corps: unknown) => suppressionUtilisateur.POST(new Request('http://localhost/api/user/suppression', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corps),
}) as never);
const deleteAdmin = (id: string) => adminUser.DELETE(new Request('http://localhost', {
  method: 'DELETE', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ confirmation: PHRASE, userId: id }),
}) as never, { params: { id } });
const sessionAdmin = (id = B, email = 'admin@studiio.test') =>
  requireAdminMock.mockResolvedValue({ error: null, session: { user: { id, email } } });

beforeEach(() => {
  jeu = dependances();
  authMock.mockReset();
  requireAdminMock.mockReset();
});

describe('POST /api/user/suppression — compte administrateur', () => {
  it('admin connecté → 403 explicite, AUCUNE demande enregistrée', async () => {
    jeu.base.tables.users.find((u) => u.id === A)!.email = 'admin@studiio.test';
    authMock.mockResolvedValue({ user: { id: A, email: 'admin@studiio.test' } });
    const res = await postUtilisateur({ confirmation: 'SUPPRIMER' });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/administrateur protégé/);
    rienEcrit();
  });

  it('casse différente de l’adresse admin → toujours refusé', async () => {
    authMock.mockResolvedValue({ user: { id: A, email: 'Admin2@Studiio.TEST' } });
    expect((await postUtilisateur({ confirmation: 'SUPPRIMER' })).status).toBe(403);
    rienEcrit();
  });

  it('témoin : un utilisateur ordinaire peut toujours supprimer son compte', async () => {
    authMock.mockResolvedValue({ user: { id: A, email: 'a@exemple.test' } });
    expect((await postUtilisateur({ confirmation: 'SUPPRIMER' })).status).toBe(200);
  });
});

describe('DELETE /api/admin/users/[id] — compte administrateur', () => {
  it('l’admin vise SON propre compte → 403, rien enregistré ni supprimé', async () => {
    sessionAdmin(A, 'admin@studiio.test');
    const res = await deleteAdmin(A);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/own account/);
    rienEcrit();
  });

  it('l’admin vise l’AUTRE compte admin → 403, rien enregistré ni supprimé', async () => {
    jeu.base.tables.users.find((u) => u.id === A)!.email = 'admin2@studiio.test';
    sessionAdmin('99999999-9999-4999-8999-999999999999', 'admin@studiio.test');
    const res = await deleteAdmin(A);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/admin accounts are protected/);
    rienEcrit();
  });

  it('lecture de la cible en panne → la garde de la bibliothèque bloque (403), rien supprimé', async () => {
    jeu.base.tables.users.find((u) => u.id === A)!.email = 'admin2@studiio.test';
    sessionAdmin('99999999-9999-4999-8999-999999999999', 'admin@studiio.test');
    // Première lecture (garde de la route) en échec, la suivante (bibliothèque) réussit.
    const lire = jeu.deps.base.lire.bind(jeu.deps.base);
    let n = 0;
    jeu.deps.base.lire = async (...args: Parameters<typeof lire>) => (n++ === 0 ? { erreur: 'x', lignes: [] } : lire(...args));
    const res = await deleteAdmin(A);
    expect(res.status).toBe(403);
    expect(ecritures()).toEqual([]);
    expect(jeu.stockage.appelsSupprimer).toBe(0);
    expect(jeu.base.tables.videos.filter((r) => r.user_id === A).length).toBe(1);
  });

  it('témoin : un compte ordinaire reste supprimable par l’admin', async () => {
    sessionAdmin('99999999-9999-4999-8999-999999999999', 'admin@studiio.test');
    expect((await deleteAdmin(A)).status).toBe(200);
  });
});
