import { describe, it, expect } from 'vitest';
import {
  drawTransition,
  resolveTransitionStyle,
  TRANSITION_STYLES,
  TRANSITION_KEYS,
  TRANSITION_LABELS,
  DEFAULT_TRANSITION,
  type TransitionScratch,
  type TransitionStyle,
} from '@/lib/video-composer';

/**
 * Moteur de transitions — tests de COMPORTEMENT.
 *
 * On n'y rejoue aucune formule : on branche un faux contexte 2D qui
 * ENREGISTRE les operations de dessin reellement emises, puis on interroge
 * cette trace. Un test qui recalculerait `-w * e` ne prouverait rien ; ici,
 * si le moteur cesse de deplacer le calque, la trace le montre.
 */

const W = 1080;
const H = 1920;

interface Op {
  op: string;
  args: unknown[];
  /** Etat au moment de l'operation — l'alpha courant compte autant que l'appel. */
  alpha: number;
  /** Filtre canvas actif au moment de l'operation (flou des styles cinema). */
  filter?: string;
}

/**
 * Contexte 2D minimal qui journalise tout ce qu'on lui demande.
 *
 * ⚠️ `save`/`restore` EMPILENT REELLEMENT l'etat (alpha, clip, transform).
 * Un double qui se contenterait de les journaliser mentirait : supprimer un
 * `restore()` du moteur — donc laisser fuir un clip ou une echelle sur tout
 * le reste de la video — passerait alors inapercu.
 */
function recordingCtx(label: string) {
  const ops: Op[] = [];
  const state = { alpha: 1, clipped: false, scaled: false, filter: 'none', fillStyle: '' as unknown };
  const stack: Array<typeof state> = [];
  const rec = (op: string, ...args: unknown[]) =>
    ops.push({ op, args, alpha: state.alpha, filter: state.filter });

  const ctx = {
    label,
    ops,
    /** Etat courant — sert a verifier qu'on repart propre apres la transition. */
    state,
    /** Profondeur de pile save/restore : doit retomber a 0. */
    get depth() { return stack.length; },
    get globalAlpha() { return state.alpha; },
    set globalAlpha(v: number) { state.alpha = v; rec('globalAlpha', v); },
    get fillStyle() { return state.fillStyle; },
    set fillStyle(v: unknown) { state.fillStyle = v; },
    // `filter` fait partie de l'etat du canvas : il doit s'empiler comme
    // l'alpha, sinon un flou laisse fuir sur le reste de la frame sans que
    // le test le voie.
    get filter() { return state.filter; },
    set filter(v: string) { state.filter = v; rec('filter', v); },
    save: () => { stack.push({ ...state }); rec('save'); },
    restore: () => {
      const prev = stack.pop();
      if (prev) Object.assign(state, prev);
      rec('restore');
    },
    clearRect: (...a: unknown[]) => rec('clearRect', ...a),
    fillRect: (...a: unknown[]) => rec('fillRect', ...a),
    beginPath: () => rec('beginPath'),
    rect: (...a: unknown[]) => rec('rect', ...a),
    arc: (...a: unknown[]) => rec('arc', ...a),
    clip: () => { state.clipped = true; rec('clip'); },
    translate: (...a: unknown[]) => rec('translate', ...a),
    scale: (...a: unknown[]) => { state.scaled = true; rec('scale', ...a); },
    drawImage: (...a: unknown[]) => rec('drawImage', ...a),
    createRadialGradient: () => ({ addColorStop: () => {} }),
  };
  return ctx as unknown as CanvasRenderingContext2D & {
    ops: Op[]; label: string; depth: number;
    state: { alpha: number; clipped: boolean; scaled: boolean; filter: string };
  };
}

/** Deux calques hors-ecran, eux aussi enregistreurs. */
function makeScratch(): TransitionScratch & {
  a: { ctx: CanvasRenderingContext2D & { ops: Op[] } };
  b: { ctx: CanvasRenderingContext2D & { ops: Op[] } };
} {
  const a = recordingCtx('layerA');
  const b = recordingCtx('layerB');
  return {
    a: { canvas: { id: 'canvasA' } as unknown as CanvasImageSource, ctx: a },
    b: { canvas: { id: 'canvasB' } as unknown as CanvasImageSource, ctx: b },
  } as never;
}

/**
 * Rend UNE frame de transition et renvoie la trace.
 * `drawA` / `drawB` marquent le calque qu'on leur donne, comme le ferait une
 * vraie sequence : on peut ainsi verifier sur QUEL contexte elles ont peint.
 */
