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
  arretsVoile, cssVoile, habillagePourMode, lireModeHabillage, MODE_HABILLAGE_DEFAUT,
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
    gradStart: '#7C3AED', gradEnd: '#EC4899', accent: '#7C3AED', habillageVideoMode: 'cadre', ...sur,
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

describe('modes d’habillage : Dégradé (défaut), Cadre, Aucun', () => {
  const C = { debut: '#12AB34', fin: '#FEDC01', accent: '#0099FF', opacite: 0.6 };

  it('1. défaut = Dégradé ; un brouillon inconnu retombe sur le défaut', () => {
    expect(MODE_HABILLAGE_DEFAUT).toBe('degrade');
    expect(lireModeHabillage('n’importe quoi')).toBe('degrade');
    expect(lireModeHabillage('cadre')).toBe('cadre');
    expect(lireModeHabillage('aucun')).toBe('aucun');
  });

  it('3. Aucun : rien n’est envoyé à l’export', () => {
    expect(habillagePourMode('aucun', C)).toBeUndefined();
    expect(habillagePourMode('degrade', C)).toEqual({ ...C, mode: 'degrade' });
  });

  it('1+4. Dégradé : le canvas pose EXACTEMENT les arrêts de l’aperçu (voile des Cartes)', () => {
    const hab = habillagePourMode('degrade', C)!;
    const stops: Array<[number, string]> = [];
    const appels: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, p) => (p === 'createLinearGradient'
        ? (...a: number[]) => { appels.push(`gradient:${a.join(',')}`); return { addColorStop: (o: number, c: string) => stops.push([o, c]) }; }
        : (...a: unknown[]) => { appels.push(`${String(p)}:${a.join(',')}`); }),
      set: (_t, p, v) => { appels.push(`set:${String(p)}=${typeof v}`); return true; },
    }) as unknown as CanvasRenderingContext2D;
    dessinerHabillageVideo(ctx, 1080, 1920, hab);
    expect(appels).toContain('gradient:0,0,0,1920'); // vertical, haut → bas, comme 180deg
    expect(stops).toEqual(arretsVoile(hab));
    expect(stops).toEqual([[0, 'rgba(18, 171, 52, 0.6)'], [0.4, 'rgba(0, 0, 0, 0)'], [0.6, 'rgba(0, 0, 0, 0)'], [1, 'rgba(254, 220, 1, 0.6)']]);
    // Le CSS de l'aperçu est fait des MÊMES arrêts.
    expect(cssVoile(hab)).toBe('linear-gradient(180deg, rgba(18, 171, 52, 0.6) 0%, rgba(0, 0, 0, 0) 40%, rgba(0, 0, 0, 0) 60%, rgba(254, 220, 1, 0.6) 100%)');
    expect(appels).toContain('fillRect:0,0,1080,1920');
    expect(appels.some((a) => a.startsWith('set:filter') || a.startsWith('set:globalCompositeOperation'))).toBe(false);
  });

  it('2+6. Cadre, et ANCIEN post (#522, sans mode) : toujours le cadre', () => {
    const ancien = lireHabillageVideo({ debut: C.debut, fin: C.fin, accent: C.accent })!;
    expect(ancien.mode).toBeUndefined();
    const appels: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (_t, p) => (p === 'createLinearGradient' ? () => ({ addColorStop: () => {} }) : (...a: unknown[]) => { appels.push(`${String(p)}:${a.join(',')}`); }),
      set: () => true,
    }) as unknown as CanvasRenderingContext2D;
    dessinerHabillageVideo(ctx, 1080, 1920, ancien);
    expect(appels).toContain('fill:evenodd');
  });

  it('relecture : mode et opacité valides gardés, le reste écarté', () => {
    expect(lireHabillageVideo({ ...C, mode: 'degrade' })).toEqual({ ...C, mode: 'degrade' });
    expect(lireHabillageVideo({ ...C, mode: 'flou', opacite: 7 })).toEqual({ debut: C.debut, fin: C.fin, accent: C.accent, opacite: 1 });
  });
});

describe('aperçu : chaque mode, en direct, vidéo intacte', () => {
  const generated = { title: 'T', subtitle: '', cards: [{ id: 'a', icon: 'Flame', title: 'A', description: '', value: '1' }], cta: 'GO', ctaSub: '' };
  const TEXT = {
    title: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
    subtitle: { font: null, color: null, scale: 1 },
    cta: { font: 'Inter', color: '#FFFFFF', subColor: '#EC4899', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
  };
  type P = Parameters<typeof Preview>[0];
  const props = (sur: Record<string, unknown>) => ({
    generated, format: '9:16', displayScale: 0.25, gradientOpacity: 0.6, watermark: 'W', text: TEXT, onFocusChange: () => {},
    rushUrl: 'https://exemple.test/jumeau.mp4', activeOrder: ['video', 'intro', 'cards', 'cta'], focus: 'video',
    gradStart: '#12AB34', gradEnd: '#FEDC01', accent: '#0099FF', ...sur,
  }) as unknown as P;
  const calque = () => document.querySelector<HTMLElement>('[data-habillage-video]');

  it('Dégradé : voile aux couleurs du style, mis à jour à chaque changement', () => {
    const { rerender } = render(<Preview {...props({ habillageVideoMode: 'degrade' })} />);
    expect(calque()!.dataset.mode).toBe('degrade');
    expect(calque()!.style.background).toMatch(/rgba\(18, 171, 52, 0\.6\)/);
    rerender(<Preview {...props({ habillageVideoMode: 'degrade', gradStart: '#000000' })} />);
    expect(calque()!.style.background).toMatch(/rgba\(0, 0, 0, 0\.6\)/);
    expect(document.querySelector('video')!.style.filter).toBe('');
  });
  it('Cadre : le cadre', () => {
    render(<Preview {...props({ habillageVideoMode: 'cadre' })} />);
    expect(calque()!.dataset.mode).toBe('cadre');
  });
  it('Aucun (et défaut d’un aperçu qui ne dit rien — l’Autopilote) : aucun calque', () => {
    render(<Preview {...props({ habillageVideoMode: 'aucun' })} />);
    expect(calque()).toBeNull();
    cleanup();
    render(<Preview {...props({})} />);
    expect(calque()).toBeNull();
  });
});

describe('Calendrier : même mode relu', () => {
  const post = (design: Record<string, unknown>) => ({ metadata: { design, rushUrls: ['https://x/r.mp4'] } }) as never;
  const prep = { cards: [], onProgress: () => {} } as never;
  it.each(['regenerer', 'exporter'] as const)('chemin %s : mode Dégradé et son opacité relus', (chemin) => {
    const hab = { debut: '#12AB34', fin: '#FEDC01', accent: '#0099FF', mode: 'degrade', opacite: 0.6 };
    expect(optionsRenduDepuisMetadata(post({ habillageVideo: hab }), chemin, prep).design?.habillageVideo).toEqual(hab);
  });
});
