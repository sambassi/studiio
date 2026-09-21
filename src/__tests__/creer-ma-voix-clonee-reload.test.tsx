/**
 * « Utiliser ma voix » dans Créer > Audio : UNE voix pour tout, qui survit
 * au changement d'étape ET au rechargement.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LE CAS DE PROD (2026-09-21)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `localStorage['tts.voiceId'] = 'fr-FR-HenriNeural'` (un choix hors défaut,
 * donc la présélection de #418 ne s'applique pas), un brouillon SANS
 * `ttsVoiceId`, et une voix clonée « Bassi (ma voix) » servie par
 * `/api/tts/elevenlabs`. Créer affichait Henri ; les voix par séquence
 * avaient été générées avec Henri.
 *
 * Ce fichier monte le VRAI wizard dans cet état, clique « Utiliser ma voix »
 * sur la carte, attend l'autosave, démonte, remonte — et lit le DOM : le
 * sélecteur global (étape Audio) ET le sélecteur par séquence (étape
 * Contenu) montrent la voix clonée, `localStorage['tts.voiceId']` aussi.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';

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

import AssistantWizard from '../app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION } from '../lib/creer/draft';

const CLE = draftKey('a@b.c');
const CLONEE = 'elevenlabs-ohwPBassi';
const HENRI = 'fr-FR-HenriNeural';
const STEP_AUDIO = 2;
const STEP_CONTENU = 3;
const CONTENU = {
  title: 'Yoga du matin',
  subtitle: 'Reveiller le corps',
  cards: [
    { icon: 'Heart', title: 'Respirer', description: 'Trois minutes', value: '3' },
    { icon: 'Zap', title: 'Bouger', description: 'Cinq postures', value: '5' },
  ],
  cta: 'Rejoins-nous',
  ctaSub: 'Chaque matin',
};

let appels: string[];

function installerFetch() {
  appels = [];
  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    appels.push(u);
    const rep = (corps: unknown, status = 200) => ({
      ok: status >= 200 && status < 300, status, json: async () => corps,
      text: async () => JSON.stringify(corps),
      blob: async () => new Blob(['x']),
    } as unknown as Response);
    if (u.includes('/api/tts/elevenlabs')) {
      return rep({
        voices: [{ id: CLONEE, name: 'Bassi (ma voix)', lang: 'FR', gender: 'Neutral', flag: '🎤', provider: 'elevenlabs', cloned: true }],
        configured: true,
      });
    }
    if (u.includes('/api/tts/heygen')) return rep({ voices: [] });
    if (u.includes('/api/credits/balance')) return rep({ ok: true, politique: 'credits', balance: 5000 });
    if (u.includes('/api/render/tarifs')) return rep({ ok: true, politique: 'credits', tarifs: { reel: 10, tv: 15 } });
    return rep({ success: true, data: [], posts: [], content: {}, images: [], photos: [] });
  }) as unknown as typeof fetch;
}

/** Le brouillon de prod : commencé, du contenu, PAS de `ttsVoiceId`, des voix par séquence générées avec Henri. */
const poser = (step: number, extra: Record<string, unknown> = {}) => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step,
    customTopic: 'yoga du matin', generated: CONTENU, scheduledDate: '2026-09-01',
    sequenceVoices: {
      titre: { text: 'Yoga du matin. Reveiller le corps', audioUrl: 'https://cdn/titre.mp3', source: 'tts', ttsVoice: HENRI, textAtGeneration: 'Yoga du matin. Reveiller le corps' },
    },
    sequenceVoicesUserEdited: { titre: true, cartes: false, video: false, cta: false },
    ...extra,
  }));
};

const attendre = async (tours = 8) => {
  for (let i = 0; i < tours; i += 1) {
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  }
};
/** Laisse passer la pause d'écriture du brouillon (400 ms). */
const attendreAutosave = () => act(async () => { await new Promise((r) => setTimeout(r, 550)); });
const lireBrouillon = (): Record<string, unknown> => JSON.parse(window.localStorage.getItem(CLE) ?? '{}');

const monter = async () => {
  urlQuery = new URLSearchParams('');
  render(<AssistantWizard />);
  await attendre(6);
};

const selecteurGlobal = () => screen.getByTestId('tts-voice-select') as HTMLSelectElement;
const selecteurSequences = () => screen.getByTestId('seq-tts-voice-select') as HTMLSelectElement;

