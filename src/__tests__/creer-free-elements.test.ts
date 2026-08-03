import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { freeElementRect } from '@/lib/video-composer';

/**
 * Éléments libres — de l'aperçu à la vidéo exportée.
 *
 * L'onglet « Éléments » pose des icônes lucide sur l'aperçu. Sans rendu côté
 * compositeur, elles n'existaient que dans l'éditeur : l'utilisateur les
 * plaçait, puis la vidéo sortait sans elles.
 *
 * Deux exigences :
 *
 * 1. **Default-safe.** Un montage sans élément se compose exactement comme
 *    avant — `elements` absent, aucun dessin, aucun chemin de code nouveau.
 * 2. **Le glyphe exporté est CELUI de l'aperçu.** L'éditeur sérialise le SVG
 *    lucide déjà affiché plutôt que de dupliquer une table nom → chemin : le
 *    dépôt en compte déjà deux (`ICON_MAP` et `CARD_ICON_MAP`), et CLAUDE.md
 *    signale cette duplication comme une source de bug latente.
 */

const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');
const editor = readFileSync(resolve(__dirname, '../app/dashboard/creer/page.tsx'), 'utf-8');

/** Plateau 9:16 — les dimensions vidéo réelles. */
const W = 1080;
const H = 1920;

describe('freeElementRect — la règle de placement', () => {
  it('convertit la taille de l aperçu (320 px) en pixels vidéo', () => {
    // Même base que le logo : `60/320 * canvasW`. Une icône de 64 px dans un
    // aperçu large de 320 occupe donc un cinquième de la largeur vidéo.
    expect(freeElementRect({ x: 50, y: 50, size: 64 }, W, H)!.size).toBe((64 / 320) * W);
  });

  it('x et y désignent le CENTRE, comme dans l aperçu', () => {
    // L'aperçu pose `left/top` en % puis `translate(-50%, -50%)`.
    const r = freeElementRect({ x: 50, y: 50, size: 64 }, W, H)!;
    expect(r.x).toBe(Math.round(W / 2 - r.size / 2));
    expect(r.y).toBe(Math.round(H / 2 - r.size / 2));
  });

  it('les deux axes ne sont pas interchangeables', () => {
    // Le plateau n'est pas carré : x et y n'ont pas le même diviseur.
    const r = freeElementRect({ x: 25, y: 25, size: 64 }, W, H)!;
    expect(r.x).toBe(Math.round(W * 0.25 - r.size / 2));
    expect(r.y).toBe(Math.round(H * 0.25 - r.size / 2));
    expect(r.x).not.toBe(r.y);
  });

  it('un élément posé au bord garde sa taille — il déborde, il ne rétrécit pas', () => {
    const bord = freeElementRect({ x: 0, y: 0, size: 64 }, W, H)!;
    expect(bord.size).toBe((64 / 320) * W);
    expect(bord.x).toBe(Math.round(-bord.size / 2));
  });

  it('refuse une taille nulle ou absurde plutôt que de peindre du vide', () => {
    for (const size of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(freeElementRect({ x: 50, y: 50, size }, W, H), String(size)).toBeNull();
    }
  });

  it('refuse une position non finie', () => {
    expect(freeElementRect({ x: Number.NaN, y: 50, size: 64 }, W, H)).toBeNull();
    expect(freeElementRect({ x: 50, y: Number.POSITIVE_INFINITY, size: 64 }, W, H)).toBeNull();
  });

  it('suit la largeur de la vidéo : le paysage agrandit l élément', () => {
    const portrait = freeElementRect({ x: 50, y: 50, size: 64 }, 1080, 1920)!;
    const paysage = freeElementRect({ x: 50, y: 50, size: 64 }, 1920, 1080)!;
    expect(paysage.size).toBeCloseTo(portrait.size * (1920 / 1080), 5);
  });
});

describe('Default-safe : un montage sans élément ne change pas', () => {
  it('la couche sort immédiatement quand il n y a rien à dessiner', () => {
    expect(composer).toContain('if (!elements || elements.length === 0) return;');
  });

  it('un élément sans image décodée est omis, jamais dessiné à vide', () => {
    // Un rendu déjà lancé ne doit pas échouer parce qu'une icône n'a pas
    // chargé : la vidéo sort sans elle.
    expect(composer).toContain("if (!img || !img.complete || img.naturalWidth === 0) continue;");
  });

  it("l'éditeur n'envoie rien quand aucun élément n'est posé", () => {
    expect(editor).toContain('if (freeElements.length === 0) return undefined;');
    expect(editor).toContain('return kept.length > 0 ? kept : undefined;');
  });

  it('les lecteurs de `elements` défaultent à une liste vide', () => {
    expect(editor).toContain('elements: freeElements');
  });
});

describe('La couche est peinte sur TOUTES les séquences, après le logo', () => {
  it('les quatre séquences appellent la couche', () => {
    // Intro, cartes, vidéo, CTA : un élément posé doit rester visible d'un
    // bout à l'autre du montage, comme le logo.
    expect(composer.split('drawFreeElements(ctx, design, w, h);').length - 1).toBe(4);
  });

  it('elle vient APRÈS le logo — c est l ordre d empilement de l aperçu', () => {
    const bloc = composer.slice(composer.indexOf("getLogoPos(design, 'intro')"));
    expect(bloc.indexOf('drawLogoAccurate')).toBeLessThan(bloc.indexOf('drawFreeElements'));
  });
});

describe('Le glyphe exporté est celui de l aperçu', () => {
  it("l'éditeur sérialise le SVG déjà affiché", () => {
    // Plutôt qu'une troisième copie des chemins d'icônes côté compositeur.
    expect(editor).toContain('data-free-element={el.id}');
    expect(editor).toContain('document.querySelector(`[data-free-element="${el.id}"] svg`)');
    expect(editor).toContain('new XMLSerializer().serializeToString(svg)');
  });

  it('le SVG détaché reçoit une taille et une couleur explicites', () => {
    // Sans dimensions intrinsèques l'image se décode en 0×0 et `drawImage` ne
    // peint rien ; `currentColor` n'a plus de contexte hors du document.
    expect(editor).toContain("svg.setAttribute('width', String(el.size));");
    expect(editor).toContain("svg.setAttribute('height', String(el.size));");
    expect(editor).toContain("svg.setAttribute('stroke', el.color);");
  });

  it('une image qui ne se décode pas ne bloque pas l export', () => {
    // Sans délai de garde, la promesse resterait pendante et l'export figé.
    const bloc = editor.slice(editor.indexOf('const rasterizeFreeElements'));
    expect(bloc.slice(0, 2500)).toContain('setTimeout(resolve, 4000)');
    expect(bloc.slice(0, 2500)).toContain('img.onerror');
  });

  it('les deux chemins d export reçoivent la couche', () => {
    // Calendrier (batch) et MP4 (bureau).
    expect(editor.split('elements: await rasterizeFreeElements(),').length - 1).toBe(2);
  });

  it('des icônes lucide, jamais des emojis', () => {
    expect(editor).toContain("renderLucideIcon(el.iconName, { size: el.size, color: el.color, style: 'outline' })");
  });
});
