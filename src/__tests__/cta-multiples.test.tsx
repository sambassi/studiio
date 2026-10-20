/**
 * CTA MULTIPLES — plusieurs CTA VISUELS dans la même séquence CTA.
 *
 * Le CTA d'origine garde ses champs historiques (élément n° 1, implicite) ;
 * les copies vivent dans une liste optionnelle `ctaCopies`
 * (`src/lib/creer/cta-copies.ts`), rangée dans le brouillon, la metadata,
 * les options du compositeur et les props Remotion.
 *
 *   A. Sans copie : rendu IDENTIQUE à avant (gel pris AVANT la modification :
 *      trace complète du contexte 2D de `drawCTA`, HTML de l'aperçu et de la
 *      composition Remotion).
 *   B. « Dupliquer » → deux CTA visibles (éditeur + lecture de l'aperçu).
 *   C. Modifier le texte de la copie → l'original inchangé.
 *   D. Déplacer la copie → l'original inchangé.
 *   E. Supprimer la copie → l'original reste.
 *   F. Brouillon et metadata : aller-retour → deux CTA.
 *   G. Export canvas (`fillText` aux positions de chacun) et Remotion.
 *   H. Machine à écrire : chaque CTA s'écrit, sur son propre texte.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import React from 'react';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';

const FRAME = { n: 40 };
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
const SESSION = { courante: { data: null as unknown, status: 'unauthenticated' } };
vi.mock('next-auth/react', () => ({ useSession: () => SESSION.courante }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));
vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontLoaded: async () => true, preloadCatalogPreview: async () => true };
});
vi.mock('@/lib/icons/prerender', () => ({ preRenderCardIcons: async (c: unknown) => c }));

import { drawCTA } from '@/lib/video-composer';
import { CreerSimpleMontage } from '../../remotion/CreerSimpleMontage';
import AssistantWizard, { Preview } from '@/app/dashboard/creer/AssistantWizard';
import { draftKey, DRAFT_VERSION, sanitizeDraft } from '@/lib/creer/draft';
import { metadataPourEnregistrement } from '@/lib/creer/postMetadata/from-wizard';
import { toWizardDraft } from '@/lib/creer/postMetadata/to-wizard';
import { optionsRenduDepuisMetadata } from '@/lib/rendus/options-depuis-metadata';
import {
  dupliquerCta, lireCtaCopies, positionCopieCta, MAX_CTA_COPIES, DECALAGE_COPIE_CTA, type CtaCopie,
} from '@/lib/creer/cta-copies';
import { CTA_BAS_916 } from '@/lib/creer/zones-sures-916';
import { VIDEO_SIZE } from '@/lib/creer/designSpec';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;
Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: () => Promise.resolve() });
Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => {} });

const GEL_DRAW = JSON.parse(readFileSync(join(__dirname, 'fixtures/cta-multiples-gel-drawcta.json'), 'utf8'));
const GEL_HTML = JSON.parse(readFileSync(join(__dirname, 'fixtures/cta-multiples-gel-html.json'), 'utf8'));
/**
 * Réécrire le gel HTML (changement VOULU du rendu, à justifier dans le
 * commit) : GEL_ECRIRE=1. 20/10 : ombre du titre lisible, coupe de secours
 * `overflow-wrap` du titre et du CTA.
 */
const ECRIRE_GEL_HTML = process.env.GEL_ECRIRE === '1';
afterAll(() => { if (ECRIRE_GEL_HTML) writeFileSync(join(__dirname, 'fixtures/cta-multiples-gel-html.json'), JSON.stringify(GEL_HTML)); });

const STYLE = { font: 'Inter', color: '#FFFFFF', subColor: '#EC4899', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 };
const copie = (o: Partial<CtaCopie> = {}): CtaCopie => ({
  id: 'cta-abc123', text: 'RESERVE TA PLACE', sub: 'DES MAINTENANT', pos: { x: 50, y: 40 }, width: 70, style: { ...STYLE }, ...o,
});
const sansEspaces = (s: string) => s.replace(/\s+/g, '');