function renderFrame(
  style: TransitionStyle | undefined,
  t: number,
  withScratch = true,
  size: { w: number; h: number } = { w: W, h: H },
) {
  const ctx = recordingCtx('main');
  const scratch = withScratch ? makeScratch() : null;
  const painted: string[] = [];
  drawTransition(
    ctx, size.w, size.h,
    (p, target) => {
      painted.push(`A:${(target as unknown as { label: string }).label}:${p}`);
      (target as unknown as { ops: Op[] }).ops.push({ op: 'paintA', args: [p], alpha: target.globalAlpha });
    },
    (p, target) => {
      painted.push(`B:${(target as unknown as { label: string }).label}:${p}`);
      (target as unknown as { ops: Op[] }).ops.push({ op: 'paintB', args: [p], alpha: target.globalAlpha });
    },
    t,
    style as TransitionStyle,
    scratch,
  );
  return { ops: ctx.ops, painted, scratch, ctx };
}

const signature = (ops: Op[]) => JSON.stringify(ops);

describe('Moteur de transitions — retro-compatibilite', () => {
  it("sans style, le rendu est celui du crossfade historique, operation par operation", () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const withoutStyle = renderFrame(undefined, t);
      const explicitCrossfade = renderFrame('crossfade', t);
      expect(signature(withoutStyle.ops)).toBe(signature(explicitCrossfade.ops));
    }
  });

  it("le crossfade dessine les DEUX sequences sur le canvas final, jamais sur un calque", () => {
    const { painted, scratch } = renderFrame(undefined, 0.5);
    expect(painted).toEqual(['A:main:1', 'B:main:0.15']);
    // Les calques existent mais ne doivent pas avoir ete touches.
    expect(scratch!.a.ctx.ops).toHaveLength(0);
    expect(scratch!.b.ctx.ops).toHaveLength(0);
  });

  it("le crossfade conserve les alphas historiques (1-t sur A, t sur B, retour a 1)", () => {
    // Verifie sur toute la fenetre, pas a un seul instant : ce sont ces
    // valeurs qui constituent la preuve de retro-compat.
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const { ops, painted } = renderFrame(undefined, t);
      const alphas = ops.filter((o) => o.op === 'globalAlpha').map((o) => o.args[0]);
      expect(alphas).toEqual([1 - t, t, 1]);
      // Progressions historiques : A terminee, B qui demarre a t * 0.3.
      expect(painted).toEqual([`A:main:1`, `B:main:${t * 0.3}`]);
    }
  });

  it("un style inconnu retombe sur le fondu historique SANS rendre les sequences deux fois", () => {
    const bogus = renderFrame('nope' as TransitionStyle, 0.5);
    const crossfade = renderFrame('crossfade', 0.5);
    expect(signature(bogus.ops)).toBe(signature(crossfade.ops));
    // Le repli doit etre decide avant tout rendu : deux peintures, sur le
    // canvas final, et des calques intacts.
    expect(bogus.painted).toEqual(['A:main:1', 'B:main:0.15']);
    expect(bogus.scratch!.a.ctx.ops).toHaveLength(0);
    expect(bogus.scratch!.b.ctx.ops).toHaveLength(0);
  });

  it("sans calque disponible (contexte 2D refuse), tout style retombe sur le fondu", () => {
    for (const style of TRANSITION_STYLES) {
      const noScratch = renderFrame(style, 0.5, false);
      const crossfade = renderFrame('crossfade', 0.5);
      expect(signature(noScratch.ops)).toBe(signature(crossfade.ops));
    }
  });
});

