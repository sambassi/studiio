import { describe, it, expect } from 'vitest';
import {
  drawTransition,
  resolveTransitionStyle,
  TRANSITION_STYLES,
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
  const state = { alpha: 1, clipped: false, scaled: false, fillStyle: '' as unknown };
  const stack: Array<typeof state> = [];
  const rec = (op: string, ...args: unknown[]) => ops.push({ op, args, alpha: state.alpha });

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
    clip: () => { state.clipped = true; rec('clip'); },
    translate: (...a: unknown[]) => rec('translate', ...a),
    scale: (...a: unknown[]) => { state.scaled = true; rec('scale', ...a); },
    drawImage: (...a: unknown[]) => rec('drawImage', ...a),
    createRadialGradient: () => ({ addColorStop: () => {} }),
  };
  return ctx as unknown as CanvasRenderingContext2D & {
    ops: Op[]; label: string; depth: number;
    state: { alpha: number; clipped: boolean; scaled: boolean };
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
function renderFrame(style: TransitionStyle | undefined, t: number, withScratch = true) {
  const ctx = recordingCtx('main');
  const scratch = withScratch ? makeScratch() : null;
  const painted: string[] = [];
  drawTransition(
    ctx, W, H,
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
