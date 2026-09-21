import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { TRANSITION_KEYS, TRANSITION_LABELS, TEXT_ANIMATION_KEYS, TEXT_ANIMATION_LABELS } from '@/lib/video-composer';
import { REDUCED_MOTION_QUERY } from '@/lib/hooks/usePrefersReducedMotion';
import TransitionMiniPreview from '@/components/creer/TransitionMiniPreview';
import TextAnimationMiniPreview from '@/components/creer/TextAnimationMiniPreview';
import SequencePlayback from '@/components/creer/SequencePlayback';

/**
 * Vignettes animées des transitions et des animations de texte, et lecteur
 * de séquences.
 *
 * Ce qui est vérifié, dans l'ordre d'importance :
 *
 * 1. Les vignettes n'altèrent pas le contrat des boutons d'option
 *    (`aria-pressed`, `data-transition`, `data-text-animation`) : le choix
 *    reste un choix, la vignette n'est qu'un ornement.
 * 2. Une vignette joue au survol, au clavier, quand l'option est choisie, ou
 *    par son bouton de lecture explicite — et JAMAIS avec la réduction des
 *    animations.
 * 3. Le lecteur de séquences choisit la bonne paire de calques à un instant
 *    donné, expose Lecture / Pause aux lecteurs d'écran, et lâche son
 *    `requestAnimationFrame` au démontage.
 */

// jsdom ne connait pas `ResizeObserver`, dont l'apercu se sert pour mesurer.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }),
}));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

import AssistantWizard from '@/app/dashboard/creer/AssistantWizard';

