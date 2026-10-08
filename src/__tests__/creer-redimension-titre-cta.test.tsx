/**
 * Créer — redimensionner le TITRE et le CTA dans l'aperçu, pour de vrai.
 *
 * Cause : les poignées de coin n'étaient pas branchées dans l'assistant
 * (seuls les coins décoratifs des repères se voyaient), et le calcul de
 * l'Autopilote re-mesurait le bloc pendant le geste — le centre se déplaçait
 * vers le pointeur et annulait l'agrandissement.
 *
 * CTA : une règle unique (`echelleCtaAjustee`) garantit qu'il ne déborde
 * jamais ; l'aperçu et l'export reçoivent la même échelle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { echelleDepuisCoin, largeurDepuisBord, LARGEUR_MAX } from '@/lib/creer/redimensionTexte';
import { echelleCtaAjustee, ECHELLE_CTA_MIN } from '@/lib/creer/ajustementCta';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { email: 'a@b.c' } }, status: 'authenticated' }) }));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});

import AssistantWizard from '@/app/dashboard/creer/AssistantWizard';

const wizard = readFileSync(resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');

describe('7-9. calcul du geste (pur) : figé à la prise, sans boucle', () => {
  const base = { echelleDepart: 1, largeurBloc: 400, hauteurBloc: 80, min: 0.5, max: 3 };
  it('coin sud-est tiré vers l’extérieur : le texte GRANDIT ; vers l’intérieur : il RÉTRÉCIT', () => {
    expect(echelleDepuisCoin({ ...base, coin: 'se', dx: 100, dy: 40 })).toBeGreaterThan(1.5);
    expect(echelleDepuisCoin({ ...base, coin: 'se', dx: -80, dy: -20 })).toBeLessThan(1);
  });
  it('les quatre coins agissent vers l’extérieur', () => {
    expect(echelleDepuisCoin({ ...base, coin: 'nw', dx: -60, dy: -20 })).toBeGreaterThan(1);
    expect(echelleDepuisCoin({ ...base, coin: 'ne', dx: 60, dy: -20 })).toBeGreaterThan(1);
    expect(echelleDepuisCoin({ ...base, coin: 'sw', dx: -60, dy: 20 })).toBeGreaterThan(1);
  });
  it('bornes respectées, sans saut à la prise', () => {
    expect(echelleDepuisCoin({ ...base, coin: 'se', dx: 0, dy: 0 })).toBe(1);
    expect(echelleDepuisCoin({ ...base, coin: 'se', dx: 5000, dy: 5000 })).toBe(3);
    expect(echelleDepuisCoin({ ...base, coin: 'se', dx: -5000, dy: -5000 })).toBe(0.5);
  });
  it('largeur : le bord suit le pointeur (×2 pour un bloc centré), bornée', () => {
    expect(largeurDepuisBord({ largeurDepart: 70, dx: 40, largeurBlocPx: 280, centre: false })).toBe(80);
    expect(largeurDepuisBord({ largeurDepart: 70, dx: 40, largeurBlocPx: 280, centre: true })).toBe(90);
    expect(largeurDepuisBord({ largeurDepart: 70, dx: 4000, largeurBlocPx: 280, centre: true })).toBe(LARGEUR_MAX);
  });
});

describe('18. CTA : ne déborde jamais, ne fait que réduire', () => {
  const v = { w: 1080, h: 1920 };
  it('texte court : l’échelle choisie est gardée', () => {
    expect(echelleCtaAjustee({ texte: 'JE ME LANCE', sousTexte: 'LIEN EN BIO', echelle: 1.2, largeurPct: 70, video: v })).toBe(1.2);
  });
  it('mot très long + grande échelle : réduite pour que le mot tienne dans la largeur utile', () => {
    const e = echelleCtaAjustee({ texte: 'AFROBOOST.COM/INSCRIPTION', echelle: 2.5, largeurPct: 70, video: v });
    expect(e).toBeLessThan(2.5);
    const motPx = 'AFROBOOST.COM/INSCRIPTION'.length * 0.72 * 1080 * 0.0375 * e;
    expect(motPx).toBeLessThanOrEqual(1080 * 0.7 * 0.94);
  });
  it('texte très long : la hauteur reste sous 30 % de l’image', () => {
    const texte = Array.from({ length: 40 }, () => 'RÉSERVE').join(' ');
    const e = echelleCtaAjustee({ texte, echelle: 3, largeurPct: 70, video: v });
    expect(e).toBeLessThan(1.2);
    expect(e).toBeGreaterThanOrEqual(ECHELLE_CTA_MIN);
  });
  it('appliquée dans `textStyles` : l’aperçu et l’export reçoivent la MÊME échelle', () => {
    expect(wizard).toContain('scale: echelleCtaAjustee({ texte: generated?.cta ?? \'\', sousTexte: generated?.ctaSub, echelle: ctaStyle.scale ?? 1, largeurPct: ctaWidth, video: VIDEO_SIZE[format] }),');
    expect(wizard).toContain('ctaTextScale: textStyles.cta.scale,');
  });
});

describe('10. export : taille ET largeur réglées partent au compositeur et au Calendrier', () => {
  it('largeurs réelles (plus les constantes) dans le design et `sizes`', () => {
    expect(wizard).toContain('titleSize: titleWidth,');
    expect(wizard).toContain('watermarkSize: ctaWidth,');
    expect(wizard).toContain('title: titleWidth,\n              watermark: ctaWidth,');
  });
});

let clientWidthOriginal: PropertyDescriptor | undefined;
beforeEach(() => {
  window.localStorage.clear();
  clientWidthOriginal = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 400; } });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).startsWith('/api/pexels')) return { ok: true, json: async () => ({ success: true, photos: [] }) };
    return { ok: true, json: async () => ({ success: true }) };
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (clientWidthOriginal) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthOriginal);
});

async function ouvrirStyle() {
  render(<AssistantWizard />);
  fireEvent.click(screen.getByRole('button', { name: 'Créer une vidéo' }));
  fireEvent.click(screen.getByText('Continuer vers Style'));
  await waitFor(() => expect(document.querySelector('[data-guide-key="title"]')).toBeTruthy());
}
const bloc = (k: 'title' | 'cta') => document.querySelector(`[data-guide-key="${k}"]`) as HTMLElement;
const taille = (k: 'title' | 'cta') => {
  const el = Array.from(bloc(k).querySelectorAll<HTMLElement>('*')).find((e) => e.style.fontSize);
  return parseFloat(el!.style.fontSize);
};
function tirer(poignee: HTMLElement, de: [number, number], a: [number, number]) {
  const vraiRect = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function fake() {
    return { x: 0, y: 0, left: 0, top: 0, width: 300, height: 80, right: 300, bottom: 80, toJSON: () => ({}) } as DOMRect;
  };
  try {
    fireEvent.pointerDown(poignee, { button: 0, isPrimary: true, pointerId: 1, clientX: de[0], clientY: de[1] });
    poignee.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: a[0], clientY: a[1], bubbles: true }));
    poignee.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
  } finally {
    HTMLElement.prototype.getBoundingClientRect = vraiRect;
  }
}

describe('7-8. dans l’aperçu de l’assistant : le coin change la VRAIE taille du texte', () => {
  it.each(['title', 'cta'] as const)('%s : survol → poignées ; coin tiré vers l’extérieur → police plus grande', async (k) => {
    await ouvrirStyle();
    const avant = taille(k);
    fireEvent.pointerEnter(bloc(k));
    const coin = document.querySelector(`[data-text-handle="${k}-se"]`) as HTMLElement;
    expect(coin).toBeTruthy();
    tirer(coin, [300, 80], [420, 140]);
    await waitFor(() => expect(taille(k)).toBeGreaterThan(avant));
  });

  it('largeur : la poignée de bord élargit le bloc', async () => {
    await ouvrirStyle();
    const avant = parseFloat(bloc('title').style.width);
    fireEvent.pointerEnter(bloc('title'));
    const bord = document.querySelector('[data-text-width-handle="title"]') as HTMLElement;
    expect(bord).toBeTruthy();
    tirer(bord, [300, 40], [360, 40]);
    await waitFor(() => expect(parseFloat(bloc('title').style.width)).toBeGreaterThan(avant));
  });
});
