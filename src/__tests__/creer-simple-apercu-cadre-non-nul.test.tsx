import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

/**
 * L'aperçu doit avoir une TAILLE, pas seulement un contenu.
 *
 * ⚠️ C'EST L'ANGLE MORT QUI A LAISSÉ PASSER UN APERÇU VIDE EN PRODUCTION.
 * Tous les tests d'aperçu du dépôt vérifiaient la PRÉSENCE : le titre est dans
 * le DOM, sa police est la bonne, sa couleur aussi. Tous passaient pendant que
 * l'écran était noir — parce que le plateau recevait `transform: scale(0)` et
 * que tout son contenu mesurait 0 × 0. Présent, stylé, invisible, et sans la
 * moindre erreur en console : un `scale(0)` est une mise en page valide.
 *
 * La cause : le cadre de l'assistant n'est monté qu'après « Commencer »
 * (`{!started ? … : …}`, PR #326), alors que l'effet de mesure tournait au
 * montage de l'ÉCRAN. `frameRef.current` valait `null`, l'effet sortait, et
 * ses dépendances `[format]` ne changeant jamais il ne repassait plus.
 *
 * ⚠️ CE QUE CE TEST MESURE, ET COMMENT. jsdom n'a pas de moteur de mise en
 * page : `getBoundingClientRect` y rend toujours 0, donc mesurer « pour de
 * vrai » est impossible. On donne donc au cadre une largeur — la seule chose
 * que le code lit (`clientWidth`) — et on vérifie **l'échelle réellement
 * appliquée au plateau**. C'est exactement la valeur qui valait 0 en
 * production.
 */

// jsdom ne connait pas `ResizeObserver`.
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

import AssistantWizard from '@/app/dashboard/creer-simple/AssistantWizard';

/** Largeur donnée à TOUT élément : la seule mesure que le code consulte. */
const LARGEUR_CADRE = 400;

let clientWidthOriginal: PropertyDescriptor | undefined;

beforeEach(() => {
  // ⚠️ L'ASSISTANT ENREGISTRE SON BROUILLON. Sans ce nettoyage, le test
  // suivant repart dans l'etat ou le precedent s'est arrete — deja demarre,
  // donc sans bouton « Commencer » — et echoue pour une raison qui n'a rien
  // a voir avec ce qu'il verifie.
  window.localStorage.clear();
  clientWidthOriginal = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() { return LARGEUR_CADRE; },
  });
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
  if (clientWidthOriginal) {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthOriginal);
  }
});

/** Le plateau : l'élément que `transform: scale()` réduit. */
function plateau(): HTMLElement | null {
  return document.querySelector('[data-title-block]')?.parentElement ?? null;
}

/**
 * Ouvre l'assistant JUSQU'A l'etape Style.
 *
 * ⚠️ « Commencer » NE SUFFIT PAS. Il mene a l'etape Sujet, ou rien n'est
 * encore genere : l'apercu n'y montre qu'un cadre en pointilles, sans titre —
 * donc sans plateau a mesurer. C'est « Continuer » qui declenche la
 * generation, et c'est la seule etape ou le bug se voyait.
 */
async function ouvrirStyle() {
  render(<AssistantWizard />);
  fireEvent.click(screen.getByText('Commencer'));
  fireEvent.click(screen.getByText('Continuer'));
  await waitFor(() => expect(document.querySelector('[data-title-block]')).toBeTruthy());
}

/** L'échelle réellement appliquée au plateau, ou 0 si aucune. */
function echelle(): number {
  const el = plateau();
  if (!el) return 0;
  const m = /scale\(([\d.]+)\)/.exec(el.style.transform || '');
  return m ? Number(m[1]) : 0;
}

