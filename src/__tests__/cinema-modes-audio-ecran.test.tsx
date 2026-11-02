/**
 * LES DEUX MODES AUDIO A L'ECRAN : etape Histoire (deux cartes), Personnages (une voix par personnage),
 * Aperçu (mode affiche et modifiable), clarification d'un locuteur ambigu, anciens films preserves.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup, waitFor } from '@testing-library/react';
import CinemaPage from '@/app/dashboard/cinema/page';
import { preparerFilm } from '@/lib/cinema/atelier';
import { monterFilm } from '@/lib/cinema/montage';
import { presenterMontage } from '@/lib/cinema/stockage/presentation';
import { devisFilm } from '@/lib/cinema/couts';
import { voixDistincte, VOIX_FILM } from '@/lib/cinema/personnages';
import type { Film } from '@/lib/cinema/types';

const AVEC_REPLIQUES = 'Maya entre dans la salle. Maya dit : « Bonjour Karim ». Karim répond : « Bonjour Maya ». Le jour se lève sur la salle.';
const AMBIGU = 'Maya entre dans la salle. « Bonjour ». Karim sourit dans la salle. Le jour se lève sur la salle.';
const SANS_REPLIQUE = 'Maya entre dans la salle. Karim la regarde. Le jour se lève sur la salle.';

let film: Film | null;
let appels: Array<{ url: string; method: string; corps?: any }>;
const faire = (histoire: string, mode?: 'personnages' | 'narrateur'): Film => {
  const f = preparerFilm({ histoire, personnages: [{ nom: 'Maya' }, { nom: 'Karim' }].map((p, i) => ({ ...p, ...(mode ? { voix: voixDistincte(i) } : {}) })), idFilm: 'film-audio', titre: 'Audio' });
  return mode ? { ...f, modeAudio: mode } : f;
};
const etape = (n: number) => screen.getByRole('button', { name: new RegExp(`^Etape ${n} sur 5`) });
const ecritures = () => appels.filter((a) => a.method !== 'GET');

beforeEach(() => {
  appels = [];
  film = null;
  try { localStorage.clear(); } catch { /* sans stockage */ }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); const method = init?.method ?? 'GET';
    appels.push({ url, method, corps: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body });
    const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { 'content-type': 'application/json' } });
    const rep = (f: Film) => ({ ok: true, film: f, montage: presenterMontage(monterFilm(f), f.id), scenesAProduire: [], devis: devisFilm(f, f.scenes.map((s) => s.id)) });
    if (url === '/api/tarifs') return json({ ok: true, prix: {}, exempte: false });
    if (url === '/api/cinema/films' && method === 'GET') return json({ ok: true, generationIa: false, generationMode: null, films: film ? [{ id: film.id, titre: film.titre, majLe: film.majLe }] : [] });
    if (url === '/api/cinema/films' && method === 'POST') { film = faire(JSON.parse(String(init!.body)).histoire, JSON.parse(String(init!.body)).modeAudio ?? undefined); return json(rep(film)); }
    if (film && url === `/api/cinema/films/${film.id}` && method === 'GET') return json(rep(film));
    if (film && url === `/api/cinema/films/${film.id}` && method === 'PATCH') return json(rep(film));
    if (url.includes('/travaux')) return json({ ok: true, travail: null });
    return json({ ok: false, erreur: 'inattendu' }, 404);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function ouvrirFilm(f: Film) {
  film = f;
  render(<CinemaPage />);
  fireEvent.change(await screen.findByLabelText(/reprendre un film/i), { target: { value: f.id } });
  await screen.findByRole('heading', { name: /Racontez votre idee/ });
}
const cartes = () => document.querySelectorAll('[data-mode-audio]');
const actif = () => Array.from(cartes()).filter((c) => c.getAttribute('aria-checked') === 'true').map((c) => c.getAttribute('data-mode-audio'));

