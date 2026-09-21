/**
 * La voix TTS choisie dans Créer survit au rechargement — PAR LE BROUILLON.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Le choix de voix ne vivait que dans `localStorage['tts.voiceId']`, hors du
 * brouillon : le wizard ne le connaissait pas, et un identifiant
 * `elevenlabs-…` y était de surcroît rejeté au rechargement. La voix clonée
 * « Bassi » choisie la veille revenait en « Denise ».
 *
 * Ce fichier monte le VRAI wizard sur l'étape Audio, choisit la voix clonée
 * dans le vrai sélecteur, attend l'écriture du brouillon, démonte, EFFACE la
 * clé localStorage (pour prouver que c'est bien le brouillon qui restaure),
 * remonte, et lit le DOM.
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
import { draftKey, DRAFT_VERSION, sanitizeDraft, type SanitizeDeps } from '../lib/creer/draft';

const CLE = draftKey('a@b.c');
const CLONEE = 'elevenlabs-MaVoixClonee01';
const DEFAUT = 'fr-FR-DeniseNeural';
const HENRI = 'fr-FR-HenriNeural';
const CONTENU = {
  title: 'Yoga du matin',
  subtitle: 'Reveiller le corps',
  cards: [
    { icon: 'Heart', title: 'Respirer', description: 'Trois minutes', value: '3' },
    { icon: 'Zap', title: 'Bouger', description: 'Cinq postures', value: '5' },
  ],
};

let voixClonees: Array<Record<string, unknown>>;
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
    if (u.includes('/api/tts/elevenlabs')) return rep({ voices: voixClonees, configured: false });
    if (u.includes('/api/tts/heygen')) return rep({ voices: [] });
    if (u.includes('/api/credits/balance')) return rep({ ok: true, politique: 'credits', balance: 5000 });
    if (u.includes('/api/render/tarifs')) return rep({ ok: true, politique: 'credits', tarifs: { reel: 10, tv: 15 } });
    return rep({ success: true, data: [], posts: [], content: {}, images: [], photos: [] });
  }) as unknown as typeof fetch;
}

/** Un brouillon commencé, ouvert sur l'étape Audio (2), avec du contenu. */
const poser = (extra: Record<string, unknown> = {}) => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 2,
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

const selecteur = () => screen.getByTestId('tts-voice-select') as HTMLSelectElement;
const choisir = async (id: string) => {
  await waitFor(() => expect(Array.from(selecteur().options).some((o) => o.value === id)).toBe(true));
  await act(async () => { fireEvent.change(selecteur(), { target: { value: id } }); });
};

