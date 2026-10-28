/**
 * SIDEBAR — l'entrée « Cinema IA » dit la vérité sur sa disponibilité.
 *
 * `CINEMA_ACTIVE` est fermé par défaut (`lib/cinema/garde.ts`) : une entrée de menu
 * TOUJOURS visible mènerait tout le monde vers une page qui refuse tout en 404. La
 * Sidebar interroge donc la MÊME route que la page Cinema IA elle-même
 * (`GET /api/cinema/films`) et n'affiche le lien que si le serveur confirme.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'u@test.local' } } }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));
vi.mock('@/i18n/client', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'fr',
  useSetLocale: () => () => {},
}));

import { Sidebar } from '@/components/layout/Sidebar';

let reponseFilms: () => unknown;

beforeEach(() => {
  reponseFilms = () => ({ ok: false, erreur: 'introuvable' }); // CINEMA_ACTIVE fermé : le défaut réel
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json' } });
    if (url === '/api/cinema/films') return json(reponseFilms(), (reponseFilms() as { ok: boolean }).ok ? 200 : 404);
    if (url === '/api/credits/balance') return json({ ok: true, balance: 100 });
    return json({ ok: false }, 404);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('entrée Cinema IA — visible seulement si le serveur confirme', () => {
  // `Sidebar` rend son contenu DEUX fois (version bureau + version mobile) :
  // tout texte ou lien y apparaît donc deux fois dans le DOM.
  it('CINEMA_ACTIVE fermé (le défaut en production) : AUCUN lien Cinema IA', async () => {
    render(<Sidebar />);
    // Laisse le temps à l'appel réseau simulé de répondre.
    await waitFor(() => expect(screen.getAllByText('dashboard').length).toBeGreaterThan(0));
    expect(screen.queryAllByRole('link', { name: 'cinema' })).toHaveLength(0);
  });

  it('le serveur confirme Cinema IA utilisable : le lien apparaît, vers /dashboard/cinema', async () => {
    reponseFilms = () => ({ ok: true, generationIa: false, generationMode: null, films: [] });
    render(<Sidebar />);
    const liens = await screen.findAllByRole('link', { name: 'cinema' });
    expect(liens.length).toBeGreaterThan(0);
    for (const lien of liens) expect(lien.getAttribute('href')).toBe('/dashboard/cinema');
  });

  /** Les href du menu, dans l'ordre, pour UNE des deux copies (bureau). */
  const ordreDuMenu = () => {
    const nav = document.querySelector('aside nav') as HTMLElement;
    return [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'));
  };

  it('Cinema IA est JUSTE SOUS « Créer », une seule fois, avec le même lien', async () => {
    reponseFilms = () => ({ ok: true, generationIa: false, generationMode: null, films: [] });
    render(<Sidebar />);
    await screen.findAllByRole('link', { name: 'cinema' });
    expect(ordreDuMenu().slice(0, 4)).toEqual([
      '/dashboard', '/dashboard/creer', '/dashboard/cinema', '/dashboard/avatar',
    ]);
    // Une entrée par copie (bureau + mobile), jamais deux dans la même liste.
    expect(ordreDuMenu().filter((h) => h === '/dashboard/cinema')).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'cinema' })).toHaveLength(2);
  });

  it('Cinema IA fermé : le reste du menu garde son ordre, sans trou', async () => {
    render(<Sidebar />);
    await waitFor(() => expect(screen.getAllByText('dashboard').length).toBeGreaterThan(0));
    expect(ordreDuMenu().slice(0, 4)).toEqual([
      '/dashboard', '/dashboard/creer', '/dashboard/avatar', '/dashboard/calendar',
    ]);
  });

  it('l’appel réseau échoue : le lien reste caché (fermé par défaut, jamais ouvert par erreur)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/cinema/films') throw new Error('network down');
      const json = (corps: unknown) => new Response(JSON.stringify(corps), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url === '/api/credits/balance') return json({ ok: true, balance: 100 });
      return new Response(JSON.stringify({ ok: false }), { status: 404 });
    }));
    render(<Sidebar />);
    await waitFor(() => expect(screen.getAllByText('dashboard').length).toBeGreaterThan(0));
    expect(screen.queryAllByRole('link', { name: 'cinema' })).toHaveLength(0);
  });
});

describe('le solde affiché se rafraîchit après une opération payante ailleurs (ex. Cinema IA)', () => {
  it('un évènement `studiio:credits-changed` relit le solde — plus besoin de recharger la page', async () => {
    let solde = 100;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: { 'content-type': 'application/json' } });
      if (url === '/api/cinema/films') return json({ ok: false }, 404);
      if (url === '/api/credits/balance') return json({ ok: true, balance: solde });
      return json({ ok: false }, 404);
    }));
    render(<Sidebar />);
    await waitFor(() => expect(screen.getAllByText('100').length).toBeGreaterThan(0));
    solde = 95; // une génération réelle vient de débiter le compte, ailleurs sur le site
    window.dispatchEvent(new Event('studiio:credits-changed'));
    await waitFor(() => expect(screen.getAllByText('95').length).toBeGreaterThan(0));
  });
});
