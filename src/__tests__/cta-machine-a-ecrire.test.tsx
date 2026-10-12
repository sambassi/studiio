/**
 * « MACHINE À ÉCRIRE » SUR LE CTA — les trois moteurs.
 *
 * Symptôme : Créer → Animation du texte → « Machine à écrire » : le titre
 * s'écrivait, mais la séquence CTA apparaissait D'UN BLOC.
 *
 * Causes, une par moteur :
 *   - Aperçu (`AssistantWizard` → `PlateContent`) : `SequenceTitle` et
 *     `SequenceCta` ne recevaient jamais `reveal`. `TextAnimationLayer` ne
 *     porte que fondu / glissement / pop ; la frappe, elle, passe par la
 *     troncature du texte — absente, le texte était entier dès la première
 *     image.
 *   - Export canvas (`drawCTA`) : la troncature visait le PARAMÈTRE
 *     `ctaText`, qui n'est que le REPLI du sous-texte (nommage historique du
 *     branding). Le gros texte réellement peint (`ctaMainText`) restait
 *     entier.
 *   - Remotion / `SequenceCta` : le sous-texte n'était jamais tronqué.
 *
 * Règle retenue — celle du titre et de son sous-titre (`drawIntro`,
 * `SequenceTitle`) : le texte principal ET le sous-texte s'écrivent ENSEMBLE,
 * à la même proportion, sur la fenêtre d'apparition (22 %). Les autres
 * animations ne touchent pas au texte.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

const FRAME = { n: 0 };
const DIM = { w: 1080, h: 1920 };
vi.mock('remotion', () => {
  const Div = ({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) => React.createElement('div', { style }, children);
  return {
    AbsoluteFill: Div, Audio: () => null, Img: () => null, OffthreadVideo: () => null,
    Sequence: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    useVideoConfig: () => ({ fps: 30, width: DIM.w, height: DIM.h, durationInFrames: 900 }),
    useCurrentFrame: () => FRAME.n, delayRender: () => 0, continueRender: () => undefined, interpolate: () => 0,
  };
});
vi.mock('@remotion/transitions', () => {
  const TS = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children);
  TS.Sequence = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children);
  TS.Transition = () => null;
  return { TransitionSeries: TS, linearTiming: () => ({}) };
});
vi.mock('@remotion/transitions/fade', () => ({ fade: () => ({}) }));
vi.mock('@remotion/transitions/slide', () => ({ slide: () => ({}) }));
vi.mock('@remotion/transitions/wipe', () => ({ wipe: () => ({}) }));
vi.mock('@remotion/transitions/iris', () => ({ iris: () => ({}) }));
vi.mock('@remotion/media-utils', () => ({ getAudioDurationInSeconds: async () => 1 }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }),
}));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

import { drawCTA } from '@/lib/video-composer';
import SequenceCta from '@/components/creer/SequenceCta';
import { CreerSimpleMontage } from '../../remotion/CreerSimpleMontage';
import AssistantWizard from '@/app/dashboard/creer/AssistantWizard';
import { INTRO_WINDOW, textAnimationState, type TextAnimation } from '@/lib/creer/textAnimation';
import { VIDEO_SIZE } from '@/lib/creer/designSpec';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

const FORMATS = ['9:16', '1:1', '16:9'] as const;
const CAS = {
  court: { main: 'GO', sub: '' },
  long: { main: 'RESERVEZ VOTRE BILAN SOMMEIL GRATUIT SUR AFROBOOST', sub: '' },
  'avec sous-texte': { main: 'JE ME LANCE', sub: 'LIEN EN BIO' },
} as const;
/** Instants de la séquence : début, dans la fenêtre d'apparition, après. */
const PROGRES = [0.01, 0.06, 0.12, 0.18, INTRO_WINDOW, 0.6];

/**
 * Suite qui ne recule jamais, partie d'au moins une lettre mais pas du texte
 * entier, et qui finit sur le texte entier. Un CTA court (« GO », 2 lettres)
 * ne peut pas grandir à CHAQUE échantillon : la monotonie suffit.
 */
function attendreProgressif(comptes: number[], total: number) {
  expect(comptes[0]).toBeLessThan(total);
  expect(comptes[0]).toBeGreaterThan(0);
  for (let i = 1; i < comptes.length; i++) expect(comptes[i]).toBeGreaterThanOrEqual(comptes[i - 1]);
  expect(comptes[comptes.length - 1]).toBe(total);
  // Un long CTA, lui, grandit à chaque échantillon de la fenêtre.
  if (total > 20) for (let i = 1; i < comptes.length - 1; i++) expect(comptes[i]).toBeGreaterThan(comptes[i - 1]);
}

