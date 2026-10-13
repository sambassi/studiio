import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import {
  mediaApercuAutopilote, aUneSequenceVideo, ETIQUETTE_AUCUN_MEDIA, type ResumeMediasApercu,
} from '@/lib/autopilot/apercu-medias';
import { DEFAULT_CONFIG, sanitizeConfig, type AutopilotConfig } from '@/lib/autopilot/rules';
import type { MediaStockRetenu } from '@/lib/autopilot/sources';
import { vignettesPourTests } from '@/lib/medias/vignette-video';

/**
 * APERÇU DE L'AUTOPILOTE — la séquence « Vidéo » montre les médias RÉELS du plan.
 *
 * Avant : `config.rushUrls[0]`, quel que soit le plan — et `retenirStock`
 * range les vidéos suggérées dans `rushUrls`. L'aperçu pouvait donc montrer
 * une vidéo stock jamais choisie comme « le rush », source stock décochée.
 */

const ORIGINE = 'https://studiio.pro/storage/v1/object/public/media/u1';
const RUSH = `${ORIGINE}/plage.mp4`;
const RUSH_2 = `${ORIGINE}/salle.mp4`;
const STOCK_V = `${ORIGINE}/library/stock-pexels-video-77.mp4`;
const PHOTO = 'https://images.pexels.com/photos/9/p.jpg';

const retenu = (url: string, type: 'video' | 'photo'): MediaStockRetenu => ({
  url, type, provider: 'pexels', providerAssetId: '1', auteur: 'X', sourceUrl: '', licence: 'Pexels License', vignetteUrl: `${url}.jpg`,
});

function resume(o: Partial<ResumeMediasApercu> = {}): ResumeMediasApercu {
  return {
    gabarit: [],
    actives: { rushes: true, avatar: false, stock: false },
    rushesPerso: [],
    stock: [],
    avatar: { disponible: false, vignette: null },
    ...o,
  };
}

