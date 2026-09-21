import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { DEFAULT_SEQUENCE_SECONDS, RUSH_SEQUENCE_SECONDS } from '@/lib/creer/designSpec';

/**
 * La lecture des séquences, montée dans les deux parcours.
 *
 * ⚠️ « TOUT » EMPILE TITRE, CARTES ET CTA. C'est une vue de COMPOSITION —
 * utile pour placer les blocs — que l'utilisateur lisait comme le montage,
 * et qui superposait des textes que la vidéo ne montre jamais ensemble. Le
 * lecteur joue les séquences dans l'ordre réel, avec la transition et
 * l'animation que chaque parcours rend VRAIMENT :
 *
 * - Autopilote : les défauts codés en dur dans `buildAutopilotDesign` et les
 *   durées par défaut du Mode simple — aucun réglage n'existe.
 * - Créer : la transition et l'animation choisies, les durées des curseurs.
 *
 * Et il ne remplace rien : à l'arrêt, le plateau reste celui d'avant, avec
 * ses gestes ; « Voir le rendu » compose toujours la vraie vidéo.
 */

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

const wizard = readFileSync(resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');

const LARGEUR_CADRE = 400;
let clientWidthOriginal: PropertyDescriptor | undefined;

beforeEach(() => {
  window.localStorage.clear();
  clientWidthOriginal = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return LARGEUR_CADRE; } });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/pexels')) {
      return { ok: true, json: async () => ({ success: true, photos: [] }) };
    }
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

const lire = () => screen.getByRole('button', { name: 'Lire les séquences dans l’ordre du montage' });
async function avancer(ms: number) {
  await act(async () => { vi.advanceTimersByTime(ms); });
}