// ── 1. Export canvas ──────────────────────────────────────────────────────
function contexteEnregistreur() {
  const peints: string[] = [];
  const etat: Record<string, unknown> = { globalAlpha: 1, filter: 'none' };
  const degrade = { addColorStop: () => {} };
  const base: Record<string, unknown> = {
    measureText: (t: string) => ({ width: Array.from(t).length * 10 }),
    fillText: (t: string) => { peints.push(t); },
    strokeText: () => {},
    save: () => {}, restore: () => {},
    translate: () => {}, rotate: () => {}, scale: () => {}, setTransform: () => {},
    beginPath: () => {}, closePath: () => {}, moveTo: () => {}, lineTo: () => {},
    arc: () => {}, rect: () => {}, roundRect: () => {}, clip: () => {},
    fill: () => {}, stroke: () => {}, setLineDash: () => {},
    fillRect: () => {}, clearRect: () => {}, strokeRect: () => {}, drawImage: () => {},
    createLinearGradient: () => degrade, createRadialGradient: () => degrade, createPattern: () => null,
  };
  const ctx = new Proxy(base, {
    get: (t, p) => (p in t ? (t as never)[p] : etat[p as string]),
    set: (_t, p, v) => { etat[p as string] = v; return true; },
    has: () => true,
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, peints };
}

/** Une frame de CTA peinte par le VRAI `drawCTA` : la trace des `fillText`. */
function peindreCta(format: (typeof FORMATS)[number], main: string, sub: string, progress: number, anim: TextAnimation) {
  const { w, h } = VIDEO_SIZE[format];
  const { ctx, peints } = contexteEnregistreur();
  drawCTA(ctx, w, h, '#7C3AED', '', '', undefined, undefined, null, progress,
    { ctaMainText: main, ctaSubTextDesign: sub, textAnimation: anim } as never);
  return peints;
}
const sansEspaces = (s: string) => s.replace(/\s+/g, '');

describe('Export canvas — `drawCTA` écrit le CTA lettre à lettre', () => {
  for (const format of FORMATS) {
    for (const [nom, c] of Object.entries(CAS)) {
      it(`${format}, CTA ${nom} : le texte peint grandit image après image`, () => {
        const total = sansEspaces(c.main + c.sub).length;
        const comptes = PROGRES.map((p) => sansEspaces(peindreCta(format, c.main, c.sub, p, 'typewriter').join('')).length);
        attendreProgressif(comptes, total);
        // Au tout début, le gros texte n'est PAS entier.
        expect(peindreCta(format, c.main, c.sub, 0.01, 'typewriter').join(' ')).not.toContain(c.main);
        // Fenêtre passée : principal et sous-texte entiers, exactement.
        const fin = peindreCta(format, c.main, c.sub, 0.6, 'typewriter').join(' ');
        expect(fin).toContain(c.main.split(' ')[0]);
        if (c.sub) expect(fin).toContain(c.sub);
      });
    }
  }

  it('principal et sous-texte s écrivent ENSEMBLE, à la même proportion (comme le titre)', () => {
    const r = textAnimationState('typewriter', 0.11).charRatio;
    expect(r).toBeCloseTo(0.5, 5);
    // « JE ME LANCE » (11) → 6 caractères, « LIEN EN BIO » (11) → 6.
    expect(peindreCta('9:16', 'JE ME LANCE', 'LIEN EN BIO', 0.11, 'typewriter')).toEqual(['JE ME ', 'LIEN E']);
  });

  it.each(['none', 'fade', 'slide', 'pop'] as const)('« %s » ne touche pas au texte', (anim) => {
    for (const p of PROGRES) {
      expect(peindreCta('9:16', 'JE ME LANCE', 'LIEN EN BIO', p, anim)).toEqual(['JE ME LANCE', 'LIEN EN BIO']);
    }
  });
});

// ── 2. Composant partagé (aperçu ET Remotion) ─────────────────────────────
const TYPO_C = { font: 'Inter', color: '#FFFFFF', subColor: '#EC4899', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 };

describe('`SequenceCta` — principal et sous-texte tronqués ensemble', () => {
  afterEach(cleanup);
  for (const format of FORMATS) {
    it(`${format} : la révélation s applique aux deux lignes`, () => {
      const { container } = render(
        <SequenceCta text="JE ME LANCE" subText="LIEN EN BIO" typography={TYPO_C}
          format={format} containerWidth={VIDEO_SIZE[format].w} reveal={0.5} />,
      );
      expect(container.textContent).toBe('JE ME LIEN E');
    });
  }
  it('sans `reveal` : le CTA entier, le rendu d aujourd hui', () => {
    const { container } = render(
      <SequenceCta text="JE ME LANCE" subText="LIEN EN BIO" typography={TYPO_C} format="9:16" containerWidth={1080} />,
    );
    expect(container.textContent).toBe('JE ME LANCELIEN EN BIO');
  });
});

// ── 3. Rendu serveur Remotion ─────────────────────────────────────────────
describe('Remotion — `CreerSimpleMontage` écrit le CTA à l image', () => {
  afterEach(cleanup);
  const FPS = 30, SECONDES = 4;
  for (const format of FORMATS) {
    for (const [nom, c] of Object.entries(CAS)) {
      it(`${format}, CTA ${nom} : le texte visible grandit d image en image`, () => {
        DIM.w = VIDEO_SIZE[format].w; DIM.h = VIDEO_SIZE[format].h;
        const props = {
          format, title: '', cards: [], ctaText: c.main, ctaSubText: c.sub || undefined,
          introDuration: 0, cardsDuration: 0, videoDuration: 0, ctaDuration: SECONDES,
          sequenceOrder: ['cta'], textAnimation: 'typewriter',
        } as unknown as React.ComponentProps<typeof CreerSimpleMontage>;
        const total = sansEspaces(c.main + c.sub).length;
        const comptes = PROGRES.map((p) => {
          FRAME.n = Math.round(p * SECONDES * FPS);
          const { container } = render(<CreerSimpleMontage {...props} />);
          const cadre = [...container.querySelectorAll('div')].find((d) => d.style.transform === 'translate(-50%, -100%)');
          const n = sansEspaces(cadre?.textContent ?? '').length;
          cleanup();
          return n;
        });
        attendreProgressif(comptes, total);
      });
    }
  }
});

// ── 4. Aperçu Créer (jsdom, lecteur de séquences) ─────────────────────────
describe('Aperçu Créer — « Machine à écrire » joue le CTA lettre à lettre', () => {
  let clientWidthOriginal: PropertyDescriptor | undefined;
  beforeEach(() => {
    window.localStorage.clear();
    clientWidthOriginal = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 400; } });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/pexels')) return { ok: true, json: async () => ({ success: true, photos: [] }) };
      if (String(url).startsWith('/api/autopilot/config')) {
        return { ok: true, json: async () => ({ success: true, ready: true, brandingReady: true, styleReady: true, config: {} }) };
      }
      return { ok: true, json: async () => ({ success: true }) };
    }));
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (clientWidthOriginal) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthOriginal);
  });
  const avancer = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };

  it('9:16 : depuis l onglet CTA, l extrait écrit le CTA, puis le montre entier', async () => {
    render(<AssistantWizard />);
    fireEvent.click(screen.getByRole('button', { name: 'Créer une vidéo' }));
    fireEvent.click(screen.getByText('Continuer vers Style'));
    await waitFor(() => expect(document.querySelector('[data-cta-block]')).toBeTruthy());
    // Le CTA de l'éditeur, entier sur le plateau : la référence.
    const entier = sansEspaces((document.querySelector('[data-cta-block]') as HTMLElement).textContent ?? '');
    expect(entier.length).toBeGreaterThan(4);
    fireEvent.click(screen.getByRole('tab', { name: 'CTA' }));
    fireEvent.click(document.querySelector('[data-text-animation="typewriter"]') as HTMLElement);
    expect(document.querySelector('[data-sequence-playback]')?.getAttribute('data-sequence-extract')).toBe('cta');
    const comptes: number[] = [];
    // Fenêtre d'apparition : 22 % de la séquence CTA. Échantillons de 160 ms.
    for (let i = 0; i < 6; i++) {
      await avancer(i === 0 ? 16 : 160);
      const calque = document.querySelector('[data-playback-layer="a"]') as HTMLElement;
      expect(calque.getAttribute('data-playback-sequence')).toBe('cta');
      comptes.push(sansEspaces(calque.querySelector('[data-cta-block]')?.textContent ?? '').length);
    }
    expect(comptes[0]).toBeLessThan(entier.length);
    expect(comptes[0]).toBeGreaterThan(0);
    for (let i = 1; i < comptes.length; i++) expect(comptes[i]).toBeGreaterThanOrEqual(comptes[i - 1]);
    expect(comptes[comptes.length - 1]).toBeGreaterThan(comptes[0]);
  });
});