describe('etape Histoire : deux petites cartes, un seul choix', () => {
  it('deux cartes exactement, avec leur phrase, et aucun troisieme mode', async () => {
    render(<CinemaPage />);
    await screen.findByRole('heading', { name: /Racontez votre idee/ });
    expect(cartes()).toHaveLength(2);
    expect(cartes()[0].textContent).toContain('Les personnages parlent');
    expect(cartes()[1].textContent).toContain('Une voix raconte l’histoire');
    expect(cartes()[0].textContent).toMatch(/Chacun dit ses répliques avec sa propre voix\. Pas de narrateur/);
    expect(cartes()[1].textContent).toMatch(/Une voix off lit ton récit\. Les répliques s’affichent mais ne sont pas lues/);
    expect(document.querySelector('[data-mode-audio-cartes] [role="radiogroup"]')!.querySelectorAll('[role="radio"]')).toHaveLength(2);
  });

  it('un seul mode a la fois (exclusifs) ; cliquer l’autre carte bascule', async () => {
    render(<CinemaPage />);
    await screen.findByRole('heading', { name: /Racontez votre idee/ });
    fireEvent.click(cartes()[1]);
    expect(actif()).toEqual(['narrateur']);
    fireEvent.click(cartes()[0]);
    expect(actif()).toEqual(['personnages']);
  });

  it('le mode est PROPOSE d’apres le texte : des guillemets -> les personnages parlent ; sinon une voix raconte', async () => {
    render(<CinemaPage />);
    await screen.findByRole('heading', { name: /Racontez votre idee/ });
    const zone = screen.getByPlaceholderText(/Une phrase par plan/) as HTMLTextAreaElement;
    fireEvent.change(zone, { target: { value: AVEC_REPLIQUES } });
    expect(actif()).toEqual(['personnages']);
    expect(document.body.textContent).toMatch(/Proposé d’après ton texte/);
    fireEvent.change(zone, { target: { value: SANS_REPLIQUE } });
    expect(actif()).toEqual(['narrateur']);
    // un choix explicite n'est plus ecrase par le texte
    fireEvent.click(cartes()[0]);
    fireEvent.change(zone, { target: { value: SANS_REPLIQUE + ' Fin.' } });
    expect(actif()).toEqual(['personnages']);
    expect(document.body.textContent).not.toMatch(/Proposé d’après ton texte/);
  });

  it('la composition envoie le mode choisi et des voix DISTINCTES, sans reecrire l’histoire', async () => {
    render(<CinemaPage />);
    await screen.findByRole('heading', { name: /Racontez votre idee/ });
    fireEvent.change(screen.getByPlaceholderText(/Une phrase par plan/), { target: { value: AVEC_REPLIQUES } });
    fireEvent.click(cartes()[0]);
    fireEvent.click(etape(2));
    fireEvent.click(await screen.findByRole('button', { name: /Composer le scenario/ }));
    await waitFor(() => expect(appels.some((a) => a.method === 'POST' && a.url === '/api/cinema/films')).toBe(true));
    const post = appels.find((a) => a.method === 'POST' && a.url === '/api/cinema/films')!;
    expect(post.corps.modeAudio).toBe('personnages');
    expect(post.corps.histoire).toBe(AVEC_REPLIQUES);
    expect(new Set(post.corps.personnages.map((p: { voix: string }) => p.voix)).size).toBe(post.corps.personnages.length);
  });
});

