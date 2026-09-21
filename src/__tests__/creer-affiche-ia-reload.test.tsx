/**
 * L'affiche GÉNÉRÉE PAR L'IA : durable, ou pas appliquée du tout.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Avant, le navigateur téléchargeait l'URL temporaire de Replicate, la
 * renvoyait au stockage, et — si l'un des deux échouait — appliquait quand
 * même l'URL temporaire avec un simple avertissement. Une heure plus tard,
 * l'affiche du brouillon était morte, et la série partait sans fond.
 *
 * Désormais le SERVEUR enregistre l'image et renvoie une URL durable. Le
 * wizard n'a plus qu'une règle : une URL qui n'est pas au stockage Studiio
 * n'est pas appliquée. Ce fichier monte le vrai wizard, clique les vrais
 * boutons, lit la trace réseau et le brouillon local, puis recharge.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;
Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true, value: () => Promise.resolve(),
});

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
    composeVideo: async () => ({
      video: new Blob([new Uint8Array(4096)], { type: 'video/webm' }),
      thumbnail: new Blob(['t'], { type: 'image/jpeg' }),
    }),
    composeAndUpload: async () => ({
      blob: new Blob([new Uint8Array(4096)], { type: 'video/webm' }),
      url: 'https://cdn/libre.webm', thumbnailUrl: null, composerVersion: 'v1',
    }),
    downloadBlob: async () => {},
  };
});

import AssistantWizard, { estAfficheDurable } from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';

const CLE = draftKey('a@b.c');
const CONTENU = {
  title: 'Yoga du matin',
  subtitle: 'Reveiller le corps',
  cards: [
    { icon: 'Heart', title: 'Respirer', description: 'Trois minutes', value: '3' },
    { icon: 'Zap', title: 'Bouger', description: 'Cinq postures', value: '5' },
  ],
};

/** L'URL DURABLE que renvoie le serveur : relais Studiio vers le stockage. */
const DURABLE = 'https://studiio.pro/storage/v1/object/public/media/u1/image/abc-affiche-ia.webp';
/** L'URL TEMPORAIRE du fournisseur — ne doit JAMAIS être appliquée. */
const TEMPORAIRE = 'https://abc.replicate.delivery/x.webp';
/** Une URL relative : le brouillon ne saurait pas la relire depuis un autre hôte. */
const RELATIVE = '/storage/v1/object/public/media/u1/image/x.webp';

interface Appel { url: string; method: string; body: Record<string, unknown> | null }
let appels: Appel[];

function installerFetch(resultUrl: string) {
  appels = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const m = String(init?.method ?? 'GET').toUpperCase();
    let body: Record<string, unknown> | null = null;
    if (typeof init?.body === 'string') { try { body = JSON.parse(init.body); } catch { body = null; } }
    appels.push({ url: u, method: m, body });
    const rep = (corps: unknown, status = 200) => ({
      ok: status >= 200 && status < 300, status, json: async () => corps,
      text: async () => JSON.stringify(corps),
      blob: async () => new Blob(['x'], { type: 'image/webp' }),
    } as unknown as Response);

    if (u.includes('/api/ai/image') && m === 'POST') {
      return rep({
        success: true, resultUrl, generationId: 'abc',
        creditsUsed: 5, creditsRemaining: 95, format: body?.format ?? '9:16',
      });
    }
    if (u.includes('/api/credits/balance')) return rep({ ok: true, politique: 'credits', balance: 5000 });
    if (u.includes('/api/render/tarifs')) return rep({ ok: true, politique: 'credits', tarifs: { reel: 10, tv: 15 } });
    if (u.includes('/api/upload/signed-url')) {
      return rep({ success: true, signedUrl: 'https://minio.studiio.pro/v', publicUrl: 'https://cdn/v.jpg' });
    }
    // Recherche de photos, posts, etc. : rien, comme après un vrai rechargement.
    return rep({ success: true, data: [], posts: [], content: {}, images: [], photos: [] });
  }) as unknown as typeof fetch;
}

/** Un brouillon commencé, ouvert sur l'étape Style — celle de « Photo d'affiche ». */
const poser = (extra: Record<string, unknown> = {}) => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 1,
    customTopic: 'yoga du matin', generated: CONTENU, scheduledDate: '2026-09-01',
    ...extra,
  }));
};

const attendre = async (tours = 8, pas = 0) => {
  for (let i = 0; i < tours; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, pas)); });
  }
};

/** Laisse passer la pause d'écriture du brouillon (400 ms). */
const attendreAutosave = () => act(async () => { await new Promise((r) => setTimeout(r, 550)); });

const lireBrouillon = (): Record<string, unknown> =>
  JSON.parse(window.localStorage.getItem(CLE) ?? '{}');

const monter = async () => {
  urlQuery = new URLSearchParams('');
  render(<AssistantWizard />);
  await attendre(6);
};

