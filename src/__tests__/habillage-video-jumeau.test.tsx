/**
 * Habillage de la séquence Vidéo (jumeau) aux couleurs du style — un CADRE
 * par-dessus les bords (bande en dégradé début → fin, filet d'accent), le
 * MÊME dans l'aperçu (CSS) et dans l'export (canvas). Jamais un filtre sur
 * l'image. Opt-in : les anciens posts, sans `habillageVideo`, sont rendus
 * exactement comme avant.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontsLoaded: async () => [] };
});

import { Preview } from '@/app/dashboard/creer/AssistantWizard';
import {
  mesuresHabillage, angleDiagonale, dessinerHabillageVideo, lireHabillageVideo,
} from '@/lib/creer/habillageVideo';
import { optionsRenduDepuisMetadata } from '@/lib/rendus/options-depuis-metadata';

afterEach(cleanup);

const HAB = { debut: '#12AB34', fin: '#FEDC01', accent: '#0099FF' };

describe('géométrie partagée aperçu / export', () => {
  it('épaisseurs proportionnelles à la largeur de la vidéo', () => {
    expect(mesuresHabillage(1080)).toEqual({ bande: 19, filet: 4 });
    expect(mesuresHabillage(1920)).toEqual({ bande: 35, filet: 8 });
  });

  it('l’angle CSS suit EXACTEMENT la diagonale du canvas (coin haut-gauche → bas-droit)', () => {
    for (const [w, h] of [[1080, 1920], [1920, 1080], [1000, 1000]]) {
      const a = (angleDiagonale(w, h) * Math.PI) / 180;
      // Direction CSS (sin θ, −cos θ) colinéaire au vecteur (w, h).
      const cross = Math.sin(a) * h - -Math.cos(a) * w;
      expect(Math.abs(cross)).toBeLessThan(1);
      expect(Math.sin(a)).toBeGreaterThan(0);
    }
  });

  it('relecture stricte : couleurs hex uniquement', () => {
    expect(lireHabillageVideo(HAB)).toEqual(HAB);
    expect(lireHabillageVideo({ ...HAB, accent: 'url(javascript:x)' })).toBeUndefined();
    expect(lireHabillageVideo(null)).toBeUndefined();
  });
});

describe('export (canvas) : un cadre par-dessus les bords, jamais un filtre', () => {
  function ctxEspion() {
    const appels: Array<[string, unknown[]]> = [];
    const stops: Array<[number, string]> = [];
    const etat: Record<string, unknown> = {};
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, p) => {
        if (p === 'createLinearGradient') return (...a: unknown[]) => { appels.push(['gradient', a]); return { addColorStop: (o: number, c: string) => stops.push([o, c]) }; };
        if (typeof p === 'string' && p in etat) return etat[p];
        return (...a: unknown[]) => { appels.push([String(p), a]); };
      },
      set: (_t, p, v) => { etat[p as string] = v; appels.push([`set:${String(p)}`, [v]]); return true; },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, appels, stops };
  }

  it('dégradé début → fin sur la diagonale, bande évidée, filet d’accent ; aucun filtre', () => {
    const { ctx, appels, stops } = ctxEspion();
    dessinerHabillageVideo(ctx, 1080, 1920, HAB);
    expect(appels.find(([n]) => n === 'gradient')![1]).toEqual([0, 0, 1080, 1920]);
    expect(stops).toEqual([[0, HAB.debut], [1, HAB.fin]]);
    expect(appels).toContainEqual(['fill', ['evenodd']]);
    expect(appels).toContainEqual(['rect', [19, 19, 1080 - 38, 1920 - 38]]);
    expect(appels).toContainEqual(['set:strokeStyle', [HAB.accent]]);
    expect(appels.some(([n]) => n === 'set:filter' || n === 'set:globalCompositeOperation')).toBe(false);
    // save / restore équilibrés (#518).
    expect(appels.filter(([n]) => n === 'save').length).toBe(appels.filter(([n]) => n === 'restore').length);
  });
});

describe('aperçu : le cadre suit les couleurs EN DIRECT, la vidéo n’est pas touchée', () => {
  const generated = {
    title: 'T', subtitle: '', cards: [{ id: 'a', icon: 'Flame', title: 'A', description: '', value: '1' }], cta: 'GO', ctaSub: '',
  };
  const TEXT = {
    title: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
    subtitle: { font: null, color: null, scale: 1 },
    cta: { font: 'Inter', color: '#FFFFFF', subColor: '#EC4899', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
  };
  type P = Parameters<typeof Preview>[0];
  const props = (sur: Record<string, unknown>) => ({
    generated, format: '9:16', displayScale: 0.25, gradientOpacity: 0.5, watermark: 'W', text: TEXT,
    onFocusChange: () => {}, rushUrl: 'https://exemple.test/jumeau.mp4', activeOrder: ['video', 'intro', 'cards', 'cta'], focus: 'video',
    gradStart: '#7C3AED', gradEnd: '#EC4899', accent: '#7C3AED', ...sur,
  }) as unknown as P;
  const cadre = () => document.querySelector<HTMLElement>('[data-habillage-video]')!;

  it('accent, dégradé début, dégradé fin : le cadre change à chaque modification', () => {
    const { rerender } = render(<Preview {...props({})} />);
    expect(cadre()).toBeTruthy();
    rerender(<Preview {...props({ gradStart: HAB.debut })} />);
    expect(cadre().style.borderImage.toLowerCase()).toContain('#12ab34');
    rerender(<Preview {...props({ gradStart: HAB.debut, gradEnd: HAB.fin })} />);
    expect(cadre().style.borderImage.toLowerCase()).toContain('#fedc01');
    rerender(<Preview {...props({ gradStart: HAB.debut, gradEnd: HAB.fin, accent: HAB.accent })} />);
    const filet = cadre().firstElementChild as HTMLElement;
    expect(filet.style.boxShadow.toLowerCase()).toMatch(/#0099ff|rgb\(0, 153, 255\)/);
  });

  it('pixels source inchangés : la vidéo n’a ni filtre ni mélange, le cadre est un calque à part', () => {
    render(<Preview {...props({ gradStart: HAB.debut })} />);
    const video = document.querySelector('video')!;
    expect(video.style.filter).toBe('');
    expect(video.style.mixBlendMode).toBe('');
    expect(cadre().style.pointerEvents).toBe('none');
    expect(cadre().style.background).toBe('');
  });

  it('pas de vidéo montée : pas de cadre', () => {
    render(<Preview {...props({ rushUrl: null })} />);
    expect(cadre()).toBeNull();
  });
});

describe('Calendrier : même cadre pour un post Créer, rien pour un ancien post', () => {
  const post = (design: Record<string, unknown>) => ({ metadata: { design, rushUrls: ['https://x/r.mp4'] } }) as never;
  const prep = { cards: [], onProgress: () => {} } as never;
  it('post Créer avec habillage : relu tel quel', () => {
    expect(optionsRenduDepuisMetadata(post({ habillageVideo: HAB }), 'regenerer', prep).design?.habillageVideo).toEqual(HAB);
  });
  it('ancien post (sans champ) : aucun habillage — rendu inchangé', () => {
    expect(optionsRenduDepuisMetadata(post({}), 'regenerer', prep).design?.habillageVideo).toBeUndefined();
  });
});
