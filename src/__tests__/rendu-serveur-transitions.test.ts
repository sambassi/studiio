import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { TRANSITION_KEYS, DEFAULT_TRANSITION, type TransitionStyle } from '@/lib/video-composer';
import { buildSequences, sequenceFrameOffsets, totalDurationFrames } from '@/lib/creer/designSpec';
import {
  TRANSITION_STYLE_KEYS, DEFAULT_TRANSITION_STYLE, TRANSITION_DURATION_SECONDS,
  easeInOut, easeInOutCubic, bellCurve,
  BLUR_DISSOLVE_MAX_PX, WHIP_PAN_MAX_BLUR_PX, BLUR_MAX_OVERSCALE, ZOOM_AMPLITUDE,
  transitionPresentation, transitionTiming, transitionFrames,
  baseSequenceFrames, seriesSequenceFrames,
} from '../../remotion/transitions';

/**
 * Transitions du rendu serveur — Phase 6.
 *
 * ⚠️ C'EST `drawTransition` QUI FAIT FOI. Ce module la reproduit sous
 * Remotion, et les tests ci-dessous verrouillent les deux endroits ou la
 * copie peut deriver sans que rien ne casse :
 *
 * 1. **Le vocabulaire et les constantes**, redits cote Remotion parce qu'y
 *    importer une VALEUR du compositeur ferait entrer ses 5 000 lignes — et
 *    ses appels au DOM — dans le bundle.
 * 2. **L'arithmetique des images**, ou le piege est reel : `TransitionSeries`
 *    fait CHEVAUCHER les sequences et raccourcit le total, la ou le canvas
 *    joue la transition DANS la sequence sortante et ne change rien a la
 *    duree. Sans compensation, la video serveur serait plus courte que celle
 *    du navigateur d'autant de fois 0,8 s qu'il y a de raccords.
 */

const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');
const composition = readFileSync(resolve(__dirname, '../../remotion/CreerSimpleMontage.tsx'), 'utf-8');

const CADRE = { width: 1080, height: 1920 };

describe('Le vocabulaire ne peut pas deriver', () => {
  it('les memes neuf styles, dans le meme ordre', () => {
    expect([...TRANSITION_STYLE_KEYS]).toEqual([...TRANSITION_KEYS]);
  });

  it('le meme defaut', () => {
    expect(DEFAULT_TRANSITION_STYLE).toBe(DEFAULT_TRANSITION);
    expect(DEFAULT_TRANSITION_STYLE).toBe('crossfade');
  });

  it('la meme duree de fenetre', () => {
    // `transitionDur` du compositeur.
    expect(TRANSITION_DURATION_SECONDS).toBe(0.8);
    expect(composer).toContain('const transitionDur = 0.8;');
  });
});

describe('Les courbes sont celles du compositeur', () => {
  it('`easeInOut` — quadratique, symetrique', () => {
    expect(composer).toContain('return c < 0.5 ? 2 * c * c : 1 - Math.pow(-2 * c + 2, 2) / 2;');
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(0.5)).toBe(0.5);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.25)).toBeCloseTo(0.125, 6);
  });

  it('`easeInOutCubic` — plus contrastee, c est ce qui fait lire un coup de camera', () => {
    expect(composer).toContain('return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;');
    expect(easeInOutCubic(0.25)).toBeCloseTo(0.0625, 6);
    // Plus lente au depart que la quadratique : c'est tout le contraste.
    expect(easeInOutCubic(0.25)).toBeLessThan(easeInOut(0.25));
  });

  it('les deux bornent leur entree', () => {
    // Une progression hors bornes ferait sortir un calque du cadre.
    for (const f of [easeInOut, easeInOutCubic, bellCurve]) {
      expect(f(-1)).toBeGreaterThanOrEqual(0);
      expect(f(2)).toBeLessThanOrEqual(1);
    }
  });

  it('`bellCurve` — nulle aux extremites, maximale au milieu', () => {
    expect(composer).toContain('return Math.sin(Math.PI * Math.max(0, Math.min(1, t)));');
    expect(bellCurve(0)).toBe(0);
    expect(bellCurve(1)).toBeCloseTo(0, 10);
    expect(bellCurve(0.5)).toBe(1);
  });
});