describe("Moteur de transitions — le canvas est rendu propre a l'appelant", () => {
  it("aucun style ne laisse fuir d'etat sur le canvas final (alpha, clip, echelle)", () => {
    for (const style of TRANSITION_STYLES) {
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const { ctx } = renderFrame(style, t);
        // Un save() sans restore() laisserait le clip du wipe ou l'echelle du
        // zoom actifs sur TOUT le reste de la video (filigrane, barre de
        // progression, et les frames suivantes).
        expect({ style, t, depth: ctx.depth }).toEqual({ style, t, depth: 0 });
        expect({ style, t, alpha: ctx.state.alpha }).toEqual({ style, t, alpha: 1 });
        expect({ style, t, clipped: ctx.state.clipped }).toEqual({ style, t, clipped: false });
        expect({ style, t, scaled: ctx.state.scaled }).toEqual({ style, t, scaled: false });
        // Un `filter` laisse actif flouterait le filigrane, la barre de
        // progression et toutes les frames suivantes.
        expect({ style, t, filter: ctx.state.filter }).toEqual({ style, t, filter: 'none' });
      }
    }
  });

  it('aucun style ne floute ni ne grossit au-dela du raisonnable', () => {
    // Bornes SUPERIEURES : sans elles, un flou de 200 px ou une echelle de
    // 3x passeraient les tests tout en rendant l'image meconnaissable.
    for (const style of TRANSITION_STYLES) {
      for (const t of [0.1, 0.5, 0.9]) {
        const ops = renderFrame(style, t).ops;
        for (const op of ops.filter((o) => o.op === 'scale')) {
          expect({ style, t, sx: op.args[0] as number }).toEqual({ style, t, sx: op.args[0] as number });
          expect(op.args[0] as number).toBeLessThanOrEqual(1.25);
        }
        for (const op of ops.filter((o) => o.op === 'filter')) {
          const m = /blur\(([\d.]+)px\)/.exec(String(op.args[0]));
          if (m) expect(parseFloat(m[1])).toBeLessThanOrEqual(W * 0.05);
        }
      }
    }
  });

  it('chaque calque est efface avant d etre repeint', () => {
    for (const style of TRANSITION_STYLES.filter((s) => s !== 'crossfade')) {
      const { scratch } = renderFrame(style, 0.5);
      for (const layer of [scratch!.a.ctx, scratch!.b.ctx]) {
        const ops = (layer as unknown as { ops: Op[] }).ops;
        // Sans ce clearRect, une sequence au fond transparent garderait la
        // remanence de la frame precedente pendant toute la transition.
        expect(ops[0].op).toBe('clearRect');
        expect(ops[0].args).toEqual([0, 0, W, H]);
        expect(ops.findIndex((o) => o.op === 'paintA' || o.op === 'paintB')).toBe(1);
      }
    }
  });
});

