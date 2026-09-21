import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { TRANSITION_KEYS, type TransitionStyle } from '@/lib/video-composer';
import * as remotion from '../../remotion/transitions';
import {
  TRANSITION_DURATION_SECONDS, ENTERING_PROGRESS_RATIO,
  easeInOut, easeInOutCubic, bellCurve,
  BLUR_DISSOLVE_MAX_PX, WHIP_PAN_MAX_BLUR_PX, BLUR_MAX_OVERSCALE, ZOOM_AMPLITUDE,
  transitionLayerStyles, sequenceClock, totalSeconds,
  transitionExtract, textAnimationExtract, EXTRACT_LEAD_SECONDS, EXTRACT_TAIL_SECONDS,
} from '@/lib/creer/transitionPreview';
import { INTRO_WINDOW, textAnimationState } from '@/lib/creer/textAnimation';

/**
 * L'aperçu CSS des transitions — troisième moteur, mêmes règles.
 *
 * ⚠️ C'EST `drawTransition` QUI FAIT FOI. Ce module recopie ses courbes et ses
 * constantes, exactement comme `remotion/transitions.tsx` le fait déjà ; les
 * tests comparent les trois pour qu'aucun ne dérive en silence. Puis chaque
 * style est vérifié à t = 0, 0,5 et 1 sur ce que le canvas fait à ces
 * instants (alphas, translations, échelles, volets).
 */

const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');
const apercu = readFileSync(resolve(__dirname, '../lib/creer/transitionPreview.ts'), 'utf-8');

const FRAME = { w: 1080, h: 1920 };
const num = (v: unknown) => Number(v);

describe('Feuille sans dépendance', () => {
  it('n importe ni le compositeur (valeur) ni Remotion', () => {
    // Le type seul, effacé à la compilation. Une valeur ferait entrer les
    // 5 000 lignes du compositeur dans chaque écran qui montre une vignette ;
    // `remotion/transitions.tsx` tirerait `remotion` dans le navigateur.
    expect(apercu).toContain("import type { TransitionStyle } from '@/lib/video-composer';");
    expect(apercu).not.toMatch(/import \{[^}]*\} from '@\/lib\/video-composer'/);
    expect(apercu).not.toMatch(/from '[^']*remotion[^']*'/);
  });
});

describe('Parité des courbes et des constantes avec Remotion (donc avec le canvas)', () => {
  it('la fenêtre de transition dure 0,8 s', () => {
    expect(TRANSITION_DURATION_SECONDS).toBe(remotion.TRANSITION_DURATION_SECONDS);
    expect(composer).toContain('const transitionDur = 0.8;');
  });

  it('les trois courbes rendent les mêmes valeurs', () => {
    for (const t of [-1, 0, 0.1, 0.25, 0.5, 0.7, 0.9, 1, 2]) {
      expect(easeInOut(t)).toBe(remotion.easeInOut(t));
      expect(easeInOutCubic(t)).toBe(remotion.easeInOutCubic(t));
      expect(bellCurve(t)).toBe(remotion.bellCurve(t));
    }
  });

  it('flous, sur-échelle et zoom', () => {
    expect(BLUR_DISSOLVE_MAX_PX).toBe(remotion.BLUR_DISSOLVE_MAX_PX);
    expect(WHIP_PAN_MAX_BLUR_PX).toBe(remotion.WHIP_PAN_MAX_BLUR_PX);
    expect(BLUR_MAX_OVERSCALE).toBe(remotion.BLUR_MAX_OVERSCALE);
    expect(ZOOM_AMPLITUDE).toBe(remotion.ZOOM_AMPLITUDE);
  });

  it('la séquence entrante est dessinée à t × 0,3 — comme `drawB(t * 0.3)`', () => {
    expect(composer).toContain('drawB(t * 0.3, ctx);');
    expect(ENTERING_PROGRESS_RATIO).toBe(0.3);
  });

  it('tous les styles du compositeur sont traités', () => {
    for (const style of TRANSITION_KEYS) {
      expect(apercu.includes(`case '${style}'`), style).toBe(true);
    }
  });
});