/** Pose `matchMedia` avec la préférence de réduction voulue. */
function poserMatchMedia(reduire: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: reduire,
    media: REDUCED_MOTION_QUERY,
    addEventListener: (_: string, fn: () => void) => { listeners.add(fn); },
    removeEventListener: (_: string, fn: () => void) => { listeners.delete(fn); },
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  };
  // Le MÊME objet à chaque appel pour notre requête : un vrai
  // `MediaQueryList` met à jour son `matches` sur place, et c'est lui que le
  // hook relit au changement.
  const autre = { ...mql, matches: false, media: 'autre' };
  vi.stubGlobal('matchMedia', vi.fn((q: string) => (q === REDUCED_MOTION_QUERY ? mql : autre)));
  return {
    basculer(v: boolean) {
      mql.matches = v;
      listeners.forEach((fn) => fn());
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/pexels')) {
      return { ok: true, json: async () => ({ success: true, photos: [] }) };
    }
    if (String(url).startsWith('/api/autopilot/config')) {
      return { ok: true, json: async () => ({ success: true, ready: true, brandingReady: true, styleReady: true, config: {} }) };
    }
    return { ok: true, json: async () => ({ success: true }) };
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Ouvre l'assistant jusqu'à l'étape Style, section Transition dépliée. */
async function ouvrirStyle() {
  render(<AssistantWizard />);
  fireEvent.click(screen.getByRole('button', { name: 'Créer une vidéo' }));
  fireEvent.click(screen.getByText('Continuer vers Style'));
  await waitFor(() => expect(document.querySelector('[data-title-block]')).toBeTruthy());
  fireEvent.click(document.querySelector('[aria-controls="section-transition"]') as HTMLElement);
}

const mini = (style: string) => document.querySelector(`[data-transition-mini="${style}"]`) as HTMLElement | null;
const joue = (style: string) => mini(style)?.getAttribute('data-transition-mini-playing');

// ─────────────────────────────────────────────────────────────────────────
describe('A — les vignettes vivent DANS chaque option, sans en changer le contrat', () => {
  it('chaque transition a sa vignette, à l intérieur de son bouton', async () => {
    await ouvrirStyle();
    for (const style of TRANSITION_KEYS) {
      const bouton = document.querySelector(`[data-transition="${style}"]`) as HTMLElement;
      expect(bouton, style).toBeTruthy();
      expect(bouton.tagName).toBe('BUTTON');
      expect(bouton.contains(mini(style)), style).toBe(true);
      // Le libellé reste celui du compositeur.
      expect(bouton.textContent).toContain(TRANSITION_LABELS[style]);
    }
  });

  it('chaque animation de texte a sa vignette, à l intérieur de son bouton', async () => {
    await ouvrirStyle();
    for (const style of TEXT_ANIMATION_KEYS) {
      const bouton = document.querySelector(`[data-text-animation="${style}"]`) as HTMLElement;
      expect(bouton, style).toBeTruthy();
      expect(bouton.contains(document.querySelector(`[data-text-animation-mini="${style}"]`)), style).toBe(true);
      expect(bouton.textContent).toContain(TEXT_ANIMATION_LABELS[style]);
    }
  });

  it('`aria-pressed` suit le CHOIX, pas la lecture de la vignette', async () => {
    await ouvrirStyle();
    expect(document.querySelector('[data-transition="crossfade"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-transition="slide"]')?.getAttribute('aria-pressed')).toBe('false');
    // Survoler ne choisit pas.
    fireEvent.pointerEnter(document.querySelector('[data-transition="slide"]') as HTMLElement);
    expect(document.querySelector('[data-transition="slide"]')?.getAttribute('aria-pressed')).toBe('false');
    // Épingler par le bouton de lecture ne choisit pas non plus.
    fireEvent.click(document.querySelector('[data-transition-play="wipe"]') as HTMLElement);
    expect(document.querySelector('[data-transition="wipe"]')?.getAttribute('aria-pressed')).toBe('false');
    // Choisir, si.
    fireEvent.click(document.querySelector('[data-transition="slide"]') as HTMLElement);
    expect(document.querySelector('[data-transition="slide"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-transition="crossfade"]')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('les vignettes sont décoratives : `aria-hidden`, inertes aux pointeurs', async () => {
    await ouvrirStyle();
    const v = mini('crossfade')!;
    expect(v.getAttribute('aria-hidden')).toBe('true');
    expect(v.style.pointerEvents).toBe('none');
  });

  it('le bouton de lecture est un bouton FRÈRE, nommé, jamais imbriqué dans l option', async () => {
    // Un bouton dans un bouton n'est pas du HTML valide ; le clavier
    // n'atteindrait que l'extérieur.
    await ouvrirStyle();
    const lecture = document.querySelector('[data-transition-play="iris"]') as HTMLElement;
    expect(lecture.tagName).toBe('BUTTON');
    expect(lecture.getAttribute('aria-label')).toBe(`Lire l’aperçu de ${TRANSITION_LABELS.iris}`);
    expect(lecture.closest('[data-transition]')).toBeNull();
    const lectureTexte = document.querySelector('[data-text-animation-play="pop"]') as HTMLElement;
    expect(lectureTexte.getAttribute('aria-label')).toBe(`Lire l’aperçu de ${TEXT_ANIMATION_LABELS.pop}`);
    expect(lectureTexte.closest('[data-text-animation]')).toBeNull();
  });

  it('les options gardent un anneau de focus visible', async () => {
    await ouvrirStyle();
    expect((document.querySelector('[data-transition="zoom"]') as HTMLElement).className).toContain('focus-visible:ring-1');
    expect((document.querySelector('[data-text-animation="fade"]') as HTMLElement).className).toContain('focus-visible:ring-1');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('B — quand une vignette joue', () => {
  it('l option CHOISIE joue ; les autres sont immobiles', async () => {
    await ouvrirStyle();
    expect(joue('crossfade')).toBe('true');
    expect(joue('slide')).toBe('false');
    expect(joue('whip-pan')).toBe('false');
  });

  it('au SURVOL (souris)', async () => {
    await ouvrirStyle();
    const slide = document.querySelector('[data-transition="slide"]') as HTMLElement;
    fireEvent.pointerEnter(slide);
    expect(joue('slide')).toBe('true');
    fireEvent.pointerLeave(slide);
    expect(joue('slide')).toBe('false');
  });

  it('au FOCUS (clavier)', async () => {
    await ouvrirStyle();
    const wipe = document.querySelector('[data-transition="wipe"]') as HTMLElement;
    fireEvent.focus(wipe);
    expect(joue('wipe')).toBe('true');
    fireEvent.blur(wipe);
    expect(joue('wipe')).toBe('false');
  });

  it('par le bouton de lecture (mobile) — bascule, et un seul épinglé à la fois', async () => {
    await ouvrirStyle();
    const lireIris = document.querySelector('[data-transition-play="iris"]') as HTMLElement;
    fireEvent.click(lireIris);
    expect(joue('iris')).toBe('true');
    expect(lireIris.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(document.querySelector('[data-transition-play="push"]') as HTMLElement);
    expect(joue('push')).toBe('true');
    expect(joue('iris')).toBe('false');
    fireEvent.click(document.querySelector('[data-transition-play="push"]') as HTMLElement);
    expect(joue('push')).toBe('false');
  });

  it('les deux grilles sont indépendantes', async () => {
    await ouvrirStyle();
    fireEvent.click(document.querySelector('[data-transition-play="zoom"]') as HTMLElement);
    expect(document.querySelector('[data-text-animation-mini="zoom"]')).toBeNull();
    // L'animation de texte choisie (« Aucune ») joue de son côté ; « Pop »
    // reste immobile tant qu'on ne le touche pas.
    expect(document.querySelector('[data-text-animation-mini="pop"]')?.getAttribute('data-text-animation-mini-playing')).toBe('false');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('C — la réduction des animations fige TOUT', () => {
  it('avec `prefers-reduced-motion: reduce`, ni choix, ni survol, ni épingle ne font jouer', async () => {
    poserMatchMedia(true);
    await ouvrirStyle();
    expect(joue('crossfade')).toBe('false');
    fireEvent.pointerEnter(document.querySelector('[data-transition="slide"]') as HTMLElement);
    expect(joue('slide')).toBe('false');
    fireEvent.click(document.querySelector('[data-transition-play="iris"]') as HTMLElement);
    expect(joue('iris')).toBe('false');
    expect(document.querySelector('[data-text-animation-mini="none"]')?.getAttribute('data-text-animation-mini-playing')).toBe('false');
  });

  it('la préférence changée en cours de route est suivie', async () => {
    const mm = poserMatchMedia(false);
    await ouvrirStyle();
    expect(joue('crossfade')).toBe('true');
    act(() => mm.basculer(true));
    expect(joue('crossfade')).toBe('false');
    act(() => mm.basculer(false));
    expect(joue('crossfade')).toBe('true');
  });

  it('immobile, la vignette de transition montre l instant MÉDIAN (t = 0,5)', () => {
    render(<TransitionMiniPreview style="slide" playing={false} />);
    const a = document.querySelector('[data-transition-mini-layer="a"]') as HTMLElement;
    const b = document.querySelector('[data-transition-mini-layer="b"]') as HTMLElement;
    expect(a.style.transform).toBe('translateX(-50%)');
    expect(b.style.transform).toBe('translateX(50%)');
  });

  it('immobile, la vignette de texte montre le texte ENTIER', () => {
    render(<TextAnimationMiniPreview style="typewriter" playing={false} />);
    expect(document.querySelector('[data-text-animation-mini="typewriter"]')?.textContent).toBe('Titre');
  });

  it('la vignette suit le format : plus large que haute en 16:9, l inverse en 9:16', () => {
    render(<TransitionMiniPreview style="wipe" playing={false} aspect="16 / 9" height={40} />);
    const large = document.querySelector('[data-transition-mini="wipe"]') as HTMLElement;
    expect(parseFloat(large.style.width)).toBeGreaterThan(parseFloat(large.style.height));
    cleanup();
    render(<TransitionMiniPreview style="wipe" playing={false} aspect="9 / 16" height={40} />);
    const haute = document.querySelector('[data-transition-mini="wipe"]') as HTMLElement;
    expect(parseFloat(haute.style.width)).toBeLessThan(parseFloat(haute.style.height));
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('D — le lecteur de séquences', () => {
  const steps = [{ key: 'intro', seconds: 4 }, { key: 'cards', seconds: 6 }, { key: 'cta', seconds: 4 }];
  const rendu = vi.fn(({ key, progress }: { key: string; progress: number }) => (
    <div data-calque-test={key} data-calque-progress={progress.toFixed(3)} />
  ));

  function monter(transition: 'crossfade' | 'slide' = 'slide') {
    return render(
      <div style={{ position: 'relative', width: 400, height: 711 }}>
        <SequencePlayback
          steps={steps}
          transition={transition}
          frame={{ w: 1080, h: 1920, scale: 400 / 1080 }}
          renderLayer={rendu}
        />
      </div>,
    );
  }

  /** Avance l'horloge de `ms` : `performance.now` et une image. */
  async function avancer(ms: number) {
    await act(async () => { vi.advanceTimersByTime(ms); });
  }

  beforeEach(() => {
    rendu.mockClear();
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout', 'Date'] });
  });

  it('à l arrêt : un bouton « Lire » nommé, AUCUN calque — le plateau reste éditable', () => {
    monter();
    const lire = screen.getByRole('button', { name: 'Lire les séquences dans l’ordre du montage' });
    expect(lire.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('[data-playback-stage]')).toBeNull();
    expect(rendu).not.toHaveBeenCalled();
    // Le conteneur laisse passer les pointeurs vers le plateau.
    expect((document.querySelector('[data-sequence-playback]') as HTMLElement).style.pointerEvents).toBe('none');
  });

  it('en lecture : Pause nommée, la première séquence seule, puis la paire pendant la fenêtre', async () => {
    monter('slide');
    fireEvent.click(screen.getByRole('button', { name: 'Lire les séquences dans l’ordre du montage' }));
    expect(screen.getByRole('button', { name: 'Mettre en pause la lecture des séquences' })).toBeTruthy();
    await avancer(16);
    expect(document.querySelector('[data-playback-layer="a"]')?.getAttribute('data-playback-sequence')).toBe('intro');
    expect(document.querySelector('[data-playback-layer="b"]')).toBeNull();

    // 3,6 s : fenêtre intro → cartes, à mi-course (3,2 + 0,4).
    await avancer(3600 - 16);
    const a = document.querySelector('[data-playback-layer="a"]') as HTMLElement;
    const b = document.querySelector('[data-playback-layer="b"]') as HTMLElement;
    expect(a.getAttribute('data-playback-sequence')).toBe('intro');
    expect(b.getAttribute('data-playback-sequence')).toBe('cards');
    // `slide` à e = easeInOut(0,5) = 0,5 : A à -50 %, B à +50 % (l'horloge
    // factice compte en millisecondes entières : tolérance flottante).
    const pct = (el: HTMLElement) => Number(/translateX\((-?[\d.]+)%\)/.exec(el.style.transform)![1]);
    expect(pct(a)).toBeCloseTo(-50, 3);
    expect(pct(b)).toBeCloseTo(50, 3);
    // La sortante est dessinée finie, l'entrante à t × 0,3 — la règle du canvas.
    expect(Number(document.querySelector('[data-calque-test="intro"]')?.getAttribute('data-calque-progress'))).toBeCloseTo(0.9, 2);
    expect(Number(document.querySelector('[data-calque-test="cards"]')?.getAttribute('data-calque-progress'))).toBeCloseTo(0.15, 2);
    expect(document.querySelector('[data-playback-label]')?.textContent).toBe('Titre → Cartes');

    // 5 s : les cartes seules.
    await avancer(1400);
    expect(document.querySelector('[data-playback-layer="a"]')?.getAttribute('data-playback-sequence')).toBe('cards');
    expect(document.querySelector('[data-playback-layer="b"]')).toBeNull();
  });

  it('la scène capte les pointeurs pendant la lecture, et disparaît à la pause', async () => {
    monter();
    fireEvent.click(screen.getByRole('button', { name: /Lire les séquences/ }));
    await avancer(100);
    expect((document.querySelector('[data-playback-stage]') as HTMLElement).style.pointerEvents).toBe('auto');
    fireEvent.click(screen.getByRole('button', { name: /Mettre en pause/ }));
    expect(document.querySelector('[data-playback-stage]')).toBeNull();
    expect(screen.getByRole('button', { name: /Lire les séquences/ })).toBeTruthy();
  });

  it('à la fin du montage, la lecture s arrête d elle-même et revient au début', async () => {
    monter();
    fireEvent.click(screen.getByRole('button', { name: /Lire les séquences/ }));
    await avancer(14_100);
    expect(document.querySelector('[data-playback-stage]')).toBeNull();
    expect(document.querySelector('[data-sequence-playback]')?.getAttribute('data-sequence-playing')).toBe('false');
  });

  it('le démontage annule l image suivante', async () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount } = monter();
    fireEvent.click(screen.getByRole('button', { name: /Lire les séquences/ }));
    await avancer(50);
    cancel.mockClear();
    unmount();
    expect(cancel).toHaveBeenCalled();
    cancel.mockRestore();
  });

  it('sans séquence jouable, rien n est rendu', () => {
    render(<SequencePlayback steps={[{ key: 'intro', seconds: 0 }]} transition="crossfade" frame={{ w: 1080, h: 1920 }} renderLayer={rendu} />);
    expect(document.querySelector('[data-sequence-playback]')).toBeNull();
  });
});
