/**
 * ETAPE 3 « DONNONS VIE A TON HISTOIRE » — un debutant sait quoi faire en quelques secondes.
 *
 * Deux choix clairs (creer avec l'IA / utiliser mes medias), des messages sans jargon de moteur,
 * un apercu vide qui propose l'action de la methode choisie, et surtout : AUCUNE depense ni
 * generation au simple clic. Les protections (ecarts critiques, confirmation, plafonds) restent
 * celles du serveur et du parcours existant.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup, waitFor } from '@testing-library/react';
import CinemaPage from '@/app/dashboard/cinema/page';
import { preparerFilm } from '@/lib/cinema/atelier';
import { monterFilm } from '@/lib/cinema/montage';
import { presenterMontage } from '@/lib/cinema/stockage/presentation';
import { devisFilm } from '@/lib/cinema/couts';
import { ecartsBloquants } from '@/lib/cinema/fidelite';
import { reinitialiserTarifsEcran } from '@/lib/tarifs/client';
import type { Film } from '@/lib/cinema/types';

const HISTOIRE = 'Maya entre dans la salle encore vide. Karim lance le chronometre dans la salle. Maya dit : « Trente secondes, juste trente ». Le dernier plan montre la salle qui s’allume.';
const PERSOS = [{ nom: 'Maya', description: 'cheveux blonds' }, { nom: 'Karim', description: 'chapeau noir' }];
const JARGON = [/\d\/\d media/i, /\d\/\d média/i, /scene\(s\) a reproduire/i, /ecarts? avec votre histoire/i, /Plan \d\/\d/, /Plan \d sur \d/];

let film: Film;
let mode: 'reelle' | 'simulee' | null;
let aReproduire: string[];
let appels: Array<{ url: string; method: string; corps?: any }>;
const zone = () => screen.getByRole('region', { name: /^Etape/ }) as HTMLElement;
const etape = (n: number) => screen.getByRole('button', { name: new RegExp(`^Etape ${n} sur 5`) });

beforeEach(() => {
  reinitialiserTarifsEcran();
  film = preparerFilm({ histoire: HISTOIRE, personnages: PERSOS, idFilm: 'film-guide', titre: 'Guide' });
  mode = 'simulee';
  aReproduire = [];
  appels = [];
  try { localStorage.clear(); } catch { /* sans stockage */ }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); const method = init?.method ?? 'GET';
    appels.push({ url, method, corps: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body });
    const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { 'content-type': 'application/json' } });
    const rep = () => ({ ok: true, film, montage: presenterMontage(monterFilm(film), film.id), scenesAProduire: aReproduire, devis: devisFilm(film, film.scenes.map((s) => s.id)) });
    if (url === '/api/tarifs') return json({ ok: true, prix: { 'ai.generate_background': 5, 'ai.image_to_video': 15 }, exempte: false });
    if (url === '/api/cinema/films' && method === 'GET') return json({ ok: true, generationIa: mode !== null, generationMode: mode, films: [{ id: film.id, titre: film.titre, majLe: film.majLe }] });
    if (url === `/api/cinema/films/${film.id}`) return json(rep());
    if (url.includes('/travaux')) return json({ ok: true, travail: null });
    if (url.endsWith('/medias') && method === 'POST') return json(rep());
    return json({ ok: false, erreur: 'inattendu' }, 404);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function ouvrirScenes() {
  render(<CinemaPage />);
  fireEvent.change(await screen.findByLabelText(/reprendre un film/i), { target: { value: film.id } });
  await screen.findByRole('heading', { name: /Racontez votre idee/ });
  fireEvent.click(etape(3));
}
const ecritures = () => appels.filter((a) => a.method !== 'GET');
const carte = (n: number) => document.querySelectorAll('[data-storyboard="scenes"] > div')[n - 1] as HTMLElement;