beforeEach(() => {
  window.localStorage.clear();
  // Le choix hors défaut qui empêchait la présélection de #418.
  window.localStorage.setItem('tts.voiceId', HENRI);
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  window.alert = () => {};
  installerFetch();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('« Utiliser ma voix » — une voix pour tout, persistée', () => {
  it('cas de prod : Henri en localStorage, brouillon sans voix → Créer affiche Henri, et la carte montre la voix clonée', async () => {
    poser(STEP_AUDIO);
    await monter();
    await waitFor(() => expect(document.querySelector(`[data-ma-voix-clonee-voix="${CLONEE}"]`)).not.toBeNull());
    expect(selecteurGlobal().value).toBe(HENRI);
    expect(document.querySelector(`[data-ma-voix-clonee-voix="${CLONEE}"]`)!.getAttribute('data-utilisee')).toBe('false');
    expect(screen.getByRole('button', { name: 'Utiliser ma voix' })).toBeTruthy();
  });

  it('clic → sélecteur global, brouillon et localStorage passent à la voix clonée ; la carte dit « utilisée »', async () => {
    poser(STEP_AUDIO);
    await monter();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Utiliser ma voix' })).not.toBeNull());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Utiliser ma voix' })); });
    expect(selecteurGlobal().value).toBe(CLONEE);
    expect(document.querySelector(`[data-ma-voix-clonee-voix="${CLONEE}"]`)!.getAttribute('data-utilisee')).toBe('true');
    expect(window.localStorage.getItem('tts.voiceId')).toBe(CLONEE);
    await attendreAutosave();
    expect(lireBrouillon().ttsVoiceId).toBe(CLONEE);
  });

  it('changement d étape : la voix par séquence suit (Continuer vers Contenu), et l audio Henri est signalé périmé', async () => {
    poser(STEP_AUDIO);
    await monter();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Utiliser ma voix' })).not.toBeNull());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Utiliser ma voix' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Continuer vers Contenu/ })); });
    await waitFor(() => expect(selecteurSequences().value).toBe(CLONEE), { timeout: 5000 });
    // Les voix par séquence avaient été générées avec Henri : signalées, pas supprimées, pas régénérées.
    await waitFor(() => expect(document.querySelector('[data-voice-stale="titre"]')).not.toBeNull());
    expect(document.querySelector('[data-voice-stale="titre"]')!.getAttribute('data-voice-stale-motif')).toBe('voix');
    expect(appels.filter((u) => u.includes('/api/tts/') && !u.includes('/api/tts/elevenlabs') && !u.includes('/api/tts/heygen'))).toHaveLength(0);
  });

  it('rechargement : les DEUX sélecteurs montrent la voix clonée, localStorage aussi', async () => {
    poser(STEP_AUDIO);
    await monter();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Utiliser ma voix' })).not.toBeNull());
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Utiliser ma voix' })); });
    await attendreAutosave();
    expect(lireBrouillon().ttsVoiceId).toBe(CLONEE);
    cleanup();

    // Rechargement sur l'étape Audio : le sélecteur global.
    await monter();
    await waitFor(() => expect(selecteurGlobal().value).toBe(CLONEE));
    await attendre(4);
    expect(selecteurGlobal().value).toBe(CLONEE);
    expect(window.localStorage.getItem('tts.voiceId')).toBe(CLONEE);
    await waitFor(() => expect(document.querySelector(`[data-ma-voix-clonee-voix="${CLONEE}"]`)!.getAttribute('data-utilisee')).toBe('true'));
    cleanup();

    // Rechargement sur l'étape Contenu (même brouillon, `step` avancé) : le sélecteur par séquence.
    const brouillon = lireBrouillon();
    expect(brouillon.ttsVoiceId).toBe(CLONEE);
    window.localStorage.setItem(CLE, JSON.stringify({ ...brouillon, step: STEP_CONTENU }));
    await monter();
    await waitFor(() => expect(selecteurSequences().value).toBe(CLONEE));
    await attendre(4);
    expect(selecteurSequences().value).toBe(CLONEE);
    expect(window.localStorage.getItem('tts.voiceId')).toBe(CLONEE);
    // L'audio « Henri » restauré du brouillon est toujours là, et signalé périmé.
    expect(document.querySelector('[data-voice-stale="titre"]')).not.toBeNull();
  });

  it('⚠️ sans clic, rien ne bouge : Henri reste, le brouillon n écrit pas de voix clonée', async () => {
    poser(STEP_AUDIO);
    await monter();
    await waitFor(() => expect(document.querySelector(`[data-ma-voix-clonee-voix="${CLONEE}"]`)).not.toBeNull());
    await attendreAutosave();
    expect(selecteurGlobal().value).toBe(HENRI);
    // Aucun choix remonté au wizard : le brouillon n'écrit pas de voix (règle #418), et surtout pas la clonée.
    expect(lireBrouillon().ttsVoiceId).not.toBe(CLONEE);
    expect(window.localStorage.getItem('tts.voiceId')).toBe(HENRI);
  });
});