describe('Règle pure — le premier créneau réel du plan', () => {
  it('plan avatar : l’avatar prêt, sa vignette réelle, « Séquence 1 — Mon avatar »', () => {
    const m = mediaApercuAutopilote(resume({
      gabarit: [{ id: 's1', type: 'avatar' }, { id: 's2', type: 'rush' }],
      actives: { rushes: true, avatar: true, stock: false },
      rushesPerso: [RUSH],
      avatar: { disponible: true, vignette: { url: '/api/avatars/versions/v1/source', type: 'video' } },
    }), { rushUrls: [RUSH] });
    expect(m).toMatchObject({ type: 'avatar', url: '/api/avatars/versions/v1/source', media: 'video', etiquette: 'Séquence 1 — Mon avatar' });
  });

  it('avatar demandé mais pas prêt : le créneau suivant (rush), jamais un avatar inventé', () => {
    const m = mediaApercuAutopilote(resume({
      gabarit: [{ id: 's1', type: 'avatar' }, { id: 's2', type: 'rush' }],
      actives: { rushes: true, avatar: true, stock: false },
      rushesPerso: [RUSH],
    }), { rushUrls: [RUSH] });
    expect(m).toMatchObject({ type: 'rush', url: RUSH, etiquette: 'Séquence 2 — Rush : plage.mp4' });
  });

  it('plan rush : le rush FORCÉ s’il est utilisable, jamais un stock', () => {
    const m = mediaApercuAutopilote(resume({
      gabarit: [{ id: 's1', type: 'rush', media: RUSH_2 }],
      rushesPerso: [RUSH, RUSH_2],
    }), { rushUrls: [STOCK_V, RUSH, RUSH_2] });
    expect(m).toMatchObject({ type: 'rush', url: RUSH_2, etiquette: 'Séquence 1 — Rush : salle.mp4' });
  });

  it('rush forcé expiré (absent des utilisables) : un autre rush réel, pas le fichier mort', () => {
    const m = mediaApercuAutopilote(resume({
      gabarit: [{ id: 's1', type: 'rush', media: `${ORIGINE}/mort.mp4` }],
      rushesPerso: [RUSH],
    }), { rushUrls: [`${ORIGINE}/mort.mp4`, RUSH] });
    expect(m).toMatchObject({ type: 'rush', url: RUSH });
  });

  it('plan stock : le média réellement retenu, « Média suggéré »', () => {
    const m = mediaApercuAutopilote(resume({
      gabarit: [{ id: 's1', type: 'stock', media: PHOTO }],
      actives: { rushes: true, avatar: false, stock: true },
      stock: [retenu(STOCK_V, 'video'), retenu(PHOTO, 'photo')],
    }), { rushUrls: [STOCK_V] });
    expect(m).toMatchObject({ type: 'stock', url: PHOTO, media: 'photo', etiquette: 'Séquence 1 — Média suggéré' });
  });

  it('stock NON coché : jamais affiché, même retenu, même dans la banque', () => {
    const r = resume({
      gabarit: [{ id: 's1', type: 'stock' }, { id: 's2', type: 'auto' }],
      actives: { rushes: true, avatar: false, stock: false },
      stock: [retenu(STOCK_V, 'video')],
    });
    const m = mediaApercuAutopilote(r, { rushUrls: [STOCK_V] });
    expect(m.type).toBe('aucun');
    expect(JSON.stringify(m)).not.toContain('stock-pexels');
  });

  it('rushes NON cochés : jamais un rush', () => {
    const m = mediaApercuAutopilote(resume({
      gabarit: [{ id: 's1', type: 'rush' }],
      actives: { rushes: false, avatar: false, stock: false },
      rushesPerso: [RUSH],
    }), { rushUrls: [RUSH] });
    expect(m.type).toBe('aucun');
  });

  it('aucun média réel : un emplacement ÉTIQUETÉ', () => {
    const m = mediaApercuAutopilote(resume({ gabarit: [{ id: 's1', type: 'auto' }] }), { rushUrls: [] });
    expect(m).toEqual({ type: 'aucun', etiquette: ETIQUETTE_AUCUN_MEDIA });
  });

  it('sans résumé (défaut sûr) : le premier rush PERSONNEL, jamais une vidéo stock de la banque', () => {
    expect(mediaApercuAutopilote(null, { rushUrls: [STOCK_V, RUSH] })).toMatchObject({ type: 'rush', url: RUSH });
    expect(mediaApercuAutopilote(null, { rushUrls: [STOCK_V] }).type).toBe('aucun');
    expect(mediaApercuAutopilote(null, { rushUrls: [RUSH], actives: { rushes: false } }).type).toBe('aucun');
    expect(aUneSequenceVideo(null, { rushUrls: [RUSH] })).toBe(true);
    expect(aUneSequenceVideo(resume(), { rushUrls: [RUSH] })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// À l'écran : le wizard, le panneau et l'aperçu montés ensemble.

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }),
}));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

import AssistantWizard from '@/app/dashboard/creer/AssistantWizard';

let configServeur: AutopilotConfig = DEFAULT_CONFIG;

beforeEach(() => {
  configServeur = DEFAULT_CONFIG;
  vignettesPourTests.reinitialiser();
  vignettesPourTests.desactiverPersistance();
  vignettesPourTests.definirExtracteur(async () => { throw new Error('jsdom'); });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.startsWith('/api/pexels')) {
      return { ok: true, json: async () => ({ success: true, photos: [{ id: 1, url: 'https://exemple.test/affiche.jpg', medium: 'https://exemple.test/affiche.jpg' }] }) };
    }
    if (u.startsWith('/api/autopilot/config')) {
      return { ok: true, json: async () => ({ success: true, ready: true, brandingReady: true, config: configServeur }) };
    }
    return { ok: true, json: async () => ({ success: true }) };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vignettesPourTests.reinitialiser(); });