describe('etape Personnages : la voix de chaque personnage (mode dialogues)', () => {
  it('une liste de voix par personnage en mode « les personnages parlent », distinctes par defaut', async () => {
    render(<CinemaPage />);
    await screen.findByRole('heading', { name: /Racontez votre idee/ });
    fireEvent.click(cartes()[0]);
    fireEvent.click(etape(2));
    const selects = Array.from(document.querySelectorAll('[data-voix-personnage] select')) as HTMLSelectElement[];
    expect(selects).toHaveLength(2);
    expect(selects[0].value).toBe(VOIX_FILM[0].id);
    expect(selects[1].value).toBe(VOIX_FILM[1].id);
    expect(document.querySelector('[data-voix-partagee]')).toBeNull();
  });

  it('deux personnages avec la meme voix : l’ecran le dit', async () => {
    render(<CinemaPage />);
    await screen.findByRole('heading', { name: /Racontez votre idee/ });
    fireEvent.click(cartes()[0]);
    fireEvent.click(etape(2));
    const selects = Array.from(document.querySelectorAll('[data-voix-personnage] select')) as HTMLSelectElement[];
    fireEvent.change(selects[1], { target: { value: VOIX_FILM[0].id } });
    expect(document.querySelectorAll('[data-voix-partagee]').length).toBeGreaterThan(0);
  });

  it('aucun choix de voix en mode « une voix raconte »', async () => {
    render(<CinemaPage />);
    await screen.findByRole('heading', { name: /Racontez votre idee/ });
    fireEvent.click(cartes()[1]);
    fireEvent.click(etape(2));
    expect(document.querySelectorAll('[data-voix-personnage]')).toHaveLength(0);
  });

  it('sur un film existant, changer une voix l’ENREGISTRE (id du personnage), sans toucher au reste', async () => {
    const f = faire(AVEC_REPLIQUES, 'personnages');
    await ouvrirFilm(f);
    fireEvent.click(etape(2));
    const selects = Array.from(document.querySelectorAll('[data-voix-personnage] select')) as HTMLSelectElement[];
    fireEvent.change(selects[0], { target: { value: VOIX_FILM[2].id } });
    const patch = ecritures().find((a) => a.method === 'PATCH')!;
    expect(patch.corps).toEqual({ voix: [{ personnageId: 'pers-maya', voix: VOIX_FILM[2].id }] });
  });
});

describe('anciens films : jamais transformes en silence', () => {
  it('un film d’avant s’ouvre SANS aucun mode choisi, avec son ancien reglage explique, et aucune ecriture', async () => {
    await ouvrirFilm(faire(AVEC_REPLIQUES));
    expect(actif()).toEqual([]);
    expect(document.querySelector('[data-mode-historique]')!.textContent).toMatch(/garde son ancien réglage audio/);
    expect(ecritures()).toEqual([]);
  });

  it('a l’etape Aperçu : l’ancien reglage Avec/Sans narration reste proposé pour lui, et le mode actuel est « ancien réglage »', async () => {
    await ouvrirFilm(faire(AVEC_REPLIQUES));
    fireEvent.click(etape(4));
    expect(document.querySelector('[data-mode-actuel]')!.textContent).toMatch(/Ancien réglage/);
    expect(document.querySelector('[data-reglage="narration"]')).not.toBeNull();
    expect(ecritures()).toEqual([]);
  });

  it('choisir explicitement un mode ENREGISTRE le mode (et rien d’autre : ni histoire, ni dialogues)', async () => {
    await ouvrirFilm(faire(AVEC_REPLIQUES));
    fireEvent.click(cartes()[1]);
    const w = ecritures();
    expect(w).toHaveLength(1);
    expect(w[0].corps).toEqual({ modeAudio: 'narrateur' });
  });
});