/** Ouvre la section « Photo d'affiche » puis le volet « Générer avec l'IA ». */
const ouvrirAfficheIA = async () => {
  const section = document.querySelector('button[aria-controls="section-affiche"]') as HTMLButtonElement;
  expect(section).toBeTruthy();
  if (section.getAttribute('aria-expanded') !== 'true') {
    await act(async () => { fireEvent.click(section); });
  }
  const bouton = document.querySelector('[data-affiche-generer-ia]') as HTMLButtonElement;
  expect(bouton).toBeTruthy();
  await act(async () => { fireEvent.click(bouton); });
  await waitFor(() => expect(document.querySelector('[data-affiche-ia-prompt]')).not.toBeNull());
};

/** Consigne → Générer → résultat → « Utiliser comme affiche ». */
const genererEtUtiliser = async () => {
  const prompt = document.querySelector('[data-affiche-ia-prompt]') as HTMLTextAreaElement;
  await act(async () => { fireEvent.change(prompt, { target: { value: 'salle de yoga baignée de lumière' } }); });
  await act(async () => { fireEvent.click(document.querySelector('[data-affiche-ia-generer]')!); });
  await waitFor(() => expect(document.querySelector('[data-affiche-ia-utiliser]')).not.toBeNull());
  await act(async () => { fireEvent.click(document.querySelector('[data-affiche-ia-utiliser]')!); });
  await attendre(4);
};

const calqueAffiche = () => document.querySelector('[data-poster-layer]') as HTMLImageElement | null;
const vignetteIA = () =>
  Array.from(document.querySelectorAll('[data-poster-photo]'))
    .find((el) => el.getAttribute('title') === 'Photo : Générée par l’IA') ?? null;