async function ouvrirAutopilote() {
  window.localStorage.clear();
  render(<AssistantWizard />);
  await waitFor(() => expect(document.querySelector('[data-parcours-autopilote]')).not.toBeNull());
  fireEvent.click(document.querySelector('[data-parcours-autopilote]')!);
  await waitFor(() => expect(document.querySelector('[data-autopilot-apercu]')).toBeTruthy());
  return document.querySelector('[data-autopilot-apercu]') as HTMLElement;
}

function ongletVideo(apercu: HTMLElement) {
  return Array.from(apercu.querySelectorAll('[role="tab"]')).find((o) => o.textContent === 'Vidéo') as HTMLButtonElement;
}

describe('À l’écran', () => {
  it('banque [stock, rush] sans clé sources : la séquence Vidéo montre le RUSH, étiqueté', async () => {
    // Le cas du bug : `rushUrls[0]` était la vidéo stock.
    configServeur = sanitizeConfig({ ...DEFAULT_CONFIG, rushUrls: [STOCK_V, RUSH] });
    const apercu = await ouvrirAutopilote();
    await waitFor(() => expect(ongletVideo(apercu)?.disabled).toBe(false));
    fireEvent.click(ongletVideo(apercu));
    await waitFor(() => expect(apercu.querySelector(`video[src="${RUSH}"]`)).toBeTruthy());
    expect(apercu.querySelector('video[src*="stock-pexels"]')).toBeNull();
    expect(apercu.querySelector('[data-autopilot-etiquette-media="rush"]')!.textContent).toContain('Rush : plage.mp4');
    expect(apercu.querySelector('[data-autopilot-apercu-media-etiquette]')!.textContent).toContain('Rush : plage.mp4');
    expect(apercu.querySelector('[data-autopilot-apercu-badge="medias"]')!.textContent).toBe('Médias réels du plan');
  });

  it('« Tout » reçoit aussi le média réel du plan', async () => {
    configServeur = sanitizeConfig({ ...DEFAULT_CONFIG, rushUrls: [RUSH] });
    const apercu = await ouvrirAutopilote();
    await waitFor(() => expect(apercu.querySelector(`video[src="${RUSH}"]`)).toBeTruthy());
  });

  it('source stock décochée : la vidéo stock de la banque n’est JAMAIS montrée', async () => {
    configServeur = sanitizeConfig({
      ...DEFAULT_CONFIG,
      rushUrls: [STOCK_V],
      designStyle: { sources: { actives: { rushes: true, avatar: false, stock: false }, stock: [retenu(STOCK_V, 'video')], gabarit: [{ id: 's1', type: 'stock' }] } },
    } as unknown as AutopilotConfig);
    const apercu = await ouvrirAutopilote();
    await waitFor(() => expect(apercu.querySelector('[data-autopilot-apercu-medias]')?.getAttribute('data-autopilot-apercu-medias')).toBe('aucun'));
    fireEvent.click(ongletVideo(apercu));
    expect(apercu.querySelector('video[src*="stock-pexels"]')).toBeNull();
    expect(apercu.querySelector('[data-autopilot-etiquette-media="aucun"]')!.textContent).toContain('Aucun média réel');
  });

  it('libellés : « Aperçu du style » (exemple) distinct des médias réels ; plus « Aperçu du projet »', async () => {
    configServeur = sanitizeConfig({ ...DEFAULT_CONFIG, rushUrls: [RUSH] });
    const apercu = await ouvrirAutopilote();
    const mention = apercu.querySelector('[data-autopilot-apercu-mention]') as HTMLElement;
    expect(mention.textContent).not.toContain('Aperçu du projet');
    expect(mention.querySelector('[data-autopilot-apercu-badge="style"]')!.textContent).toBe('Aperçu du style');
    expect(mention.textContent).toContain('exemple');
    // L'affiche Pexels porte son étiquette « exemple » dans le cadre.
    await waitFor(() => expect(apercu.querySelector('[data-autopilot-etiquette-exemple]')).toBeTruthy());
    expect(screen.getAllByText('Médias réels du plan').length).toBe(1);
  });
});
