/**
 * CINEMA IA — la page reste fluide avec BEAUCOUP de plans, et ne fait tourner
 * aucun minuteur tant que rien n'est en cours.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import CinemaPage from '@/app/dashboard/cinema/page';
import { preparerFilm } from '@/lib/cinema/atelier';
import { monterFilm } from '@/lib/cinema/montage';
import { presenterMontage } from '@/lib/cinema/stockage/presentation';
import { devisFilm } from '@/lib/cinema/couts';

const PHRASES = Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? `Nina avance vers la porte ${i}.` : i % 3 === 1 ? `Marco la regarde sans bouger ${i}.` : `Le silence tombe sur la salle ${i}.`));
const film = { ...preparerFilm({ histoire: PHRASES.join(' '), nbScenes: 5, personnages: [{ nom: 'Nina', description: 'veste rouge' }, { nom: 'Marco', description: 'ceinture noire' }], idFilm: 'film-gros-1', titre: 'Gros film' }), proprietaire: 'u1' };
let generations: Array<Record<string, unknown>> = [];

beforeEach(() => {
  generations = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { 'content-type': 'application/json' } });
    if (url === '/api/tarifs') return json({ ok: true, prix: { 'ai.generate_background': 5, 'ai.image_to_video': 15 }, exempte: false });
    if (url === '/api/cinema/films') return json({ ok: true, generationIa: true, generationMode: 'reelle', films: [{ id: film.id, titre: 'Gros film', majLe: film.majLe }] });
    if (url === `/api/cinema/films/${film.id}`) {
      const f = { ...film, generations: generations as unknown as import("@/lib/cinema/types").GenerationSuivie[] };
      return json({ ok: true, film: f, montage: presenterMontage(monterFilm(f), f.id), scenesAProduire: [], devis: devisFilm(f, []) });
    }
    if (url.endsWith('/travaux')) return json({ ok: true, travail: null });
    return json({ ok: false }, 404);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function ouvrir() {
  render(<CinemaPage />);
  fireEvent.change(await screen.findByLabelText(/reprendre un film/i), { target: { value: film.id } });
  await screen.findByText(/Export MP4/);
}

describe('page Cinema IA — plusieurs scenes, beaucoup de plans', () => {
  it('le film de test est bien gros (plusieurs scenes, 20+ plans)', () => {
    expect(film.scenes.length).toBeGreaterThanOrEqual(4);
    expect(film.scenes.flatMap((s) => s.plans).length).toBeGreaterThanOrEqual(20);
  });

  it('s’affiche entierement, chaque plan avec son bouton, en un temps borne', async () => {
    const t0 = performance.now();
    await ouvrir();
    const duree = performance.now() - t0;
    const nbPlans = film.scenes.flatMap((s) => s.plans).length;
    expect(document.querySelectorAll('[data-cinema-generation="image"]').length).toBe(nbPlans);
    expect(duree).toBeLessThan(5000); // jsdom, machine partagee : marge large, mais finie
  });

  it('aucun minuteur par seconde n’est arme tant qu’aucune generation n’est en cours', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    await ouvrir();
    expect(spy.mock.calls.filter(([, ms]) => ms === 1000)).toHaveLength(0);
  });

  it('une generation en cours n’arme qu’UN compteur, sur SON plan', async () => {
    generations = [{ id: 'g1', planId: film.scenes[1].plans[1].id, operation: 'video', mode: 'reelle', statut: 'en_cours', creeLe: new Date().toISOString(), majLe: new Date().toISOString() }];
    const spy = vi.spyOn(globalThis, 'setInterval');
    await ouvrir();
    await screen.findByText(/generation video en cours/i);
    expect(spy.mock.calls.filter(([, ms]) => ms === 1000)).toHaveLength(1);
    expect(document.querySelectorAll('[data-cinema-generation-statut="en_cours"]')).toHaveLength(1);
  });
});