describe('etape Aperçu : le mode affiche, modifiable sans perdre le scenario', () => {
  it('affiche le mode et bascule par un PATCH {modeAudio} ; l’ancien reglage n’existe plus (pas de contradiction)', async () => {
    await ouvrirFilm(faire(AVEC_REPLIQUES, 'personnages'));
    fireEvent.click(etape(4));
    const bloc = document.querySelector('[data-reglage="mode-audio"]') as HTMLElement;
    expect(bloc.querySelector('[data-mode-actuel]')!.textContent).toMatch(/^Les personnages parlent — /);
    expect(within(bloc).getByRole('radio', { name: 'Les personnages parlent' }).getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('[data-reglage="narration"]')).toBeNull();
    fireEvent.click(within(bloc).getByRole('radio', { name: 'Une voix raconte l’histoire' }));
    expect(ecritures().at(-1)!.corps).toEqual({ modeAudio: 'narrateur' });
    expect(bloc.textContent).toMatch(/ne touche ni ton histoire, ni tes personnages, ni tes dialogues/);
  });

  it('cliquer le mode deja actif n’envoie rien', async () => {
    await ouvrirFilm(faire(AVEC_REPLIQUES, 'narrateur'));
    fireEvent.click(etape(4));
    const bloc = document.querySelector('[data-reglage="mode-audio"]') as HTMLElement;
    fireEvent.click(within(bloc).getByRole('radio', { name: 'Une voix raconte l’histoire' }));
    expect(ecritures()).toEqual([]);
  });

  it('SYNCHRONISATION LABIALE : la limite est dite, sans pretendre que les levres bougent (mode personnages seulement)', async () => {
    await ouvrirFilm(faire(AVEC_REPLIQUES, 'personnages'));
    fireEvent.click(etape(4));
    expect(document.querySelector('[data-limite-labiale]')!.textContent).toMatch(/leurs lèvres ne bougent pas en synchronisation/);
    cleanup();
    await ouvrirFilm(faire(AVEC_REPLIQUES, 'narrateur'));
    fireEvent.click(etape(4));
    expect(document.querySelector('[data-limite-labiale]')).toBeNull();
  });

  it('mode « personnages » sans replique : le probleme est explique, avec le conseil', async () => {
    await ouvrirFilm(faire(SANS_REPLIQUE, 'personnages'));
    fireEvent.click(etape(4));
    const pb = document.querySelector('[data-probleme-audio="aucune_replique"]') as HTMLElement;
    expect(pb.textContent).toMatch(/aucune réplique entre guillemets/);
    expect(pb.textContent).toMatch(/Ajoute des répliques entre guillemets/);
  });

  it('mode « voix » sans recit : on explique, on n’ecrit rien a la place', async () => {
    await ouvrirFilm(faire('Maya dit : « Bonjour ». Karim répond : « Salut ». Maya dit : « Ca va ».', 'narrateur'));
    fireEvent.click(etape(4));
    expect(document.querySelector('[data-probleme-audio="aucun_recit"]')!.textContent).toMatch(/Studiio n’écrit jamais de texte à ta place/);
  });
});

describe('locuteur ambigu : on demande, on ne choisit pas au hasard', () => {
  it('l’etape Aperçu liste la replique et propose les personnages ; un clic envoie le LOCUTEUR choisi', async () => {
    await ouvrirFilm(faire(AMBIGU, 'personnages'));
    fireEvent.click(etape(4));
    const pb = document.querySelector('[data-probleme-audio="locuteur_ambigu"]') as HTMLElement;
    expect(pb.textContent).toMatch(/ne dit pas qui parle/);
    expect(pb.textContent).toContain('« Bonjour »');
    fireEvent.click(within(pb).getByRole('button', { name: 'Karim dit cette réplique' }));
    const patch = ecritures().at(-1)!;
    const plan = film!.scenes.flatMap((s) => s.plans).find((p) => p.dialogue?.genre === 'replique')!;
    expect(patch.corps).toEqual({ plans: [{ id: plan.id, locuteur: 'pers-karim' }] });
  });

  it('le point « locuteur deviné » n’offre pas « Accepter ainsi » : seulement le choix du locuteur', async () => {
    await ouvrirFilm(faire(AMBIGU, 'personnages'));
    fireEvent.click(etape(4));
    const point = document.querySelector('[data-ecart="locuteur_devine"]') as HTMLElement;
    expect(within(point).queryByRole('button', { name: /Accepter/ })).toBeNull();
    expect(within(point).getByRole('group', { name: 'Qui dit cette réplique ?' })).toBeTruthy();
  });

  it('en mode « une voix raconte », le locuteur n’a aucune importance : aucune clarification demandée', async () => {
    await ouvrirFilm(faire(AMBIGU, 'narrateur'));
    fireEvent.click(etape(4));
    expect(document.querySelector('[data-probleme-audio="locuteur_ambigu"]')).toBeNull();
    expect(document.querySelector('[data-ecart="locuteur_devine"]')).toBeNull();
  });
});
