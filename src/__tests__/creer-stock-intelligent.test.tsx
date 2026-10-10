/**
 * RECHERCHE STOCK INTELLIGENTE dans Créer — additive, jamais intrusive.
 *
 * - Suggestions déterministes (sujet + séquence), un clic relance la recherche
 *   MANUELLE existante (`/api/pexels`), inchangée.
 * - Panneau `RechercheStockSequence` : `/api/stock/recherche` avec type +
 *   format, vertical d'abord en 9:16 ; vidéo Pexels → `/api/stock/importer`
 *   avec {provider,type,providerAssetId} SEULEMENT, puis AJOUT aux rushes ;
 *   photo sur un fond existant → « Remplacer l’arrière-plan » ; fournisseur
 *   tombé → message discret.
 * - Panneau jamais ouvert ⇒ aucune requête `/api/stock/*`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { MediaStock } from '@/lib/stock/types';
import { construireRecherchesStock } from '@/lib/stock/requetes';
import RechercheStockSequence, { texteDeSequence } from '@/components/creer/RechercheStockSequence';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;
Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() });

let sessionState: { data: unknown; status: string };
let urlQuery: URLSearchParams;

vi.mock('next-auth/react', () => ({ useSession: () => sessionState }));
vi.mock('next/navigation', () => ({ useSearchParams: () => urlQuery }));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});
vi.mock('@/lib/icons/prerender', () => ({ preRenderCardIcons: async (c: unknown) => c }));
vi.mock('@/lib/video-composer', async () => {
  const actual = await vi.importActual<typeof import('@/lib/video-composer')>('@/lib/video-composer');
  return {
    ...actual,
    composeVideo: async () => ({ video: new Blob(['v'], { type: 'video/webm' }), thumbnail: new Blob(['t'], { type: 'image/jpeg' }) }),
    composeAndUpload: async () => ({ blob: new Blob(['v']), url: 'https://cdn/x.webm', thumbnailUrl: null, composerVersion: 'v1' }),
    downloadBlob: async () => {},
  };
});

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';

const media = (id: string, o: Partial<MediaStock>): MediaStock => ({
  id: `pexels-video-${id}`, provider: 'pexels', providerAssetId: id, type: 'video',
  largeur: 1080, hauteur: 1920, orientation: 'portrait', dureeSecondes: 12,
  vignetteUrl: `https://images.pexels.test/${id}.jpg`, apercuUrl: `https://images.pexels.test/${id}-m.jpg`,
  fichierUrl: `https://videos.pexels.test/${id}-hd.mp4`, sourceUrl: `https://www.pexels.com/video/${id}/`,
  auteur: 'Ada', description: 'dance', licence: 'Pexels License', attribution: 'Vidéo de Ada sur Pexels',
  ...o,
});

interface Appel { url: string; method: string; body: Record<string, unknown> | null }
let appels: Appel[];

function installerFetch(opts: {
  recherche?: { medias: MediaStock[]; echecs?: unknown[] } | 'panne';
  importe?: { url: string; media: MediaStock };
} = {}) {
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
      if (opts.recherche === 'panne') throw new Error('réseau');
      return rep({ success: true, medias: opts.recherche?.medias ?? [], echecs: opts.recherche?.echecs ?? [], requete: 'q' });
    }
    if (u.startsWith('/api/stock/importer')) {
      return rep({ success: true, url: opts.importe?.url, media: opts.importe?.media, importe: true });
    }
    if (u.includes('/api/credits/balance')) return rep({ ok: true, politique: 'credits', balance: 5000 });
    if (u.includes('/api/render/tarifs')) return rep({ ok: true, politique: 'credits', tarifs: { reel: 10, tv: 15 } });
    return rep({ success: true, data: [], posts: [], content: {}, images: [], photos: [] });
  }) as unknown as typeof fetch;
}

const attendre = async (tours = 6) => {
  for (let i = 0; i < tours; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

beforeEach(() => {
  window.localStorage.clear();
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  urlQuery = new URLSearchParams('');
  window.alert = () => {};
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// ────────────────────────────────────────────────────────────────────────────
describe('suggestions déterministes', () => {
  it('même sujet + même séquence ⇒ mêmes suggestions ; le texte de la séquence oriente', () => {
    const contenu = { title: 'Danse en groupe', subtitle: 'Énergie', cards: [{ title: 'Respirer', description: 'calme' }], cta: 'Réserve', ctaSub: 'ton cours' };
    expect(texteDeSequence(contenu, 'titre')).toBe('Danse en groupe Énergie');
    expect(texteDeSequence(contenu, 'cartes')).toBe('Respirer calme');
    expect(texteDeSequence(contenu, 'cta')).toBe('Réserve ton cours');
    expect(texteDeSequence(null, 'titre')).toBe('');
    const a = construireRecherchesStock({ sujet: 'yoga du matin', texte: texteDeSequence(contenu, 'titre'), role: 'titre', visuel: 'arriere-plan', format: '9:16' });
    const b = construireRecherchesStock({ sujet: 'yoga du matin', texte: texteDeSequence(contenu, 'titre'), role: 'titre', visuel: 'arriere-plan', format: '9:16' });
    expect(a).toEqual(b);
    expect(a.requetes.length).toBeGreaterThan(0);
    expect(a.requetes.length).toBeLessThanOrEqual(5);
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe('RechercheStockSequence (isolé)', () => {
  const base = {
    role: 'video' as const, libelleSequence: 'Vidéo', sujet: 'afroboost cardio danse', objectif: 'groupe',
    texte: '', format: '9:16' as const, fondExistant: false,
    onUtiliserPhoto: vi.fn(), onAjouterRush: vi.fn(), onFermer: vi.fn(),
  };

  it('cherche /api/stock/recherche avec type + format, vertical en premier', async () => {
    const paysage = media('h1', { orientation: 'landscape', largeur: 1920, hauteur: 1080 });
    const portrait = media('v1', {});
    installerFetch({ recherche: { medias: [paysage, portrait] } });
    render(<RechercheStockSequence {...base} typeInitial="video" />);
    await attendre();
    const appel = appels.find((a) => a.url.startsWith('/api/stock/recherche'))!;
    expect(appel).toBeTruthy();
    const q = new URLSearchParams(appel.url.split('?')[1]);
    expect(q.get('type')).toBe('video');
    expect(q.get('format')).toBe('9:16');
    expect(q.get('fournisseurs')).toBe('pexels');
    const ordre = Array.from(document.querySelectorAll('[data-stock-orientation]')).map((e) => e.getAttribute('data-stock-orientation'));
    expect(ordre).toEqual(['portrait', 'landscape']);
    // Vignettes paresseuses, jamais le fichier HD.
    const img = document.querySelector('[data-stock-media] img') as HTMLImageElement;
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(appels.some((a) => a.url.includes('-hd.mp4'))).toBe(false);
  });

  it('vidéo Pexels : importer reçoit {provider,type,providerAssetId} seulement, puis ajout aux rushes', async () => {
    const v = media('v1', {});
    const IMPORTEE = 'https://studiio.pro/storage/v1/object/public/media/u1/library/pexels-v1.mp4';
    installerFetch({ recherche: { medias: [v] }, importe: { url: IMPORTEE, media: v } });
    const onAjouterRush = vi.fn();
    render(<RechercheStockSequence {...base} typeInitial="video" onAjouterRush={onAjouterRush} />);
    await attendre();
    await act(async () => { fireEvent.click(document.querySelector('[data-stock-media]')!); });
    // Crédit visible, lien sûr.
    const lien = document.querySelector('[data-stock-attribution] a') as HTMLAnchorElement;
    expect(lien.getAttribute('href')).toBe(v.sourceUrl);
    expect(lien.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByText('Ajouter aux rushes')).toBeTruthy();
    await act(async () => { fireEvent.click(document.querySelector('[data-stock-utiliser]')!); });
    await attendre();
    const imp = appels.find((a) => a.url === '/api/stock/importer')!;
    expect(imp.method).toBe('POST');
    expect(imp.body).toEqual({ provider: 'pexels', type: 'video', providerAssetId: 'v1' });
    expect(onAjouterRush).toHaveBeenCalledTimes(1);
    expect(onAjouterRush.mock.calls[0][0]).toBe(IMPORTEE);
    expect(onAjouterRush.mock.calls[0][2]).toMatchObject({ provider: 'pexels', providerAssetId: 'v1', auteur: 'Ada', sourceUrl: v.sourceUrl });
    expect(document.querySelector('[data-stock-message]')?.textContent).toMatch(/Médiathèque/);
  });

  it('photo sur une séquence qui a déjà un fond : bouton « Remplacer l’arrière-plan », rien sans ce clic', async () => {
    const p = media('p1', { id: 'unsplash-photo-p1', provider: 'unsplash', type: 'photo', providerAssetId: 'p1', dureeSecondes: undefined });
    installerFetch({ recherche: { medias: [p] }, importe: { url: 'https://images.unsplash.test/p1.jpg', media: p } });
    const onUtiliserPhoto = vi.fn();
    render(<RechercheStockSequence {...base} role="titre" libelleSequence="Titre" typeInitial="photo" fondExistant onUtiliserPhoto={onUtiliserPhoto} />);
    await attendre();
    await act(async () => { fireEvent.click(document.querySelector('[data-stock-media]')!); });
    expect(onUtiliserPhoto).not.toHaveBeenCalled();
    expect(appels.some((a) => a.url === '/api/stock/importer')).toBe(false);
    const bouton = document.querySelector('[data-stock-utiliser]')!;
    expect(bouton.textContent).toContain('Remplacer l’arrière-plan');
    await act(async () => { fireEvent.click(bouton); });
    await attendre();
    expect(appels.find((a) => a.url === '/api/stock/importer')?.body).toEqual({ provider: 'unsplash', type: 'photo', providerAssetId: 'p1' });
    expect(onUtiliserPhoto).toHaveBeenCalledWith('https://images.unsplash.test/p1.jpg', expect.objectContaining({ provider: 'unsplash' }));
  });

  it('sans fond existant : « Utiliser dans cette séquence »', async () => {
    const p = media('p2', { id: 'pexels-photo-p2', type: 'photo', providerAssetId: 'p2' });
    installerFetch({ recherche: { medias: [p] } });
    render(<RechercheStockSequence {...base} role="cta" libelleSequence="CTA" typeInitial="photo" />);
    await attendre();
    await act(async () => { fireEvent.click(document.querySelector('[data-stock-media]')!); });
    expect(document.querySelector('[data-stock-utiliser]')!.textContent).toContain('Utiliser dans cette séquence');
  });

  it('fournisseur tombé : message discret, résultats restants affichés ; réseau en panne : pas de plantage', async () => {
    installerFetch({ recherche: { medias: [media('v1', {})], echecs: [{ provider: 'unsplash', motif: 'quota' }] } });
    render(<RechercheStockSequence {...base} typeInitial="photo" />);
    await attendre();
    expect(document.querySelector('[data-stock-echecs]')?.textContent).toBe('Unsplash quota atteint');
    expect(document.querySelectorAll('[data-stock-media]').length).toBe(1);
    cleanup();

    installerFetch({ recherche: 'panne' });
    render(<RechercheStockSequence {...base} typeInitial="video" />);
    await attendre();
    expect(document.querySelector('[data-stock-echecs]')?.textContent).toBe('Pexels indisponible');
    expect(document.querySelector('[data-stock-vide]')).not.toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
const CLE = draftKey('a@b.c');
const RUSH = 'https://studiio.pro/storage/v1/object/public/media/u1/rush-principal.mp4';
const poser = (extra: Record<string, unknown> = {}) => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 1,
    customTopic: 'yoga du matin', scheduledDate: '2026-09-01',
    generated: { title: 'Yoga du matin', subtitle: 'Réveiller le corps', cards: [], cta: 'Viens', ctaSub: '' },
    ...extra,
  }));
};
const ouvrirSection = async (id: string) => {
  const s = document.querySelector(`button[aria-controls="section-${id}"]`) as HTMLButtonElement;
  expect(s).toBeTruthy();
  if (s.getAttribute('aria-expanded') !== 'true') await act(async () => { fireEvent.click(s); });
};

describe('AssistantWizard — intégration légère', () => {
  it('panneau jamais ouvert : aucune requête /api/stock au montage ni en ouvrant l’affiche', async () => {
    installerFetch();
    poser();
    render(<AssistantWizard />);
    await attendre();
    await ouvrirSection('affiche');
    await attendre();
    expect(appels.some((a) => a.url.includes('/api/stock/'))).toBe(false);
    // Le panneau n'est pas monté.
    expect(document.querySelector('[data-recherche-stock]')).toBeNull();
  });

  it('un clic sur une suggestion lance la recherche MANUELLE existante (/api/pexels) avec cette requête', async () => {
    installerFetch();
    poser();
    render(<AssistantWizard />);
    await attendre();
    await ouvrirSection('affiche');
    const puces = Array.from(document.querySelectorAll('[data-suggestion-photo]'));
    const attendues = construireRecherchesStock({ sujet: 'yoga du matin', texte: '', role: null, visuel: 'arriere-plan', format: '9:16' }).requetes.slice(0, 5);
    expect(puces.map((p) => p.getAttribute('data-suggestion-photo'))).toEqual(attendues);
    await act(async () => { fireEvent.click(puces[0]); });
    await attendre();
    const pexels = appels.filter((a) => a.url.startsWith('/api/pexels'));
    expect(pexels).toHaveLength(1);
    expect(pexels[0].url).toContain(`query=${encodeURIComponent(attendues[0])}`);
    expect(pexels[0].url).toContain('source=pexels');
    expect((document.querySelector('[data-poster-query]') as HTMLInputElement).value).toBe(attendues[0]);
    expect(appels.some((a) => a.url.includes('/api/stock/'))).toBe(false);
  });

  it('ouvert depuis « Photo d’affiche » (onglet Tout) : le panneau s’ouvre sur PHOTO, jamais sur « Ajouter aux rushes »', async () => {
    installerFetch({ recherche: { medias: [media('p1', { type: 'photo', id: 'pexels-photo-p1' })] } });
    poser();
    render(<AssistantWizard />);
    await attendre();
    await ouvrirSection('affiche');
    const bouton = document.querySelector('[data-ouvrir-stock="fond"]') as HTMLButtonElement;
    expect(bouton).toBeTruthy();
    await act(async () => { fireEvent.click(bouton); });
    await attendre();
    const rech = appels.filter((a) => a.url.startsWith('/api/stock/recherche'));
    expect(rech.length).toBeGreaterThan(0);
    expect(rech.every((a) => new URLSearchParams(a.url.split('?')[1]).get('type') === 'photo')).toBe(true);
    expect(document.querySelector('[data-stock-type="photo"]')?.getAttribute('aria-pressed')).toBe('true');
    await act(async () => { fireEvent.click(document.querySelector('[data-stock-media]')!); });
    expect(document.querySelector('[data-stock-utiliser]')?.textContent).not.toContain('Ajouter aux rushes');
  });

  it('vidéo stock ajoutée depuis la séquence Vidéo : keep du nouveau rush, rush principal inchangé', async () => {
    const v = media('v9', {});
    const IMPORTEE = 'https://studiio.pro/storage/v1/object/public/media/u1/library/pexels-v9.mp4';
    installerFetch({ recherche: { medias: [v] }, importe: { url: IMPORTEE, media: v } });
    poser({ rushUrl: RUSH, rushName: 'plage.mp4' });
    render(<AssistantWizard />);
    await attendre();
    await ouvrirSection('sequences');
    const bouton = document.querySelector('[data-ouvrir-stock="rush"]') as HTMLButtonElement;
    expect(bouton).toBeTruthy();
    await act(async () => { fireEvent.click(bouton); });
    await attendre();
    const rech = appels.find((a) => a.url.startsWith('/api/stock/recherche'))!;
    expect(new URLSearchParams(rech.url.split('?')[1]).get('type')).toBe('video');
    await act(async () => { fireEvent.click(document.querySelector('[data-stock-media]')!); });
    await act(async () => { fireEvent.click(document.querySelector('[data-stock-utiliser]')!); });
    await attendre();
    const keep = appels.filter((a) => a.url === '/api/creer/rush/keep');
    expect(keep.map((k) => k.body?.url)).toContain(IMPORTEE);
    // Le rush principal n'a pas bougé : l'écriture du brouillon le garde.
    await act(async () => { await new Promise((r) => setTimeout(r, 550)); });
    const brouillon = JSON.parse(window.localStorage.getItem(CLE) ?? '{}');
    expect(brouillon.rushUrl).toBe(RUSH);
  });
});

describe('câblage (source)', () => {
  const wizard = readFileSync(join(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf8');
  it('le panneau est monté seulement à l’ouverture et ajoute via `ajouterRush`', () => {
    expect(wizard).toMatch(/\{stockPanneau && \(\s*<RechercheStockSequence/);
    const bloc = wizard.slice(wizard.indexOf('onAjouterRush={'), wizard.indexOf('onFermer={() => setStockPanneau(null)}'));
    expect(bloc).toContain('ajouterRush(url, nom)');
    expect(bloc).not.toContain('applyRush(');
  });
});
