/**
 * CINEMA IA — découvrabilité et responsive : les exemples (styles, mouvements) s'affichent
 * dans l'UNIQUE aperçu, l'aperçu vide épouse son contenu, l'exemple science-fiction est complet.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import CinemaPage from '@/app/dashboard/cinema/page';
import { MODELES_FILM } from '@/components/cinema/ModelesFilm';

let appels: Array<{ url: string; method: string }>;
beforeEach(() => {
  appels = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); const method = init?.method ?? 'GET';
    appels.push({ url, method });
    const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { 'content-type': 'application/json' } });
    if (url === '/api/tarifs') return json({ ok: true, prix: {}, exempte: false });
    if (url === '/api/cinema/films' && method === 'GET') return json({ ok: true, generationIa: false, generationMode: null, films: [] });
    return json({ ok: false, erreur: 'inattendu' }, 404);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ouvrir = async () => { render(<CinemaPage />); await screen.findByText(/Partir d’un exemple/i); };
const ecritures = () => appels.filter((a) => a.method !== 'GET');

describe('un seul aperçu : les mouvements s’affichent dedans, sans scénario', () => {
  it('les 4 mouvements filmés sont proposés sous l’aperçu, avec leur photogramme', async () => {
    await ouvrir();
    const bloc = document.querySelector('[data-bloc="mouvements"]') as HTMLElement;
    const boutons = within(bloc).getAllByRole('button');
    expect(boutons.map((b) => b.textContent!.trim())).toEqual(['Travelling avant', 'Panoramique', 'Suivi latéral', 'Orbite']);
    const imgs = Array.from(bloc.querySelectorAll('img'));
    expect(imgs).toHaveLength(4);
    expect(new Set(imgs.map((i) => i.getAttribute('src'))).size).toBe(4);
    for (const i of imgs) expect(i.getAttribute('loading')).toBe('lazy');
    expect(bloc.textContent).toMatch(/mouvement réel, pas une simulation/);
  });

  it('un clic montre le plan dans l’APERÇU, pas dans un second lecteur — et aucun appel', async () => {
    await ouvrir();
    const avant = appels.length;
    fireEvent.click(within(document.querySelector('[data-bloc="mouvements"]') as HTMLElement).getByText('Orbite'));
    const zone = document.querySelector('[data-apercu="exemple"]') as HTMLElement;
    expect(zone.textContent).toMatch(/Mouvement de caméra — Orbite/);
    const videos = Array.from(document.querySelectorAll('video'));
    expect(videos).toHaveLength(1);
    expect(videos[0].getAttribute('src')).toBe('/cinema-mouvements/orbite.mp4');
    expect(appels.slice(avant)).toEqual([]);
  });

  it('« Revenir à mon film » rend l’aperçu du projet', async () => {
    await ouvrir();
    fireEvent.click(within(document.querySelector('[data-bloc="mouvements"]') as HTMLElement).getByText('Panoramique'));
    expect(document.querySelector('[data-apercu="exemple"]')).toBeTruthy();
    fireEvent.click(screen.getByText('Revenir à mon film'));
    expect(document.querySelector('[data-apercu="exemple"]')).toBeNull();
    expect(screen.getByText('Votre film apparaitra ici')).toBeTruthy();
  });
});

describe('aperçu vide : la hauteur suit le contenu, le bouton agrandir reste là', () => {
  it('plus de cadre à hauteur minimale ni à ratio forcé ; bouton désactivé conservé en haut à droite', async () => {
    await ouvrir();
    const cadre = screen.getByText('Votre film apparaitra ici').closest('.relative') as HTMLElement;
    expect(cadre.style.minHeight).toBe('');
    expect(cadre.style.aspectRatio).toBe('');
    const bouton = screen.getByLabelText(/agrandi sera disponible/i);
    expect(bouton.className).toContain('top-3');
    expect(bouton.className).toContain('right-3');
    expect(bouton.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('responsive : styles, exemples et personnages', () => {
  it('styles : 2 colonnes (3 dès sm), plus de six colonnes minuscules', async () => {
    await ouvrir();
    const grille = screen.getByRole('radiogroup', { name: /Style cinematique/ });
    expect(grille.className).toContain('grid-cols-2');
    expect(grille.className).toContain('sm:grid-cols-3');
    expect(grille.className).not.toContain('md:grid-cols-6');
  });

  it('exemples : cartes assez larges (1 colonne, 2 dès sm), textes qui passent à la ligne', async () => {
    await ouvrir();
    const carte = screen.getByRole('button', { name: /Utiliser l’exemple L’ascension/ }).closest('.grid') as HTMLElement;
    expect(carte.className).toContain('sm:grid-cols-2');
    expect(carte.className).not.toContain('sm:grid-cols-3');
    expect(screen.getByText(/Lumiere froide d’avant l’aube/).className).toContain('break-words');
  });

  it('personnages : nom et rôle sur une ligne, apparence sur toute la largeur', async () => {
    await ouvrir();
    const ligne = screen.getAllByPlaceholderText('Nom')[0].parentElement as HTMLElement;
    expect(ligne.className).toContain('grid-cols-2');
    expect(ligne.className).not.toContain('md:grid-cols-4');
    expect(screen.getAllByPlaceholderText('Apparence (reference)')[0].className).toContain('col-span-2');
  });
});

describe('exemple science-fiction', () => {
  it('quatrième carte ; un clic remplit le formulaire ET propose le style, sans rien générer', async () => {
    await ouvrir();
    expect(MODELES_FILM).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: /Utiliser l’exemple Signal perdu \(Science-fiction\)/ }));
    expect((screen.getByPlaceholderText('Titre du film') as HTMLInputElement).value).toBe('Signal perdu');
    expect((screen.getByPlaceholderText(/Une phrase par plan/) as HTMLTextAreaElement).value).toMatch(/Ada se reveille seule/);
    expect(screen.getAllByPlaceholderText('Nom').map((i) => (i as HTMLInputElement).value)).toEqual(['Ada', 'Orion']);
    expect(screen.getByRole('radio', { name: /Science-fiction/ }).getAttribute('aria-checked')).toBe('true');
    expect(ecritures()).toEqual([]);
  });

  it('les autres exemples ne touchent pas au style choisi', async () => {
    await ouvrir();
    fireEvent.click(screen.getByRole('radio', { name: /Film noir/ }));
    fireEvent.click(screen.getByRole('button', { name: /Utiliser l’exemple L’ascension/ }));
    expect(screen.getByRole('radio', { name: /Film noir/ }).getAttribute('aria-checked')).toBe('true');
  });
});