describe('Les constantes de rendu sont recopiees a l identique', () => {
  it('flous, sur-echelle et amplitude de zoom', () => {
    expect(composer).toContain('const BLUR_DISSOLVE_MAX_PX = 16;');
    expect(composer).toContain('const WHIP_PAN_MAX_BLUR_PX = 26;');
    expect(composer).toContain('const BLUR_MAX_OVERSCALE = 1.06;');
    expect(BLUR_DISSOLVE_MAX_PX).toBe(16);
    expect(WHIP_PAN_MAX_BLUR_PX).toBe(26);
    expect(BLUR_MAX_OVERSCALE).toBe(1.06);
    // Le zoom du canvas : `1 + 0.18 * e`.
    expect(composer).toContain('const scaleA = 1 + 0.18 * e;');
    expect(ZOOM_AMPLITUDE).toBe(0.18);
  });
});

describe('L arithmetique des images — le piege du chevauchement', () => {
  const sequences = buildSequences({
    introDuration: 3, cardsDuration: 4, videoDuration: 0, ctaDuration: 3,
    cardCount: 3, hasVideoBackground: false, videoRequested: false,
  });
  const fps = 30;
  const total = totalDurationFrames(sequences, fps);
  const base = baseSequenceFrames(sequenceFrameOffsets(sequences, fps), total);

  it('les durees nominales somment EXACTEMENT au total annonce', () => {
    // C'est `totalDurationFrames` que `calculateMetadata` donne a Remotion :
    // une somme differente laisserait la derniere sequence tomber dans le
    // vide, ou la couperait.
    expect(base.reduce((s, f) => s + f, 0)).toBe(total);
    expect(total).toBe(300);
  });

  it('la serie retombe sur la MEME duree que le navigateur', () => {
    const t = transitionFrames(base, fps);
    const durees = seriesSequenceFrames(base, t);
    // `TransitionSeries` : total = somme des sequences - somme des recouvrements.
    const totalSerie = durees.reduce((s, f) => s + f, 0) - (durees.length - 1) * t;
    expect(totalSerie).toBe(total);
  });

  it('chaque transition tombe sur les dernieres images de sa sortante', () => {
    // Le canvas : `seqElapsed > seq.duration - transitionDur`. Ici, la
    // premiere sequence garde sa duree nominale, donc la fenetre de
    // chevauchement commence bien a `duree - 0,8 s`.
    const t = transitionFrames(base, fps);
    const durees = seriesSequenceFrames(base, t);
    expect(t).toBe(24);
    expect(durees[0]).toBe(base[0]);
    expect(durees[0] - t).toBe(90 - 24);
    // Les suivantes portent le supplement que le chevauchement consomme.
    expect(durees[1]).toBe(base[1] + t);
    expect(durees[2]).toBe(base[2] + t);
  });

  it('une sequence plus courte que la fenetre raccourcit la transition', () => {
    // `TransitionSeries` refuse une transition plus longue qu'une des deux
    // sequences : le rendu entier echouerait, la ou une transition un peu
    // plus courte se voit a peine.
    expect(transitionFrames([12, 90, 90], 30)).toBe(12);
    expect(transitionFrames([90, 90], 30)).toBe(24);
  });

  it('elle ne descend jamais sous une image', () => {
    expect(transitionFrames([0, 90], 30)).toBe(1);
    expect(transitionFrames([], 30)).toBe(24);
  });

  it('une cadence absurde retombe sur 30 images par seconde', () => {
    expect(transitionFrames([90, 90], 0)).toBe(24);
  });

  it('une seule sequence : rien a relier', () => {
    const seule = baseSequenceFrames([0], 60);
    expect(seule).toEqual([60]);
    expect(seriesSequenceFrames(seule, 24)).toEqual([60]);
  });
});

