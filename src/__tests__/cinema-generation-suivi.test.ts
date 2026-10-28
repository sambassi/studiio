/**
 * CINEMA IA — suivi durable des generations : reservation atomique, statut reel,
 * interruption, et remboursement IDEMPOTENT de ce qu'une interruption a laisse pris.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { preparerFilm } from '@/lib/cinema/atelier';
import { depotFilmsMemoire, modifierFilm } from '@/lib/cinema/stockage/depot-films';
import {
  reserverGeneration, generationActive, generationsDuFilm, statutEffectif, aRembourser,
  DELAI_GENERATION_PERIMEE_MS, HISTORIQUE_GENERATIONS_MAX,
} from '@/lib/cinema/generation/suivi';
import type { GenerationSuivie } from '@/lib/cinema/types';

const rembourser = vi.fn();
vi.mock('@/lib/auth/config', () => ({ auth: async () => null }));
vi.mock('@/lib/cinema/generation/credits', async (orig) => ({
  ...(await orig<typeof import('@/lib/cinema/generation/credits')>()),
  rembourserCredits: (...a: unknown[]) => rembourser(...a),
}));

const U = '11111111-1111-4111-8111-111111111111';
const HISTOIRE = 'Nina entre dans la salle. Marco la regarde. Le jour se leve.';

async function filmEnDepot() {
  const depot = depotFilmsMemoire();
  const film = { ...preparerFilm({ histoire: HISTOIRE, personnages: [{ nom: 'Nina', description: 'veste rouge' }], idFilm: 'film-suivi-1', titre: 't' }), proprietaire: U };
  await depot.creer(film, U);
  return { depot, film, planId: film.scenes[0].plans[0].id };
}

beforeEach(() => { rembourser.mockReset(); });

describe('reservation d’une generation — UNE seule active par film', () => {
  it('8 reservations simultanees : exactement une reussit, les 7 autres recoivent LA meme generation en cours', async () => {
    const { depot, film, planId } = await filmEnDepot();
    let n = 0;
    const issues = await Promise.all(Array.from({ length: 8 }, () =>
      reserverGeneration(depot, film.id, U, { planId, operation: 'video', mode: 'reelle' }, { nouvelId: () => `g-${++n}` })));
    const ok = issues.filter((i) => i.ok);
    expect(ok).toHaveLength(1);
    const gagnante = (ok[0] as { generation: GenerationSuivie }).generation;
    for (const i of issues.filter((x) => !x.ok)) expect(i).toMatchObject({ ok: false, raison: 'en_cours', generation: { id: gagnante.id } });
    const relu = (await depot.lire(film.id, U))!.film;
    expect(relu.generations).toHaveLength(1);
    expect(generationActive(relu)?.id).toBe(gagnante.id);
  });

  it('un film inconnu ou d’un autre compte : `absent`, rien n’est ecrit', async () => {
    const { depot, planId } = await filmEnDepot();
    expect(await reserverGeneration(depot, 'film-inexistant', U, { planId, operation: 'image', mode: 'simulee' })).toEqual({ ok: false, raison: 'absent' });
    expect(await reserverGeneration(depot, 'film-suivi-1', '22222222-2222-4222-8222-222222222222', { planId, operation: 'image', mode: 'simulee' })).toEqual({ ok: false, raison: 'absent' });
  });

  it('une fois terminee, une nouvelle generation peut etre reservee ; l’historique est borne', async () => {
    const { depot, film, planId } = await filmEnDepot();
    for (let i = 0; i < HISTORIQUE_GENERATIONS_MAX + 5; i++) {
      const r = await reserverGeneration(depot, film.id, U, { planId, operation: 'image', mode: 'simulee' });
      expect(r.ok).toBe(true);
      const id = (r as { generation: GenerationSuivie }).generation.id;
      await modifierFilm(depot, film.id, U, (f) => ({ ...f, generations: f.generations!.map((g) => g.id === id ? { ...g, statut: 'reussie' as const } : g) }));
    }
    expect((await depot.lire(film.id, U))!.film.generations).toHaveLength(HISTORIQUE_GENERATIONS_MAX);
  });
});

describe('statut REEL — jamais « en cours » pour toujours', () => {
  const g = (creeLe: string): GenerationSuivie => ({ id: 'g', planId: 'p', operation: 'video', mode: 'reelle', statut: 'en_cours', creeLe, majLe: creeLe });
  it('au-dela du delai, une generation sans executeur est lue `interrompue`', () => {
    const t = Date.parse('2026-10-27T10:00:00Z');
    expect(statutEffectif(g('2026-10-27T10:00:00Z'), t + 60_000)).toBe('en_cours');
    expect(statutEffectif(g('2026-10-27T10:00:00Z'), t + DELAI_GENERATION_PERIMEE_MS + 1)).toBe('interrompue');
    const lu = generationsDuFilm({ generations: [g('2026-10-27T10:00:00Z')] }, t + DELAI_GENERATION_PERIMEE_MS + 1);
    expect(lu[0]).toMatchObject({ statut: 'interrompue' });
    expect(lu[0].erreur).toMatch(/interrompue/);
  });

  it('le delai couvre l’appel le plus long autorise (video : 10 min)', () => {
    expect(DELAI_GENERATION_PERIMEE_MS).toBeGreaterThan(10 * 60_000);
  });
});

describe('remboursement apres interruption — idempotent, et seulement si des credits ont ete pris', () => {
  const vieux = new Date(Date.now() - DELAI_GENERATION_PERIMEE_MS - 60_000).toISOString();
  const base: GenerationSuivie = { id: 'g1', planId: 'p', operation: 'video', mode: 'reelle', statut: 'en_cours', creeLe: vieux, majLe: vieux };

  it('ne retient que les interrompues avec credits pris, reference connue et non encore rendus', () => {
    expect(aRembourser({ generations: [base] })).toHaveLength(0); // rien de pris
    expect(aRembourser({ generations: [{ ...base, creditsPris: 15 }] })).toHaveLength(0); // pas de reference
    expect(aRembourser({ generations: [{ ...base, creditsPris: 15, referenceCredits: 'cinema-generation:x' }] })).toHaveLength(1);
    expect(aRembourser({ generations: [{ ...base, creditsPris: 15, referenceCredits: 'cinema-generation:x', creditsRembourses: true }] })).toHaveLength(0);
    expect(aRembourser({ generations: [{ ...base, creeLe: new Date().toISOString(), creditsPris: 15, referenceCredits: 'r' }] })).toHaveLength(0); // encore vivante
  });

  it('solder deux fois ne rembourse qu’une fois (la seconde lecture voit `creditsRembourses`)', async () => {
    const { solderGenerationsInterrompues } = await import('@/lib/cinema/generation/executeur-generation');
    const { depot, film } = await filmEnDepot();
    await modifierFilm(depot, film.id, U, (f) => ({ ...f, generations: [{ ...base, creditsPris: 15, referenceCredits: 'cinema-generation:abc' }] }));
    rembourser.mockResolvedValue({ ok: true });
    for (let i = 0; i < 2; i++) {
      const lu = (await depot.lire(film.id, U))!.film;
      await solderGenerationsInterrompues({ films: depot }, film.id, U, lu);
    }
    expect(rembourser).toHaveBeenCalledTimes(1);
    expect(rembourser.mock.calls[0]).toEqual([U, { cout: 15, reference: 'cinema-generation:abc' }, 'video']);
    const g = (await depot.lire(film.id, U))!.film.generations![0];
    expect(g).toMatchObject({ statut: 'interrompue', creditsRembourses: true });
  });

  it('un remboursement refuse reste a refaire : la generation n’est PAS marquee rendue', async () => {
    const { solderGenerationsInterrompues } = await import('@/lib/cinema/generation/executeur-generation');
    const { depot, film } = await filmEnDepot();
    await modifierFilm(depot, film.id, U, (f) => ({ ...f, generations: [{ ...base, creditsPris: 15, referenceCredits: 'cinema-generation:def' }] }));
    rembourser.mockResolvedValue({ ok: false, motif: 'refuse' });
    await solderGenerationsInterrompues({ films: depot }, film.id, U, (await depot.lire(film.id, U))!.film);
    expect((await depot.lire(film.id, U))!.film.generations![0].creditsRembourses).toBe(false);
    expect(aRembourser((await depot.lire(film.id, U))!.film)).toHaveLength(1);
  });
});