describe('Chaque style, aux trois instants', () => {
  it('crossfade : alphas linéaires', () => {
    expect(transitionLayerStyles('crossfade', 0, FRAME)).toEqual({ a: { opacity: 1 }, b: { opacity: 0 }, black: false });
    expect(transitionLayerStyles('crossfade', 0.5, FRAME)).toEqual({ a: { opacity: 0.5 }, b: { opacity: 0.5 }, black: false });
    expect(transitionLayerStyles('crossfade', 1, FRAME)).toEqual({ a: { opacity: 0 }, b: { opacity: 1 }, black: false });
  });

  it('un style inconnu retombe sur le fondu, comme le canvas', () => {
    expect(transitionLayerStyles('inconnu', 0.5, FRAME)).toEqual(transitionLayerStyles('crossfade', 0.5, FRAME));
    expect(transitionLayerStyles(undefined, 0.5, FRAME)).toEqual(transitionLayerStyles('crossfade', 0.5, FRAME));
  });

  it('slide : A part à gauche (-w·e), B arrive de droite (w·(1-e))', () => {
    expect(transitionLayerStyles('slide', 0, FRAME)).toEqual({ a: { transform: 'translateX(0%)' }, b: { transform: 'translateX(100%)' }, black: false });
    expect(transitionLayerStyles('slide', 0.5, FRAME)).toEqual({ a: { transform: 'translateX(-50%)' }, b: { transform: 'translateX(50%)' }, black: false });
    expect(transitionLayerStyles('slide', 1, FRAME)).toEqual({ a: { transform: 'translateX(-100%)' }, b: { transform: 'translateX(0%)' }, black: false });
  });

  it('push : pendant vertical de slide', () => {
    expect(transitionLayerStyles('push', 1, FRAME)).toEqual({ a: { transform: 'translateY(-100%)' }, b: { transform: 'translateY(0%)' }, black: false });
    expect(transitionLayerStyles('push', 0.5, FRAME).a.transform).toBe('translateY(-50%)');
  });

  it('wipe : A immobile, B découverte par un volet de largeur w·e', () => {
    expect(transitionLayerStyles('wipe', 0, FRAME).b.clipPath).toBe('inset(0 100% 0 0)');
    expect(transitionLayerStyles('wipe', 0.5, FRAME).b.clipPath).toBe('inset(0 50% 0 0)');
    expect(transitionLayerStyles('wipe', 1, FRAME).b.clipPath).toBe('inset(0 0% 0 0)');
    expect(transitionLayerStyles('wipe', 0.5, FRAME).a).toEqual({});
  });

  it('iris : un disque dont le rayon final est la demi-diagonale', () => {
    // `hypot(w, h) / 2` = 100 / √2 % en CSS (le % de `circle()` se rapporte à
    // `hypot(w, h) / √2`).
    expect(transitionLayerStyles('iris', 0, FRAME).b.clipPath).toBe('circle(0.00% at 50% 50%)');
    expect(transitionLayerStyles('iris', 1, FRAME).b.clipPath).toBe('circle(70.71% at 50% 50%)');
    expect(transitionLayerStyles('iris', 0.5, FRAME).b.clipPath).toBe('circle(35.36% at 50% 50%)');
  });

  it('zoom : A s éloigne en s effaçant, B avance (facteur toujours ≥ 1)', () => {
    const mi = transitionLayerStyles('zoom', 0.5, FRAME);
    expect(mi.a).toEqual({ opacity: 0.5, transform: `scale(${1 + 0.18 * 0.5})` });
    expect(mi.b).toEqual({ opacity: 0.5, transform: `scale(${1 + 0.18 * 0.5})` });
    const fin = transitionLayerStyles('zoom', 1, FRAME);
    expect(fin.a).toEqual({ opacity: 0, transform: 'scale(1.18)' });
    expect(fin.b).toEqual({ opacity: 1, transform: 'scale(1)' });
    // Jamais sous 1 : sinon un liseré sombre palpiterait au pourtour.
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const s = transitionLayerStyles('zoom', t, FRAME);
      expect(num(/scale\(([\d.]+)\)/.exec(String(s.b.transform))![1])).toBeGreaterThanOrEqual(1);
    }
  });

  it('fade-to-black : A s éteint sur la première moitié, B s allume sur la seconde, noir dessous', () => {
    expect(transitionLayerStyles('fade-to-black', 0, FRAME)).toEqual({ a: { opacity: 1 }, b: { opacity: 0 }, black: true });
    expect(transitionLayerStyles('fade-to-black', 0.25, FRAME)).toEqual({ a: { opacity: 0.5 }, b: { opacity: 0 }, black: true });
    expect(transitionLayerStyles('fade-to-black', 0.5, FRAME)).toEqual({ a: { opacity: 0 }, b: { opacity: 0 }, black: true });
    expect(transitionLayerStyles('fade-to-black', 0.75, FRAME)).toEqual({ a: { opacity: 0 }, b: { opacity: 0.5 }, black: true });
    expect(transitionLayerStyles('fade-to-black', 1, FRAME)).toEqual({ a: { opacity: 0 }, b: { opacity: 1 }, black: true });
  });

  it('blur-dissolve : flou en cloche (nul aux bouts, 16 px au milieu en 1080), alphas du fondu', () => {
    const debut = transitionLayerStyles('blur-dissolve', 0, FRAME);
    expect(debut.a.filter).toBeUndefined();
    expect(debut.a.opacity).toBe(1);
    expect(debut.b.opacity).toBe(0);
    const mi = transitionLayerStyles('blur-dissolve', 0.5, FRAME);
    expect(mi.a.filter).toBe('blur(16.0px)');
    expect(mi.b.filter).toBe('blur(16.0px)');
    expect(mi.a.transform).toBe('translateX(0%) scale(1.06)');
    expect(mi.a.opacity).toBe(0.5);
    // Mis à l'échelle de la largeur : 1920 de large → 28,4 px.
    expect(transitionLayerStyles('blur-dissolve', 0.5, { w: 1920, h: 1080 }).a.filter).toBe('blur(28.4px)');
    // Et ramené aux pixels d'écran du calque.
    expect(transitionLayerStyles('blur-dissolve', 0.5, { ...FRAME, scale: 0.25 }).a.filter).toBe('blur(4.0px)');
  });

  it('whip-pan : courbe cubique, filé de 26 px, les DEUX calques opaques', () => {
    const mi = transitionLayerStyles('whip-pan', 0.5, FRAME);
    expect(mi.a.opacity).toBe(1);
    expect(mi.b.opacity).toBe(1);
    expect(mi.a.filter).toBe('blur(26.0px)');
    expect(mi.a.transform).toBe('translateX(-50%) scale(1.06)');
    expect(mi.b.transform).toBe('translateX(50%) scale(1.06)');
    const fin = transitionLayerStyles('whip-pan', 1, FRAME);
    expect(fin.a.transform).toBe('translateX(-100%) scale(1)');
    expect(fin.b.transform).toBe('translateX(0%) scale(1)');
    // Cubique : à t = 0,25, bien plus proche du départ que la quadratique.
    const q = transitionLayerStyles('slide', 0.25, FRAME).a.transform;
    const c = transitionLayerStyles('whip-pan', 0.25, FRAME).a.transform;
    expect(Math.abs(num(/-?[\d.]+/.exec(String(c))![0]))).toBeLessThan(Math.abs(num(/-?[\d.]+/.exec(String(q))![0])));
  });

  it('t est borné à [0, 1]', () => {
    expect(transitionLayerStyles('slide', -3, FRAME)).toEqual(transitionLayerStyles('slide', 0, FRAME));
    expect(transitionLayerStyles('slide', 7, FRAME)).toEqual(transitionLayerStyles('slide', 1, FRAME));
    expect(transitionLayerStyles('slide', NaN, FRAME)).toEqual(transitionLayerStyles('slide', 0, FRAME));
  });
});