beforeEach(() => {
  window.localStorage.clear();
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  window.alert = () => {};
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// ────────────────────────────────────────────────────────────────────────────
// Le chemin nominal : une URL durable, appliquée, persistée, restaurée
// ────────────────────────────────────────────────────────────────────────────

describe('Affiche IA durable : appliquée, enregistrée, restaurée', () => {
  it('(a) le navigateur ne télécharge jamais le fournisseur et n envoie rien au stockage', async () => {
    installerFetch(DURABLE);
    poser();
    await monter();
    await ouvrirAfficheIA();
    await genererEtUtiliser();

    expect(appels.filter((a) => a.url.includes('/api/ai/image'))).toHaveLength(1);
    expect(appels.some((a) => a.url.includes('replicate.delivery'))).toBe(false);
    expect(appels.some((a) => a.url.includes('/api/upload/signed-url'))).toBe(false);
    expect(appels.some((a) => a.url.includes('minio.studiio.pro'))).toBe(false);
    // Et pas davantage un téléchargement de l'image durable elle-même.
    expect(appels.some((a) => a.url === DURABLE)).toBe(false);
  });

  it('(b) l affiche est posée sur l aperçu et la grille porte « Générée par l IA »', async () => {
    installerFetch(DURABLE);
    poser();
    await monter();
    await ouvrirAfficheIA();
    expect(calqueAffiche()).toBeNull();
    await genererEtUtiliser();

    await waitFor(() => expect(calqueAffiche()?.getAttribute('src')).toBe(DURABLE));
    const vignette = vignetteIA();
    expect(vignette).not.toBeNull();
    expect(vignette?.getAttribute('data-poster-photo')).toBe(DURABLE);
    // Aucune erreur : l'ancien « appliquée, mais non copiée » n'existe plus.
    expect(document.body.textContent).not.toContain('non copiée au stockage');
    expect(document.querySelector('[data-affiche-ia-etat="erreur"]')).toBeNull();
  });

  it('(c) après la pause d écriture, le brouillon porte l URL absolue du stockage', async () => {
    installerFetch(DURABLE);
    poser();
    await monter();
    await ouvrirAfficheIA();
    await genererEtUtiliser();
    await attendreAutosave();

    const brouillon = lireBrouillon();
    expect(brouillon.posterUrl).toBe(DURABLE);
    const posterUrl = String(brouillon.posterUrl);
    expect(posterUrl.startsWith('https://')).toBe(true);
    expect(posterUrl).not.toContain('replicate.delivery');
    expect(posterUrl.startsWith('data:')).toBe(false);
  });

  it('(d) au rechargement, l affiche est restaurée et le wizard le dit', async () => {
    installerFetch(DURABLE);
    poser();
    await monter();
    await ouvrirAfficheIA();
    await genererEtUtiliser();
    await attendreAutosave();
    expect(lireBrouillon().posterUrl).toBe(DURABLE);

    cleanup();
    await monter();

    await waitFor(() => expect(calqueAffiche()?.getAttribute('src')).toBe(DURABLE));
    const texte = document.body.textContent ?? '';
    expect(texte).toContain('Brouillon restauré');
    expect(texte).toMatch(/Brouillon restauré \([^)]*affiche[^)]*\)/);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Les refus : rien n'est appliqué, rien n'est écrit
// ────────────────────────────────────────────────────────────────────────────

describe('Affiche IA non durable : refusée', () => {
  const refuser = async (resultUrl: string) => {
    installerFetch(resultUrl);
    poser();
    await monter();
    await ouvrirAfficheIA();
    await genererEtUtiliser();
    await attendreAutosave();

    const alerte = document.querySelector('[data-affiche-ia-etat="erreur"]');
    expect(alerte).not.toBeNull();
    expect(alerte?.getAttribute('role')).toBe('alert');
    expect(alerte?.textContent).toContain('n’a pas été enregistrée dans le stockage');
    expect(alerte?.textContent).toContain('n’a pas été appliquée');
    expect(calqueAffiche()).toBeNull();
    expect(vignetteIA()).toBeNull();
    expect(lireBrouillon().posterUrl).toBeUndefined();
    expect(document.body.textContent).not.toContain('non copiée au stockage');
    // Et toujours aucun téléchargement ni envoi depuis ce chemin.
    expect(appels.some((a) => a.url.includes('replicate.delivery'))).toBe(false);
    expect(appels.some((a) => a.url.includes('/api/upload/signed-url'))).toBe(false);
  };

  it('(e) une URL replicate.delivery : erreur affichée, brouillon intact, grille intacte', async () => {
    await refuser(TEMPORAIRE);
  });

  it('(f) une URL relative : refusée de même', async () => {
    await refuser(RELATIVE);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// La règle, sur des valeurs
// ────────────────────────────────────────────────────────────────────────────

describe('(g) estAfficheDurable', () => {
  it('accepte le relais Studiio vers le stockage', () => {
    expect(estAfficheDurable(DURABLE)).toBe(true);
    expect(estAfficheDurable('http://localhost:3000/storage/v1/object/public/media/u1/image/x.webp')).toBe(true);
  });
  it('accepte l ancien chemin public Supabase', () => {
    expect(estAfficheDurable('https://lhuqdmlkhezdwzwlpfqo.supabase.co/storage/v1/object/public/media/u1/image/x.webp')).toBe(true);
  });
  it('refuse le fournisseur, même sous un sous-domaine', () => {
    expect(estAfficheDurable(TEMPORAIRE)).toBe(false);
    expect(estAfficheDurable('https://replicate.delivery/pbxt/x.webp')).toBe(false);
    // Un hôte du fournisseur qui imiterait notre chemin ne passe pas non plus.
    expect(estAfficheDurable('https://abc.replicate.delivery/storage/v1/object/public/media/x.webp')).toBe(false);
  });
  it('refuse une URL relative, data:, blob:, javascript:, vide', () => {
    expect(estAfficheDurable(RELATIVE)).toBe(false);
    expect(estAfficheDurable('data:image/webp;base64,AAAA')).toBe(false);
    expect(estAfficheDurable('blob:https://studiio.pro/abc')).toBe(false);
    expect(estAfficheDurable('javascript:alert(1)')).toBe(false);
    expect(estAfficheDurable('')).toBe(false);
    expect(estAfficheDurable('pas une url')).toBe(false);
  });
  it('refuse une URL absolue hors du stockage', () => {
    expect(estAfficheDurable('https://studiio.pro/x.webp')).toBe(false);
    expect(estAfficheDurable('https://cdn/affiche-1.jpg')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Le format de la vidéo dicte le format de l'image demandée
// ────────────────────────────────────────────────────────────────────────────

describe('(h) le wizard passe son format à AfficheIA', () => {
  it('9:16 par défaut, dans le corps de la requête', async () => {
    installerFetch(DURABLE);
    poser();
    await monter();
    await ouvrirAfficheIA();
    await genererEtUtiliser();
    const requete = appels.find((a) => a.url.includes('/api/ai/image'));
    expect(requete?.body).toMatchObject({ action: 'generate-bg', format: '9:16' });
    expect(document.querySelector('[data-affiche-ia]')?.getAttribute('data-affiche-ia-format')).toBe('9:16');
  });

  it('1:1 choisi à l écran → format: "1:1" dans la requête', async () => {
    installerFetch(DURABLE);
    poser();
    await monter();
    // La section « Format » est ouverte par défaut sur l'étape Style.
    const carre = screen.getAllByRole('button', { name: /^1:1/ })[0] as HTMLButtonElement;
    expect(carre).toBeTruthy();
    await act(async () => { fireEvent.click(carre); });
    expect(carre.getAttribute('aria-pressed')).toBe('true');

    await ouvrirAfficheIA();
    expect(document.querySelector('[data-affiche-ia]')?.getAttribute('data-affiche-ia-format')).toBe('1:1');
    await genererEtUtiliser();
    const requete = appels.find((a) => a.url.includes('/api/ai/image'));
    expect(requete?.body).toMatchObject({ action: 'generate-bg', format: '1:1' });
  });

  it('la source instancie AfficheIA avec format={format}', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');
    expect(src).toMatch(/<AfficheIA[^>]*onUtiliser=\{utiliserAfficheIA\}[^>]*format=\{format\}/);
  });
});
