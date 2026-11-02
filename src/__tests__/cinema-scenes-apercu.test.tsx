/**
 * ETAPE SCENES : un SEUL apercu, des miniatures a gauche, un editeur par plan, de vrais portraits.
 *
 * Ce qui est eprouve : un clic sur une miniature change le lecteur unique ; une scene n'altere
 * jamais une autre ; un media dit d'ou il vient (importe / simulation) ; un portrait est une
 * vraie photo de reference ou une icone neutre, jamais un faux visage ; aucune action ne declenche
 * d'appel IA sans geste explicite.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import CinemaPage from '@/app/dashboard/cinema/page';
import ApercuScene, { provenanceMedia, type SceneAffichee } from '@/components/cinema/ApercuScene';
import PortraitPersonnage, { aUnePhoto } from '@/components/cinema/PortraitPersonnage';
import { preparerFilm } from '@/lib/cinema/atelier';
import { monterFilm } from '@/lib/cinema/montage';
import { presenterMontage } from '@/lib/cinema/stockage/presentation';
import { devisFilm } from '@/lib/cinema/couts';
import type { Film } from '@/lib/cinema/types';

const HISTOIRE = 'Nina entre dans la salle. Marco dit : « je ne reculerai pas ». Nina sourit dans la salle. Le jour se leve sur la salle.';
const MEDIA_IMPORT = { url: 'cinema/film-sc/s1-p-1.png', genre: 'image' as const, largeur: 1280, hauteur: 720, dureeS: null, octets: 4000, origine: 'import' as const };
const MEDIA_SIMULE = { url: 'cinema/film-sc/s2-p-1.png', genre: 'image' as const, largeur: 360, hauteur: 640, dureeS: null, octets: 900, origine: 'genere' as const, fournisseurGeneration: 'simule' };

function fabriquer(): Film {
  const f = preparerFilm({ histoire: HISTOIRE, personnages: [{ nom: 'Nina', description: 'veste rouge' }, { nom: 'Marco', description: 'ceinture noire' }], idFilm: 'film-sc', titre: 'Scenes' });
  const nina = f.personnages[0];
  nina.references = [{ id: 'ref-nina', version: 1, description: 'veste rouge', urlImage: 'cinema/film-sc/ref/nina.jpg', creeeLe: '2026-11-02T00:00:00Z' }];
  nina.referenceActiveId = 'ref-nina';
  f.scenes[0].plans[0].media = MEDIA_IMPORT;
  f.scenes[1].plans[0].media = MEDIA_SIMULE;
  return f;
}
let film: Film;
let appels: Array<{ url: string; method: string; corps?: any }>;

beforeEach(() => {
  film = fabriquer();
  appels = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); const method = init?.method ?? 'GET';
    appels.push({ url, method, corps: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body });
    const json = (c: unknown, status = 200) => new Response(JSON.stringify(c), { status, headers: { 'content-type': 'application/json' } });
    const rep = () => ({ ok: true, film, montage: presenterMontage(monterFilm(film), film.id), scenesAProduire: [], devis: devisFilm(film, film.scenes.map((s) => s.id)) });
    if (url === '/api/tarifs') return json({ ok: true, prix: {}, exempte: false });
    if (url === '/api/cinema/films' && method === 'GET') return json({ ok: true, generationIa: false, generationMode: null, films: [{ id: film.id, titre: film.titre, majLe: film.majLe }] });
    if (url === `/api/cinema/films/${film.id}`) return json(rep());
    if (url.includes('/travaux')) return json({ ok: true, travail: null });
    if (url.endsWith('/references') && method === 'POST') return json(rep());
    return json({ ok: false, erreur: 'inattendu' }, 404);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const etape = (n: number) => screen.getByRole('button', { name: new RegExp(`^Etape ${n} sur 5`) });
async function ouvrirScenes() {
  render(<CinemaPage />);
  fireEvent.change(await screen.findByLabelText(/reprendre un film/i), { target: { value: film.id } });
  await screen.findByRole('heading', { name: /Racontez votre idee/ });
  fireEvent.click(etape(3));
}
const apercu = () => document.querySelector('[data-apercu]') as HTMLElement;
const carte = (n: number) => document.querySelectorAll('[data-storyboard="scenes"] > div')[n - 1] as HTMLElement;

describe('UN SEUL apercu, a droite', () => {
  it('un seul apercu dans la colonne de droite, et aucune carte media secondaire ni miniature en double', async () => {
    await ouvrirScenes();
    const colonne = document.querySelector('[aria-label="Apercu permanent"]') as HTMLElement;
    expect(colonne.querySelectorAll('[data-apercu]')).toHaveLength(1);
    expect(apercu().getAttribute('data-apercu')).toBe('scene');
    expect(colonne.querySelectorAll('[data-vignette]')).toHaveLength(0);
    expect(colonne.textContent).not.toMatch(/Relancer le rendu de la scene affichee/);
    expect(colonne.querySelectorAll('[role="tablist"]')).toHaveLength(0);
  });

  it('par defaut : la scene 1, et son VRAI media (adresse servie par l’API, ratio reel, contain)', async () => {
    await ouvrirScenes();
    expect(apercu().getAttribute('data-scene-id')).toBe(film.scenes[0].id);
    const img = apercu().querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(`/api/cinema/films/film-sc/medias/${film.scenes[0].plans[0].id}`);
    expect(img.style.objectFit).toBe('contain');
    expect(apercu().querySelector('[data-ratio-media]')!.getAttribute('data-ratio-media')).toBe('1.778');
  });

  it('cliquer la miniature de la scene 2 met a jour LE MEME apercu, sans appel reseau, et les outils ne concernent qu’elle', async () => {
    await ouvrirScenes();
    const avant = appels.length;
    fireEvent.click(screen.getByLabelText(/Selectionner la scene 2 :/));
    expect(apercu().getAttribute('data-scene-id')).toBe(film.scenes[1].id);
    expect(document.querySelectorAll('[data-apercu]')).toHaveLength(1);
    expect(within(apercu()).getByRole('heading').textContent).toMatch(/^02/);
    expect(document.querySelectorAll('[id^="outils-"]')).toHaveLength(1);
    expect(document.getElementById(`outils-${film.scenes[1].id}`)).not.toBeNull();
    expect(appels.slice(avant)).toEqual([]);
    expect(carte(2).getAttribute('data-selectionnee')).toBe('oui');
    expect(carte(1).getAttribute('data-selectionnee')).toBe('non');
  });

  it('visiter la scene 2 ne touche pas a la scene 1 : medias et plan courant conserves', async () => {
    await ouvrirScenes();
    const avant = JSON.stringify(film.scenes[0]);
    fireEvent.click(screen.getByLabelText(/Selectionner la scene 2 :/));
    fireEvent.click(screen.getByLabelText(/Selectionner la scene 3 :/));
    fireEvent.click(screen.getByLabelText(/Selectionner la scene 1 :/));
    expect(JSON.stringify(film.scenes[0])).toBe(avant);
    expect(apercu().querySelector('img')).not.toBeNull();
    expect(appels.filter((a) => a.method !== 'GET')).toEqual([]);
  });

  it('une scene a plusieurs plans : un seul cadre, des numeros discrets pour naviguer', async () => {
    await ouvrirScenes();
    const nav = within(apercu()).getByRole('group', { name: /Plans de la scene/ });
    const plans = within(nav).getAllByRole('button');
    expect(plans.length).toBe(film.scenes[0].plans.length);
    expect(plans.length).toBeGreaterThan(1);
    expect(apercu().querySelectorAll('[data-cadre-plan]')).toHaveLength(1);
    fireEvent.click(plans[1]);
    expect(apercu().getAttribute('data-plan-id')).toBe(film.scenes[0].plans[1].id);
    // Le plan 2 n'a pas de media : etat neutre explicite, pas de couleur unie presentee comme un film.
    expect(apercu().querySelector('[data-etat="sans-media"]')).not.toBeNull();
    expect(apercu().textContent).toMatch(/Aucun media pour ce plan/);
  });

  it('le plan courant est propre a chaque scene', async () => {
    await ouvrirScenes();
    fireEvent.click(within(apercu()).getAllByRole('button', { name: /^Plan 2 sur/ })[0]);
    fireEvent.click(screen.getByLabelText(/Selectionner la scene 2 :/));
    expect(apercu().getAttribute('data-plan-id')).toBe(film.scenes[1].plans[0].id);
    fireEvent.click(screen.getByLabelText(/Selectionner la scene 1 :/));
    expect(apercu().getAttribute('data-plan-id')).toBe(film.scenes[0].plans[1].id);
  });
});

describe('miniatures a gauche', () => {
  it('chaque miniature montre le vrai media de sa scene, sinon un emplacement neutre', async () => {
    await ouvrirScenes();
    const v1 = carte(1).querySelector('[data-vignette]') as HTMLElement;
    expect(v1.getAttribute('data-vignette')).toBe('media');
    expect(v1.querySelector('img')!.getAttribute('src')).toBe(`/api/cinema/films/film-sc/medias/${film.scenes[0].plans[0].id}`);
    const v3 = carte(3).querySelector('[data-vignette]') as HTMLElement;
    expect(v3.getAttribute('data-vignette')).toBe('vide');
    expect(v3.querySelector('img, video')).toBeNull();
  });

  it('une seule liste compacte, avec numero, titre court, statut', async () => {
    await ouvrirScenes();
    expect(carte(1).textContent).toMatch(/01 · /);
    expect(carte(1).textContent).toMatch(/Brouillon|Validee|A reproduire/);
    expect(document.querySelectorAll('[data-storyboard="scenes"]')).toHaveLength(1);
    // Aucun outil tant qu'on n'a pas clique : la liste reste compacte.
    expect(document.querySelectorAll('[id^="outils-"]')).toHaveLength(0);
  });
});

describe('un media dit d’ou il vient', () => {
  it('un fichier importe est « importe » ; le fournisseur simule est une SIMULATION, jamais « importe »', () => {
    expect(provenanceMedia(MEDIA_IMPORT)).toMatchObject({ cle: 'import', libelle: 'Media importe' });
    expect(provenanceMedia(MEDIA_SIMULE).cle).toBe('simule');
    expect(provenanceMedia(MEDIA_SIMULE).libelle).toMatch(/Simulation locale/);
    expect(provenanceMedia(MEDIA_SIMULE).libelle).not.toMatch(/importe/i);
    expect(provenanceMedia({ ...MEDIA_SIMULE, fournisseurGeneration: 'replicate' }).cle).toBe('genere');
    expect(provenanceMedia(null).cle).toBe('aucun');
  });

  it('la scene 2 (media simule) porte le badge « Simulation » et le libelle honnete', async () => {
    await ouvrirScenes();
    fireEvent.click(screen.getByLabelText(/Selectionner la scene 2 :/));
    expect(apercu().textContent).toMatch(/Simulation/);
    expect(apercu().querySelector('[data-provenance="simule"]')!.textContent).toMatch(/Simulation locale \(aplat de couleur\)/);
    expect(apercu().querySelector('[data-provenance="import"]')).toBeNull();
    // Le cadre suit le VRAI format du media (9:16), pas celui du projet (16:9).
    expect(apercu().querySelector('[data-ratio-media]')!.getAttribute('data-ratio-media')).toBe('0.563');
  });
});

describe('l’apercu de scene : cadre au format reel, jamais deforme', () => {
  const scene: SceneAffichee = { id: 's', index: 0, titre: 'T', plans: [{ id: 'p', cadre: 'moyen', description: 'd', dialogue: null, media: { ...MEDIA_IMPORT, genre: 'video' } }] };
  it('une video 16:9 dans un projet 9:16 garde son ratio 16:9 et object-fit: contain', () => {
    render(<ApercuScene filmId="f" scene={scene} planIndex={0} surPlan={() => {}} agrandi={false} surAgrandir={() => {}} surReduire={() => {}} />);
    expect(document.querySelector('[data-ratio-media]')!.getAttribute('data-ratio-media')).toBe('1.778');
    expect((document.querySelector('video') as HTMLVideoElement).style.objectFit).toBe('contain');
  });
  it('sans media dans un projet 9:16 : cadre neutre 16:9 (pas un grand rectangle vertical), etat explicite', () => {
    render(<ApercuScene filmId="f" scene={{ ...scene, plans: [{ ...scene.plans[0], media: null }] }} planIndex={0} surPlan={() => {}} agrandi={false} surAgrandir={() => {}} surReduire={() => {}} />);
    expect(document.querySelector('[data-ratio-media]')!.getAttribute('data-ratio-media')).toBe('1.778');
    expect(document.body.textContent).toMatch(/Aucun media pour ce plan/);
    expect(document.querySelector('video, img')).toBeNull();
  });
  it('agrandi : une fenetre dans <body>, Echap referme, aucun menu de telechargement natif', () => {
    const reduire = vi.fn();
    render(<ApercuScene filmId="f" scene={scene} planIndex={0} surPlan={() => {}} agrandi surAgrandir={() => {}} surReduire={reduire} />);
    const fenetre = screen.getByRole('dialog');
    expect(fenetre.parentElement).toBe(document.body);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(reduire).toHaveBeenCalled();
    for (const v of Array.from(document.querySelectorAll('video'))) {
      expect(v.hasAttribute('controls')).toBe(false);
      expect(v.getAttribute('controlslist')).toMatch(/nodownload/);
    }
  });
});

describe('portraits : la vraie photo de reference, jamais un faux visage', () => {
  it('Nina (photo importee) montre sa photo ; Marco (aucune) montre une icone neutre', async () => {
    await ouvrirScenes();
    fireEvent.click(screen.getByLabelText(/Selectionner la scene 1 :/));
    const groupe = screen.getByRole('group', { name: /Personnages de ce plan/ });
    const nina = within(groupe).getByRole('button', { name: /^Nina/ });
    const marco = within(groupe).getByRole('button', { name: /^Marco/ });
    expect(nina.getAttribute('data-portrait')).toBe('photo');
    expect(nina.querySelector('img')!.getAttribute('src')).toBe('/api/cinema/films/film-sc/references/' + film.personnages[0].id);
    expect(marco.getAttribute('data-portrait')).toBe('neutre');
    expect(marco.querySelector('img')).toBeNull();
    expect(marco.querySelector('svg')).not.toBeNull();
    expect(marco.getAttribute('title')).toMatch(/aucune photo de reference/);
  });

  it('cliquer un portrait lie / delie le personnage au PLAN (PATCH), sans aucun appel IA', async () => {
    await ouvrirScenes();
    fireEvent.click(screen.getByLabelText(/Selectionner la scene 1 :/));
    const groupe = screen.getByRole('group', { name: /Personnages de ce plan/ });
    const marco = within(groupe).getByRole('button', { name: /^Marco/ });
    const avant = marco.getAttribute('aria-pressed');
    fireEvent.click(marco);
    const patch = appels.find((a) => a.method === 'PATCH');
    expect(patch).toBeTruthy();
    expect(patch!.corps.plans[0].id).toBe(film.scenes[0].plans[0].id);
    expect(patch!.corps.plans[0].personnages).toBeInstanceOf(Array);
    expect(avant).toBeDefined();
    expect(appels.some((a) => /generation|produire|travaux/.test(a.url) && a.method !== 'GET')).toBe(false);
  });

  it('ajouter une photo : un import de fichier (octets) vers /references, aucune generation', async () => {
    await ouvrirScenes();
    fireEvent.click(screen.getByLabelText(/Selectionner la scene 1 :/));
    fireEvent.click(document.querySelector('details[data-avance="scene"] summary') as HTMLElement);
    const champ = screen.getByLabelText(/Ajouter une photo de reference pour Marco/) as HTMLInputElement;
    fireEvent.change(champ, { target: { files: [new File([new Uint8Array([137, 80, 78, 71])], 'marco.png', { type: 'image/png' })] } });
    const post = appels.find((a) => a.url.endsWith('/references') && a.method === 'POST');
    expect(post).toBeTruthy();
    expect(post!.corps).toBeInstanceOf(FormData);
    expect((post!.corps as FormData).get('personnageId')).toBe(film.personnages[1].id);
    expect(appels.some((a) => /generation|produire/.test(a.url))).toBe(false);
  });

  it('une photo qui ne se charge pas retombe sur l’icone neutre', () => {
    const p = film.personnages[0];
    render(<PortraitPersonnage filmId="film-sc" personnage={p} selectionne surClic={() => {}} />);
    const img = document.querySelector('img') as HTMLImageElement;
    fireEvent.error(img);
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('[data-portrait]')!.getAttribute('data-portrait')).toBe('neutre');
  });

  it('aUnePhoto : lit la reference ACTIVE', () => {
    const p = film.personnages[0];
    expect(aUnePhoto(p)).toBe(true);
    expect(aUnePhoto({ ...p, referenceActiveId: null, references: [{ id: 'x', urlImage: null }] })).toBe(false);
    expect(aUnePhoto({ ...p, references: [] })).toBe(false);
  });
});

describe('editeur du plan : peu d’outils, des icones nommees', () => {
  it('un seul plan edite ; chaque action est une icone avec libelle et infobulle', async () => {
    await ouvrirScenes();
    fireEvent.click(screen.getByLabelText(/Selectionner la scene 1 :/));
    const editeur = document.querySelector('[data-plan-editeur]') as HTMLElement;
    expect(document.querySelectorAll('[data-plan-editeur]')).toHaveLength(1);
    const actions = within(editeur).getByRole('group', { name: /Media du plan/ });
    for (const b of Array.from(actions.querySelectorAll('button, label'))) {
      expect(b.getAttribute('aria-label') || b.getAttribute('title')).toBeTruthy();
      expect(b.querySelector('svg')).not.toBeNull();
    }
    // Pas de gros bouton « Importer une image ou une video » en toutes lettres.
    expect(within(editeur).queryByText(/Importer une image ou une video/)).toBeNull();
  });

  it('retirer un media demande confirmation ; « Non » ne change rien, « Oui » envoie media: null', async () => {
    await ouvrirScenes();
    fireEvent.click(screen.getByLabelText(/Selectionner la scene 1 :/));
    fireEvent.click(screen.getByRole('button', { name: 'Retirer le media de ce plan' }));
    expect(screen.getByRole('group', { name: /Confirmer le retrait du media/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Annuler le retrait' }));
    expect(appels.some((a) => a.method === 'PATCH')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Retirer le media de ce plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le retrait' }));
    const patch = appels.find((a) => a.method === 'PATCH')!;
    expect(patch.corps.plans[0]).toEqual({ id: film.scenes[0].plans[0].id, media: null });
  });

  it('les reglages secondaires sont dans UN seul panneau « Options avancees », replie', async () => {
    await ouvrirScenes();
    fireEvent.click(screen.getByLabelText(/Selectionner la scene 1 :/));
    const avances = document.querySelectorAll('details[data-avance="scene"]');
    expect(avances).toHaveLength(1);
    expect((avances[0] as HTMLDetailsElement).open).toBe(false);
    expect(avances[0].textContent).toMatch(/Duree/);
    expect(avances[0].textContent).toMatch(/Photos de reference/);
  });

  it('choisir un mouvement affiche son extrait DANS l’apercu unique, puis changer de scene revient au film', async () => {
    await ouvrirScenes();
    fireEvent.click(screen.getByLabelText(/Selectionner la scene 1 :/));
    fireEvent.change(document.querySelector('select[aria-label="Mouvement de camera de ce plan"]') as HTMLSelectElement, { target: { value: 'pano_droite' } });
    expect(document.querySelectorAll('[data-apercu]')).toHaveLength(1);
    expect(apercu().getAttribute('data-apercu')).toBe('exemple');
    expect(apercu().querySelector('video')!.getAttribute('src')).toBe('/cinema-mouvements/panoramique.mp4');
    fireEvent.click(screen.getByLabelText(/Selectionner la scene 2 :/));
    expect(apercu().getAttribute('data-apercu')).toBe('scene');
  });
});

describe('etapes suivantes : le montage garde son apercu', () => {
  it('a l’etape Apercu, l’apercu unique est le montage (lecture, voix) ; la scene n’y est plus doublee', async () => {
    await ouvrirScenes();
    fireEvent.click(etape(4));
    expect(document.querySelectorAll('[data-apercu="scene"]')).toHaveLength(0);
    expect(document.body.textContent).toMatch(/Lire le montage/);
  });
});
