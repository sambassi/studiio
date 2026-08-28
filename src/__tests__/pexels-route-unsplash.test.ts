/**
 * `GET /api/pexels?source=unsplash` — le fournisseur, doublé.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * AUCUN APPEL RÉEL, AUCUNE VRAIE CLÉ
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `fetch` est remplacé : rien ne part vers `api.unsplash.com`. Les clés sont
 * des valeurs de test évidentes, posées AVANT l'import — la route les lit à
 * l'évaluation du module.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE QUE CES TESTS FERMENT
 * ─────────────────────────────────────────────────────────────────────────
 *
 * La route attrapait TOUTE erreur du fournisseur et répondait
 * `{ success: true, photos: [] }`. Une clé refusée, un quota épuisé et une
 * recherche infructueuse devenaient la même réponse — et l'écran accusait la
 * requête de l'utilisateur d'un échec qui n'était pas le sien.
 *
 * Le second défaut était plus discret : après un échec, la route relançait
 * une SECONDE page. Un 429 déclenchait donc deux appels au lieu d'un, ce qui
 * rapproche du blocage au lieu de l'éviter.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

const CLE_UNSPLASH_TEST = 'cle-unsplash-de-test-jamais-reelle';
const CLE_PEXELS_TEST = 'cle-pexels-de-test-jamais-reelle';
process.env.UNSPLASH_ACCESS_KEY = CLE_UNSPLASH_TEST;
process.env.PEXELS_API_KEY = CLE_PEXELS_TEST;

const authMock = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: () => authMock() }));

/** Ce que le « fournisseur » répond, et ce que la route lui a demandé. */
interface Reponse { statut: number; corps: unknown }
let reponseUnsplash: Reponse;
let reponsePexels: Reponse;
let appels: Array<{ url: string; entetes: Record<string, string> }>;

const vraiFetch = globalThis.fetch;
globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
  const u = String(url);
  appels.push({ url: u, entetes: (init?.headers ?? {}) as Record<string, string> });
  const r = u.includes('api.unsplash.com') ? reponseUnsplash : reponsePexels;
  return {
    ok: r.statut >= 200 && r.statut < 300,
    status: r.statut,
    json: async () => r.corps,
  } as Response;
}) as unknown as typeof fetch;
afterAll(() => { globalThis.fetch = vraiFetch; });

const { GET } = await import('@/app/api/pexels/route');

const PHOTO_UNSPLASH = {
  id: 'aaa',
  urls: {
    regular: 'https://images.unsplash.com/photo-aaa?w=1080',
    full: 'https://images.unsplash.com/photo-aaa',
    small: 'https://images.unsplash.com/photo-aaa?w=400',
    thumb: 'https://images.unsplash.com/photo-aaa?w=200',
  },
  user: { name: 'Ada' },
  alt_description: 'danse',
};

const lire = async (params = 'query=danse&source=unsplash&count=5') => {
  const res = await GET({ url: `https://studiio.pro/api/pexels?${params}` } as never);
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  appels = [];
  reponseUnsplash = { statut: 200, corps: { results: [PHOTO_UNSPLASH] } };
  reponsePexels = { statut: 200, corps: { photos: [] } };
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: 'moi' } });
});

// ────────────────────────────────────────────────────────────────────────────

describe('Session', () => {
  it('sans session → 401, et le fournisseur n est pas appelé', async () => {
    authMock.mockResolvedValue(null);
    const r = await lire();
    expect(r.status).toBe(401);
    expect(appels).toEqual([]);
  });
});

describe('1. Une réponse Unsplash valide devient des photos normalisées', () => {
  it('la route appelle bien Unsplash, et rend ses photos', async () => {
    const r = await lire();
    expect(r.status).toBe(200);
    expect(appels[0].url).toContain('api.unsplash.com/search/photos');
    expect(r.body.success).toBe(true);
    expect(r.body.photos).toHaveLength(1);
  });

  it('les URL rendues sont celles d Unsplash, en https', async () => {
    const r = await lire();
    const p = r.body.photos[0];
    expect(p.id).toBe('unsplash-aaa');
    expect(p.source).toBe('unsplash');
    expect(p.url).toBe(PHOTO_UNSPLASH.urls.regular);
    expect(p.medium).toBe(PHOTO_UNSPLASH.urls.small);
    expect(p.small).toBe(PHOTO_UNSPLASH.urls.thumb);
    for (const u of [p.url, p.medium, p.small]) {
      expect(String(u).startsWith('https://')).toBe(true);
    }
  });

  it('2. la requête part avec la recherche encodée', async () => {
    await lire(`query=${encodeURIComponent('danse africaine & énergie')}&source=unsplash`);
    // La route traduit le français ; ce qui compte est que la valeur soit
    // encodée et qu'aucune esperluette brute ne coupe la query string.
    const envoyee = new URL(appels[0].url).searchParams.get('query');
    expect(typeof envoyee).toBe('string');
    expect(appels[0].url).not.toMatch(/query=[^&]*\s/);
  });
});