describe('Moteur de transitions — chaque style produit un rendu distinct', () => {
  const t = 0.5; // frontiere entre les deux sequences

  it("'slide' produit des frames differentes de 'crossfade'", () => {
    const slide = renderFrame('slide', t);
    const crossfade = renderFrame('crossfade', t);
    expect(signature(slide.ops)).not.toBe(signature(crossfade.ops));
  });

  it("les cinq styles produisent cinq traces differentes entre elles", () => {
    const signatures = TRANSITION_STYLES.map((s) => signature(renderFrame(s, t).ops));
    expect(new Set(signatures).size).toBe(TRANSITION_STYLES.length);
  });

  it("'slide' rend les sequences sur des calques puis les DEPLACE horizontalement", () => {
    const { ops, painted } = renderFrame('slide', t);
    // Les sequences ont ete peintes hors-ecran, pas sur le canvas final.
    expect(painted).toEqual(['A:layerA:1', 'B:layerB:0.15']);

    const draws = ops.filter((o) => o.op === 'drawImage');
    expect(draws).toHaveLength(2);
    const [dA, dB] = draws;
    // Le bon calque au bon endroit : la sortante d'abord, l'entrante ensuite.
    expect((dA.args[0] as { id: string }).id).toBe('canvasA');
    expect((dB.args[0] as { id: string }).id).toBe('canvasB');
    // A part vers la gauche (x < 0), B arrive depuis la droite (x > 0).
    expect(dA.args[1] as number).toBeLessThan(0);
    expect(dB.args[1] as number).toBeGreaterThan(0);
    // Les deux restent verticalement en place.
    expect(dA.args[2]).toBe(0);
    expect(dB.args[2]).toBe(0);
  });

  it("'slide' progresse : le decalage augmente avec le temps, jusqu'a sortir A du cadre", () => {
    const offsetAt = (t: number) => {
      const draws = renderFrame('slide', t).ops.filter((o) => o.op === 'drawImage');
      return Math.abs(draws[0].args[1] as number);
    };
    expect(offsetAt(0.25)).toBeLessThan(offsetAt(0.5));
    expect(offsetAt(0.5)).toBeLessThan(offsetAt(0.9));
    expect(offsetAt(0)).toBe(0);   // au debut, A est encore en place
    expect(offsetAt(1)).toBe(W);   // a la fin, A a entierement quitte le cadre
  });

  it("'slide' garde les deux calques JOINTIFS — ni trou ni recouvrement", () => {
    for (const t of [0, 0.2, 0.5, 0.8, 1]) {
      const draws = renderFrame('slide', t).ops.filter((o) => o.op === 'drawImage');
      const xA = draws[0].args[1] as number;
      const xB = draws[1].args[1] as number;
      // B colle exactement au bord droit de A : un ecart different laisserait
      // une bande transparente (ou un chevauchement) pendant la transition.
      expect({ t, gap: xB - xA }).toEqual({ t, gap: W });
    }
  });

  it("'wipe' revele la sequence entrante par une decoupe qui s'elargit", () => {
    const clipWidth = (t: number) => {
      const ops = renderFrame('wipe', t).ops;
      const rect = ops.find((o) => o.op === 'rect');
      return rect!.args[2] as number;
    };
    expect(clipWidth(0.25)).toBeLessThan(clipWidth(0.75));
    expect(clipWidth(0.75)).toBeLessThan(W);
    // Bornes : rien de revele au depart, tout revele a l'arrivee.
    expect(clipWidth(0)).toBe(0);
    expect(clipWidth(1)).toBe(W);

    // Le volet part du bord gauche et fait TOUTE la hauteur : sinon la
    // sequence entrante n'apparaitrait que sur une bande.
    for (const at of [0.2, 0.5, 0.8]) {
      const rect = renderFrame('wipe', at).ops.find((o) => o.op === 'rect')!;
      expect({ at, x: rect.args[0], y: rect.args[1], h: rect.args[3] })
        .toEqual({ at, x: 0, y: 0, h: H });
    }

    const ops = renderFrame('wipe', t).ops;
    // La decoupe doit encadrer le dessin de la sequence entrante.
    const iClip = ops.findIndex((o) => o.op === 'clip');
    const draws = ops.map((o, i) => ({ o, i })).filter(({ o }) => o.op === 'drawImage');
    expect(draws[0].i).toBeLessThan(iClip); // A dessinee avant la decoupe
    expect(draws[1].i).toBeGreaterThan(iClip); // B dessinee dedans
    expect((draws[0].o.args[0] as { id: string }).id).toBe('canvasA');
    expect((draws[1].o.args[0] as { id: string }).id).toBe('canvasB');
  });

  it("'fade-to-black' passe par une frame noire au milieu", () => {
    const first = renderFrame('fade-to-black', 0.49).ops;
    const second = renderFrame('fade-to-black', 0.51).ops;
    // Un aplat noir couvre toute la frame dans les deux moities, et il est
    // peint AVANT la sequence : peint apres, la frame serait entierement
    // noire pendant les 0,8 s de transition.
    for (const ops of [first, second]) {
      const iFill = ops.findIndex((o) => o.op === 'fillRect');
      const iDraw = ops.findIndex((o) => o.op === 'drawImage');
      expect(ops[iFill].args).toEqual([0, 0, W, H]);
      expect(iFill).toBeLessThan(iDraw);
    }
    // Un seul calque est compose a la fois, et ce n'est pas le meme avant et
    // apres la moitie : A s'eteint, puis B s'allume.
    const composited = (ops: Op[]) => {
      const draws = ops.filter((o) => o.op === 'drawImage');
      expect(draws).toHaveLength(1);
      return { id: (draws[0].args[0] as { id: string }).id, alpha: draws[0].alpha };
    };
    expect(composited(first).id).toBe('canvasA');
    expect(composited(second).id).toBe('canvasB');
    // Au plus pres du milieu, le calque visible est quasiment eteint : la
    // frame est donc bien noire au passage.
    expect(composited(first).alpha).toBeLessThan(0.05);
    expect(composited(second).alpha).toBeLessThan(0.05);
    // Et aux extremites, la sequence concernee est pleinement visible.
    expect(composited(renderFrame('fade-to-black', 0).ops).alpha).toBe(1);
    expect(composited(renderFrame('fade-to-black', 1).ops).alpha).toBe(1);
  });
});