beforeEach(() => {
  window.localStorage.clear();
  sessionState = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
  window.alert = () => {};
  voixClonees = [{
    id: CLONEE, name: 'Bassi (ma voix)', lang: 'FR', gender: 'Neutral', flag: '🎤', provider: 'elevenlabs', cloned: true,
  }];
  installerFetch();
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Voix TTS : choisie, enregistrée dans le brouillon, restaurée', () => {
  it('(a) le sélecteur de l étape Audio liste la voix clonée reçue de /api/tts/elevenlabs', async () => {
    poser();
    await monter();
    await waitFor(() => expect(Array.from(selecteur().options).map((o) => o.value)).toContain(CLONEE));
    expect(appels.some((u) => u.includes('/api/tts/elevenlabs'))).toBe(true);
  });

  it('(b) un choix explicite est écrit dans le brouillon sous `ttsVoiceId`', async () => {
    poser();
    await monter();
    await choisir(HENRI);
    await attendreAutosave();
    expect(lireBrouillon().ttsVoiceId).toBe(HENRI);
  });

  it('(c) la voix clonée choisie revient après rechargement — même sans localStorage', async () => {
    poser();
    await monter();
    await choisir(CLONEE);
    await attendreAutosave();
    expect(lireBrouillon().ttsVoiceId).toBe(CLONEE);

    cleanup();
    // La clé locale est effacée : seul le brouillon peut restaurer le choix.
    window.localStorage.removeItem('tts.voiceId');
    await monter();
    await waitFor(() => expect(selecteur().value).toBe(CLONEE));
  });

  it('(d) un brouillon qui porte une voix standard n est pas remplacé par la voix clonée', async () => {
    // Le compte a une voix clonée, mais l'utilisateur avait choisi Henri :
    // la présélection ne doit pas défaire un choix restauré.
    poser({ ttsVoiceId: HENRI });
    await monter();
    await attendre(4);
    expect(selecteur().value).toBe(HENRI);
    await attendreAutosave();
    expect(lireBrouillon().ttsVoiceId).toBe(HENRI);
  });

  it('(e) un brouillon sans voix, un compte avec voix clonée → la voix clonée est proposée d office', async () => {
    poser();
    await monter();
    await waitFor(() => expect(selecteur().value).toBe(CLONEE));
    await attendreAutosave();
    expect(lireBrouillon().ttsVoiceId).toBe(CLONEE);
  });

  it('(f) un brouillon sans voix et sans voix clonée → Denise, comme avant', async () => {
    voixClonees = [];
    poser();
    await monter();
    await attendre(4);
    expect(selecteur().value).toBe(DEFAUT);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Le sanitiseur : ce champ est optionnel et ne fait confiance à rien
// ────────────────────────────────────────────────────────────────────────────

const DEPS: SanitizeDeps = {
  themeIds: ['sommeil', 'nutrition'],
  toneIds: ['punchy', 'pro'],
  formats: ['9:16', '1:1', '16:9'],
  maxStep: 3,
  defaults: {
    themeId: 'sommeil',
    toneId: 'punchy',
    format: '9:16',
    titleStyle: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
    subtitleStyle: { font: null, color: null, scale: 1 },
    ctaStyle: { font: 'Inter', color: '#FFFFFF', subColor: '', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
    sequences: [
      { key: 'intro', enabled: true },
      { key: 'cards', enabled: true },
      { key: 'video', enabled: false },
      { key: 'cta', enabled: true },
    ],
    durations: { intro: 4, cards: 6, video: 0, cta: 4 },
  },
};

const valide = (over: Record<string, unknown> = {}) => ({
  version: DRAFT_VERSION, savedAt: 1, started: true, step: 1,
  themeId: 'nutrition', toneId: 'pro', format: '1:1',
  titleStyle: DEPS.defaults.titleStyle, subtitleStyle: DEPS.defaults.subtitleStyle,
  ctaStyle: DEPS.defaults.ctaStyle, sequences: DEPS.defaults.sequences,
  ...over,
});

describe('sanitizeDraft — ttsVoiceId', () => {
  it('relit un identifiant de voix bien formé, quel que soit le fournisseur', () => {
    for (const id of [CLONEE, 'heygen-abc_123', 'openai-nova', 'fr-FR-DeniseNeural', 'en-US-AriaNeural']) {
      expect(sanitizeDraft(valide({ ttsVoiceId: id }), DEPS)!.ttsVoiceId, id).toBe(id);
    }
  });

  it('absent → absent : un brouillon antérieur se relit exactement comme avant', () => {
    expect(sanitizeDraft(valide(), DEPS)!.ttsVoiceId).toBeUndefined();
    expect(DRAFT_VERSION).toBe(1);
  });

  it('écarte ce qui n est pas un identifiant : type, longueur, caractères', () => {
    expect(sanitizeDraft(valide({ ttsVoiceId: 42 }), DEPS)!.ttsVoiceId).toBeUndefined();
    expect(sanitizeDraft(valide({ ttsVoiceId: '' }), DEPS)!.ttsVoiceId).toBeUndefined();
    expect(sanitizeDraft(valide({ ttsVoiceId: 'a'.repeat(121) }), DEPS)!.ttsVoiceId).toBeUndefined();
    expect(sanitizeDraft(valide({ ttsVoiceId: 'a'.repeat(120) }), DEPS)!.ttsVoiceId).toBe('a'.repeat(120));
    expect(sanitizeDraft(valide({ ttsVoiceId: 'elevenlabs-<script>' }), DEPS)!.ttsVoiceId).toBeUndefined();
    expect(sanitizeDraft(valide({ ttsVoiceId: 'Google français' }), DEPS)!.ttsVoiceId).toBeUndefined();
    expect(sanitizeDraft(valide({ ttsVoiceId: { id: CLONEE } }), DEPS)!.ttsVoiceId).toBeUndefined();
  });
});
