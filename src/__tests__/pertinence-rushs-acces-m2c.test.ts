// @vitest-environment node
/**
 * M2-c — ACCÈS ENTRE UTILISATEURS : les seules lectures du panneau (les GET
 * `/api/creer/fiches-contenu` et `…/approfondir`) ne rendent JAMAIS la fiche
 * d'un autre compte. MinIO doublé en mémoire ; aucun réseau.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleFicheContenu } from '@/lib/creer/fiche-contenu-serveur';
import { ficheContenuRush } from '@/lib/creer/fiche-contenu';
import { fusionnerFicheV2 } from '@/lib/creer/fiche-contenu-v2';

const authMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

const OBJETS = vi.hoisted(() => new Map<string, Buffer>());
vi.mock('@/lib/storage/minio-client', () => ({
  clientMinio: () => ({
    statObject: async (b: string, c: string) => {
      const o = OBJETS.get(`${b}/${c}`);
      if (!o) throw Object.assign(new Error('Not Found'), { code: 'NotFound' });
      return { size: o.length };
    },
    putObject: async (b: string, c: string, corps: Buffer) => { OBJETS.set(`${b}/${c}`, Buffer.from(corps)); },
  }),
  lecteurMinio: () => ({
    getObject: async (b: string, c: string) => {
      const o = OBJETS.get(`${b}/${c}`);
      if (!o) throw Object.assign(new Error('Not Found'), { code: 'NoSuchKey' });
      const { Readable } = await import('stream');
      return Readable.from([o]);
    },
  }),
  signeurInterne: () => ({ presignedGetObject: async (b: string, c: string) => `http://studiio-minio:9000/${b}/${c}` }),
}));

const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const PUB = 'https://studiio.pro/storage/v1/object/public';
const RUSH_B = `${PUB}/media/${B}/library/converted_1792081208949.mp4`;
const CLE_B = `${B}/library/converted_1792081208949.mp4`;
const V2_B = fusionnerFicheV2({
  v1: ficheContenuRush({ nomFichier: 'converted_1792081208949.mp4' }),
  vision: { objets: [], lieu: null, action: null, personnes: null, categories: [{ id: 'dance', confiance: 'moyenne' }] },
  parole: null, langue: 'fr', paroleEcoutee: false, etapes: { vision: { etat: 'faite' }, transcription: { etat: 'a_faire' } }, usage: { tarifs: 't' },
});
const V1_B = { ...ficheContenuRush({ metadonnees: ['Cours de danse'] }) };
const get = (chemin: string) => new Request(`https://studiio.pro${chemin}`, { method: 'GET' }) as never;

let fetchEspion: ReturnType<typeof vi.fn>;
beforeEach(() => {
  OBJETS.clear();
  OBJETS.set(`media/${CLE_B}`, Buffer.alloc(5000));
  OBJETS.set(`media/${cleFicheContenu(B, 'media', CLE_B, 5000, 1)}`, Buffer.from(JSON.stringify(V1_B)));
  OBJETS.set(`media/${cleFicheContenu(B, 'media', CLE_B, 5000, 2)}`, Buffer.from(JSON.stringify(V2_B)));
  authMock.mockReset();
  fetchEspion = vi.fn(async () => { throw new Error('fetch interdit'); });
  vi.stubGlobal('fetch', fetchEspion);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('M2-c — A ne lit jamais les fiches de B', () => {
  it('GET v1 et GET v2 au nom de A sur le rush de B : `fiche: null`, rien écrit sous A', async () => {
    const v1 = await import('@/app/api/creer/fiches-contenu/route');
    const v2 = await import('@/app/api/creer/fiches-contenu/approfondir/route');
    authMock.mockResolvedValue({ user: { id: A, email: 'a@example.com' } });
    const r1 = await (await v1.GET(get(`/api/creer/fiches-contenu?url=${encodeURIComponent(RUSH_B)}`))).json();
    expect(r1).toEqual({ success: true, fiches: [{ url: RUSH_B, fiche: null, depuisCache: false }] });
    const r2 = await (await v2.GET(get(`/api/creer/fiches-contenu/approfondir?url=${encodeURIComponent(RUSH_B)}`))).json();
    expect(r2).toEqual({ success: true, fiche: null });
    expect([...OBJETS.keys()].some((k) => k.includes(`fiches-contenu/${A}`))).toBe(false);
    expect(fetchEspion).not.toHaveBeenCalled();
  });

  it('témoin : au nom de B, les deux fiches de B sont bien lues (la garde ne masque pas tout)', async () => {
    const v1 = await import('@/app/api/creer/fiches-contenu/route');
    const v2 = await import('@/app/api/creer/fiches-contenu/approfondir/route');
    authMock.mockResolvedValue({ user: { id: B, email: 'b@example.com' } });
    const r1 = await (await v1.GET(get(`/api/creer/fiches-contenu?url=${encodeURIComponent(RUSH_B)}`))).json();
    expect(r1.fiches[0].fiche).toEqual(V1_B);
    const r2 = await (await v2.GET(get(`/api/creer/fiches-contenu/approfondir?url=${encodeURIComponent(RUSH_B)}`))).json();
    expect(r2.fiche).toEqual(V2_B);
  });

  it('sans session : 401 sur les deux GET', async () => {
    const v1 = await import('@/app/api/creer/fiches-contenu/route');
    const v2 = await import('@/app/api/creer/fiches-contenu/approfondir/route');
    authMock.mockResolvedValue(null);
    expect((await v1.GET(get(`/api/creer/fiches-contenu?url=${encodeURIComponent(RUSH_B)}`))).status).toBe(401);
    expect((await v2.GET(get(`/api/creer/fiches-contenu/approfondir?url=${encodeURIComponent(RUSH_B)}`))).status).toBe(401);
  });
});