describe('Les neuf styles ont tous une presentation', () => {
  it('aucun ne coupe franc', () => {
    for (const style of TRANSITION_STYLE_KEYS) {
      const p = transitionPresentation(style, CADRE);
      expect(p.component, style).toBeTruthy();
    }
  });

  it('un style inconnu retombe sur le fondu enchaine, comme le canvas', () => {
    // `drawTransition` teste `TRANSITION_STYLES.includes(style)` AVANT de
    // peindre : un design venu d'une version plus recente de l'editeur garde
    // une transition, il n'en perd pas une.
    expect(composer).toContain("if (style === 'crossfade' || !TRANSITION_STYLES.includes(style) || !scratch)");
    const inconnu = transitionPresentation('valse-a-mille-temps' as TransitionStyle, CADRE);
    expect(inconnu.component).toBe(transitionPresentation('crossfade', CADRE).component);
  });

  it('le fondu enchaine efface bien la SORTANTE', () => {
    // Sans cela, ce serait un fondu en entree : la sortante resterait opaque
    // dessous, et le milieu de transition ne serait pas un melange.
    const p = transitionPresentation('crossfade', CADRE) as { props: Record<string, unknown> };
    expect(p.props.shouldFadeOutExitingScene).toBe(true);
  });

  it('`push` est le pendant VERTICAL de `slide`', () => {
    // Canvas : A chassee vers le HAUT (`-h * e`), B qui monte du bas.
    expect(composer).toContain('ctx.drawImage(layerA, 0, -h * e);');
    const p = transitionPresentation('push', CADRE) as { props: Record<string, unknown> };
    expect(p.props.direction).toBe('from-bottom');
    const s = transitionPresentation('slide', CADRE) as { props: Record<string, unknown> };
    expect(s.props.direction).toBe('from-right');
  });

  it('l iris recoit les dimensions — son rayon couvre les coins', () => {
    // Canvas : `rMax = Math.hypot(w, h) / 2`. Sans les dimensions, la
    // derniere image garderait quatre angles sur la sortante.
    expect(composer).toContain('const rMax = Math.hypot(w, h) / 2;');
    const p = transitionPresentation('iris', CADRE) as { props: Record<string, unknown> };
    expect(p.props.width).toBe(1080);
    expect(p.props.height).toBe(1920);
  });
});

describe('Le calage temporel suit ce que chaque style demande', () => {
  const progression = (style: TransitionStyle, frame: number) =>
    transitionTiming(style, 24).getProgress({ frame, fps: 30 });

  it('les styles entierement adoucis passent par `easeInOut`', () => {
    for (const style of ['slide', 'wipe', 'push', 'iris', 'zoom'] as TransitionStyle[]) {
      expect(progression(style, 6), style).toBeCloseTo(easeInOut(0.25), 6);
    }
  });

  it('ceux qui melangent adoucissement et cloche restent LINEAIRES', () => {
    // Adoucir en amont rendrait la progression brute irrecuperable, et la
    // cloche du flou ne serait plus centree sur le milieu de la transition.
    for (const style of ['crossfade', 'fade-to-black', 'blur-dissolve', 'whip-pan'] as TransitionStyle[]) {
      expect(progression(style, 6), style).toBeCloseTo(0.25, 6);
    }
  });

  it('la progression est bornee aux deux bouts', () => {
    expect(progression('crossfade', -5)).toBe(0);
    expect(progression('crossfade', 99)).toBe(1);
  });

  it('la duree annoncee est celle demandee', () => {
    expect(transitionTiming('crossfade', 24).getDurationInFrames({ fps: 30 })).toBe(24);
  });
});

describe('La composition monte bien une serie', () => {
  it('plus de coupe franche', () => {
    expect(composition).toContain('<TransitionSeries>');
    expect(composition).toContain('<TransitionSeries.Transition');
    expect(composition).toContain('<TransitionSeries.Sequence');
  });

  it('le style vient du design, avec repli', () => {
    expect(composition).toContain('resolveStyle(props.transition)');
    expect(composition).toContain('DEFAULT_TRANSITION_STYLE');
  });

  it('la transition est posee ENTRE les sequences, jamais en tete', () => {
    // `TransitionSeries` refuse une serie qui commence par une transition.
    expect(composition).toContain('{i > 0 && (');
  });

  it('le compositeur n entre PAS dans le bundle', () => {
    // Seul le TYPE est importe : une valeur y ferait entrer 5 000 lignes et
    // des appels au DOM que Chromium sans tete n'a pas au moment du bundle.
    const imports = composition.split('\n')
      .filter((l) => l.trim().startsWith('import') && l.includes('video-composer'));
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain('import type { TransitionStyle }');
  });
});
