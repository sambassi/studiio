/**
 * CONTRAT C-CTA — le texte du CTA (principal, petite ligne, copies #555) est
 * IDENTIQUE dans l'aperçu Créer, le rendu (compositeur `drawCTA` et Remotion
 * `CreerSimpleMontage`) et la metadata relue par le Calendrier.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';

vi.mock('remotion', () => {
  const Div = ({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) => React.createElement('div', { style }, children);
  return {
    AbsoluteFill: Div, Audio: () => null, Img: () => null, OffthreadVideo: () => null,
    Sequence: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    useVideoConfig: () => ({ fps: 30, width: 1080, height: 1920, durationInFrames: 900 }),
    useCurrentFrame: () => 100, delayRender: () => 0, continueRender: () => undefined, interpolate: () => 0,
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
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null, status: 'unauthenticated' }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});
vi.mock('@/lib/icons/prerender', () => ({ preRenderCardIcons: async (c: unknown) => c }));

import { drawCTA } from '@/lib/video-composer';
import { CreerSimpleMontage } from '../../../remotion/CreerSimpleMontage';
import { Preview } from '@/app/dashboard/creer/AssistantWizard';
import { metadataPourEnregistrement } from '@/lib/creer/postMetadata/from-wizard';
import { optionsRenduDepuisMetadata } from '@/lib/rendus/options-depuis-metadata';
import { avecCtaDuBrief } from '@/lib/creer/validation-rendu';
import type { CtaCopie } from '@/lib/creer/cta-copies';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;
afterEach(cleanup);

const CTA = 'JE ME LANCE';
const SOUS = 'Réservez sur afroboost.com';
const STYLE = { font: 'Inter', color: '#FFFFFF', subColor: '#EC4899', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 };
const COPIE: CtaCopie = { id: 'cta-abc123', text: 'RESERVE TA PLACE', sub: 'DES MAINTENANT', pos: { x: 30, y: 40 }, width: 50, style: { ...STYLE } };
const net = (s: string) => s.replace(/\s+/g, '').toUpperCase(); // le canvas peint en capitales (comme l'aperçu en CSS)

/** Textes peints par le VRAI `drawCTA`. */
function peintureCanvas(ctaText: string, ctaSub: string, design: Record<string, unknown>): string {
  const peints: string[] = [];
  const etat: Record<string, unknown> = { globalAlpha: 1, filter: 'none' };
  const degrade = { addColorStop: () => {} };
  const base: Record<string, unknown> = {
    measureText: (t: string) => ({ width: Array.from(t).length * 10 }), fillText: (t: string) => { peints.push(t); },
    createLinearGradient: () => degrade, createRadialGradient: () => degrade, createPattern: () => null,
  };
  const ctx = new Proxy(base, {
    get: (t, k) => (k in t ? (t as never)[k] : (k in etat ? etat[k as string] : () => undefined)),
    set: (_t, k, v) => { etat[k as string] = v; return true; },
    has: () => true,
  }) as unknown as CanvasRenderingContext2D;
  drawCTA(ctx, 1080, 1920, '#7C3AED', ctaText, ctaSub, undefined, undefined, null, 0.6, design as never);
  return net(peints.join(''));
}

describe('C-CTA — CTA du brief : aperçu = état = rendu', () => {
  it('le CTA saisi devient la petite ligne de l’ÉTAT (lu par l’aperçu ET le rendu), headline gardée', () => {
    const etat = avecCtaDuBrief({ title: 'T', subtitle: 'S', cards: [], cta: CTA, ctaSub: 'LIEN EN BIO' }, { cta: SOUS });
    expect(etat).toMatchObject({ cta: CTA, ctaSub: SOUS });
    expect(JSON.stringify(etat)).not.toMatch(/LIEN EN BIO/);
  });
});

describe('C-CTA — principal + copie, sur chaque surface', () => {
  const attendu = net(`${CTA}${SOUS}${COPIE.text}${COPIE.sub}`);

  it('Calendrier : metadata enregistrée → options « Régénérer » → drawCTA peint original ET copie', () => {
    const envoi = metadataPourEnregistrement({ design: { ctaMainText: CTA, ctaSubText: SOUS } }, { ctaCopies: [COPIE] }, { ctaCopies: [] });
    const metadata = { ...envoi, branding: { ctaText: CTA, ctaSubText: SOUS } };
    const o = optionsRenduDepuisMetadata({ title: 'T', metadata } as never, 'regenerer', { cards: [] });
    expect(o.design?.ctaCopies).toEqual([COPIE]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = o as any;
    const peint = peintureCanvas(a.ctaText, a.ctaSubText, a.design);
    for (const t of [CTA, SOUS, COPIE.text, COPIE.sub]) expect(peint).toContain(net(t));
    expect(peint.length).toBe(attendu.length); // rien d'inventé, rien de perdu
  });

  it('Remotion : la séquence CTA rend original ET copie, mêmes textes', () => {
    const p = { format: '9:16', title: '', cards: [], ctaText: CTA, ctaSubText: SOUS, introDuration: 0, cardsDuration: 0, videoDuration: 0, ctaDuration: 4, sequenceOrder: ['cta'], ctaCopies: [COPIE] };
    const { container } = render(React.createElement(CreerSimpleMontage as never, p as never));
    const texte = net(container.textContent ?? '');
    for (const t of [CTA, SOUS, COPIE.text, COPIE.sub]) expect(texte).toContain(net(t));
    expect(net(container.querySelector(`[data-cta-copie="${COPIE.id}"]`)!.textContent ?? '')).toBe(net(COPIE.text + COPIE.sub));
  });

  it('Aperçu Créer : original ET copie, mêmes textes', () => {
    const TEXT = { title: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 }, subtitle: { font: null, color: null, scale: 1 }, cta: { ...STYLE } };
    const props = {
      generated: { title: 'Routine', subtitle: 'Sous', cards: [], cta: CTA, ctaSub: SOUS },
      format: '9:16', displayScale: 0.25, gradStart: '#7C3AED', gradEnd: '#EC4899', gradientOpacity: 0.5, accent: '#7C3AED',
      watermark: 'Studiio.pro', text: TEXT, activeOrder: ['intro', 'cta'], ctaPos: { x: 40, y: 70 },
      onDragStart: () => {}, onDragMove: () => {}, onDragEnd: () => {}, onTextDoubleClick: () => {}, ctaCopies: [COPIE],
    };
    const { container } = render(React.createElement(Preview as never, props as never));
    const texte = net(container.textContent ?? '');
    for (const t of [CTA, SOUS, COPIE.text, COPIE.sub]) expect(texte).toContain(net(t));
    expect(net(container.querySelector(`[data-cta-copie="${COPIE.id}"]`)!.textContent ?? '')).toContain(net(COPIE.text));
  });
});