describe('Moteur de transitions — aucune image deformee', () => {
  it("aucun style n'etire une sequence : pas de drawImage redimensionnant", () => {
    for (const style of TRANSITION_STYLES) {
      for (const t of [0.1, 0.5, 0.9]) {
        const draws = renderFrame(style, t).ops.filter((o) => o.op === 'drawImage');
        for (const d of draws) {
          // Formes acceptees : (img), (img, dx, dy). Une forme a 5 ou 9
          // arguments imposerait une largeur/hauteur d'arrivee, donc un
          // risque d'etirement.
          expect(d.args.length).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  it("AUCUN style ne met a l'echelle de facon non uniforme (sx === sy partout)", () => {
    for (const style of TRANSITION_STYLES) {
      for (const t of [0.1, 0.5, 0.9]) {
        const scales = renderFrame(style, t).ops.filter((o) => o.op === 'scale');
        for (const s of scales) {
          // sx !== sy = image etiree : interdit par la regle « aucune video
          // deformee », quel que soit le style.
          expect({ style, t, sx: s.args[0], sy: s.args[1] })
            .toEqual({ style, t, sx: s.args[0], sy: s.args[0] });
          expect(s.args[0] as number).toBeGreaterThan(0);
        }
      }
    }
  });

  it("'zoom' n'expose jamais de bord : la sequence entrante couvre au moins la frame", () => {
    for (const t of [0, 0.3, 0.7, 0.9, 1]) {
      const scales = renderFrame('zoom', t).ops.filter((o) => o.op === 'scale');
      expect(scales).toHaveLength(2); // une par sequence
      // Un facteur < 1 laisserait un liseré transparent autour de la
      // sequence entrante sur la fin de la transition.
      for (const s of scales) {
        expect({ t, scale: s.args[0] as number }).toEqual({ t, scale: s.args[0] as number });
        expect(s.args[0] as number).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("'zoom' recentre l'echelle sur le milieu de la frame", () => {
    const ops = renderFrame('zoom', 0.5).ops;
    const translates = ops.filter((o) => o.op === 'translate');
    // Deux paires (aller au centre, revenir) — une par sequence.
    expect(translates).toHaveLength(4);
    expect(translates[0].args).toEqual([W / 2, H / 2]);
    expect(translates[1].args).toEqual([-W / 2, -H / 2]);
  });
});

describe('Resolution du style', () => {
  it('sans rien de defini, on garde le fondu historique', () => {
    expect(resolveTransitionStyle('intro')).toBe(DEFAULT_TRANSITION);
    expect(DEFAULT_TRANSITION).toBe('crossfade');
  });

  it('le reglage par sequence prime sur le reglage global', () => {
    expect(resolveTransitionStyle('intro', { intro: 'wipe' }, 'slide')).toBe('wipe');
    expect(resolveTransitionStyle('cards', { intro: 'wipe' }, 'slide')).toBe('slide');
  });

  it("les cles de l'editeur (titre / cartes) sont comprises, pas ignorees en silence", () => {
    // L'editeur persiste ses sequences en francais ; toutes les autres
    // options par sequence passent par SEQ_NAME_MAP.
    expect(resolveTransitionStyle('intro', { titre: 'wipe' })).toBe('wipe');
    expect(resolveTransitionStyle('cards', { cartes: 'zoom' })).toBe('zoom');
    expect(resolveTransitionStyle('cta', { cta: 'slide' })).toBe('slide');
    // Et une cle qui ne designe pas cette sequence ne s'applique pas.
    expect(resolveTransitionStyle('cards', { titre: 'wipe' })).toBe('crossfade');
  });

  it('le reglage global prime sur celui du design', () => {
    expect(resolveTransitionStyle('intro', undefined, 'zoom', 'wipe')).toBe('zoom');
    expect(resolveTransitionStyle('intro', undefined, undefined, 'wipe')).toBe('wipe');
  });

  it('une valeur inconnue ne casse rien et retombe sur le defaut', () => {
    expect(resolveTransitionStyle('intro', undefined, 'peluche' as TransitionStyle)).toBe('crossfade');
  });
});

// ═══════════════════════════════════════════════════════════
// STYLES « CINEMA » (push / iris / blur-dissolve / whip-pan)
// ═══════════════════════════════════════════════════════════

/** Les quatre styles ajoutes apres #228. */
const CINEMA_STYLES: TransitionStyle[] = ['push', 'iris', 'blur-dissolve', 'whip-pan'];

describe('Styles cinema — catalogue', () => {
  it('TRANSITION_KEYS liste les 9 styles, defaut en tete', () => {
    expect(TRANSITION_KEYS).toEqual([
      'crossfade', 'slide', 'wipe', 'zoom', 'fade-to-black',
      'push', 'iris', 'blur-dissolve', 'whip-pan',
    ]);
    expect(TRANSITION_KEYS[0]).toBe(DEFAULT_TRANSITION);
    // La liste depreciee est une COPIE : la trier ne doit pas reordonner le
    // catalogue de reference.
    expect(TRANSITION_STYLES).not.toBe(TRANSITION_KEYS as unknown as TransitionStyle[]);
    expect([...TRANSITION_STYLES]).toEqual([...TRANSITION_KEYS]);
  });

  it('chaque style du catalogue a un libelle pour le menu', () => {
    for (const key of TRANSITION_KEYS) {
      expect(TRANSITION_LABELS[key], `libelle manquant pour ${key}`).toBeTruthy();
    }
    // Pas de libelle orphelin non plus.
    expect(Object.keys(TRANSITION_LABELS).sort()).toEqual([...TRANSITION_KEYS].sort());
    // Ni deux entrees identiques : deux « Zoom » dans le menu seraient
    // indiscernables pour l'utilisateur.
    const labels = Object.values(TRANSITION_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('les nouveaux styles sont bien resolus, et un style inconnu retombe au defaut', () => {
    for (const style of CINEMA_STYLES) {
      expect(resolveTransitionStyle('intro', undefined, style)).toBe(style);
      expect(resolveTransitionStyle('intro', { titre: style })).toBe(style);
    }
  });

  it('chaque nouveau style produit des frames DIFFERENTES du fondu', () => {
    for (const style of CINEMA_STYLES) {
      for (const t of [0.25, 0.5, 0.75]) {
        const cinema = renderFrame(style, t);
        const crossfade = renderFrame('crossfade', t);
        expect(signature(cinema.ops), `${style} @ ${t}`).not.toBe(signature(crossfade.ops));
        // Et elles passent par les calques hors-ecran, pas par le canvas final.
        expect(cinema.painted).toEqual(['A:layerA:1', `B:layerB:${t * 0.3}`]);
      }
    }
  });
});

describe("Style 'push' — poussee verticale", () => {
  const draws = (t: number) => renderFrame('push', t).ops.filter((o) => o.op === 'drawImage');

  it('deplace les calques VERTICALEMENT, jamais horizontalement', () => {
    for (const t of [0.2, 0.5, 0.8]) {
      const [dA, dB] = draws(t);
      expect((dA.args[0] as { id: string }).id).toBe('canvasA');
      expect((dB.args[0] as { id: string }).id).toBe('canvasB');
      // x reste a 0 : sinon ce serait un slide, pas une poussee.
      expect({ t, xA: dA.args[1], xB: dB.args[1] }).toEqual({ t, xA: 0, xB: 0 });
      expect(dA.args[2] as number).toBeLessThan(0);      // A chassee vers le haut
      expect(dB.args[2] as number).toBeGreaterThan(0);   // B monte par le bas
    }
  });

  it('garde les calques jointifs — ni bande vide ni chevauchement', () => {
    for (const t of [0, 0.3, 0.6, 1]) {
      const [dA, dB] = draws(t);
      expect({ t, gap: (dB.args[2] as number) - (dA.args[2] as number) }).toEqual({ t, gap: H });
    }
  });

  it('part de zero et finit hors cadre', () => {
    // `-h * 0` vaut `-0` en JS : on compare la valeur, pas son signe.
    expect(draws(0)[0].args[2] as number).toBeCloseTo(0, 10);
    expect(draws(1)[0].args[2]).toBe(-H);
  });

  it('demarre en douceur, pas en rampe lineaire', () => {
    // Meme garde-fou que pour l'iris : `t` brut au lieu de la courbe adoucie
    // rendrait le depart mecanique.
    expect(Math.abs(draws(0.25)[0].args[2] as number)).toBeLessThan(H * 0.25);
  });

  it("n'est pas confondu avec 'slide' : l'un bouge en y, l'autre en x", () => {
    const push = draws(0.5)[0];
    const slide = renderFrame('slide', 0.5).ops.filter((o) => o.op === 'drawImage')[0];
    expect(push.args[1]).toBe(0);          // push : x nul
    expect(slide.args[2]).toBe(0);         // slide : y nul
    expect(push.args[2]).not.toBe(0);
    expect(slide.args[1]).not.toBe(0);
  });
});

describe("Style 'iris' — ouverture circulaire", () => {
  const arcOf = (t: number) => renderFrame('iris', t).ops.find((o) => o.op === 'arc')!;

  it('ouvre un cercle centre sur la frame, dont le rayon croit', () => {
    for (const t of [0.2, 0.6]) {
      const arc = arcOf(t);
      expect({ t, cx: arc.args[0], cy: arc.args[1] }).toEqual({ t, cx: W / 2, cy: H / 2 });
    }
    expect(arcOf(0.2).args[2] as number).toBeLessThan(arcOf(0.6).args[2] as number);
    expect(arcOf(0).args[2]).toBe(0);
  });

  it('decoupe un cercle ENTIER, pas un secteur', () => {
    // Sans verifier les angles, un `arc(..., 0, Math.PI)` passerait : l'iris
    // deviendrait un demi-disque et le double 2D, qui ne modelise aucune
    // region de clip, ne le verrait pas.
    const arc = arcOf(0.5);
    expect(arc.args[3]).toBe(0);
    expect(arc.args[4]).toBe(Math.PI * 2);
  });

  it("ouvre en douceur, pas en rampe lineaire", () => {
    // A un quart du parcours, une courbe adoucie a moins avance qu'une droite.
    const rAtQuarter = arcOf(0.25).args[2] as number;
    expect(rAtQuarter).toBeLessThan((Math.hypot(W, H) / 2) * 0.25);
  });

  it('couvre les COINS a la fin, sinon la frame garderait 4 angles de la sortante', () => {
    const rFinal = arcOf(1).args[2] as number;
    // Demi-diagonale = distance du centre a un coin.
    expect(rFinal).toBeGreaterThanOrEqual(Math.hypot(W, H) / 2);
  });

  it('revele la sequence entrante DANS le cercle, la sortante etant dessinee avant', () => {
    const ops = renderFrame('iris', 0.5).ops;
    const iClip = ops.findIndex((o) => o.op === 'clip');
    const draws = ops.map((o, i) => ({ o, i })).filter(({ o }) => o.op === 'drawImage');
    expect(draws[0].i).toBeLessThan(iClip);
    expect(draws[1].i).toBeGreaterThan(iClip);
    expect((draws[0].o.args[0] as { id: string }).id).toBe('canvasA');
    expect((draws[1].o.args[0] as { id: string }).id).toBe('canvasB');
  });
});

describe("Style 'blur-dissolve' — fondu floute", () => {
  const blursAt = (t: number) =>
    renderFrame('blur-dissolve', t).ops
      .filter((o) => o.op === 'drawImage')
      .map((o) => o.filter ?? 'none');

  const blurValue = (f: string) => {
    const m = /blur\(([\d.]+)px\)/.exec(f);
    return m ? parseFloat(m[1]) : 0;
  };

  it('floute les deux calques, avec un maximum au milieu de la transition', () => {
    const mid = blursAt(0.5).map(blurValue);
    const early = blursAt(0.1).map(blurValue);
    // PLANCHER : un flou d'1 px ferait degenerer le style en simple fondu
    // tout en gardant les tests verts. On exige un flou reellement visible,
    // au moins 1 % de la largeur.
    expect(mid[0]).toBeGreaterThanOrEqual(W * 0.01);
    expect(mid[1]).toBeGreaterThanOrEqual(W * 0.01);
    expect(early[0]).toBeLessThan(mid[0]);
  });

  it('met le flou a l ECHELLE de la largeur : meme rendu relatif en 9:16 et en 16:9', () => {
    // Un flou en px absolus pese deux fois moins dans un cadre deux fois plus
    // large : le meme montage exporte en Reel et en TV n'aurait pas la meme
    // transition. Le fichier a deja cette convention (ombres portees, rayon
    // du backdrop).
    const blurAtWidth = (w: number) => {
      const op = renderFrame('blur-dissolve', 0.5, true, { w, h: Math.round((w * 9) / 16) }).ops
        .find((o) => o.op === 'filter');
      return blurValue(String(op!.args[0]));
    };
    const at1080 = blurAtWidth(1080);
    const at1920 = blurAtWidth(1920);
    expect(at1080).toBeGreaterThan(0);
    // Proportionnel a la largeur, a l'arrondi d'affichage pres.
    expect(at1920 / at1080).toBeCloseTo(1920 / 1080, 2);
  });

  it('ne floute plus rien aux extremites : la sequence doit finir nette', () => {
    expect(blursAt(0).every((f) => blurValue(f) === 0)).toBe(true);
    expect(blursAt(1).every((f) => blurValue(f) === 0)).toBe(true);
  });

  it('croise les opacites comme un fondu (la sortante baisse, l entrante monte)', () => {
    const alphas = (t: number) =>
      renderFrame('blur-dissolve', t).ops.filter((o) => o.op === 'drawImage').map((o) => o.alpha);
    const [aEarly, bEarly] = alphas(0.25);
    const [aLate, bLate] = alphas(0.75);
    expect(aLate).toBeLessThan(aEarly);
    expect(bLate).toBeGreaterThan(bEarly);
  });

  it('centre la sur-echelle sur le milieu de la frame', () => {
    // Un pivot decale (w/h permutes, par exemple) deplacerait le calque.
    const translates = renderFrame('blur-dissolve', 0.5).ops.filter((o) => o.op === 'translate');
    expect(translates.length).toBeGreaterThanOrEqual(2);
    expect(translates[0].args).toEqual([W / 2, H / 2]);
    expect(translates[1].args).toEqual([-W / 2, -H / 2]);
  });

  it('reste continu aux frontieres : pas de saut d echelle a l entree ni a la sortie', () => {
    // La sur-echelle doit SUIVRE la cloche du flou. Appliquee en tout ou rien,
    // elle faisait sauter le contenu de 6 % en une frame a chaque frontiere.
    const scaleAt = (t: number) => {
      const s = renderFrame('blur-dissolve', t).ops.find((o) => o.op === 'scale');
      return s ? (s.args[0] as number) : 1;
    };
    expect(scaleAt(0)).toBeCloseTo(1, 4);
    expect(scaleAt(1)).toBeCloseTo(1, 4);
    expect(scaleAt(0.02)).toBeLessThan(1.01);
    expect(scaleAt(0.5)).toBeGreaterThan(scaleAt(0.02));
  });

  it('agrandit uniformement le calque floute pour ne pas laisser de lisere translucide', () => {
    const scales = renderFrame('blur-dissolve', 0.5).ops.filter((o) => o.op === 'scale');
    expect(scales.length).toBeGreaterThan(0);
    for (const s of scales) {
      expect(s.args[0]).toBe(s.args[1]);                 // uniforme
      expect(s.args[0] as number).toBeGreaterThan(1);    // vers l'exterieur
    }
  });
});

describe("Style 'whip-pan' — balayage fouette", () => {
  const offsetsAt = (t: number) =>
    renderFrame('whip-pan', t).ops
      .filter((o) => o.op === 'drawImage')
      .map((o, i) => ({ i, filter: o.filter ?? 'none', op: o }));

  /** Decalage horizontal effectif : soit l'argument dx, soit la translation. */
  const xOffsetOf = (t: number, which: 0 | 1) => {
    const ops = renderFrame('whip-pan', t).ops;
    const translates = ops.filter((o) => o.op === 'translate');
    // Chaque calque floute est dessine via translate(offset + w/2, h/2).
    if (translates.length >= 2) return (translates[which * 2].args[0] as number) - W / 2;
    const draws = ops.filter((o) => o.op === 'drawImage');
    return draws[which].args[1] as number;
  };

  it('balaye horizontalement, calques jointifs avant sur-echelle', () => {
    // Les decalages mesures sont ceux d'AVANT la sur-echelle du flou : celle-ci
    // fait volontairement se CHEVAUCHER les deux calques de quelques pourcents,
    // ce qui vaut mieux qu'un trou transparent entre eux.
    for (const t of [0.2, 0.5, 0.8]) {
      const xA = xOffsetOf(t, 0);
      const xB = xOffsetOf(t, 1);
      expect({ t, gap: Math.round(xB - xA) }).toEqual({ t, gap: W });
      expect(xA).toBeLessThanOrEqual(0);
      expect(xB).toBeGreaterThanOrEqual(0);
    }
  });

  it('garde les DEUX calques opaques : un balayage n est pas un fondu', () => {
    // Une opacite < 1 laisserait voir le vide derriere les calques — donc du
    // noir a l'encodage — pendant tout le mouvement.
    for (const t of [0.1, 0.5, 0.9]) {
      const alphas = renderFrame('whip-pan', t).ops
        .filter((o) => o.op === 'drawImage')
        .map((o) => o.alpha);
      expect({ t, alphas }).toEqual({ t, alphas: [1, 1] });
    }
  });

  it('est plus BRUTAL que slide : quasi immobile au depart, fulgurant au milieu', () => {
    const whipAt = (t: number) => Math.abs(xOffsetOf(t, 0));
    const slideAt = (t: number) =>
      Math.abs(renderFrame('slide', t).ops.filter((o) => o.op === 'drawImage')[0].args[1] as number);
    // Courbe cubique vs quadratique : en debut de course, whip-pan a moins
    // avance ; il rattrape tout au milieu.
    expect(whipAt(0.25)).toBeLessThan(slideAt(0.25));
    expect(whipAt(0.75)).toBeGreaterThan(slideAt(0.75));
  });

  it('ajoute un file (flou) au plus fort du mouvement, nul aux extremites', () => {
    const blurAt = (t: number) => {
      const f = offsetsAt(t)[0].filter;
      const m = /blur\(([\d.]+)px\)/.exec(f);
      return m ? parseFloat(m[1]) : 0;
    };
    expect(blurAt(0.5)).toBeGreaterThan(blurAt(0.15));
    expect(blurAt(0)).toBe(0);
    expect(blurAt(1)).toBe(0);
  });
});