describe('6. Les refus du fournisseur sont distingués', () => {
  ([[401, 'auth'], [403, 'auth'], [429, 'quota'], [500, 'indisponible'], [404, 'indisponible']] as const)
    .forEach(([statut, motif]) => {
      it(`un ${statut} devient « ${motif} », pas une liste vide muette`, async () => {
        reponseUnsplash = { statut, corps: { errors: ['nope'] } };
        const r = await lire();
        expect(r.status).toBe(200);
        expect(r.body.photos).toEqual([]);
        expect(r.body.echec).toBe(motif);
      });
    });

  it('une recherche VRAIMENT vide n a pas de motif d échec', async () => {
    reponseUnsplash = { statut: 200, corps: { results: [] } };
    const r = await lire();
    expect(r.body.photos).toEqual([]);
    expect(r.body.echec).toBeUndefined();
  });

  it('un refus ne déclenche PAS de seconde page', async () => {
    // La relance « trop peu de résultats » doublait les appels après un 429.
    reponseUnsplash = { statut: 429, corps: {} };
    await lire();
    expect(appels).toHaveLength(1);
  });

  it('une recherche pauvre, elle, tente bien la page suivante', async () => {
    reponseUnsplash = { statut: 200, corps: { results: [PHOTO_UNSPLASH] } };
    await lire();
    expect(appels.length).toBe(2);
    expect(new URL(appels[1].url).searchParams.get('page')).toBe('2');
  });
});

describe('7. Rien de la clé ne sort', () => {
  it('la clé part au fournisseur, jamais dans la réponse', async () => {
    reponseUnsplash = { statut: 200, corps: { results: [PHOTO_UNSPLASH] } };
    const r = await lire();
    // Elle est bien utilisée pour authentifier l'appel sortant…
    expect(String(appels[0].entetes.Authorization)).toContain(CLE_UNSPLASH_TEST);
    // …et absente de tout ce qui revient au navigateur.
    const texte = JSON.stringify(r.body);
    expect(texte).not.toContain(CLE_UNSPLASH_TEST);
    expect(texte).not.toContain(CLE_PEXELS_TEST);
    expect(texte).not.toMatch(/Client-ID|Authorization/i);
  });

  it('même quand le fournisseur refuse et renvoie n importe quoi', async () => {
    reponseUnsplash = {
      statut: 401,
      corps: { errors: [`Invalid Client-ID ${CLE_UNSPLASH_TEST}`] },
    };
    const r = await lire();
    const texte = JSON.stringify(r.body);
    expect(texte).not.toContain(CLE_UNSPLASH_TEST);
    // Le corps du fournisseur n'est jamais relayé : il peut contenir
    // l'écho de la clé qu'on vient de lui envoyer.
    expect(texte).not.toContain('Invalid Client-ID');
    expect(r.body.echec).toBe('auth');
  });
});

describe('8. Seules des URL https sortent', () => {
  it('la route ne fabrique jamais d URL en clair', async () => {
    const r = await lire();
    const texte = JSON.stringify(r.body);
    expect(texte).not.toContain('http://');
  });

  it('elle interroge Unsplash en https', async () => {
    await lire();
    expect(appels[0].url.startsWith('https://api.unsplash.com/')).toBe(true);
  });
});

describe('La source demandée est respectée', () => {
  it('source=unsplash n appelle pas Pexels', async () => {
    await lire('query=danse&source=unsplash');
    expect(appels.every((a) => a.url.includes('api.unsplash.com'))).toBe(true);
  });

  it('source=pexels n appelle pas Unsplash', async () => {
    reponsePexels = { statut: 200, corps: { photos: [] } };
    await lire('query=danse&source=pexels');
    expect(appels.every((a) => a.url.includes('api.pexels.com'))).toBe(true);
  });

  it('« both » n échoue que si les DEUX tombent', async () => {
    reponseUnsplash = { statut: 429, corps: {} };
    reponsePexels = {
      statut: 200,
      corps: { photos: [{ id: 1, src: { large: 'https://images.pexels.com/a.jpg' }, photographer: 'X' }] },
    };
    const r = await lire('query=danse&source=both');
    expect(r.body.photos.length).toBeGreaterThan(0);
    expect(r.body.echec).toBeUndefined();
  });

  it('« both » avec les deux tombées rend un motif', async () => {
    reponseUnsplash = { statut: 429, corps: {} };
    reponsePexels = { statut: 429, corps: {} };
    const r = await lire('query=danse&source=both');
    expect(r.body.photos).toEqual([]);
    expect(r.body.echec).toBe('quota');
  });
});
