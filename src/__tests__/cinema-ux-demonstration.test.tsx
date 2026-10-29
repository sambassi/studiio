/**
 * CINEMA IA — découvrabilité et responsive : la démonstration gratuite est accessible sans
 * scénario, l'aperçu vide épouse son contenu, l'exemple science-fiction est complet.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import CinemaPage from '@/app/dashboard/cinema/page';
import { CLIPS_DEMO } from '@/components/cinema/ApercuStoryboard';
import { LIBELLES_DEMO } from '@/components/cinema/DemoGratuite';
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

describe('démonstration gratuite : visible dès l’arrivée, sans scénario', () => {
  it('un bouton discret dans l’aperçu vide ouvre les 4 clips, étiquetés « Démonstration »', async () => {
    await ouvrir();
    const bouton = screen.getByRole('button', { name: /Voir une démonstration gratuite/ });
    expect(bouton.querySelector('svg')).toBeTruthy();
    const avant = appels.length;
    fireEvent.click(bouton);

    const zone = document.querySelector('[data-demo="gratuite"]') as HTMLElement;
    expect(zone).toBeTruthy();
    expect(within(zone).getAllByText(/Démonstration/).length).toBeGreaterThan(1);
    expect(zone.textContent).toMatch(/pas des vidéos générées par l’IA/);
    expect(zone.textContent).toMatch(/rien n’est débité/);
    // Ce bloc montre les MOUVEMENTS de camera — le style du film a ses propres extraits.
    expect(zone.textContent).toMatch(/Mouvements de caméra/);
    const video = zone.querySelector('video') as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe(CLIPS_DEMO[0]);
    // Commandes de l'application : jamais la barre native (et son menu « telecharger »).
    expect(video.hasAttribute('controls')).toBe(false);
    expect(within(zone).getByLabelText(/^Lecture$|^Pause$/)).toBeTruthy();

    // Les 4 clips, un par mouvement de caméra.
    const boutons = within(within(zone).getByRole('group', { name: /Clips de démonstration/ })).getAllByRole('button').filter((b) => LIBELLES_DEMO.includes(b.textContent!.trim()));
    expect(boutons).toHaveLength(4);
    for (const [k, b] of boutons.entries()) {
      fireEvent.click(b);
      expect((zone.querySelector('video') as HTMLVideoElement).getAttribute('src')).toBe(CLIPS_DEMO[k]);
      expect(b.getAttribute('aria-pressed')).toBe('true');
    }
    // Aucun appel : ni génération, ni enregistrement, ni crédit.
    expect(appels.slice(avant)).toEqual([]);
    expect(ecritures()).toEqual([]);
  });

  it('on peut quitter la démonstration et retrouver l’aperçu vide', async () => {
    await ouvrir();
    fireEvent.click(screen.getByRole('button', { name: /Voir une démonstration gratuite/ }));
    fireEvent.click(screen.getByRole('button', { name: /Quitter la démonstration/ }));
    expect(document.querySelector('[data-demo="gratuite"]')).toBeNull();
    expect(screen.getByText('Votre film apparaitra ici')).toBeTruthy();
  });

  it('les clips servis existent vraiment (4 fichiers locaux)', () => {
    expect(CLIPS_DEMO).toHaveLength(4);
    expect(LIBELLES_DEMO).toHaveLength(4);
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