describe('sequenceClock — la règle de `drawFrame`', () => {
  const steps = [{ key: 'intro', seconds: 4 }, { key: 'cards', seconds: 6 }, { key: 'cta', seconds: 4 }];

  it('la durée totale ne change pas : les transitions vivent DANS la sortante', () => {
    expect(totalSeconds(steps)).toBe(14);
    expect(composer).toContain('const inTransition = seqIdx < sequences.length - 1 && seqElapsed > seq.duration - transitionDur;');
  });

  it('au début : première séquence, aucune transition', () => {
    expect(sequenceClock(steps, 0)).toEqual({ index: 0, progress: 0, inTransition: false, nextIndex: null, transitionProgress: 0, ended: false });
  });

  it('à 2 s : moitié de l intro', () => {
    expect(sequenceClock(steps, 2)).toMatchObject({ index: 0, progress: 0.5, inTransition: false });
  });

  it('à 3,2 s : la fenêtre s ouvre (4 − 0,8), strictement après', () => {
    expect(sequenceClock(steps, 3.2).inTransition).toBe(false);
    const c = sequenceClock(steps, 3.6);
    expect(c.index).toBe(0);
    expect(c.inTransition).toBe(true);
    expect(c.nextIndex).toBe(1);
    expect(c.transitionProgress).toBeCloseTo(0.5, 10);
  });

  it('à 4 s : les cartes prennent la main, progression à zéro', () => {
    expect(sequenceClock(steps, 4)).toMatchObject({ index: 1, progress: 0, inTransition: false, nextIndex: null });
  });

  it('à 9,6 s : transition cartes → CTA, aux trois quarts', () => {
    const c = sequenceClock(steps, 9.8);
    expect(c).toMatchObject({ index: 1, inTransition: true, nextIndex: 2 });
    expect(c.transitionProgress).toBeCloseTo(0.75, 10);
    expect(c.progress).toBeCloseTo(5.8 / 6, 10);
  });

  it('pas de transition après la DERNIÈRE séquence', () => {
    expect(sequenceClock(steps, 13.9)).toMatchObject({ index: 2, inTransition: false, nextIndex: null, ended: false });
  });

  it('au-delà du total : terminé', () => {
    expect(sequenceClock(steps, 14)).toMatchObject({ index: 2, progress: 1, ended: true });
    expect(sequenceClock(steps, 99)).toMatchObject({ ended: true });
  });

  it('une séquence plus courte que la fenêtre ne renvoie jamais une progression hors [0, 1]', () => {
    const courtes = [{ key: 'a', seconds: 0.5 }, { key: 'b', seconds: 0.5 }];
    for (const t of [0, 0.1, 0.3, 0.49, 0.5, 0.9]) {
      const c = sequenceClock(courtes, t);
      expect(c.transitionProgress).toBeGreaterThanOrEqual(0);
      expect(c.transitionProgress).toBeLessThanOrEqual(1);
    }
  });

  it('sans séquence : terminé d emblée', () => {
    expect(sequenceClock([], 0).ended).toBe(true);
  });

  it('un instant négatif ou NaN est lu comme 0', () => {
    expect(sequenceClock(steps, -1)).toEqual(sequenceClock(steps, 0));
    expect(sequenceClock(steps, NaN)).toEqual(sequenceClock(steps, 0));
  });

  it('le libellé de chaque style existe pour l aperçu', () => {
    for (const style of TRANSITION_KEYS) {
      expect(transitionLayerStyles(style as TransitionStyle, 0.5, FRAME)).toHaveProperty('a');
    }
  });
});