// ─────────────────────────────────────────────────────────────────────────
describe('L aperçu de l assistant a une taille', () => {
  it('le plateau est réduit à une échelle NON NULLE une fois l assistant démarré', async () => {
    // ⚠️ LE TEST QUI MANQUAIT. Avant le correctif, l'échelle restait à 0 :
    // le plateau et tout son contenu mesuraient 0 × 0, l'écran était noir, et
    // aucun test ne le voyait puisque le titre était bien dans le DOM.
    await ouvrirStyle();
    await waitFor(() => {
      expect(echelle()).toBeGreaterThan(0);
    });
    // Et c'est bien la largeur du cadre rapportée à celle de la vidéo.
    expect(echelle()).toBeCloseTo(LARGEUR_CADRE / 1080, 5);
  });

  it('le titre est peint DANS ce plateau, pas ailleurs', async () => {
    // Une échelle correcte sur un plateau qui ne contient pas le titre ne
    // servirait à rien : c'est la conjonction qui fait un aperçu visible.
    await ouvrirStyle();
    const bloc = document.querySelector('[data-title-block]');
    expect(bloc).toBeTruthy();
    expect(plateau()?.contains(bloc!)).toBe(true);
  });

  it('le cadre porte son ratio en style EN LIGNE, jamais en classe arbitraire', async () => {
    // ⚠️ PIEGE CONNU DU DEPOT (CLAUDE.md #4) : les classes Tailwind
    // arbitraires (`aspect-[9/16]`) sont PURGEES en production — le cadre y
    // tomberait à 0 alors que le développement est correct.
    await ouvrirStyle();
    const cadre = plateau()?.parentElement as HTMLElement;
    expect(cadre.style.aspectRatio).toBe('9 / 16');
    expect(cadre.className).not.toMatch(/aspect-\[/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('L aperçu de l Autopilote garde sa taille', () => {
  it('son plateau est réduit dès l affichage, sans rien démarrer', async () => {
    // Il n'était pas touché — il se monte en même temps que son cadre — mais
    // il partage désormais la MEME règle de mesure : le vérifier interdit de
    // corriger l'un en cassant l'autre.
    render(<AssistantWizard />);
    await waitFor(() => expect(document.querySelector('[data-autopilot-apercu]')).toBeTruthy());
    await waitFor(() => expect(echelle()).toBeGreaterThan(0));
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('L indice « double-clic » de l Autopilote se voit', () => {
  it('il nomme les trois zones et les trois gestes', async () => {
    // ⚠️ LA PHRASE EXISTAIT DEJA, EN `text-gray-600` SOUS UN AUTRE
    // PARAGRAPHE GRIS. Personne ne la lisait, donc personne ne decouvrait le
    // double-clic, donc la fonctionnalite n'existait pas.
    render(<AssistantWizard />);
    const aide = await waitFor(() =>
      document.querySelector('[data-autopilot-apercu-aide]') as HTMLElement);
    for (const mot of ['Double-cliquez', 'titre', 'CTA', 'carte', 'Glissez', 'coins']) {
      expect(aide.textContent, mot).toContain(mot);
    }
  });

  it('c est un encart, pas une ligne noyee dans le gris', () => {
    render(<AssistantWizard />);
    const aide = document.querySelector('[data-autopilot-apercu-aide]') as HTMLElement;
    expect(aide.className).toMatch(/border/);
    // Une icone lucide, jamais un emoji.
    expect(aide.querySelector('svg')).toBeTruthy();
    expect(aide.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('La mesure ne dépend plus de l ordre de montage', () => {
  const wizard = require('fs').readFileSync(
    require('path').resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
    'utf-8',
  ) as string;

  it('les deux aperçus passent par le MEME hook', () => {
    expect(wizard.split('useFrameScale(').length - 1).toBe(2);
  });

  it('le cadre reçoit une ref de RAPPEL, pas une `useRef`', () => {
    // ⚠️ C'EST TOUTE LA DIFFERENCE. React APPELLE une ref de rappel au moment
    // exact où le nœud s'attache ; une `useRef` mutée ne réveille aucun effet,
    // et c'est ainsi que la mesure n'a jamais eu lieu.
    expect(wizard.split('frameRef={setFrame}').length - 1).toBe(2);
    expect(wizard).not.toContain('frameRef={frameRef}');
  });

  it('plus aucun effet de mesure ne lit `frameRef.current` au montage', () => {
    expect(wizard).not.toContain('const el = frameRef.current;');
  });
});