// ── Contexte 2D enregistreur (le MÊME que celui du gel) ───────────────────
function ctxTrace() {
  const log: unknown[] = [];
  const etat: Record<string, unknown> = { globalAlpha: 1, filter: 'none' };
  const degrade = { addColorStop: (...a: unknown[]) => log.push(['stop', ...a]) };
  const rec = (n: string) => (...a: unknown[]) => {
    log.push([n, ...a.map((x) => (typeof x === 'object' ? '[obj]' : x))]);
    return n === 'measureText' ? { width: String(a[0]).length * 10 } : undefined;
  };
  const noms = ['measureText', 'fillText', 'strokeText', 'save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'rect', 'roundRect', 'clip', 'fill', 'stroke', 'setLineDash', 'fillRect', 'clearRect', 'strokeRect', 'drawImage'];
  const base: Record<string, unknown> = {
    createLinearGradient: (...a: unknown[]) => { log.push(['grad', ...a]); return degrade; },
    createRadialGradient: () => degrade, createPattern: () => null,
  };
  for (const n of noms) base[n] = rec(n);
  const ctx = new Proxy(base, {
    get: (t, p) => (p in t ? (t as never)[p] : etat[p as string]),
    set: (_t, p, v) => { log.push(['set', p, typeof v === 'object' ? '[obj]' : v]); etat[p as string] = v; return true; },
    has: () => true,
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}
/** Les `fillText` peints : texte et position. */
const peints = (log: unknown[]) => (log as unknown[][])
  .filter((l) => l[0] === 'fillText')
  .map((l) => ({ t: String(l[1]), x: Number(l[2]), y: Number(l[3]) }));

// ═════════════════════════════════════════════════════════════════════════
describe('A — sans copie : rendu identique à avant (gel)', () => {
  afterEach(cleanup);
  const CAS = [
    ['9:16', 1080, 1920, { ctaMainText: 'JE ME LANCE', ctaSubTextDesign: 'LIEN EN BIO', watermarkPosition: { x: 50, y: 76 }, watermarkSize: 70, ctaFont: 'Inter', watermarkFont: 'Inter', ctaColor: '#FFFFFF', ctaSubColor: '#EC4899', ctaTextScale: 1.2, ctaTypography: { bold: true, italic: false, letterSpacing: 2, lineHeight: 1.2 } }],
    ['16:9', 1920, 1080, { ctaMainText: 'RESERVEZ VOTRE BILAN SOMMEIL GRATUIT SUR AFROBOOST', ctaSubTextDesign: '', textAnimation: 'typewriter' }],
    ['1:1', 1080, 1080, { ctaMainText: 'GO', ctaSubTextDesign: 'X', textAnimation: 'fade', ctaUnderline: true }],
  ] as const;

  it('drawCTA : chaque appel au contexte 2D, à l’identique (liste absente ET liste vide)', () => {
    for (const [nom, w, h, d] of CAS) for (const p of [0.05, 0.5]) {
      for (const variante of [d, { ...d, ctaCopies: [] }]) {
        const { ctx, log } = ctxTrace();
        drawCTA(ctx, w, h, '#7C3AED', 'CHAT', 'BIO', 'Phrase de vente ici', 'WM', null, p, variante as never);
        expect(JSON.parse(JSON.stringify(log)), `${nom}@${p}`).toEqual(GEL_DRAW[`${nom}@${p}`]);
      }
    }
  });

  const generated = { title: 'Routine', subtitle: 'Sous', cards: [{ id: 'a', icon: 'Flame', title: 'Matin', description: '', value: '70%' }], cta: 'JE ME LANCE', ctaSub: 'LIEN EN BIO' };
  const TEXT = {
    title: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
    subtitle: { font: null, color: null, scale: 1 },
    cta: { ...STYLE },
  };
  const propsApercu = (format: '9:16' | '1:1' | '16:9', extra: Record<string, unknown> = {}) => ({
    generated, format, displayScale: 0.25, gradStart: '#7C3AED', gradEnd: '#EC4899', gradientOpacity: 0.5, accent: '#7C3AED',
    watermark: 'Studiio.pro', text: TEXT, activeOrder: ['intro', 'cards', 'cta'], ctaPos: { x: 40, y: 70 },
    onDragStart: () => {}, onDragMove: () => {}, onDragEnd: () => {}, onTextDoubleClick: () => {}, ...extra,
  });

  it.each(['9:16', '1:1', '16:9'] as const)('aperçu Créer %s : HTML identique au gel (liste absente ET vide)', (format) => {
    for (const extra of [{}, { ctaCopies: [] }]) {
      const { container } = render(React.createElement(Preview as never, propsApercu(format, extra) as never));
      if (ECRIRE_GEL_HTML) GEL_HTML[`preview-${format}`] = container.innerHTML;
      expect(container.innerHTML).toBe(GEL_HTML[`preview-${format}`]);
      expect(container.querySelector('[data-cta-copie]')).toBeNull();
      cleanup();
    }
  });

  it.each(['9:16', '1:1', '16:9'] as const)('Remotion %s : HTML identique au gel (liste absente ET vide)', (format) => {
    DIM.w = 1080; DIM.h = 1920; FRAME.n = 40;
    for (const extra of [{}, { ctaCopies: [] }]) {
      const p = { format, title: '', cards: [], ctaText: 'JE ME LANCE', ctaSubText: 'LIEN EN BIO', introDuration: 0, cardsDuration: 0, videoDuration: 0, ctaDuration: 4, sequenceOrder: ['cta'], textAnimation: 'typewriter', ...extra };
      const r = render(React.createElement(CreerSimpleMontage as never, p as never));
      if (ECRIRE_GEL_HTML) GEL_HTML[`remotion-${format}`] = r.container.innerHTML;
      expect(r.container.innerHTML).toBe(GEL_HTML[`remotion-${format}`]);
      cleanup();
    }
  });

  it('brouillon et metadata d’un projet sans copie : aucune clé nouvelle', () => {
    const meta = metadataPourEnregistrement({ design: { ctaMainText: 'GO' } }, { ctaCopies: [] }, { ctaCopies: [] });
    expect(meta).toEqual({});
    expect(metadataPourEnregistrement({}, { ctaCopies: [] })).toEqual({});
    expect('ctaCopies' in toWizardDraft({ metadata: { design: { ctaMainText: 'GO' } } } as never)).toBe(false);
    const opts = optionsRenduDepuisMetadata({ metadata: { design: { ctaMainText: 'GO' } } } as never, 'regenerer', { cards: [] });
    expect('ctaCopies' in (opts.design as object)).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('Modèle — duplication', () => {
  it('copie autonome : tout repris, id neuf, objets recopiés, source intacte', () => {
    const src = copie();
    const avant = JSON.stringify(src);
    const c = dupliquerCta(src, [src], '16:9', () => 0.5);
    expect(c.id).not.toBe(src.id);
    expect(c).toMatchObject({ text: src.text, sub: src.sub, width: src.width, style: src.style });
    expect(c.style).not.toBe(src.style);
    expect(c.pos).toEqual({ x: 50, y: 40 + DECALAGE_COPIE_CTA });
    expect(JSON.stringify(src)).toBe(avant);
  });

  it('9:16 : le décalage reste dans la zone sûre (bas jamais sous CTA_BAS_916)', () => {
    expect(positionCopieCta({ x: 50, y: CTA_BAS_916 }, '9:16').y).toBe(CTA_BAS_916 - DECALAGE_COPIE_CTA);
    expect(positionCopieCta({ x: 50, y: 60 }, '9:16').y).toBe(64);
    for (let y = 0; y <= 100; y += 5) {
      const p = positionCopieCta({ x: 50, y }, '9:16');
      expect(p.y).toBeLessThanOrEqual(CTA_BAS_916);
    }
  });

  it('relecture : valeurs abîmées écartées, jamais d’exception', () => {
    expect(lireCtaCopies(null)).toEqual([]);
    expect(lireCtaCopies('x')).toEqual([]);
    expect(lireCtaCopies([{ id: 'a' }, { id: 'b c', text: 'x', pos: { x: 1, y: 1 } }, copie({ pos: { x: 500, y: 1 } })])).toEqual([]);
    const [lu] = lireCtaCopies([{ ...copie(), style: { color: 'rouge', scale: 99 } }, copie()]);
    expect(lu.style.color).toBe('#FFFFFF');
    expect(lu.style.scale).toBe(1);
    expect(lireCtaCopies([copie(), copie()])).toHaveLength(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('G / H — export canvas et Remotion peignent chaque copie', () => {
  afterEach(cleanup);
  const ORIG = { ctaMainText: 'JE ME LANCE', ctaSubTextDesign: 'LIEN EN BIO', watermarkPosition: { x: 50, y: 76 }, watermarkSize: 70 };
  const C2 = copie({ text: 'RESERVE TA PLACE', sub: 'DES MAINTENANT', pos: { x: 30, y: 40 }, width: 50, style: { ...STYLE, color: '#00FF00', scale: 0.8 } });

  it('G — canvas : les deux textes, chacun à SA position (x = son ancre, bas au-dessus de son y)', () => {
    const { w, h } = VIDEO_SIZE['9:16'];
    const { ctx, log } = ctxTrace();
    drawCTA(ctx, w, h, '#7C3AED', '', '', undefined, undefined, null, 0.5, { ...ORIG, ctaCopies: [C2] } as never);
    const p = peints(log);
    const orig = p.filter((x) => x.t === 'JE ME LANCE' || x.t === 'LIEN EN BIO');
    const cp = p.filter((x) => ['RESERVE', 'TA', 'PLACE', 'DES', 'MAINTENANT'].some((m) => x.t.includes(m)));
    expect(orig.length).toBe(2);
    expect(cp.length).toBeGreaterThanOrEqual(2);
    for (const o of orig) { expect(o.x).toBe(0.5 * w); expect(o.y).toBeLessThan(0.76 * h); expect(o.y).toBeGreaterThan(0.6 * h); }
    for (const o of cp) { expect(o.x).toBe(0.3 * w); expect(o.y).toBeLessThan(0.4 * h); expect(o.y).toBeGreaterThan(0.25 * h); }
    expect(sansEspaces(cp.map((x) => x.t).join(''))).toBe(sansEspaces('RESERVE TA PLACE DES MAINTENANT'));
    // Couleur propre à la copie.
    expect((log as unknown[][]).some((l) => l[0] === 'set' && l[1] === 'fillStyle' && l[2] === '#00FF00')).toBe(true);
  });

  it('G — Remotion : la séquence CTA rend l’original ET la copie, à sa place', () => {
    DIM.w = 1080; DIM.h = 1920; FRAME.n = 100;
    const p = { format: '9:16', title: '', cards: [], ctaText: 'JE ME LANCE', ctaSubText: 'LIEN EN BIO', introDuration: 0, cardsDuration: 0, videoDuration: 0, ctaDuration: 4, sequenceOrder: ['cta'], ctaCopies: [C2] };
    const { container } = render(React.createElement(CreerSimpleMontage as never, p as never));
    const cp = container.querySelector(`[data-cta-copie="${C2.id}"]`) as HTMLElement;
    expect(cp).toBeTruthy();
    expect(cp.style.left).toBe('30%');
    expect(cp.style.top).toBe('40%');
    expect(cp.style.width).toBe('50%');
    expect(cp.textContent).toBe('RESERVE TA PLACEDES MAINTENANT');
    expect(container.textContent).toContain('JE ME LANCE');
  });

  const PROGRES = [0.01, 0.06, 0.12, 0.18, 0.6];
  it('H — canvas : chaque CTA s’écrit lettre à lettre, sur son propre texte', () => {
    const { w, h } = VIDEO_SIZE['9:16'];
    const comptes = PROGRES.map((pr) => {
      const { ctx, log } = ctxTrace();
      drawCTA(ctx, w, h, '#7C3AED', '', '', undefined, undefined, null, pr, { ...ORIG, textAnimation: 'typewriter', ctaCopies: [C2] } as never);
      const p = peints(log);
      return {
        o: sansEspaces(p.filter((x) => x.x === 0.5 * w).map((x) => x.t).join('')).length,
        c: sansEspaces(p.filter((x) => x.x === 0.3 * w).map((x) => x.t).join('')).length,
      };
    });
    const totalO = sansEspaces('JE ME LANCELIEN EN BIO').length;
    const totalC = sansEspaces('RESERVE TA PLACEDES MAINTENANT').length;
    expect(comptes[0].o).toBeLessThan(totalO);
    expect(comptes[0].c).toBeLessThan(totalC);
    expect(comptes[0].c).toBeGreaterThan(0);
    for (let i = 1; i < comptes.length; i++) {
      expect(comptes[i].o).toBeGreaterThanOrEqual(comptes[i - 1].o);
      expect(comptes[i].c).toBeGreaterThanOrEqual(comptes[i - 1].c);
    }
    expect(comptes[2].c).toBeGreaterThan(comptes[0].c);
    expect(comptes[comptes.length - 1]).toEqual({ o: totalO, c: totalC });
  });

  it('H — Remotion : la copie s’écrit image après image', () => {
    DIM.w = 1080; DIM.h = 1920;
    const comptes = PROGRES.map((pr) => {
      FRAME.n = Math.round(pr * 4 * 30);
      const p = { format: '9:16', title: '', cards: [], ctaText: 'JE ME LANCE', introDuration: 0, cardsDuration: 0, videoDuration: 0, ctaDuration: 4, sequenceOrder: ['cta'], textAnimation: 'typewriter', ctaCopies: [C2] };
      const { container } = render(React.createElement(CreerSimpleMontage as never, p as never));
      const n = sansEspaces(container.querySelector('[data-cta-copie]')?.textContent ?? '').length;
      cleanup();
      return n;
    });
    expect(comptes[0]).toBeGreaterThan(0);
    expect(comptes[0]).toBeLessThan(comptes[comptes.length - 1]);
    for (let i = 1; i < comptes.length; i++) expect(comptes[i]).toBeGreaterThanOrEqual(comptes[i - 1]);
    expect(comptes[comptes.length - 1]).toBe(sansEspaces('RESERVE TA PLACEDES MAINTENANT').length);
  });
});

// ═════════════════════════════════════════════════════════════════════════
describe('F — aller-retour metadata (Modifier / Régénérer)', () => {
  const deps = {
    themeIds: ['t'], toneIds: ['n'], formats: ['9:16', '1:1', '16:9'], maxStep: 3,
    defaults: {
      themeId: 't', toneId: 'n', format: '9:16',
      titleStyle: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
      subtitleStyle: { font: null, color: null, scale: 1 },
      ctaStyle: { ...STYLE, subColor: '' },
      sequences: [{ key: 'intro', enabled: true }, { key: 'cta', enabled: true }],
      durations: { intro: 4, cards: 6, video: 0, cta: 4 },
    },
  };
  it('enregistrer → relire : deux CTA, copie intacte ; régénération : copie transmise au compositeur', () => {
    const c = copie();
    const envoi = metadataPourEnregistrement({ design: { ctaMainText: 'GO' } }, { ctaCopies: [c] }, { ctaCopies: [] });
    expect((envoi.design as Record<string, unknown>).ctaCopies).toEqual([c]);
    const post = { title: 'T', metadata: { design: envoi.design } };
    const draft = sanitizeDraft(toWizardDraft(post as never), deps as never)!;
    expect(draft.ctaCopies).toEqual([c]);
    expect(draft.generated).toMatchObject({ cta: 'GO' });
    // Supprimer la dernière copie : `[]` part (sinon elle reviendrait).
    const retire = metadataPourEnregistrement(post.metadata, { ctaCopies: [] }, { ctaCopies: [c] });
    expect((retire.design as Record<string, unknown>).ctaCopies).toEqual([]);
    const opts = optionsRenduDepuisMetadata(post as never, 'regenerer', { cards: [] });
    expect(opts.design?.ctaCopies).toEqual([c]);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// Éditeur Créer : B, C, D, E, F (brouillon) et H (lecture de l'aperçu).
const CLE = draftKey('a@b.c');
const poser = (extra: Record<string, unknown> = {}) => {
  window.localStorage.setItem(CLE, JSON.stringify({
    version: DRAFT_VERSION, savedAt: 1, started: true, step: 1,
    customTopic: 'danse fitness', scheduledDate: '2026-09-01',
    generated: {
      title: 'Danse fitness', subtitle: 'En groupe',
      cards: [{ id: 'c1', icon: 'Heart', title: 'Cardio', description: 'Bouger', value: '1' }],
      cta: 'Viens danser', ctaSub: 'Lien en bio',
    },
    ...extra,
  }));
};
const attendre = async (tours = 6) => {
  for (let i = 0; i < tours; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};
const panneau = () => document.querySelector('[data-zone-panneau="cta"]') as HTMLElement | null;
const action = (id: string) => panneau()?.querySelector(`[data-action-edition="${id}"]`) as HTMLButtonElement | null;
const original = () => document.querySelector('[data-cta-block]') as HTMLElement;
const copies = () => Array.from(document.querySelectorAll('[data-cta-copie]')) as HTMLElement[];

async function dupliquerDepuisOriginal() {
  await act(async () => { fireEvent.doubleClick(original()); });
  await waitFor(() => expect(panneau()).toBeTruthy());
  await act(async () => { fireEvent.click(action('dupliquer')!); });
  await attendre(2);
}

describe('Éditeur Créer — copies du CTA', () => {
  let rectOriginal: PropertyDescriptor | undefined;
  beforeEach(() => {
    window.localStorage.clear();
    SESSION.courante = { data: { user: { email: 'a@b.c' } }, status: 'authenticated' };
    window.alert = () => {};
    globalThis.fetch = vi.fn(async () => ({
      ok: true, status: 200, json: async () => ({ success: true, data: [], posts: [], photos: [] }), text: async () => '{}',
    })) as unknown as typeof fetch;
    // Géométrie : plateau 360 × 640, blocs CTA 80 × 40 — de quoi glisser.
    rectOriginal = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value(this: HTMLElement) {
        const bloc = this.hasAttribute('data-cta-copie') || this.hasAttribute('data-cta-block');
        const r = bloc ? { left: 140, top: 440, width: 80, height: 40 } : { left: 0, top: 0, width: 360, height: 640 };
        return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => r } as DOMRect;
      },
    });
  });
  afterEach(() => {
    cleanup();
    if (rectOriginal) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', rectOriginal);
  });

  it('B + C + E — dupliquer, modifier la copie, la supprimer : l’original ne bouge jamais', async () => {
    poser();
    render(<AssistantWizard />);
    await attendre();
    const texteOriginal = original().textContent;
    const styleOriginal = original().getAttribute('style');
    expect(copies()).toHaveLength(0);

    // B : deux CTA visibles, la copie sélectionnée dans le panneau.
    await dupliquerDepuisOriginal();
    expect(document.querySelectorAll('[data-cta-block]')).toHaveLength(1);
    expect(copies()).toHaveLength(1);
    const id = copies()[0].getAttribute('data-cta-copie')!;
    expect(copies()[0].textContent).toBe(texteOriginal);
    expect(panneau()!.getAttribute('data-cta-cible')).toBe(id);
    // Décalée de l'original (9:16 : vers le haut, l'original est au plancher sûr).
    expect(copies()[0].style.top).not.toBe(original().style.top);

    // C : le texte et le sous-texte de la copie changent ; l'original non.
    const zone = panneau()!.querySelector('[data-zone-texte="cta"]') as HTMLTextAreaElement;
    expect(zone.value).toBe('Viens danser');
    await act(async () => { fireEvent.change(zone, { target: { value: 'Copie modifiée' } }); });
    await act(async () => { fireEvent.change(panneau()!.querySelector('[data-zone-soustexte="cta"]')!, { target: { value: 'Autre ligne' } }); });
    expect(copies()[0].textContent).toBe('Copie modifiéeAutre ligne');
    expect(original().textContent).toBe(texteOriginal);
    expect(original().getAttribute('style')).toBe(styleOriginal);

    // Dupliquer une COPIE marche aussi : elle reprend le texte de la copie.
    await act(async () => { fireEvent.click(action('dupliquer')!); });
    await attendre(2);
    expect(copies()).toHaveLength(2);
    expect(copies()[1].textContent).toBe('Copie modifiéeAutre ligne');

    // E : supprimer la copie sélectionnée — l'original et l'autre copie restent.
    const cible = panneau()!.getAttribute('data-cta-cible');
    await act(async () => { fireEvent.click(action('supprimer')!); });
    await attendre(2);
    expect(copies().map((c) => c.getAttribute('data-cta-copie'))).toEqual([id]);
    expect(cible).not.toBe(id);
    expect(original().textContent).toBe(texteOriginal);
    // L'original n'offre pas « Supprimer ».
    await act(async () => { fireEvent.doubleClick(original()); });
    await waitFor(() => expect(panneau()!.getAttribute('data-cta-cible')).toBe('original'));
    expect(action('supprimer')).toBeNull();
    // Le texte du panneau est celui de l'original.
    expect((panneau()!.querySelector('[data-zone-texte="cta"]') as HTMLTextAreaElement).value).toBe('Viens danser');
  });

  it('D — glisser la copie : seule elle bouge', async () => {
    poser();
    render(<AssistantWizard />);
    await attendre();
    await dupliquerDepuisOriginal();
    const styleOriginal = original().getAttribute('style');
    const cp = copies()[0];
    const avant = { left: cp.style.left, top: cp.style.top };
    await act(async () => { fireEvent.pointerDown(cp, { button: 0, isPrimary: true, pointerId: 7, clientX: 180, clientY: 460, buttons: 1 }); });
    await act(async () => { fireEvent.pointerMove(cp, { pointerId: 7, clientX: 120, clientY: 200, buttons: 1, pointerType: 'mouse' }); });
    await act(async () => { fireEvent.pointerUp(cp, { pointerId: 7 }); });
    await attendre(2);
    const apres = copies()[0];
    expect(apres.style.top).not.toBe(avant.top);
    expect(parseFloat(apres.style.top)).toBeLessThan(parseFloat(avant.top));
    expect(original().getAttribute('style')).toBe(styleOriginal);
  });

  it('F — brouillon : sauvegarde puis rechargement → deux CTA', async () => {
    poser();
    const r = render(<AssistantWizard />);
    await attendre();
    await dupliquerDepuisOriginal();
    await act(async () => { fireEvent.change(panneau()!.querySelector('[data-zone-texte="cta"]')!, { target: { value: 'Seconde' } }); });
    await waitFor(() => {
      const brut = JSON.parse(window.localStorage.getItem(CLE) ?? '{}');
      expect(brut.ctaCopies?.[0]?.text).toBe('Seconde');
    }, { timeout: 3000 });
    r.unmount();
    render(<AssistantWizard />);
    await attendre();
    expect(document.querySelectorAll('[data-cta-block]')).toHaveLength(1);
    expect(copies()).toHaveLength(1);
    expect(copies()[0].textContent).toContain('Seconde');
    expect(original().textContent).toContain('Viens danser');
  });

  it('limite : au-delà de MAX_CTA_COPIES, « Dupliquer » est grisé', async () => {
    const liste = Array.from({ length: MAX_CTA_COPIES }, (_, i) => copie({ id: `cta-${i}`, pos: { x: 50, y: 30 + i } }));
    poser({ ctaCopies: liste });
    render(<AssistantWizard />);
    await attendre();
    expect(copies()).toHaveLength(MAX_CTA_COPIES);
    await act(async () => { fireEvent.doubleClick(original()); });
    await waitFor(() => expect(panneau()).toBeTruthy());
    expect(action('dupliquer')!.disabled).toBe(true);
  });
});

describe('B / H — lecture de l’aperçu : les deux CTA, écrits chacun à la machine à écrire', () => {
  let clientWidthOriginal: PropertyDescriptor | undefined;
  beforeEach(() => {
    window.localStorage.clear();
    SESSION.courante = { data: null, status: 'unauthenticated' };
    clientWidthOriginal = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 400; } });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('/api/autopilot/config')) {
        return { ok: true, json: async () => ({ success: true, ready: true, brandingReady: true, styleReady: true, config: {} }) };
      }
      return { ok: true, json: async () => ({ success: true, photos: [] }) };
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

  it('9:16 : l’extrait CTA écrit l’original ET la copie, puis les montre entiers', async () => {
    render(<AssistantWizard />);
    fireEvent.click(screen.getByRole('button', { name: 'Créer une vidéo' }));
    fireEvent.click(screen.getByText('Continuer vers Style'));
    await waitFor(() => expect(document.querySelector('[data-cta-block]')).toBeTruthy());
    await act(async () => { fireEvent.doubleClick(original()); });
    await waitFor(() => expect(panneau()).toBeTruthy());
    await act(async () => { fireEvent.click(action('dupliquer')!); });
    await act(async () => { fireEvent.change(panneau()!.querySelector('[data-zone-texte="cta"]')!, { target: { value: 'RESERVE TA PLACE MAINTENANT' } }); });
    expect(copies()).toHaveLength(1);
    const entierCopie = sansEspaces(copies()[0].textContent ?? '');
    fireEvent.click(screen.getByRole('tab', { name: 'CTA' }));
    fireEvent.click(document.querySelector('[data-text-animation="typewriter"]') as HTMLElement);
    const comptes: Array<{ o: number; c: number }> = [];
    for (let i = 0; i < 6; i++) {
      await avancer(i === 0 ? 16 : 160);
      const calque = document.querySelector('[data-playback-layer="a"]') as HTMLElement;
      expect(calque.getAttribute('data-playback-sequence')).toBe('cta');
      // B : deux CTA dans la lecture de l'aperçu.
      expect(calque.querySelectorAll('[data-cta-block]')).toHaveLength(1);
      expect(calque.querySelectorAll('[data-cta-copie]')).toHaveLength(1);
      comptes.push({
        o: sansEspaces(calque.querySelector('[data-cta-block]')?.textContent ?? '').length,
        c: sansEspaces(calque.querySelector('[data-cta-copie]')?.textContent ?? '').length,
      });
    }
    expect(comptes[0].c).toBeGreaterThan(0);
    expect(comptes[0].c).toBeLessThan(entierCopie.length);
    for (let i = 1; i < comptes.length; i++) {
      expect(comptes[i].o).toBeGreaterThanOrEqual(comptes[i - 1].o);
      expect(comptes[i].c).toBeGreaterThanOrEqual(comptes[i - 1].c);
    }
    expect(comptes[comptes.length - 1].c).toBeGreaterThan(comptes[0].c);
    expect(comptes[comptes.length - 1].o).toBeGreaterThan(comptes[0].o);
  });
});