describe('B/C. l’arrivee : deux choix clairs, rien d’autre', () => {
  it('le titre et la phrase demandes, sans jargon', async () => {
    await ouvrirScenes();
    expect(within(zone()).getByRole('heading', { name: 'Donnons vie à ton histoire' })).toBeTruthy();
    expect(zone().textContent).toContain('Tes scènes sont préparées. Choisis comment créer les images de ton film.');
    expect(JARGON.some((re) => re.test(zone().textContent ?? ''))).toBe(false);
  });

  it('exactement deux cartes, avec leur icone SVG et leur libelle', async () => {
    await ouvrirScenes();
    const cartes = document.querySelectorAll('[data-methode]');
    expect(cartes).toHaveLength(2);
    expect(within(cartes[0] as HTMLElement).getByText('Créer les images avec l’IA')).toBeTruthy();
    expect(within(cartes[1] as HTMLElement).getByText('Utiliser mes images ou vidéos')).toBeTruthy();
    for (const c of Array.from(cartes)) expect(c.querySelectorAll('svg')).toHaveLength(1);
  });

  it('ni scenes, ni reglages de plan, ni editeur avant le choix', async () => {
    await ouvrirScenes();
    expect(document.querySelector('[data-storyboard]')).toBeNull();
    expect(document.querySelector('[data-plan-editeur]')).toBeNull();
    expect(document.querySelectorAll('select[aria-label="Mouvement de camera de ce plan"]')).toHaveLength(0);
  });

  it('l’apercu vide le dit (« Cette scène n’a pas encore d’image. ») et guide vers le choix, sans lecteur', async () => {
    await ouvrirScenes();
    const apercu = document.querySelector('[data-apercu="scene"]') as HTMLElement;
    expect(apercu.textContent).toContain('Cette scène n’a pas encore d’image.');
    expect(apercu.textContent).toMatch(/Choisis d’abord comment créer tes images/);
    expect(apercu.querySelector('video, img')).toBeNull();
  });

  it('un clic sur l’une ou l’autre carte ne lance AUCUNE requete et ne coute rien', async () => {
    await ouvrirScenes();
    const avant = appels.length;
    fireEvent.click(document.querySelector('[data-methode="ia"]') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: 'Changer de méthode' }));
    fireEvent.click(document.querySelector('[data-methode="import"]') as HTMLElement);
    expect(appels.slice(avant)).toEqual([]);
  });

  it('IA indisponible cote serveur : la carte est desactivee et dit pourquoi', async () => {
    mode = null;
    await ouvrirScenes();
    const ia = document.querySelector('[data-methode="ia"]') as HTMLButtonElement;
    expect(ia.disabled).toBe(true);
    expect(ia.textContent).toMatch(/Pas disponible pour le moment/);
    expect((document.querySelector('[data-methode="import"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('la carte IA annonce le mode demonstration quand il est simule : gratuit, pas de vraie image', async () => {
    await ouvrirScenes();
    expect((document.querySelector('[data-methode="ia"]') as HTMLElement).textContent).toMatch(/Mode démonstration gratuit.*pas de vraies images/);
  });

  it('en mode reel, la carte IA annonce le cout et la confirmation', async () => {
    mode = 'reelle';
    await ouvrirScenes();
    expect((document.querySelector('[data-methode="ia"]') as HTMLElement).textContent).toMatch(/coût.*confirmes avant chaque création/);
  });
});

describe('A-I. le parcours « mes medias »', () => {
  async function choisirImport() {
    await ouvrirScenes();
    fireEvent.click(document.querySelector('[data-methode="import"]') as HTMLElement);
  }

  it('les scenes passent au second niveau : miniatures, un seul apercu, consigne simple', async () => {
    await choisirImport();
    expect(document.querySelector('[data-methode-active="import"]')!.textContent).toMatch(/Choisis une scène, puis ajoute ton image ou ta vidéo/);
    expect(document.querySelectorAll('[data-storyboard="scenes"] [data-vignette]').length).toBe(film.scenes.length);
    expect(document.querySelectorAll('[data-apercu]')).toHaveLength(1);
    expect(document.querySelectorAll('[id^="outils-"]')).toHaveLength(0);
  });

  it('aucun bouton de generation dans cette methode (pas d’IA par erreur)', async () => {
    await choisirImport();
    fireEvent.click(screen.getByLabelText(/Selectionner la scene 1 :/));
    expect(document.querySelectorAll('[data-cinema-generation]')).toHaveLength(0);
  });

  it('les messages sont ceux d’un debutant : « N visuels à préparer », jamais « 0/3 média »', async () => {
    await choisirImport();
    const total = film.scenes.reduce((n, s) => n + s.plans.length, 0);
    expect(document.querySelector('[data-visuels]')!.textContent).toBe(`${total} visuels à préparer dans ${film.scenes.length} scènes.`);
    expect(carte(1).textContent).toMatch(/\d visuels? à préparer/);
    expect(JARGON.some((re) => re.test(zone().textContent ?? ''))).toBe(false);
  });

  it('l’apercu vide propose « Ajouter une image ou une vidéo » ; l’import part pour CE plan, sans appel IA', async () => {
    await choisirImport();
    const action = document.querySelector('[data-action-vide="import"]') as HTMLElement;
    expect(action.textContent).toMatch(/Ajouter une image ou une vidéo/);
    const champ = screen.getByLabelText('Ajouter une image ou une vidéo à cette scène') as HTMLInputElement;
    fireEvent.change(champ, { target: { files: [new File([new Uint8Array([137, 80, 78, 71])], 'photo.png', { type: 'image/png' })] } });
    const post = appels.find((a) => a.url.endsWith('/medias') && a.method === 'POST');
    expect(post).toBeTruthy();
    expect((post!.corps as FormData).get('planId')).toBe(film.scenes[0].plans[0].id);
    expect(appels.some((a) => /generation|produire/.test(a.url))).toBe(false);
  });

  it('« Ajouter au premier visuel manquant » selectionne sans rien envoyer', async () => {
    await choisirImport();
    const avant = appels.length;
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter au premier visuel manquant' }));
    expect(document.querySelectorAll('[id^="outils-"]')).toHaveLength(1);
    expect(appels.length).toBe(avant);
  });

  it('la methode choisie est conservee en changeant d’etape, et au rechargement du film', async () => {
    await choisirImport();
    fireEvent.click(etape(4)); fireEvent.click(etape(1)); fireEvent.click(etape(3));
    expect(document.querySelector('[data-methode-active="import"]')).not.toBeNull();
    cleanup();
    await ouvrirScenes();
    expect(document.querySelector('[data-methode-active="import"]')).not.toBeNull();
  });

  it('« Changer de méthode » revient aux deux choix', async () => {
    await choisirImport();
    fireEvent.click(screen.getByRole('button', { name: 'Changer de méthode' }));
    expect(document.querySelectorAll('[data-methode]')).toHaveLength(2);
    expect(document.querySelector('[data-storyboard]')).toBeNull();
  });

  it('un film qui a deja des medias importes retrouve sa methode sans redemander', async () => {
    film.scenes[0].plans[0].media = { url: 'cinema/film-guide/p.png', genre: 'image', largeur: 1280, hauteur: 720, dureeS: null, octets: 10, origine: 'import' };
    await ouvrirScenes();
    expect(document.querySelector('[data-methode-active="import"]')).not.toBeNull();
    expect(document.querySelector('[data-choix-methode]')).toBeNull();
  });

  it('une scene a mettre a jour l’explique, en mots simples', async () => {
    aReproduire = [film.scenes[0].id];
    await choisirImport();
    const note = document.querySelector('[data-a-mettre-a-jour]') as HTMLElement;
    expect(note.textContent).toMatch(/Une scène doit être mise à jour : son contenu a changé depuis la dernière version de la vidéo/);
    expect(carte(1).textContent).toMatch(/à mettre à jour/);
    expect(zone().textContent).not.toMatch(/a reproduire/i);
  });
});

describe('le parcours « créer avec l’IA » : rien ne part sans confirmation', () => {
  async function choisirIA() {
    await ouvrirScenes();
    fireEvent.click(document.querySelector('[data-methode="ia"]') as HTMLElement);
  }

  it('mode REEL : cout previsionnel = nombre de visuels x prix, et « rien n’est débité » avant confirmation', async () => {
    mode = 'reelle';
    await choisirIA();
    const total = film.scenes.reduce((n, s) => n + s.plans.length, 0);
    const cout = document.querySelector('[data-cout-previsionnel]') as HTMLElement;
    await waitFor(() => expect(cout.textContent).toContain(`${total * 5} crédits pour ${total} images`));
    expect(cout.textContent).toMatch(/5 crédits chacune/);
    expect(cout.textContent).toMatch(/Rien n’est débité tant que tu n’as pas confirmé chaque image/);
  });

  it('pas de generation groupee simulee : le panneau guide vers un visuel a la fois', async () => {
    mode = 'reelle';
    await choisirIA();
    expect(document.querySelector('[data-methode-active="ia"]')!.textContent).toMatch(/Studiio crée un visuel à la fois/);
  });

  it('mode SIMULE : annonce « démonstration gratuite », aucun cout, aucun faux espoir de vraie image', async () => {
    await choisirIA();
    const cout = document.querySelector('[data-cout-previsionnel]') as HTMLElement;
    expect(cout.textContent).toMatch(/Démonstration gratuite : aucun crédit.*pas de vraies images/);
    expect(cout.textContent).not.toMatch(/crédits pour/);
  });

  it('« Commencer par le premier visuel » selectionne sans generer', async () => {
    mode = 'reelle';
    await choisirIA();
    const avant = appels.length;
    fireEvent.click(screen.getByRole('button', { name: 'Commencer par le premier visuel' }));
    expect(document.querySelectorAll('[data-cinema-generation="image"]')).toHaveLength(1);
    expect(appels.slice(avant)).toEqual([]);
  });

  it('mode REEL, ecarts critiques acceptes : l’etoile ouvre la CONFIRMATION avec le prix, sans rien envoyer', async () => {
    mode = 'reelle';
    film.ecartsAcceptes = ecartsBloquants(film).map((e) => e.cle);
    await choisirIA();
    fireEvent.click(screen.getByRole('button', { name: 'Commencer par le premier visuel' }));
    const etoile = document.querySelector('[data-cinema-generation="image"]') as HTMLButtonElement;
    fireEvent.click(etoile);
    fireEvent.click(etoile);
    expect(screen.getAllByRole('group', { name: /confirmer la generation payante/i })).toHaveLength(1);
    expect(screen.getByRole('group', { name: /confirmer la generation payante/i }).textContent).toMatch(/5 crédits/);
    expect(ecritures().some((a) => /generation/.test(a.url))).toBe(false);
  });

  it('mode REEL, ecarts critiques NON acceptes : le panneau les signale et la generation payante est refusee', async () => {
    mode = 'reelle';
    expect(ecartsBloquants(film).length).toBeGreaterThan(0);
    await choisirIA();
    const note = document.querySelector('[data-points-a-verifier]') as HTMLElement;
    expect(note.textContent).toMatch(/\d points? à vérifier dans ton histoire avant de créer des images payantes/);
    fireEvent.click(screen.getByRole('button', { name: 'Commencer par le premier visuel' }));
    fireEvent.click(document.querySelector('[data-cinema-generation="image"]') as HTMLButtonElement);
    expect(screen.queryByRole('group', { name: /confirmer la generation payante/i })).toBeNull();
    expect(document.body.textContent).toMatch(/à vérifier dans ton histoire avant de créer des images payantes : ouvre l’étape Aperçu/);
    expect(appels.some((a) => /generation/.test(a.url))).toBe(false);
  });

  it('« Voir les points » mene directement a leur explication (etape Aperçu)', async () => {
    mode = 'reelle';
    await choisirIA();
    fireEvent.click(screen.getByRole('button', { name: 'Voir les points' }));
    expect(within(zone()).getByRole('heading', { name: /Verifiez avant de generer/ })).toBeTruthy();
    expect(zone().querySelector('[data-ecarts-liste]')).not.toBeNull();
  });

  it('l’apercu vide propose « Préparer l’image avec l’IA » : une selection, pas une generation', async () => {
    await choisirIA();
    const avant = appels.length;
    fireEvent.click(document.querySelector('[data-action-vide="ia"]') as HTMLElement);
    expect(document.querySelectorAll('[id^="outils-"]')).toHaveLength(1);
    expect(appels.length).toBe(avant);
  });
});

describe('les points a verifier : ce qui se passe, pourquoi, quoi faire — jamais d’acceptation aveugle', () => {
  it('un lieu non cite : l’explication, le conseil, et un bouton qui dit sa consequence', async () => {
    film = preparerFilm({ histoire: 'Maya sourit. Karim la regarde. Maya parle. Karim part.', personnages: PERSOS, idFilm: 'film-guide', titre: 'Guide' });
    await ouvrirScenes();
    fireEvent.click(document.querySelector('[data-methode="import"]') as HTMLElement);
    fireEvent.click(screen.getByLabelText(/Selectionner la scene 1 :/));
    const item = document.querySelector('[data-ecarts-scene] [data-ecart="lieu_substitue"]') as HTMLElement;
    expect(item.textContent).toMatch(/Ton histoire ne dit pas où se passe cette scène/);
    expect(item.textContent).toMatch(/Pour le régler : Cite le lieu/);
    expect(within(item).getByRole('button', { name: 'Modifier mon histoire' })).toBeTruthy();
    const accepter = within(item).getByRole('button', { name: /Accepter cet ecart : .*décor neutre/ });
    expect(accepter.textContent).toBe('Accepter ainsi');
    expect(item.textContent).toMatch(/décor neutre, choisi par Studiio/);
  });

  it('« Modifier mon histoire » ramene au texte ; « Accepter ainsi » n’est jamais automatique', async () => {
    film = preparerFilm({ histoire: 'Maya sourit. Karim la regarde. Maya parle. Karim part.', personnages: PERSOS, idFilm: 'film-guide', titre: 'Guide' });
    await ouvrirScenes();
    fireEvent.click(document.querySelector('[data-methode="import"]') as HTMLElement);
    fireEvent.click(screen.getByLabelText(/Selectionner la scene 1 :/));
    expect(appels.some((a) => a.method === 'PATCH')).toBe(false);
    expect(film.ecartsAcceptes).toBeUndefined();
    fireEvent.click(within(document.querySelector('[data-ecart="lieu_substitue"]') as HTMLElement).getByRole('button', { name: 'Modifier mon histoire' }));
    expect(within(zone()).getByRole('heading', { name: /Racontez votre idee/ })).toBeTruthy();
  });
});

describe('F. « Continuer » : on voit ce qui manque, on n’est jamais bloque, rien de payant ne part', () => {
  it('le pied de page dit combien de visuels manquent et que l’on peut continuer', async () => {
    film.ecartsAcceptes = ecartsBloquants(film).map((e) => e.cle);
    await ouvrirScenes();
    fireEvent.click(document.querySelector('[data-methode="import"]') as HTMLElement);
    const total = film.scenes.reduce((n, s) => n + s.plans.length, 0);
    expect(document.querySelector('[data-indice-pied]')!.textContent).toBe(`${total} visuels à préparer · tu peux continuer`);
  });

  it('s’il y a des points a verifier, le pied les annonce (et ne les accepte pas)', async () => {
    await ouvrirScenes();
    fireEvent.click(document.querySelector('[data-methode="import"]') as HTMLElement);
    expect(document.querySelector('[data-indice-pied]')!.textContent).toMatch(/\d points? à vérifier dans ton histoire/);
    expect(film.ecartsAcceptes).toBeUndefined();
  });

  it('cliquer « Continuer » avec des visuels manquants passe a l’etape suivante, sans aucune ecriture', async () => {
    await ouvrirScenes();
    fireEvent.click(document.querySelector('[data-methode="ia"]') as HTMLElement);
    const avant = appels.length;
    fireEvent.click(screen.getByRole('button', { name: /^Continuer/ }));
    expect(within(zone()).getByRole('heading', { name: /Verifiez avant de generer/ })).toBeTruthy();
    expect(appels.slice(avant).filter((a) => a.method !== 'GET')).toEqual([]);
  });

  it('avant le choix, le pied garde l’indicateur d’etape habituel', async () => {
    await ouvrirScenes();
    expect(document.querySelector('[data-indice-pied]')).toBeNull();
    expect(screen.getByText(/Etape 3 sur 5/)).toBeTruthy();
  });
});
