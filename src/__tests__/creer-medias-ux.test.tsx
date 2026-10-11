/**
 * MÉDIAS DANS CRÉER — l'utilisateur cherche, regarde, puis ajoute.
 *
 * Règle produit : il ne choisit ni ne voit de fournisseur technique. Les
 * noms des banques d'images n'apparaissent QUE dans les crédits exigés par
 * leurs conditions (ligne discrète sous les résultats, « Informations du
 * média » dans l'aperçu).
 *
 * - Photo d'affiche : une seule recherche (`/api/pexels?source=both`).
 * - Médias suggérés : filtres par TYPE, puces françaises / requêtes anglaises,
 *   cartes « Aperçu » / « Ajouter » ; un clic sur une vignette sélectionne et
 *   prévisualise, sans ajouter ni ouvrir d'onglet.
 * - Colonne de droite : « Aperçu du média » ↔ aperçu du projet.
 * - Panneaux d'édition : Dupliquer / Regrouper / Dissocier (fonctions
 *   existantes), grisés avec une raison quand ils ne s'appliquent pas.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { MediaStock } from '@/lib/stock/types';
import { construireRecherchesStock, traduireRequete } from '@/lib/stock/requetes';
import RechercheStockSequence from '@/components/creer/RechercheStockSequence';
import ApercuMedia from '@/components/creer/ApercuMedia';
import ActionsEdition from '@/components/creer/ActionsEdition';
import { Copy } from 'lucide-react';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;
const playSpy = vi.fn(() => Promise.resolve());
const pauseSpy = vi.fn();
Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: playSpy });
Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: pauseSpy });

let sessionState: { data: unknown; status: string };
let urlQuery: URLSearchParams;
vi.mock('next-auth/react', () => ({ useSession: () => sessionState }));
vi.mock('next/navigation', () => ({ useSearchParams: () => urlQuery }));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});
vi.mock('@/lib/icons/prerender', () => ({ preRenderCardIcons: async (c: unknown) => c }));

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';

const media = (id: string, o: Partial<MediaStock> = {}): MediaStock => ({
  id: `pexels-video-${id}`, provider: 'pexels', providerAssetId: id, type: 'video',
  largeur: 1080, hauteur: 1920, orientation: 'portrait', dureeSecondes: 16,
  vignetteUrl: `https://images.pexels.test/${id}.jpg`, apercuUrl: `https://images.pexels.test/${id}-m.jpg`,
  fichierUrl: `https://videos.pexels.test/${id}-hd.mp4`, sourceUrl: `https://www.pexels.com/video/${id}/`,
  auteur: 'Ada', description: 'dance', licence: 'Pexels License', attribution: 'Vidéo de Ada sur Pexels',
  ...o,
});
const photo = (id: string, o: Partial<MediaStock> = {}): MediaStock => media(id, {
  id: `unsplash-photo-${id}`, provider: 'unsplash', type: 'photo', dureeSecondes: undefined,
  fichierUrl: `https://images.unsplash.test/${id}.jpg`, sourceUrl: `https://unsplash.com/photos/${id}`,
  auteur: 'Grace', attribution: 'Photo de Grace sur Unsplash', ...o,
});

interface Appel { url: string; method: string; body: Record<string, unknown> | null }
let appels: Appel[];

function installerFetch(opts: { videos?: MediaStock[]; photos?: MediaStock[]; posters?: unknown[] } = {}) {
  appels = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    let body: Record<string, unknown> | null = null;
    if (typeof init?.body === 'string') { try { body = JSON.parse(init.body); } catch { body = null; } }
    appels.push({ url: u, method: m, body });
    const rep = (corps: unknown, status = 200) => ({
      ok: status >= 200 && status < 300, status, json: async () => corps, text: async () => JSON.stringify(corps),
    } as unknown as Response);
    if (u.startsWith('/api/stock/recherche')) {
      const type = new URLSearchParams(u.split('?')[1]).get('type');
      const medias = type === 'video' ? (opts.videos ?? []) : (opts.photos ?? []);
      return rep({ success: true, medias, echecs: [], requete: 'q' });
    }
    if (u.startsWith('/api/stock/importer')) {
      const b = body as { providerAssetId?: string; type?: string } | null;
      const tous = [...(opts.videos ?? []), ...(opts.photos ?? [])];
      const trouve = tous.find((x) => x.providerAssetId === b?.providerAssetId);
      return rep({ success: true, url: `https://studiio.test/media/${b?.providerAssetId}.${b?.type === 'video' ? 'mp4' : 'jpg'}`, media: trouve, importe: true });
    }
    if (u.startsWith('/api/pexels')) return rep({ success: true, photos: opts.posters ?? [] });
    if (u.includes('/api/credits/balance')) return rep({ ok: true, politique: 'credits', balance: 5000 });
    if (u.includes('/api/render/tarifs')) return rep({ ok: true, politique: 'credits', tarifs: { reel: 10, tv: 15 } });
    return rep({ success: true, data: [], posts: [], content: {}, images: [], photos: [] });
  }) as unknown as typeof fetch;
}

const attendre = async (tours = 6) => {
  for (let i = 0; i < tours; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

/** Texte visible d'un conteneur, crédits exclus. */
function texteHorsCredits(el: Element): string {
  const copie = el.cloneNode(true) as Element;
  copie.querySelectorAll('[data-credit-media], [data-media-infos]').forEach((n) => n.remove());
  return copie.textContent ?? '';
}

let openSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  window.localStorage.clear();
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  urlQuery = new URLSearchParams('');
  window.alert = () => {};
  openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
  playSpy.mockClear();
  pauseSpy.mockClear();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); openSpy.mockRestore(); });

const base = {
  role: 'video' as const, libelleSequence: 'Vidéo', sujet: 'afroboost cardio danse', objectif: 'groupe',
  texte: '', format: '9:16' as const, fondExistant: false,
  onUtiliserPhoto: vi.fn(), onAjouterRush: vi.fn(), onFermer: vi.fn(),
};
const rechercheParams = () => appels.filter((a) => a.url.startsWith('/api/stock/recherche'))
  .map((a) => new URLSearchParams(a.url.split('?')[1]));

// ────────────────────────────────────────────────────────────────────────────
describe('suggestions françaises, requêtes anglaises', () => {
  it('chaque suggestion a un libellé FR et la même requête EN qu’avant (rétro-compatible)', () => {
    const r = construireRecherchesStock({ sujet: 'Afroboost / sport / cardio-danse', texte: 'Le groupe danse avec énergie', role: 'video', format: '9:16' });
    expect(r.suggestions.map((s) => s.requete)).toEqual(r.requetes);
    const libelles = r.suggestions.map((s) => s.libelle);
    expect(libelles).toContain('Femme qui danse');
    expect(libelles).toContain('Cours collectif de danse');
    for (const l of libelles) expect(l).not.toMatch(/\b(workout|dancing|group|woman)\b/);
    // Déterministe.
    expect(construireRecherchesStock({ sujet: 'Afroboost / sport / cardio-danse', texte: 'Le groupe danse avec énergie', role: 'video', format: '9:16' }).suggestions).toEqual(r.suggestions);
  });

  it('une saisie libre en français est traduite par le lexique ; inconnue → texte brut', () => {
    expect(traduireRequete('femme qui danse')).toBe('woman dancing');
    expect(traduireRequete('danse kizomba')).toBe('dance kizomba');
    expect(traduireRequete('sunset beach')).toBe('sunset beach');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('Médias suggérés (panneau isolé)', () => {
  it('titre, aide, recherche « Que recherchez-vous ? », et AUCUN nom de banque hors crédits', async () => {
    installerFetch({ videos: [media('v1')], photos: [photo('p1')] });
    render(<RechercheStockSequence {...base} />);
    await attendre();
    const panneau = document.querySelector('[data-recherche-stock]')!;
    expect(panneau.textContent).toContain('Médias suggérés');
    expect(panneau.textContent).toContain('Trouvez rapidement une photo ou une vidéo adaptée à votre contenu.');
    expect((panneau.querySelector('[data-stock-requete]') as HTMLInputElement).placeholder).toBe('Que recherchez-vous ?');
    expect(panneau.querySelector('[data-stock-chercher]')!.textContent).toContain('Rechercher');
    expect(panneau.textContent).toContain('Cliquez sur un média pour le prévisualiser avant de l’ajouter.');
    // Les cartes : jamais de nom de fichier, jamais de banque.
    expect(texteHorsCredits(panneau)).not.toMatch(/Pexels|Unsplash|\.mp4|\.jpg/i);
    // Le crédit, lui, est là — avec ses liens.
    const credits = panneau.querySelector('[data-stock-credits]')!;
    expect(credits.textContent).toBe('Photos et vidéos fournies par Pexels et Unsplash');
    const liens = Array.from(credits.querySelectorAll('a'));
    expect(liens.map((a) => a.getAttribute('rel'))).toEqual(['noopener noreferrer', 'noopener noreferrer']);
    expect(liens.every((a) => a.getAttribute('target') === '_blank')).toBe(true);
  });

  it('filtres par type : Tout (photos + vidéos), Vidéos, Photos ; vidéo → une seule banque', async () => {
    installerFetch({ videos: [media('v1')], photos: [photo('p1')] });
    render(<RechercheStockSequence {...base} />);
    await attendre();
    const chips = Array.from(document.querySelectorAll('[data-stock-type]')).map((b) => b.textContent);
    expect(chips).toEqual(['Tout', 'Vidéos', 'Photos']);
    expect(document.querySelector('[data-stock-type="tout"]')!.getAttribute('aria-pressed')).toBe('true');
    expect(rechercheParams().map((p) => p.get('type')).sort()).toEqual(['photo', 'video']);
    expect(document.querySelectorAll('[data-stock-carte]').length).toBe(2);
    const video = rechercheParams().find((p) => p.get('type') === 'video')!;
    expect(video.get('fournisseurs')).toBe('pexels');
    // Photos : aucune banque imposée (le moteur interroge toutes les banques).
    expect(rechercheParams().find((p) => p.get('type') === 'photo')!.get('fournisseurs')).toBeNull();

    appels = [];
    await act(async () => { fireEvent.click(document.querySelector('[data-stock-type="video"]')!); });
    await attendre();
    expect(rechercheParams().map((p) => p.get('type'))).toEqual(['video']);
    expect(Array.from(document.querySelectorAll('[data-stock-carte]')).map((c) => c.getAttribute('data-stock-carte-type'))).toEqual(['video']);

    appels = [];
    await act(async () => { fireEvent.click(document.querySelector('[data-stock-type="photo"]')!); });
    await attendre();
    expect(rechercheParams().map((p) => p.get('type'))).toEqual(['photo']);
    expect(Array.from(document.querySelectorAll('[data-stock-carte]')).map((c) => c.getAttribute('data-stock-carte-type'))).toEqual(['photo']);
  });

  it('zone photo seulement (affiche / fond) : un seul filtre « Photos », jamais de vidéo demandée', async () => {
    installerFetch({ videos: [media('v1')], photos: [photo('p1')] });
    render(<RechercheStockSequence {...base} role="titre" typesAutorises={['photo']} />);
    await attendre();
    expect(Array.from(document.querySelectorAll('[data-stock-type]')).map((b) => b.textContent)).toEqual(['Photos']);
    expect(rechercheParams().every((p) => p.get('type') === 'photo')).toBe(true);
  });

  it('carte vidéo : badge lecture + durée « 0:16 », libellé lisible, boutons Aperçu / Ajouter', async () => {
    installerFetch({ videos: [media('v1')] });
    render(<RechercheStockSequence {...base} typeInitial="video" />);
    await attendre();
    const carte = document.querySelector('[data-stock-carte]')!;
    expect(carte.querySelector('[data-stock-duree]')!.textContent).toBe('0:16');
    expect(carte.textContent).toContain('Vidéo suggérée');
    const apercu = carte.querySelector('[data-stock-apercu]') as HTMLButtonElement;
    const ajouter = carte.querySelector('[data-stock-ajouter]') as HTMLButtonElement;
    expect(apercu.textContent).toBe('Aperçu');
    expect(ajouter.textContent).toBe('Ajouter');
    expect(apercu.getAttribute('aria-label')).toMatch(/Aperçu/);
    expect(ajouter.getAttribute('aria-label')).toMatch(/rushes/);
    // Le nom technique reste dans l'infobulle seulement.
    // L'infobulle parle comme l'utilisateur — jamais l'identifiant du fournisseur.
    expect(carte.querySelector('[data-stock-media]')!.getAttribute('title')).toBe('Vidéo suggérée');
  });

  it('clic sur la vignette : sélection + aperçu ; rien n’est ajouté, aucun onglet, aucune navigation', async () => {
    installerFetch({ videos: [media('v1')] });
    const onAjouterRush = vi.fn();
    const onSelection = vi.fn();
    render(<RechercheStockSequence {...base} typeInitial="video" onAjouterRush={onAjouterRush} onSelection={onSelection} />);
    await attendre();
    const vignette = document.querySelector('[data-stock-media]') as HTMLButtonElement;
    expect(vignette.closest('a')).toBeNull();
    const avant = window.location.href;
    await act(async () => { fireEvent.click(vignette); });
    await attendre(2);
    expect(vignette.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-stock-selection] [data-apercu-media="video"]')).not.toBeNull();
    expect(onSelection).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'pexels-video-v1' }), 'pret');
    expect(onAjouterRush).not.toHaveBeenCalled();
    expect(appels.some((a) => a.url.startsWith('/api/stock/importer'))).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
    expect(window.location.href).toBe(avant);
  });

  it('« Ajouter » ajoute UNE fois, puis « Ajouté » (désactivé)', async () => {
    installerFetch({ videos: [media('v1')] });
    const onAjouterRush = vi.fn();
    render(<RechercheStockSequence {...base} typeInitial="video" onAjouterRush={onAjouterRush} />);
    await attendre();
    const bouton = () => document.querySelector('[data-stock-ajouter]') as HTMLButtonElement;
    await act(async () => { fireEvent.click(bouton()); });
    await attendre();
    await act(async () => { fireEvent.click(bouton()); });
    await attendre();
    expect(appels.filter((a) => a.url === '/api/stock/importer')).toHaveLength(1);
    expect(onAjouterRush).toHaveBeenCalledTimes(1);
    // Nom visible dans la liste des rushes : lisible, jamais un nom de fichier ni une banque.
    expect(onAjouterRush.mock.calls[0][1]).toBe('Vidéo suggérée · 0:16');
    expect(bouton().textContent).toBe('Ajouté');
    expect(bouton().disabled).toBe(true);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('puces françaises à l’écran, requête anglaise envoyée ; saisie libre FR traduite', async () => {
    installerFetch({ videos: [media('v1')] });
    render(<RechercheStockSequence {...base} typeInitial="video" texte="Le groupe danse avec énergie" />);
    await attendre();
    const attendues = construireRecherchesStock({ sujet: base.sujet, objectif: base.objectif, texte: 'Le groupe danse avec énergie', role: 'video', format: '9:16' }).suggestions;
    const puces = Array.from(document.querySelectorAll('[data-stock-suggestion]'));
    expect(puces.map((p) => p.textContent)).toEqual(attendues.map((s) => s.libelle));
    // Le champ montre le français, la première requête part en anglais.
    expect((document.querySelector('[data-stock-requete]') as HTMLInputElement).value).toBe(attendues[0].libelle);
    expect(rechercheParams()[0].get('requete')).toBe(attendues[0].requete);

    const femme = puces.find((p) => p.textContent === 'Femme qui danse')!;
    appels = [];
    await act(async () => { fireEvent.click(femme); });
    await attendre();
    expect(rechercheParams()[0].get('requete')).toBe('woman dancing');

    appels = [];
    const champ = document.querySelector('[data-stock-requete]') as HTMLInputElement;
    await act(async () => { fireEvent.change(champ, { target: { value: 'homme qui court à la plage' } }); });
    await act(async () => { fireEvent.click(document.querySelector('[data-stock-chercher]')!); });
    await attendre();
    expect(rechercheParams()[0].get('requete')).toBe('man running beach');
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('Aperçu du média', () => {
  it('vidéo : muette par défaut, Lecture / Pause, durée, cadre au ratio du projet', async () => {
    render(
      <ApercuMedia
        format="16:9"
        media={{ type: 'video', url: 'https://v.test/a.mp4', libelle: 'Vidéo suggérée', dureeSecondes: 16 }}
        onAjouter={() => {}}
        onRemplacer={() => {}}
        onRetour={() => {}}
      />,
    );
    const v = document.querySelector('[data-apercu-media-video]') as HTMLVideoElement;
    expect(v.muted).toBe(true);
    expect(v.style.objectFit).toBe('cover');
    expect((document.querySelector('[data-apercu-media-cadre]') as HTMLElement).style.aspectRatio).toBe('16 / 9');
    expect(document.querySelector('[data-apercu-media-duree]')!.textContent).toBe('0:00 / 0:16');
    const lecture = document.querySelector('[data-apercu-media-lecture]') as HTMLButtonElement;
    expect(lecture.getAttribute('aria-label')).toBe('Lire la vidéo');
    Object.defineProperty(v, 'paused', { configurable: true, get: () => true });
    await act(async () => { fireEvent.click(lecture); });
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(lecture.getAttribute('aria-label')).toBe('Mettre en pause');
    Object.defineProperty(v, 'paused', { configurable: true, get: () => false });
    await act(async () => { fireEvent.click(lecture); });
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    // Libellés novices.
    expect(document.querySelector('[data-apercu-media-ajouter]')!.textContent).toBe('Ajouter au projet');
    expect(document.querySelector('[data-apercu-media-remplacer]')!.textContent).toBe('Remplacer');
    expect(document.querySelector('[data-apercu-media-retour]')!.textContent).toBe('Retour à l’aperçu du projet');
  });

  it('photo : vraie image en cover ; crédit replié dans « Informations du média »', () => {
    render(
      <ApercuMedia
        format="9:16"
        media={{
          type: 'photo', url: 'https://i.test/p.jpg', libelle: 'Photo suggérée',
          credit: { auteur: 'Grace', sourceUrl: 'https://unsplash.com/photos/p', banque: 'Unsplash', banqueUrl: 'https://unsplash.com/?utm_source=studiio&utm_medium=referral' },
        }}
      />,
    );
    const img = document.querySelector('[data-apercu-media-image]') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://i.test/p.jpg');
    expect(img.style.objectFit).toBe('cover');
    const infos = document.querySelector('[data-media-infos]') as HTMLDetailsElement;
    expect(infos.tagName).toBe('DETAILS');
    expect(infos.open).toBe(false);
    expect(infos.querySelector('summary')!.textContent).toBe('Informations du média');
    expect(infos.querySelector('[data-credit-media]')!.textContent).toBe('Photo de Grace sur Unsplash');
    for (const a of Array.from(infos.querySelectorAll('a'))) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
    // Hors crédit : aucun nom de banque.
    expect(texteHorsCredits(document.querySelector('[data-apercu-media]')!)).not.toMatch(/Unsplash|Pexels/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('Actions d’édition (composant)', () => {
  it('bouton grisé : raison en infobulle, aucun appel ; actif : appelle la fonction donnée', () => {
    const faire = vi.fn();
    const jamais = vi.fn();
    render(
      <ActionsEdition
        nom="Cartes"
        actions={[
          { id: 'dupliquer', libelle: 'Dupliquer', Icone: Copy, onClick: faire, aide: 'Dupliquer la sélection' },
          { id: 'regrouper', libelle: 'Regrouper', Icone: Copy, onClick: jamais, disabled: true, aide: 'Sélectionnez au moins deux cartes' },
        ]}
      />,
    );
    const [d, r] = Array.from(document.querySelectorAll('[data-action-edition]')) as HTMLButtonElement[];
    fireEvent.click(d);
    fireEvent.click(r);
    expect(faire).toHaveBeenCalledTimes(1);
    expect(jamais).not.toHaveBeenCalled();
    expect(r.disabled).toBe(true);
    expect(r.getAttribute('title')).toBe('Sélectionnez au moins deux cartes');
    expect(d.getAttribute('aria-label')).toContain('Dupliquer');
  });
});

// ────────────────────────────────────────────────────────────────────────────
const CLE = draftKey('a@b.c');
const poser = (extra: Record<string, unknown> = {}) => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 1,
    customTopic: 'danse fitness', scheduledDate: '2026-09-01',
    generated: {
      title: 'Danse fitness', subtitle: 'En groupe',
      cards: [
        { id: 'c1', icon: 'Heart', title: 'Cardio', description: 'Bouger', value: '1' },
        { id: 'c2', icon: 'Flame', title: 'Énergie', description: 'Danser', value: '2' },
        { id: 'c3', icon: 'Star', title: 'Plaisir', description: 'Sourire', value: '3' },
      ],
      cta: 'Viens', ctaSub: '',
    },
    ...extra,
  }));
};
const ouvrirSection = async (id: string) => {
  const s = document.querySelector(`button[aria-controls="section-${id}"]`) as HTMLButtonElement;
  expect(s).toBeTruthy();
  if (s.getAttribute('aria-expanded') !== 'true') await act(async () => { fireEvent.click(s); });
};

describe('AssistantWizard — photo d’affiche', () => {
  it('une seule recherche, sans choix de banque ; aide novice ; requête source=both', async () => {
    installerFetch({
      posters: [
        { id: 'pexels-1', source: 'pexels', url: 'https://images.pexels.com/p1.jpg', small: 'https://images.pexels.com/p1-s.jpg', photographer: 'Ada' },
        { id: 'unsplash-2', source: 'unsplash', url: 'https://images.unsplash.com/p2.jpg', small: 'https://images.unsplash.com/p2-s.jpg', photographer: 'Grace' },
      ],
    });
    poser();
    render(<AssistantWizard />);
    await attendre();
    await ouvrirSection('affiche');
    const section = document.getElementById('section-affiche')!;
    expect(section).toBeTruthy();
    expect(section.querySelector('[data-poster-source]')).toBeNull();
    expect(section.textContent).toContain('Choisissez une image pour illustrer votre vidéo.');
    expect(section.textContent).toContain('Décrivez simplement ce que vous voulez montrer.');
    expect((section.querySelector('[data-poster-query]') as HTMLInputElement).placeholder).toBe('Rechercher une photo…');
    const chercher = section.querySelector('[data-poster-search]') as HTMLButtonElement;
    expect(chercher.textContent).toBe('Rechercher');
    await act(async () => { fireEvent.change(section.querySelector('[data-poster-query]')!, { target: { value: 'femme qui danse' } }); });
    await act(async () => { fireEvent.click(chercher); });
    await attendre();
    const req = appels.filter((a) => a.url.startsWith('/api/pexels'));
    expect(req.length).toBeGreaterThan(0);
    expect(req[req.length - 1].url).toContain('source=both');
    expect(section.querySelectorAll('[data-poster-photo]').length).toBe(2);
    // Aucune banque nommée hors du crédit ; le crédit est là.
    expect(texteHorsCredits(section)).not.toMatch(/Pexels|Unsplash/);
    expect(section.querySelector('[data-poster-credits]')!.textContent).toContain('Pexels et Unsplash');
  });
});

describe('AssistantWizard — aperçu du média dans la colonne de droite', () => {
  it('sélection → « Aperçu du média » (projet masqué, pas d’ajout) ; Ajouter au projet ; Retour restaure', async () => {
    installerFetch({ photos: [photo('p1')] });
    poser();
    render(<AssistantWizard />);
    await attendre();
    await ouvrirSection('affiche');
    await act(async () => { fireEvent.click(document.querySelector('[data-ouvrir-stock="fond"]')!); });
    await attendre();
    const panneau = document.querySelector('[data-recherche-stock]')!;
    // Dans la page, pas en fenêtre modale.
    expect(panneau.getAttribute('role')).toBe('region');
    expect(panneau.closest('[data-colonne="travail"]')).not.toBeNull();
    const projet = document.querySelector('[data-colonne-etat="projet"]') as HTMLElement;
    expect(projet.style.display).toBe('');
    expect(document.querySelector('[data-colonne-etat="media"]')).toBeNull();

    await act(async () => { fireEvent.click(document.querySelector('[data-stock-media]')!); });
    await attendre(2);
    const colonne = document.querySelector('[data-colonne="apercu"]')!;
    expect(colonne.querySelector('[data-colonne-etat="media"] [data-apercu-media="photo"]')).not.toBeNull();
    expect(projet.style.display).toBe('none');
    expect(appels.some((a) => a.url.startsWith('/api/stock/importer'))).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();

    // Ajouter depuis la colonne de droite : une fois, puis « Ajouté ».
    const ajouter = () => colonne.querySelector('[data-apercu-media-ajouter]') as HTMLButtonElement;
    await act(async () => { fireEvent.click(ajouter()); });
    await attendre();
    expect(appels.filter((a) => a.url === '/api/stock/importer')).toHaveLength(1);
    await waitFor(() => expect(ajouter().textContent).toBe('Ajouté'));
    expect(ajouter().disabled).toBe(true);

    await act(async () => { fireEvent.click(colonne.querySelector('[data-apercu-media-retour]')!); });
    await attendre(2);
    expect(document.querySelector('[data-colonne-etat="media"]')).toBeNull();
    expect(projet.style.display).toBe('');
  });

  it('fermer le panneau ramène l’aperçu du projet', async () => {
    installerFetch({ photos: [photo('p1')] });
    poser();
    render(<AssistantWizard />);
    await attendre();
    await ouvrirSection('affiche');
    await act(async () => { fireEvent.click(document.querySelector('[data-ouvrir-stock="fond"]')!); });
    await attendre();
    await act(async () => { fireEvent.click(document.querySelector('[data-stock-media]')!); });
    await attendre(2);
    expect(document.querySelector('[data-colonne-etat="media"]')).not.toBeNull();
    await act(async () => { fireEvent.click(document.querySelector('[aria-label="Fermer les médias suggérés"]')!); });
    await attendre(2);
    expect(document.querySelector('[data-recherche-stock]')).toBeNull();
    expect(document.querySelector('[data-colonne-etat="media"]')).toBeNull();
  });
});

describe('AssistantWizard — actions des panneaux d’édition', () => {
  it('Titre : Dupliquer / Regrouper / Dissocier visibles et grisés avec une raison', async () => {
    installerFetch();
    poser();
    render(<AssistantWizard />);
    await attendre();
    await act(async () => { fireEvent.doubleClick(document.querySelector('[data-title-block]')!); });
    await waitFor(() => expect(document.querySelector('[data-zone-panneau="title"]')).toBeTruthy());
    const barre = document.querySelector('[data-zone-panneau="title"] [data-actions-edition]')!;
    const boutons = Array.from(barre.querySelectorAll('[data-action-edition]')) as HTMLButtonElement[];
    expect(boutons.map((b) => b.textContent)).toEqual(['Dupliquer', 'Regrouper', 'Dissocier']);
    expect(boutons.every((b) => b.disabled && !!b.getAttribute('title'))).toBe(true);
  });

  it('Cartes : sans sélection tout est grisé ; deux cartes cochées → Regrouper puis Dissocier', async () => {
    installerFetch();
    poser();
    render(<AssistantWizard />);
    await attendre();
    await act(async () => { fireEvent.doubleClick(document.querySelector('[data-card-id]')!); });
    await waitFor(() => expect(document.querySelector('[data-zone-panneau="cards"]')).toBeTruthy());
    const bouton = (id: string) => document.querySelector(`[data-zone-panneau="cards"] [data-action-edition="${id}"]`) as HTMLButtonElement;
    expect(bouton('dupliquer').disabled).toBe(true);
    expect(bouton('regrouper').disabled).toBe(true);
    expect(bouton('regrouper').getAttribute('title')).toMatch(/au moins deux cartes/);
    expect(bouton('dissocier').disabled).toBe(true);
    expect(bouton('supprimer').disabled).toBe(true);

    // Sélection depuis l'aperçu (Maj+clic) — même geste que l'utilisateur.
    const cartes = Array.from(document.querySelectorAll('[data-card-id]')) as HTMLElement[];
    await act(async () => { fireEvent.pointerDown(cartes[0], { button: 0, isPrimary: true, pointerId: 1 }); });
    await act(async () => { fireEvent.pointerDown(cartes[2], { button: 0, isPrimary: true, shiftKey: true, pointerId: 1 }); });
    await attendre(2);
    expect(bouton('dupliquer').disabled).toBe(false);
    expect(bouton('regrouper').disabled).toBe(false);
    expect(bouton('dissocier').disabled).toBe(true);

    await act(async () => { fireEvent.click(bouton('regrouper')); });
    await attendre(2);
    expect(bouton('dissocier').disabled).toBe(false);
    await act(async () => { fireEvent.click(bouton('dissocier')); });
    await attendre(2);
    expect(bouton('dissocier').disabled).toBe(true);

    // Dupliquer : la fonction existante — une carte de plus.
    const avant = document.querySelectorAll('[data-card-id]').length;
    await act(async () => { fireEvent.click(bouton('dupliquer')); });
    await attendre(2);
    expect(document.querySelectorAll('[data-card-id]').length).toBe(avant + 2);
  });

  it('câblage : les boutons appellent les fonctions EXISTANTES', () => {
    const wizard = readFileSync(join(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf8');
    const bloc = wizard.slice(wizard.indexOf("nom={ZONE_LABELS[zoneOuverte]}"), wizard.indexOf("nom={ZONE_LABELS[zoneOuverte]}") + 3000);
    expect(bloc).toContain('onClick: duplicateSelection');
    expect(bloc).toContain('onClick: groupSelection');
    expect(bloc).toContain('onClick: ungroupSelection');
    expect(bloc).toContain('supprimerCarte(id)');
  });
});