describe('extraits — ce que l aperçu rejoue quand on choisit un effet', () => {
  const steps = [{ key: 'intro', seconds: 4 }, { key: 'cards', seconds: 6 }, { key: 'video', seconds: 0 }, { key: 'cta', seconds: 4 }];

  it('la transition : la fenêtre de 0,8 s en FIN de séquence sortante — celle de `drawFrame`', () => {
    const x = transitionExtract(steps, 'intro')!;
    expect(x).toMatchObject({ sequence: 'intro', next: 'cards' });
    // 1 s avant la fenêtre, 0,6 s après la fin de la sortante.
    expect(x.from).toBeCloseTo(4 - TRANSITION_DURATION_SECONDS - EXTRACT_LEAD_SECONDS, 10);
    expect(x.to).toBeCloseTo(4 + EXTRACT_TAIL_SECONDS, 10);
    expect(EXTRACT_LEAD_SECONDS).toBe(1);
    expect(EXTRACT_TAIL_SECONDS).toBe(0.6);
    // L'instant figé est le MILIEU de la fenêtre : `sequenceClock` — donc
    // `drawFrame` — y voit la transition intro → cartes à t = 0,5.
    const c = sequenceClock(steps.filter((s) => s.seconds > 0), x.still);
    expect(c).toMatchObject({ index: 0, inTransition: true, nextIndex: 1 });
    expect(c.transitionProgress).toBeCloseTo(0.5, 10);
    // Au début de l'extrait, PAS encore de transition ; à la fin, la
    // séquence entrante a pris la main.
    expect(sequenceClock(steps, x.from).inTransition).toBe(false);
    expect(sequenceClock(steps, x.to - 1e-9)).toMatchObject({ index: 1, inTransition: false });
    // Même règle que le compositeur, en toutes lettres.
    expect(composer).toContain('const transitionDur = 0.8;');
    expect(composer).toContain('const inTransition = seqIdx < sequences.length - 1 && seqElapsed > seq.duration - transitionDur;');
  });

  it('la séquence de l onglet courant est la sortante ; sans onglet, ou sur la dernière, la première paire', () => {
    expect(transitionExtract(steps, 'cards')).toMatchObject({ sequence: 'cards', next: 'cta' });
    expect(transitionExtract(steps, 'cards')!.still).toBeCloseTo(10 - 0.4, 10);
    expect(transitionExtract(steps, null)).toMatchObject({ sequence: 'intro', next: 'cards' });
    expect(transitionExtract(steps, 'cta')).toMatchObject({ sequence: 'intro', next: 'cards' });
    // Une séquence à 0 s n'existe pas pour le lecteur : « video » est sautée.
    expect(transitionExtract(steps, 'video')).toMatchObject({ sequence: 'intro', next: 'cards' });
  });

  it('borné au montage : une sortante plus courte que l amorce commence à son début', () => {
    const courtes = [{ key: 'intro', seconds: 1.2 }, { key: 'cta', seconds: 4 }];
    const x = transitionExtract(courtes, 'intro')!;
    expect(x.from).toBe(0);
    expect(x.to).toBeCloseTo(1.8, 10);
  });

  it('moins de deux séquences jouables : rien à montrer', () => {
    expect(transitionExtract([{ key: 'intro', seconds: 4 }], 'intro')).toBeNull();
    expect(transitionExtract([{ key: 'intro', seconds: 4 }, { key: 'cta', seconds: 0 }], null)).toBeNull();
    expect(transitionExtract([], null)).toBeNull();
  });

  it('l animation : le DÉBUT de la séquence, sur la fenêtre `INTRO_WINDOW` du compositeur', () => {
    const x = textAnimationExtract(steps, 'cards', INTRO_WINDOW)!;
    expect(x).toMatchObject({ sequence: 'cards' });
    expect(x.next).toBeUndefined();
    expect(x.from).toBe(4);
    // 22 % de 6 s = 1,32 s, puis 0,6 s sur le texte entier.
    expect(x.to).toBeCloseTo(4 + 6 * INTRO_WINDOW + EXTRACT_TAIL_SECONDS, 10);
    // L'instant figé est le milieu de la fenêtre : l'animation y est à
    // mi-course — ni invisible, ni finie.
    const progress = (x.still - 4) / 6;
    expect(progress).toBeCloseTo(INTRO_WINDOW / 2, 10);
    const fondu = textAnimationState('fade', progress);
    expect(fondu.alpha).toBeGreaterThan(0);
    expect(fondu.alpha).toBeLessThan(1);
    // Sans onglet, ou onglet inconnu : la première séquence (le titre).
    expect(textAnimationExtract(steps, null, INTRO_WINDOW)).toMatchObject({ sequence: 'intro', from: 0 });
    expect(textAnimationExtract(steps, 'video', INTRO_WINDOW)).toMatchObject({ sequence: 'intro' });
    expect(textAnimationExtract([], null, INTRO_WINDOW)).toBeNull();
  });

  it('l extrait d animation ne déborde jamais de sa séquence', () => {
    const x = textAnimationExtract([{ key: 'intro', seconds: 0.5 }, { key: 'cta', seconds: 4 }], 'intro', INTRO_WINDOW)!;
    expect(x.to).toBe(0.5);
  });
});
