/**
 * CINEMA IA — LE PARCOURS : une etape a la fois, un apercu permanent, rien de perdu.
 *
 * Ce qui est eprouve ici est ce que la maquette validee exige : on ne voit jamais deux
 * formulaires d'etapes a la fois, l'apercu reste a l'ecran, une etape non atteinte le DIT,
 * et naviguer ne perd aucune saisie.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync } from 'fs';
import CinemaPage from '@/app/dashboard/cinema/page';
import { preparerFilm } from '@/lib/cinema/atelier';
import { monterFilm } from '@/lib/cinema/montage';
import { presenterMontage } from '@/lib/cinema/stockage/presentation';
import { devisFilm } from '@/lib/cinema/couts';
import type { Film } from '@/lib/cinema/types';

const HISTOIRE = 'Nina entre dans la salle avant le lever du jour. Le tatami est encore froid. Marco la regarde sans bouger. Marco dit : « je ne reculerai pas ». Le jour se leve sur la salle vide.';
const film: Film = { ...preparerFilm({ histoire: HISTOIRE, personnages: [{ nom: 'Nina', description: 'veste rouge' }, { nom: 'Marco', description: 'ceinture noire' }], idFilm: 'film-wiz', titre: 'Avant le jour' }), proprietaire: 'u1' };

let appels: Array<{ url: string; method: string }>;
let filmsListes: Array<{ id: string; titre: string; majLe: string }>;

beforeEach(() => {
  appels = [];
  filmsListes = [{ id: film.id, titre: film.titre, majLe: film.majLe }];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); const method = init?.method ?? 'GET';
    appels.push({ url, method });
    const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { 'content-type': 'application/json' } });
    if (url === '/api/tarifs') return json({ ok: true, prix: {}, exempte: false });
    if (url === '/api/cinema/films' && method === 'GET') return json({ ok: true, generationIa: false, generationMode: null, films: filmsListes });
    if (url === `/api/cinema/films/${film.id}`) {
      return json({ ok: true, film, montage: presenterMontage(monterFilm(film), film.id), scenesAProduire: [], devis: devisFilm(film, film.scenes.map((s) => s.id)) });
    }
    if (url.includes('/travaux')) return json({ ok: true, travail: null });
    return json({ ok: false, erreur: 'inattendu' }, 404);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const etape = (n: number) => screen.getByRole('button', { name: new RegExp(`^Etape ${n} sur 5`) });
const zone = () => screen.getByRole('region', { name: /^Etape/ }) as HTMLElement;
async function ouvrir() {
  render(<CinemaPage />);
  fireEvent.change(await screen.findByLabelText(/reprendre un film/i), { target: { value: film.id } });
  await screen.findByRole('heading', { name: /Une histoire, scene apres scene|Racontez votre idee/ });
}

describe('une seule etape a la fois', () => {
  it('a l’ouverture : Histoire seule, et aucun autre formulaire d’etape n’est rendu', async () => {
    render(<CinemaPage />);
    await screen.findByRole('heading', { name: /Racontez votre idee/ });
    expect(screen.queryByRole('heading', { name: /Qui joue dans votre film/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Une histoire, scene apres scene/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Verifiez avant de generer/ })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Votre film, pret a partager/ })).toBeNull();
    // Le pied de page annonce ou l'on est, et propose UNE action primaire.
    expect(screen.getByText(/Etape 1 sur 5/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Continuer/ })).toBeTruthy();
  });

  it('les etapes qui dependent d’un scenario sont desactivees, et le disent', async () => {
    render(<CinemaPage />);
    await screen.findByRole('heading', { name: /Racontez votre idee/ });
    for (const n of [3, 4, 5]) {
      expect((etape(n) as HTMLButtonElement).disabled, `etape ${n}`).toBe(true);
      expect(etape(n).getAttribute('aria-label')).toMatch(/composez d’abord le scenario/i);
    }
    expect((etape(2) as HTMLButtonElement).disabled).toBe(false);
  });

  it('avec un film : chaque etape s’affiche seule, et la zone de travail est annoncee', async () => {
    await ouvrir();
    for (const [n, titre] of [[1, /Racontez votre idee/], [2, /Qui joue dans votre film/], [3, /Une histoire, scene apres scene/], [4, /Verifiez avant de generer/], [5, /Votre film, pret a partager/]] as const) {
      fireEvent.click(etape(n));
      expect(within(zone()).getByRole('heading', { name: titre }), `etape ${n}`).toBeTruthy();
      expect(screen.getAllByRole('heading', { level: 2 }).filter((h) => /Racontez|Qui joue|scene apres scene|Verifiez avant|pret a partager/.test(h.textContent ?? ''))).toHaveLength(1);
    }
  });
});

describe('l’apercu est permanent, et les saisies survivent a la navigation', () => {
  it('l’apercu reste rendu a chaque etape', async () => {
    await ouvrir();
    for (const n of [1, 2, 3, 4, 5]) {
      fireEvent.click(etape(n));
      expect(screen.getByLabelText('Apercu permanent'), `etape ${n}`).toBeTruthy();
    }
  });

  it('titre et histoire sont conserves en allant et revenant', async () => {
    render(<CinemaPage />);
    await screen.findByRole('heading', { name: /Racontez votre idee/ });
    fireEvent.change(screen.getByPlaceholderText('Titre du film'), { target: { value: 'Mon titre a moi' } });
    fireEvent.change(screen.getByPlaceholderText(/Une phrase par plan/), { target: { value: HISTOIRE } });
    fireEvent.click(etape(2));
    fireEvent.change(screen.getAllByPlaceholderText('Nom')[0], { target: { value: 'Zoe' } });
    fireEvent.click(etape(1));
    expect((screen.getByPlaceholderText('Titre du film') as HTMLInputElement).value).toBe('Mon titre a moi');
    expect((screen.getByPlaceholderText(/Une phrase par plan/) as HTMLTextAreaElement).value).toBe(HISTOIRE);
    fireEvent.click(etape(2));
    expect((screen.getAllByPlaceholderText('Nom')[0] as HTMLInputElement).value).toBe('Zoe');
  });

  it('rouvrir un projet restitue ses scenes, sans rien regenerer', async () => {
    const avant = appels.filter((a) => a.method !== 'GET').length;
    await ouvrir();
    fireEvent.click(etape(3));
    expect(document.querySelectorAll('[id^="scene-cinema-"]').length).toBe(film.scenes.length);
    expect(appels.filter((a) => a.method !== 'GET')).toHaveLength(avant);
  });
});

describe('scenes : cartes compactes, outils a la demande, phrases d’origine', () => {
  it('aucun outil de plan n’est ouvert par defaut', async () => {
    await ouvrir();
    fireEvent.click(etape(3));
    // Les outils d'un plan (camera, personnages du plan) ne sont rendus que pour la scene ouverte.
    // (Le carrousel de l'apercu garde son propre import de media : il n'est pas dans l'etape.)
    expect(document.querySelectorAll('select[aria-label="Mouvement de camera de ce plan"]')).toHaveLength(0);
    expect(within(zone()).queryAllByText(/Importer une image ou une video/)).toHaveLength(0);
  });

  it('chaque carte montre les phrases de VOTRE texte, et le plan ajoute est signale', async () => {
    await ouvrir();
    fireEvent.click(etape(3));
    const texte = zone().textContent ?? '';
    expect(texte).toContain('Nina entre dans la salle avant le lever du jour.');
    expect(texte).toMatch(/Plan ajoute par Studiio/);
  });

  it('ouvrir UNE scene n’ouvre qu’elle, et refermer la referme', async () => {
    await ouvrir();
    fireEvent.click(etape(3));
    const plansOuverts = () => document.querySelectorAll('select[aria-label="Mouvement de camera de ce plan"]').length;
    fireEvent.click(screen.getByLabelText(/Ouvrir les outils de la scene 1/));
    expect(plansOuverts()).toBe(film.scenes[0].plans.length);
    fireEvent.click(screen.getByLabelText(/Ouvrir les outils de la scene 2/));
    expect(plansOuverts()).toBe(film.scenes[1].plans.length);
    fireEvent.click(screen.getByLabelText(/Fermer les outils de la scene 2/));
    expect(plansOuverts()).toBe(0);
  });
});

describe('etape Apercu : fidelite et cout, avant toute generation', () => {
  it('annonce que les phrases sont conservees, l’etat du media et le cout', async () => {
    await ouvrir();
    fireEvent.click(etape(4));
    const texte = zone().textContent ?? '';
    expect(texte).toMatch(/phrases sont conservees, dans l’ordre/);
    expect(texte).toMatch(/Aucun media genere pour ce film/);
    expect(texte).toMatch(/Cout annonce avant toute creation/);
    expect(texte).toMatch(/gratuit \(rendu local\)|USD|Cout inconnu/i);
  });

  it('les ecarts avec le texte sont listes, et Studiio dit qu’il ne corrige rien tout seul', async () => {
    await ouvrir();
    fireEvent.click(etape(4));
    const texte = zone().textContent ?? '';
    expect(texte).toMatch(/A valider : \d+ ecart\(s\) avec votre texte/);
    expect(texte).toMatch(/ne corrige rien tout seul/);
  });
});

describe('la coque respecte les contraintes de la maquette', () => {
  it('hauteur bornee a l’ecran et apercu compact sur mobile — en CSS reel, pas en classe purgeable', () => {
    const src = readFileSync('src/components/cinema/WizardCinema.tsx', 'utf8');
    expect(src).toMatch(/\.cinema-wizard\{height:calc\(100vh - 6rem\);min-height:420px\}/);
    expect(src).toMatch(/\.cinema-apercu\{max-height:190px\}/);
    expect(src).toMatch(/@media\(min-width:1024px\)/);
    // Pas de hauteur en classe arbitraire Tailwind (purgee en production).
    expect(src).not.toMatch(/className="[^"]*\b(h|min-h)-\[/);
  });

  it('aucun emoji, et les boutons d’etape portent un libelle accessible', async () => {
    render(<CinemaPage />);
    await screen.findByRole('heading', { name: /Racontez votre idee/ });
    const barre = screen.getByRole('navigation', { name: /Etapes de Cinema IA/ });
    expect(barre.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    for (const b of within(barre).getAllByRole('button')) {
      expect(b.getAttribute('aria-label')).toMatch(/^Etape \d sur 5/);
      expect(b.querySelector('svg')).toBeTruthy();
    }
  });
});
