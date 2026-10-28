// @vitest-environment node
/**
 * CINEMA IA — routes : refus immediat d'une generation hors quota, et quota/devis du projet.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const e = vi.hoisted(() => ({
  regime: { type: 'credits' } as Record<string, unknown>,
  evaluation: { ok: true } as Record<string, unknown>,
  mode: 'reelle' as 'reelle' | 'simulee',
  lancer: vi.fn(),
  conso: null as unknown,
  depot: null as unknown,
}));

vi.mock('@/lib/auth/config', () => ({ auth: async () => null }));
vi.mock('@/lib/cinema/routes-aide', async (orig) => ({
  ...(await orig<typeof import('@/lib/cinema/routes-aide')>()),
  sessionCinema: async () => ({ userId: '11111111-1111-4111-8111-111111111111' }),
}));
vi.mock('@/lib/cinema/contexte', () => ({ contexteCinema: () => ({ films: e.depot, plafondUsd: 2 }) }));
vi.mock('@/lib/cinema/garde', async (orig) => {
  const { ID_REPLICATE_IMAGE, ID_REPLICATE_VIDEO } = await import('@/lib/cinema/generation/replicate');
  return {
    ...(await orig<typeof import('@/lib/cinema/garde')>()),
    fournisseurServeur: (op: string) => ({ id: op === 'video' ? ID_REPLICATE_VIDEO : ID_REPLICATE_IMAGE, mode: e.mode }),
  };
});
vi.mock('@/lib/cinema/generation/executeur-generation', () => ({
  lancerGeneration: (...a: unknown[]) => e.lancer(...a),
  solderGenerationsInterrompues: async () => {},
}));
vi.mock('@/lib/cinema/abonnement/regime', async (orig) => ({
  ...(await orig<typeof import('@/lib/cinema/abonnement/regime')>()),
  regimeCinema: async () => e.regime,
  evaluerQuota: async () => e.evaluation,
}));
vi.mock('@/lib/cinema/abonnement/depot', async (orig) => ({
  ...(await orig<typeof import('@/lib/cinema/abonnement/depot')>()),
  lireConsommation: async () => e.conso,
}));

const generation = await import('@/app/api/cinema/films/[id]/generation/route');
const quota = await import('@/app/api/cinema/films/[id]/quota/route');
const { preparerFilm } = await import('@/lib/cinema/atelier');
const { depotFilmsMemoire } = await import('@/lib/cinema/stockage/depot-films');

const U = '11111111-1111-4111-8111-111111111111';
const FORMULE = {
  planKey: 'pro', inclus: true, filmsParMois: 30, secondesParMois: 1800, dureeMaxFilmS: 360,
  qualites: ['standard'], fonctionnalites: ['image_ia'], budgetUsdParMois: 10, renouvellement: 'periode_abonnement',
};
let planId = '';

beforeEach(async () => {
  e.regime = { type: 'credits' }; e.evaluation = { ok: true }; e.mode = 'reelle'; e.lancer.mockReset().mockResolvedValue('reussie');
  e.conso = { films: 3, secondes: 240, usdEngages: 2, tentatives: 7, film: { compte: false, secondes: 0 } };
  const depot = depotFilmsMemoire();
  const film = { ...preparerFilm({ histoire: 'Nina entre. Marco la regarde.', personnages: [], idFilm: 'film-r', titre: 't' }), proprietaire: U };
  await depot.creer(film, U);
  planId = film.scenes[0].plans[0].id;
  e.depot = depot;
});

const poster = () => generation.POST(
  new NextRequest('https://studiio.pro/api/cinema/films/film-r/generation', { method: 'POST', body: JSON.stringify({ planId, operation: 'image' }) }),
  { params: { id: 'film-r' } },
);
const generationsEnBase = async () => ((await (e.depot as ReturnType<typeof depotFilmsMemoire>).lire('film-r', U))!.film.generations ?? []);

describe('POST generation : refus IMMEDIAT et clair hors quota', () => {
  it('quota depasse : 402 avec le message, RIEN n’est reserve ni lance', async () => {
    e.regime = { type: 'abonnement', planKey: 'pro', formule: FORMULE, periode: { debut: 'a', fin: 'b' } };
    e.evaluation = { ok: false, message: 'Vous avez utilise toutes les minutes incluses ce mois-ci.', resume: null };
    const res = await poster();
    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ ok: false, quota: true, erreur: expect.stringMatching(/minutes incluses/) });
    expect(e.lancer).not.toHaveBeenCalled();
    expect(await generationsEnBase()).toHaveLength(0);
  });

  it('abonnement illisible : 409, rien de lance', async () => {
    e.regime = { type: 'refus', message: 'Votre abonnement n’a pas pu etre verifie' };
    expect((await poster()).status).toBe(409);
    expect(e.lancer).not.toHaveBeenCalled();
  });

  it('regime credits (le defaut) : la route se comporte comme avant — 202 et lancement', async () => {
    const res = await poster();
    expect(res.status).toBe(202);
    expect(e.lancer).toHaveBeenCalledTimes(1);
  });

  it('dans le quota : 202 — la reservation atomique est faite par l’executeur, pas ici', async () => {
    e.regime = { type: 'abonnement', planKey: 'pro', formule: FORMULE, periode: { debut: 'a', fin: 'b' } };
    expect((await poster()).status).toBe(202);
    expect(e.lancer).toHaveBeenCalledTimes(1);
  });
});

describe('GET quota : ce que chacun voit', () => {
  const lire = async () => (await quota.GET(new Request('https://studiio.pro'), { params: { id: 'film-r' } })).json();

  it('credits, ou generation simulee : rien de nouveau', async () => {
    expect(await lire()).toEqual({ ok: true, regime: 'credits' });
    e.regime = { type: 'cout_reel' }; e.mode = 'simulee';
    expect(await lire()).toEqual({ ok: true, regime: 'credits' });
  });

  it('abonne : films et minutes utilises / inclus, duree du projet — aucun montant en dollars', async () => {
    e.regime = { type: 'abonnement', planKey: 'pro', formule: FORMULE, periode: { debut: '2026-11-03T08:00:00.000Z', fin: '2026-12-03T08:00:00.000Z' } };
    const q = await lire();
    expect(q).toMatchObject({
      regime: 'abonnement', filmsUtilises: 3, filmsInclus: 30, dureeUtilisee: '4 min', dureeIncluse: '30 min',
      disponible: true, supplement: null,
    });
    expect(q.dureeProjetS).toBeGreaterThan(0);
    expect(JSON.stringify(q)).not.toMatch(/usd|Usd/);
  });

  it('administrateur : le cout fournisseur estime en USD, aucun supplement', async () => {
    e.regime = { type: 'cout_reel' };
    const q = await lire();
    expect(q).toMatchObject({ regime: 'cout_reel', supplement: null });
    expect(q.devis.totalUsd).toBeGreaterThan(0);
  });

  it('periode non verifiable : indisponible, avec le message', async () => {
    e.regime = { type: 'abonnement', planKey: 'pro', formule: FORMULE, periode: null };
    expect(await lire()).toMatchObject({ regime: 'indisponible', message: expect.stringMatching(/periode/) });
  });
});