// ─────────────────────────────────────────────────────────────────────────
describe('A — Autopilote', () => {
  async function ouvrir() {
    render(<AssistantWizard />);
    await waitFor(() => expect(document.querySelector('[data-parcours-autopilote]')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-parcours-autopilote]')!);
    await waitFor(() => expect(document.querySelector('[data-autopilot-apercu]')).not.toBeNull());
    await waitFor(() => expect(document.querySelector('[data-title-block]')).toBeTruthy());
  }

  it('sur « Tout », le lecteur est là, et le libellé dit « vue de composition »', async () => {
    await ouvrir();
    const apercu = document.querySelector('[data-autopilot-apercu]') as HTMLElement;
    expect(apercu.querySelector('[data-sequence-playback]')).toBeTruthy();
    expect(apercu.contains(lire())).toBe(true);
    const mention = apercu.querySelector('[data-autopilot-apercu-lecture]') as HTMLElement;
    expect(mention.getAttribute('data-autopilot-apercu-lecture')).toBe('composition');
    expect(mention.textContent).toContain('Vue de composition');
    expect(mention.textContent).toContain('superposés');
  });

  it('en lecture : le libellé bascule sur « lecture des séquences », les calques jouent dans l ordre réel', async () => {
    await ouvrir();
    fireEvent.click(lire());
    await avancer(16);
    const apercu = document.querySelector('[data-autopilot-apercu]') as HTMLElement;
    const mention = apercu.querySelector('[data-autopilot-apercu-lecture]') as HTMLElement;
    expect(mention.getAttribute('data-autopilot-apercu-lecture')).toBe('lecture');
    expect(mention.textContent).toContain('Lecture des séquences');
    // Première séquence : le titre, seul — pas empilé.
    const calque = apercu.querySelector('[data-playback-layer="a"]') as HTMLElement;
    expect(calque.getAttribute('data-playback-sequence')).toBe('intro');
    expect(calque.querySelector('[data-title-block]')).toBeTruthy();
    expect(calque.querySelector('[data-cta-block]')).toBeNull();
    // Le calque est un plateau COMPLET, à l'échelle du cadre.
    const plateau = calque.querySelector('[data-plateau-lecture="intro"]') as HTMLElement;
    expect(plateau.style.transform).toBe(`scale(${LARGEUR_CADRE / 1080})`);
    // Dans la séquence CTA, le titre n'est plus là.
    await avancer((DEFAULT_SEQUENCE_SECONDS.intro + DEFAULT_SEQUENCE_SECONDS.cards + 1) * 1000);
    const cta = apercu.querySelector('[data-playback-layer="a"]') as HTMLElement;
    expect(cta.getAttribute('data-playback-sequence')).toBe('cta');
    expect(cta.querySelector('[data-cta-block]')).toBeTruthy();
    expect(cta.querySelector('[data-title-block]')).toBeNull();
  });

  it('à l arrêt, le plateau d édition est intact — le double-clic ouvre toujours le panneau', async () => {
    await ouvrir();
    expect(document.querySelector('[data-playback-stage]')).toBeNull();
    fireEvent.doubleClick(document.querySelector('[data-title-block]') as HTMLElement);
    await waitFor(() => expect(document.querySelector('[data-autopilot-texte-panneau="title"]')).toBeTruthy());
  });

  it('les durées et les effets sont ceux que l Autopilote rend VRAIMENT', () => {
    // `buildAutopilotDesign` fige transition et animation ; aucun réglage
    // n'existe. Les montrer autrement mentirait.
    const autopilote = wizard.slice(
      wizard.indexOf('function AutopilotPreview('),
      wizard.indexOf('export default function AssistantWizard()'),
    );
    expect(autopilote).toContain('transition={DEFAULT_TRANSITION}');
    expect(autopilote).toContain('textAnimation={DEFAULT_TEXT_ANIMATION}');
    expect(autopilote).toContain("seconds: k === 'video' ? RUSH_SEQUENCE_SECONDS.fallback : DEFAULT_SEQUENCE_SECONDS[");
    const design = readFileSync(resolve(__dirname, '../lib/autopilot/design.ts'), 'utf-8');
    expect(design).toContain('transition: DEFAULT_TRANSITION,');
    expect(design).toContain('textAnimation: DEFAULT_TEXT_ANIMATION,');
    expect(RUSH_SEQUENCE_SECONDS.fallback).toBeGreaterThan(0);
  });

  it('sur un autre onglet, pas de lecteur', async () => {
    await ouvrir();
    fireEvent.click(screen.getByRole('tab', { name: 'Titre' }));
    expect(document.querySelector('[data-autopilot-apercu] [data-sequence-playback]')).toBeNull();
    expect(document.querySelector('[data-autopilot-apercu-lecture]')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('B — Créer', () => {
  async function ouvrirStyle() {
    render(<AssistantWizard />);
    fireEvent.click(screen.getByRole('button', { name: 'Créer une vidéo' }));
    fireEvent.click(screen.getByText('Continuer vers Style'));
    await waitFor(() => expect(document.querySelector('[data-title-block]')).toBeTruthy());
  }

  it('sur « Tout » sans rendu, le lecteur est dans le cadre — et « Voir le rendu » reste', async () => {
    await ouvrirStyle();
    const calque = document.querySelector('[data-preview-overlay]') as HTMLElement;
    expect(calque).toBeTruthy();
    expect(calque.querySelector('[data-sequence-playback]')).toBeTruthy();
    // Le vrai rendu (payé) garde son bouton : la lecture ne le remplace pas.
    expect(document.querySelector('[data-play-rendu]')).toBeTruthy();
    expect(document.querySelector('[data-play-lecteur]')).toBeNull();
  });

  it('le lecteur est HORS du plateau photographié', async () => {
    await ouvrirStyle();
    const plateau = (document.querySelector('[data-title-block]') as HTMLElement).parentElement as HTMLElement;
    expect(plateau.contains(document.querySelector('[data-sequence-playback]'))).toBe(false);
  });

  it('en lecture, les calques suivent la transition CHOISIE', async () => {
    await ouvrirStyle();
    fireEvent.click(document.querySelector('[data-transition="slide"]') as HTMLElement);
    fireEvent.click(lire());
    // Fenêtre intro → cartes : à mi-course (4 s − 0,8 + 0,4).
    await avancer(3600);
    const a = document.querySelector('[data-playback-layer="a"]') as HTMLElement;
    const b = document.querySelector('[data-playback-layer="b"]') as HTMLElement;
    expect(a.getAttribute('data-playback-sequence')).toBe('intro');
    expect(b.getAttribute('data-playback-sequence')).toBe('cards');
    expect(a.style.transform).toMatch(/^translateX\(-(49\.9|50)/);
    expect(b.style.transform).toMatch(/^translateX\((49\.9|50)/);
  });

  it('sur un autre onglet, pas de lecteur ; le plateau isolé reste', async () => {
    await ouvrirStyle();
    fireEvent.click(screen.getByRole('tab', { name: 'Cartes' }));
    expect(document.querySelector('[data-sequence-playback]')).toBeNull();
    expect(document.querySelector('[data-preview-overlay]')).toBeNull();
  });

  it('le câblage : le rendu d abord, la lecture ensuite, jamais pendant une composition', () => {
    expect(wizard).toContain("const lectureSequences = generated && previewFocus === 'all' && !previewUrl && !rendPourApercu ? (");
    expect(wizard).toContain('overlay={renduDansLeCadre ?? lectureSequences}');
    // Les durées viennent du même point que le compositeur et le Calendrier.
    expect(wizard).toContain('steps={activeOrder.map((k) => ({ key: k, seconds: seqDuration(k) }))}');
    // Et les effets sont ceux de l'état — les mêmes qui partent au rendu.
    const bloc = wizard.slice(wizard.indexOf('const lectureSequences ='), wizard.indexOf('const lectureSequences =') + 2500);
    expect(bloc).toContain('transition={transition}');
    expect(bloc).toContain('textAnimation={textAnimation}');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('C — un seul plateau, deux usages', () => {
  it('`PlateContent` est rendu par le plateau ET par les calques de lecture', () => {
    // Pas de seconde écriture du titre, des cartes ou du CTA : le lecteur ne
    // peut pas montrer autre chose que l'aperçu.
    // Le plateau d'édition et le calque de lecture — et personne d'autre.
    expect(wizard.match(/<PlateContent[\s{]/g)?.length).toBe(2);
    expect(wizard.split('<PlateauLecture').length - 1).toBe(2);
    // L'animation enveloppe le TEXTE (titre, cartes, CTA) — jamais le fond,
    // ni les éléments, ni le filigrane : même place que `applyTextAnimation`.
    const plate = wizard.slice(wizard.indexOf('function PlateContent('), wizard.indexOf('type PlateContentProps'));
    expect(plate.split('<TextAnimationLayer style={textAnimation} progress={progress}>').length - 1).toBe(3);
    expect(plate.indexOf('<FreeElementsLayer')).toBeGreaterThan(plate.lastIndexOf('</TextAnimationLayer>'));
  });
});
