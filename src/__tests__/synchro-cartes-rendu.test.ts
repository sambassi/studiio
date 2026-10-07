/**
 * Rendu des cartes calées sur la voix : le compositeur choisit la photo de
 * l'étape en cours ; sans calage, EXACTEMENT le rendu d'avant ; l'enveloppe
 * d'animation de #518 (save/restore) reste équilibrée dans tous les cas.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontsLoaded: async () => [] };
});

import { drawCards, type DesignOptions } from '@/lib/video-composer';
import { capturerEtapesCartes } from '@/lib/creer/capture-etapes-cartes';
import { calageCartes, morceauxCartes, texteDesMorceaux } from '@/lib/creer/synchro-cartes';

function contexte() {
  let alpha = 1;
  let profondeur = 0;
  const pile: number[] = [];
  const peints: unknown[] = [];
  const degrade = { addColorStop: () => {} };
  const base: Record<string, unknown> = {
    save: () => { pile.push(alpha); profondeur += 1; },
    restore: () => { const a = pile.pop(); if (a !== undefined) alpha = a; profondeur -= 1; },
    drawImage: (src: unknown) => { peints.push(src); },
    measureText: (t: string) => ({ width: String(t).length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createLinearGradient: () => degrade,
    createRadialGradient: () => degrade,
    createPattern: () => null,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
  const ctx = new Proxy(base, {
    get: (t, p) => (p === 'globalAlpha' ? alpha : p in t ? (t as never)[p] : () => {}),
    set: (_t, p, v) => { if (p === 'globalAlpha') alpha = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, peints, profondeur: () => profondeur, alpha: () => alpha };
}

const photo = (nom: string) => ({ nom, width: 900, height: 600, naturalWidth: 900, naturalHeight: 600 }) as unknown as HTMLImageElement;
const RECT = { x: 4, y: 30, width: 92, height: 40 };

describe('drawCards — photos d’étapes', () => {
  it('8. sans calage : la photo unique, exactement comme avant (quel que soit l’instant)', () => {
    const { ctx, peints, profondeur } = contexte();
    const design = { textAnimation: 'fade', cardsSnapshot: photo('unique'), cardsSnapshotRect: RECT } as DesignOptions;
    for (const t of [0, 0.5, 3, Infinity]) drawCards(ctx, 1080, 1920, [], null, '#7C3AED', 0.5, design, null, 1, t);
    // Appel d'avant, sans l'argument secondes : même photo.
    drawCards(ctx, 1080, 1920, [], null, '#7C3AED', 0.5, design);
    expect(peints.every((p) => (p as { nom: string }).nom === 'unique')).toBe(true);
    expect(peints).toHaveLength(5);
    expect(profondeur()).toBe(0);
  });

  it('avec calage : la photo de l’étape commencée ; avant la première, aucune carte', () => {
    const { ctx, peints } = contexte();
    const design = {
      cardsSnapshot: photo('unique'), cardsSnapshotRect: RECT,
      cardsReveal: [{ debut: 0.1, image: photo('e1') }, { debut: 1.4, image: photo('e2') }, { debut: 2.9, image: photo('e3') }],
    } as DesignOptions;
    const a = (t: number) => { peints.length = 0; drawCards(ctx, 1080, 1920, [], null, '#7C3AED', 0.5, design, null, 1, t); return (peints.at(-1) as { nom?: string } | undefined)?.nom; };
    expect(a(0)).toBeUndefined();
    expect(a(0.1)).toBe('e1');
    expect(a(1.39)).toBe('e1');
    expect(a(1.4)).toBe('e2');
    expect(a(10)).toBe('e3');
  });

  it('9. #518 : save/restore équilibrés et alpha intact à CHAQUE instant, étape vide comprise', () => {
    const { ctx, profondeur, alpha } = contexte();
    const design = {
      textAnimation: 'fade', cardsSnapshot: photo('unique'), cardsSnapshotRect: RECT,
      cardsReveal: [{ debut: 0.5, image: photo('e1') }],
    } as DesignOptions;
    for (const [p, t] of [[0, 0], [0.01, 0.1], [0.1, 0.5], [1, 5]]) {
      drawCards(ctx, 1080, 1920, [], null, '#7C3AED', p, design, null, 1, t);
      expect(profondeur()).toBe(0);
      expect(alpha()).toBe(1);
    }
  });
});

describe('capturerEtapesCartes — une photo par étape, styles toujours restaurés', () => {
  const CARTES = [
    { id: 'c1', title: 'Cardio', description: 'Brûle', value: '76%' },
    { id: 'c2', title: 'Force', description: '', value: '' },
  ];

  function dom() {
    const conteneur = document.createElement('div');
    conteneur.innerHTML = CARTES.map((c) => `<div data-card-id="${c.id}"><span>${c.title}</span>${c.value ? `<span data-card-value>${c.value}</span>` : ''}</div>`).join('');
    return conteneur;
  }
  const visibles = (el: HTMLElement) => ({
    c1: el.querySelector<HTMLElement>('[data-card-id="c1"]')!.style.visibility,
    v1: el.querySelector<HTMLElement>('[data-card-id="c1"] [data-card-value]')!.style.visibility,
    c2: el.querySelector<HTMLElement>('[data-card-id="c2"]')!.style.visibility,
  });

  it('carte 1, puis sa valeur, puis carte 2 — et le DOM revient tel quel', async () => {
    const el = dom();
    const texte = texteDesMorceaux(morceauxCartes(CARTES));
    const calage = calageCartes(CARTES, { textAtGeneration: texte, duration: 6 })!;
    const vus: Array<ReturnType<typeof visibles>> = [];
    const etapes = await capturerEtapesCartes(el, calage, CARTES.map((c) => c.id), async () => { vus.push(visibles(el)); return `photo-${vus.length}`; });
    expect(etapes!.map((e) => e.image)).toEqual(['photo-1', 'photo-2', 'photo-3']);
    expect(vus).toEqual([
      { c1: '', v1: 'hidden', c2: 'hidden' },
      { c1: '', v1: '', c2: 'hidden' },
      { c1: '', v1: '', c2: '' },
    ]);
    expect(visibles(el)).toEqual({ c1: '', v1: '', c2: '' });
  });

  it('photo ratée ou carte introuvable : null, et le DOM est restauré', async () => {
    const el = dom();
    const calage = calageCartes(CARTES, { textAtGeneration: texteDesMorceaux(morceauxCartes(CARTES)), duration: 6 })!;
    expect(await capturerEtapesCartes(el, calage, ['c1', 'c2'], async () => null)).toBeNull();
    expect(visibles(el)).toEqual({ c1: '', v1: '', c2: '' });
    expect(await capturerEtapesCartes(el, calage, ['c1', 'absente'], async () => 'x')).toBeNull();
  });
});
