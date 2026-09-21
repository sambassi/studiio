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
import { REDUCED_MOTION_QUERY } from '@/lib/hooks/usePrefersReducedMotion';

/** Pose `matchMedia` avec la préférence de réduction voulue (jsdom n'en a pas). */
function poserMatchMedia(reduire: boolean) {
  const mql = {
    matches: reduire,
    media: REDUCED_MOTION_QUERY,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  };
  const autre = { ...mql, matches: false, media: 'autre' };
  vi.stubGlobal('matchMedia', vi.fn((q: string) => (q === REDUCED_MOTION_QUERY ? mql : autre)));
}

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
    // Choisir joue d'abord l'EXTRAIT (voir la section D) ; on le quitte pour
    // lire le montage entier, comme avant.
    await avancer(3000);
    fireEvent.click(screen.getByRole('button', { name: 'Quitter l’extrait — revenir au plateau' }));
    fireEvent.click(lire());
    // Fenêtre intro → cartes : à mi-course (4 s − 0,8 + 0,4). L'horloge
    // factice avance par images de 16 ms depuis l'instant du clic : ±2 %.
    await avancer(3600);
    const a = document.querySelector('[data-playback-layer="a"]') as HTMLElement;
    const b = document.querySelector('[data-playback-layer="b"]') as HTMLElement;
    expect(a.getAttribute('data-playback-sequence')).toBe('intro');
    expect(b.getAttribute('data-playback-sequence')).toBe('cards');
    const pct = (el: HTMLElement) => Number(/translateX\((-?[\d.]+)%\)/.exec(el.style.transform)![1]);
    expect(pct(a)).toBeGreaterThan(-53);
    expect(pct(a)).toBeLessThan(-47);
    expect(pct(b)).toBeGreaterThan(47);
    expect(pct(b)).toBeLessThan(53);
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
    // Les durées viennent du même point que le compositeur et le Calendrier —
    // pour le lecteur ET pour les extraits.
    expect(wizard).toContain('const etapesLecture = activeOrder.map((k) => ({ key: k, seconds: seqDuration(k) }));');
    expect(wizard).toContain('steps={etapesLecture}');
    expect(wizard).toContain('transitionExtract(etapesLecture, previewFocus)');
    expect(wizard).toContain('textAnimationExtract(etapesLecture, previewFocus, INTRO_WINDOW)');
    // Et les effets sont ceux de l'état — les mêmes qui partent au rendu. Seul
    // l'ESSAI d'une option par son bouton ▶ impose la sienne, sans la choisir.
    const bloc = wizard.slice(wizard.indexOf('const lectureSequences ='), wizard.indexOf('const lectureSequences =') + 2500);
    expect(bloc).toContain('transition={transition}');
    expect(bloc).toContain('textAnimation={animationExtrait ?? textAnimation}');
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('D — choisir un effet le joue AUSSITÔT dans le grand aperçu', () => {
  async function ouvrirStyle() {
    render(<AssistantWizard />);
    fireEvent.click(screen.getByRole('button', { name: 'Créer une vidéo' }));
    fireEvent.click(screen.getByText('Continuer vers Style'));
    await waitFor(() => expect(document.querySelector('[data-title-block]')).toBeTruthy());
  }
  const lecteur = () => document.querySelector('[data-sequence-playback]') as HTMLElement | null;
  const calque = (l: 'a' | 'b') => document.querySelector(`[data-playback-layer="${l}"]`) as HTMLElement | null;
  const pct = (el: HTMLElement) => Number(/translate[XY]\((-?[\d.]+)%\)/.exec(el.style.transform)![1]);

  it('un clic sur une transition : l extrait joue la paire courante → suivante, avec CE style, sans Lire', async () => {
    await ouvrirStyle();
    expect(document.querySelector('[data-transition="crossfade"]')?.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(document.querySelector('[data-transition="push"]') as HTMLElement);
    // Choisi, ET en lecture, tout de suite.
    expect(document.querySelector('[data-transition="push"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(lecteur()?.getAttribute('data-sequence-playing')).toBe('true');
    expect(lecteur()?.getAttribute('data-sequence-extract')).toBe('intro>cards');
    // L'extrait commence 1 s AVANT la fenêtre (4 − 0,8 − 1 = 2,2 s) : la
    // séquence sortante, seule, presque finie — pas le début du montage.
    await avancer(16);
    expect(calque('a')?.getAttribute('data-playback-sequence')).toBe('intro');
    expect(calque('b')).toBeNull();
    // 1,4 s plus tard : t = 3,6 s, milieu de la fenêtre intro → cartes.
    await avancer(1400 - 16);
    const a = calque('a')!;
    const b = calque('b')!;
    expect(a.getAttribute('data-playback-sequence')).toBe('intro');
    expect(b.getAttribute('data-playback-sequence')).toBe('cards');
    // `push` : translation VERTICALE — la transition jouée est bien « push ».
    expect(a.style.transform).toMatch(/^translateY\(-/);
    // Images de 16 ms depuis le clic : ±2 % autour de la mi-course.
    expect(pct(a)).toBeGreaterThan(-53);
    expect(pct(a)).toBeLessThan(-47);
    expect(pct(b)).toBeGreaterThan(47);
    expect(pct(b)).toBeLessThan(53);
    expect(document.querySelector('[data-playback-label]')?.textContent).toBe('Titre → Cartes');
    // Le contenu est le VRAI : le titre du projet, pas une tuile « A ».
    expect(a.querySelector('[data-title-block]')).toBeTruthy();
    // 0,6 s après la fenêtre, l'extrait est fini : le plateau est de retour,
    // Rejouer reste.
    await avancer(1300);
    expect(lecteur()?.getAttribute('data-sequence-playing')).toBe('false');
    expect(document.querySelector('[data-playback-stage]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Rejouer l’extrait' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lire l’extrait' })).toBeTruthy();
  });

  it('un clic sur une animation de texte : le DÉBUT de la séquence courante rejoue avec elle', async () => {
    await ouvrirStyle();
    fireEvent.click(document.querySelector('[data-text-animation="slide"]') as HTMLElement);
    expect(document.querySelector('[data-text-animation="slide"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(lecteur()?.getAttribute('data-sequence-playing')).toBe('true');
    expect(lecteur()?.getAttribute('data-sequence-extract')).toBe('intro');
    await avancer(16);
    const a = calque('a')!;
    expect(a.getAttribute('data-playback-sequence')).toBe('intro');
    expect(calque('b')).toBeNull();
    // Au tout début, « Glissement » enveloppe le titre : translation vers le
    // haut et fondu — l'enveloppe de `TextAnimationLayer`, sur le VRAI titre.
    const enveloppe = a.querySelector('[data-title-block]')?.parentElement as HTMLElement;
    expect(enveloppe.style.transform).toMatch(/translateY\(/);
    expect(Number(enveloppe.style.opacity)).toBeLessThan(1);
    // Fenêtre d'apparition (22 % de 4 s = 0,88 s) + 0,6 s : l'extrait s'arrête
    // avant la fin de la séquence.
    await avancer(1600);
    expect(lecteur()?.getAttribute('data-sequence-playing')).toBe('false');
    expect(document.querySelector('[data-playback-stage]')).toBeNull();
  });

  it('le bouton ▶ d une option joue l extrait avec CET effet — sans le choisir', async () => {
    await ouvrirStyle();
    fireEvent.click(document.querySelector('[data-transition-play="slide"]') as HTMLElement);
    // Le choix n'a pas bougé…
    expect(document.querySelector('[data-transition="crossfade"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('[data-transition="slide"]')?.getAttribute('aria-pressed')).toBe('false');
    // …mais le grand aperçu joue « slide », l'effet qu'on regarde.
    await avancer(1400);
    expect(calque('a')?.style.transform).toMatch(/^translateX\(-/);
    // Idem pour une animation : « pop » à l'essai, « Aucune » toujours choisie.
    await avancer(2000);
    fireEvent.click(document.querySelector('[data-text-animation-play="pop"]') as HTMLElement);
    expect(document.querySelector('[data-text-animation="none"]')?.getAttribute('aria-pressed')).toBe('true');
    await avancer(16);
    const enveloppe = calque('a')?.querySelector('[data-title-block]')?.parentElement as HTMLElement;
    expect(enveloppe.style.transform).toMatch(/scale\(/);
  });

  it('Rejouer relance l extrait depuis son début ; Pause l arrête sans rien couvrir', async () => {
    await ouvrirStyle();
    fireEvent.click(document.querySelector('[data-transition="wipe"]') as HTMLElement);
    await avancer(1400);
    expect(calque('b')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Rejouer l’extrait' }));
    await avancer(16);
    // De retour AVANT la fenêtre : la sortante seule.
    expect(calque('a')?.getAttribute('data-playback-sequence')).toBe('intro');
    expect(calque('b')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mettre en pause la lecture des séquences' }));
    expect(document.querySelector('[data-playback-stage]')).toBeNull();
    // Le plateau d'édition est intact : le double-clic ouvre le panneau du titre.
    fireEvent.doubleClick(document.querySelector('[data-title-block]') as HTMLElement);
    await waitFor(() => expect(document.querySelector('[data-zone-panneau="title"]')).toBeTruthy());
  });

  it('depuis un autre onglet : bascule sur « Tout » le temps de l extrait, puis REVIENT', async () => {
    await ouvrirStyle();
    fireEvent.click(screen.getByRole('tab', { name: 'Cartes' }));
    expect(lecteur()).toBeNull();
    fireEvent.click(document.querySelector('[data-transition="zoom"]') as HTMLElement);
    // Sur « Tout », en lecture, la paire cartes → CTA (la séquence de l'onglet).
    expect(screen.getByRole('tab', { name: 'Tout' }).getAttribute('aria-selected')).toBe('true');
    expect(lecteur()?.getAttribute('data-sequence-extract')).toBe('cards>cta');
    await avancer(16);
    expect(calque('a')?.getAttribute('data-playback-sequence')).toBe('cards');
    // Extrait fini (1 + 0,8 + 0,6 = 2,4 s) : retour sur Cartes, plus de lecteur.
    await avancer(2500);
    expect(screen.getByRole('tab', { name: 'Cartes' }).getAttribute('aria-selected')).toBe('true');
    expect(lecteur()).toBeNull();
    // Revenir sur « Tout » à la main ne rejoue RIEN tout seul.
    fireEvent.click(screen.getByRole('tab', { name: 'Tout' }));
    expect(lecteur()?.getAttribute('data-sequence-playing')).toBe('false');
    expect(document.querySelector('[data-playback-stage]')).toBeNull();
  });

  it('aucun rendu, aucun débit : ni `runRender`, ni appel réseau de rendu', async () => {
    await ouvrirStyle();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const avant = fetchMock.mock.calls.length;
    fireEvent.click(document.querySelector('[data-transition="iris"]') as HTMLElement);
    fireEvent.click(document.querySelector('[data-text-animation="fade"]') as HTMLElement);
    await avancer(3000);
    const appels = fetchMock.mock.calls.slice(avant).map((c) => String(c[0]));
    expect(appels.filter((u) => /render|rendu|compose/i.test(u))).toEqual([]);
    expect(document.querySelector('[data-play-chargement]')).toBeNull();
    expect(document.querySelector('[data-play-lecteur]')).toBeNull();
    // « Voir le rendu » est toujours là, intact — c'est lui qui compose et débite.
    expect(document.querySelector('[data-play-rendu]')).toBeTruthy();
    // Et dans le code : aucun des deux gestes n'appelle `runRender`.
    const grille = wizard.slice(wizard.indexOf('{TRANSITION_KEYS.map((style) => {'), wizard.indexOf('{TEXT_ANIMATION_HINTS[textAnimation]}'));
    expect(grille).toContain('onClick={() => { setTransition(style); jouerTransition(style); }}');
    expect(grille).toContain('onClick={() => { setTextAnimation(style); jouerAnimation(style); }}');
    expect(grille).toContain('onClick={() => { apercuTransitions.togglePin(style); jouerTransition(style); }}');
    expect(grille).toContain('onClick={() => { apercuAnimations.togglePin(style); jouerAnimation(style); }}');
    expect(grille).not.toContain('runRender');
    const demande = wizard.slice(wizard.indexOf('const demanderExtrait = useCallback('), wizard.indexOf('const lectureSequences ='));
    expect(demande).not.toContain('runRender');
    expect(demande).not.toContain('fetch(');
  });

  it('avec la réduction des animations : image FIGÉE au milieu de l effet, Lire reste volontaire', async () => {
    poserMatchMedia(true);
    await ouvrirStyle();
    fireEvent.click(document.querySelector('[data-transition="slide"]') as HTMLElement);
    // Pas de lecture, mais la scène est là, figée à t = 0,5 de la fenêtre.
    expect(lecteur()?.getAttribute('data-sequence-playing')).toBe('false');
    expect(lecteur()?.getAttribute('data-sequence-frozen')).toBe('true');
    const a = calque('a')!;
    const b = calque('b')!;
    expect(a.getAttribute('data-playback-sequence')).toBe('intro');
    expect(b.getAttribute('data-playback-sequence')).toBe('cards');
    expect(pct(a)).toBeCloseTo(-50, 3);
    expect(pct(b)).toBeCloseTo(50, 3);
    expect(document.querySelector('[data-playback-label]')?.textContent).toContain('image figée');
    // Le temps passe : rien ne bouge.
    await avancer(1000);
    expect(pct(calque('a')!)).toBeCloseTo(-50, 3);
    // Lire, volontairement : l'extrait joue, depuis son début.
    fireEvent.click(screen.getByRole('button', { name: 'Lire l’extrait' }));
    expect(lecteur()?.getAttribute('data-sequence-frozen')).toBe('false');
    await avancer(16);
    expect(calque('b')).toBeNull();
    // Une animation figée : au MILIEU de sa fenêtre — le titre à mi-fondu.
    await avancer(3000);
    fireEvent.click(document.querySelector('[data-text-animation="fade"]') as HTMLElement);
    expect(lecteur()?.getAttribute('data-sequence-frozen')).toBe('true');
    const enveloppe = calque('a')?.querySelector('[data-title-block]')?.parentElement as HTMLElement;
    const opacite = Number(enveloppe.style.opacity);
    expect(opacite).toBeGreaterThan(0);
    expect(opacite).toBeLessThan(1);
    // Quitter rend le plateau.
    fireEvent.click(screen.getByRole('button', { name: 'Quitter l’extrait — revenir au plateau' }));
    expect(document.querySelector('[data-playback-stage]')).toBeNull();
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
