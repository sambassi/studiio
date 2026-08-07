import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  textAnimationState,
  introRatio,
  easeOut,
  revealText,
  isTypewriter,
  TEXT_ANIMATION_KEYS,
  TEXT_ANIMATION_LABELS,
  TEXT_ANIMATION_HINTS,
  DEFAULT_TEXT_ANIMATION,
  INTRO_WINDOW,
} from '@/lib/creer/textAnimation';
import { sanitizeDraft, DRAFT_VERSION, type SanitizeDeps } from '@/lib/creer/draft';

/**
 * Animations d'apparition du texte.
 *
 * L'exigence qui commande tout : **« Aucune » doit rendre exactement ce que
 * rendait le compositeur hier**, au pixel. D'où un état NEUTRE renvoyé non
 * seulement pour `'none'`, mais aussi pour un style inconnu et pour toute
 * animation déjà terminée — les trois cas où le compositeur ne doit toucher
 * à rien.
 *
 * L'animation se joue sur le **début** de la séquence. Étalée sur sa durée
 * entière, le texte finirait d'apparaître au moment où la séquence s'en va :
 * on ne le lirait jamais en entier.
 */

const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');
const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);

const NEUTRE = { alpha: 1, translateY: 0, scale: 1, charRatio: 1 };

describe('« Aucune » ne touche à rien', () => {
  it('c est le défaut', () => {
    expect(DEFAULT_TEXT_ANIMATION).toBe('none');
    expect(TEXT_ANIMATION_KEYS[0]).toBe('none');
  });

  it('l état est neutre à tout instant', () => {
    for (const p of [0, 0.1, 0.5, 1]) {
      expect(textAnimationState('none', p), String(p)).toEqual(NEUTRE);
    }
  });

  it('un style absent ou inconnu est neutre lui aussi', () => {
    expect(textAnimationState(undefined, 0)).toEqual(NEUTRE);
    expect(textAnimationState('magie' as never, 0)).toEqual(NEUTRE);
  });

  it('une animation TERMINÉE redevient neutre', () => {
    // C'est ce qui garantit qu'au-delà de la fenêtre d'apparition, le rendu
    // est identique à celui d'avant — y compris l'`alpha` exact.
    for (const style of TEXT_ANIMATION_KEYS) {
      expect(textAnimationState(style, 1), style).toEqual(NEUTRE);
      expect(textAnimationState(style, INTRO_WINDOW), style).toEqual(NEUTRE);
    }
  });
});

describe('introRatio — l animation se joue sur le DÉBUT', () => {
  it('va de 0 à 1 sur la fenêtre', () => {
    expect(introRatio(0)).toBe(0);
    expect(introRatio(INTRO_WINDOW / 2)).toBeCloseTo(0.5, 5);
    expect(introRatio(INTRO_WINDOW)).toBe(1);
  });

  it('sature ensuite — le texte est simplement là', () => {
    expect(introRatio(0.5)).toBe(1);
    expect(introRatio(1)).toBe(1);
  });

  it('la fenêtre laisse le texte lisible le reste du temps', () => {
    // Sur une séquence de 4 s, l'apparition dure moins d'une seconde.
    expect(INTRO_WINDOW).toBeLessThanOrEqual(0.25);
    expect(INTRO_WINDOW * 4).toBeLessThan(1);
  });

  it('une valeur aberrante ne bloque pas le texte à l invisible', () => {
    // Rendre 0 sur `NaN` laisserait un cadre vide toute la séquence.
    expect(introRatio(Number.NaN)).toBe(1);
    expect(introRatio(-1)).toBe(0);
    // Une fenêtre nulle ou négative retombe sur la fenêtre par défaut plutôt
    // que de diviser par zéro : l'animation joue, au lieu de disparaître.
    expect(introRatio(0.1, 0)).toBeCloseTo(introRatio(0.1), 10);
    expect(introRatio(0.1, -3)).toBeCloseTo(introRatio(0.1), 10);
  });
});

describe('easeOut', () => {
  it('part de 0, arrive à 1', () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
  });

  it('freine à l arrivée : à mi-course, plus de la moitié est faite', () => {
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });

  it('reste borné', () => {
    expect(easeOut(-5)).toBe(0);
    expect(easeOut(9)).toBe(1);
    expect(easeOut(Number.NaN)).toBe(1);
  });
});

describe('Chaque effet fait ce que son nom annonce', () => {
  const debut = (style: Parameters<typeof textAnimationState>[0]) =>
    textAnimationState(style, 0.01);

  it('fondu : l opacité seule bouge', () => {
    const a = debut('fade');
    expect(a.alpha).toBeLessThan(1);
    expect(a.translateY).toBe(0);
    expect(a.scale).toBe(1);
    expect(a.charRatio).toBe(1);
  });

  it('glissement : il vient du BAS, et non du haut', () => {
    const a = debut('slide');
    expect(a.translateY).toBeGreaterThan(0);
    // Un texte qui glisse en restant opaque donne l'impression de sauter.
    expect(a.alpha).toBeLessThan(1);
  });

  it('le glissement se résorbe à mesure', () => {
    const tot = debut('slide').translateY;
    const mi = textAnimationState('slide', INTRO_WINDOW * 0.6).translateY;
    expect(mi).toBeLessThan(tot);
    expect(mi).toBeGreaterThanOrEqual(0);
  });

  it('pop : il GRANDIT, il ne rétrécit pas', () => {
    const a = debut('pop');
    expect(a.scale).toBeGreaterThan(0);
    expect(a.scale).toBeLessThan(1);
    expect(textAnimationState('pop', INTRO_WINDOW * 0.9).scale).toBeGreaterThan(a.scale);
  });

  it('machine à écrire : le texte se dévoile, rien ne bouge', () => {
    const a = debut('typewriter');
    expect(a.charRatio).toBeLessThan(1);
    expect(a.alpha).toBe(1);
    expect(a.translateY).toBe(0);
    expect(a.scale).toBe(1);
  });

  it('la frappe est LINÉAIRE — elle ne ralentit pas à la fin', () => {
    // Un easing ferait une frappe qui traîne, ce qui ne ressemble à personne.
    const t1 = textAnimationState('typewriter', INTRO_WINDOW * 0.25).charRatio;
    const t2 = textAnimationState('typewriter', INTRO_WINDOW * 0.5).charRatio;
    const t3 = textAnimationState('typewriter', INTRO_WINDOW * 0.75).charRatio;
    expect(t2 - t1).toBeCloseTo(t3 - t2, 5);
  });
});

describe('revealText', () => {
  it('dévoile le début du texte', () => {
    expect(revealText('Bonjour', 0.5)).toBe('Bonj');
    expect(revealText('Bonjour', 1)).toBe('Bonjour');
  });

  it('à la première frame utile, une lettre est déjà là', () => {
    // Un cadre vide au premier instant ressemble à un bug.
    expect(revealText('Bonjour', 0.001)).toBe('B');
    expect(revealText('Bonjour', 0)).toBe('B');
  });

  it('ne rend rien sur un texte vide', () => {
    expect(revealText('', 0.5)).toBe('');
    expect(revealText(null as never, 0.5)).toBe('');
  });

  it('une proportion aberrante rend le texte entier plutôt que rien', () => {
    expect(revealText('Bonjour', Number.NaN)).toBe('Bonjour');
    expect(revealText('Bonjour', 9)).toBe('Bonjour');
  });

  it('isTypewriter ne reconnaît que la frappe', () => {
    expect(isTypewriter('typewriter')).toBe(true);
    for (const s of ['none', 'fade', 'slide', 'pop', undefined] as const) {
      expect(isTypewriter(s), String(s)).toBe(false);
    }
  });
});

describe('Le menu', () => {
  it('les cinq effets sont proposés, libellés et expliqués', () => {
    expect(TEXT_ANIMATION_KEYS).toHaveLength(5);
    for (const k of TEXT_ANIMATION_KEYS) {
      expect(TEXT_ANIMATION_LABELS[k], k).toBeTruthy();
      expect(TEXT_ANIMATION_HINTS[k], k).toBeTruthy();
    }
  });

  it('la liste est importée, jamais recopiée dans l écran', () => {
    expect(wizard).toContain('{TEXT_ANIMATION_KEYS.map((style) => {');
    for (const label of Object.values(TEXT_ANIMATION_LABELS)) {
      expect(wizard.includes(`>${label}<`), label).toBe(false);
    }
  });

  it('il a sa propre section', () => {
    expect(wizard).toMatch(/type SectionId = .*\| 'animation'/);
    expect(wizard).toContain('id="animation"');
    expect(wizard).toContain('hint={TEXT_ANIMATION_LABELS[textAnimation]}');
  });

  it('l écran dit où l effet se voit — pas dans l aperçu', () => {
    expect(wizard).toContain('Visible à l&apos;export, pas dans');
  });

  it('la limite de la machine à écrire sur les cartes est DITE', () => {
    // Les cartes du Mode simple sont une photographie : aucune frappe
    // possible dessus. Le taire laisserait croire à un bug.
    expect(wizard).toContain('Les cartes sont photographiées');
  });
});

describe('Le compositeur applique l animation au bon endroit', () => {
  it('après le fond, jamais avant', () => {
    // Un fond en fondu laisserait voir le noir du canvas ; un fond qui
    // glisserait découvrirait une bande vide.
    for (const seq of ["'cards'", "'cta'"]) {
      const i = composer.indexOf(`paintSeqGradient(ctx, w, h, ${seq}, design)`);
      const j = composer.indexOf('applyTextAnimation', i);
      expect(j, seq).toBeGreaterThan(i);
    }
  });

  it('les trois séquences de texte sont couvertes', () => {
    expect(composer.split('applyTextAnimation(ctx, w, h, design?.textAnimation, progress);').length - 1).toBe(3);
  });

  it('les fonctions consomment enfin leur `progress`', () => {
    // Il était passé puis ignoré (`_progress`).
    expect(composer).not.toContain('accent: string, _progress: number');
    expect(composer).not.toContain('logoImg: HTMLImageElement | null, _progress: number');
    expect(composer).not.toContain('_accent: string, _progress: number');
  });

  it('l échelle se fait autour du CENTRE du cadre', () => {
    // Autour de l'origine, le texte partirait du coin haut-gauche.
    expect(composer).toContain('ctx.translate(w / 2, h / 2);');
    expect(composer).toContain('ctx.translate(-w / 2, -h / 2);');
  });

  it('l état neutre sort immédiatement, sans toucher au contexte', () => {
    expect(composer).toContain('if (a.alpha === 1 && a.translateY === 0 && a.scale === 1) return;');
  });

  it('l opacité est MULTIPLIÉE, pas écrasée', () => {
    // L'appelant peut déjà être en train de fondre une transition.
    expect(composer).toContain('ctx.globalAlpha *= a.alpha;');
  });

  it('le logo reste hors de l animation', () => {
    // C'est une marque, pas du contenu : la voir glisser trahirait le kit.
    expect(composer).toContain("// Ferme l'enveloppe d'animation : le logo n'en fait pas partie.");
  });

  it('la machine à écrire tronque AVANT la mise en lignes', () => {
    // Le retour à la ligne suit alors la frappe, comme une vraie saisie.
    expect(composer).toContain('title = revealText(title, revealRatio);');
    expect(composer).toContain('if (revealRatio < 1) ctaText = revealText(ctaText, revealRatio);');
  });
});

const DEPS: SanitizeDeps = {
  themeIds: ['sommeil'],
  toneIds: ['punchy'],
  formats: ['9:16', '1:1', '16:9'],
  maxStep: 3,
  defaults: {
    themeId: 'sommeil',
    toneId: 'punchy',
    format: '9:16',
    titleStyle: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
    subtitleStyle: { font: null, color: null, scale: 1 },
    ctaStyle: { font: 'Inter', color: '#FFFFFF', subColor: '', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
    sequences: [
      { key: 'intro', enabled: true },
      { key: 'cards', enabled: true },
      { key: 'video', enabled: false },
      { key: 'cta', enabled: true },
    ],
    durations: { intro: 4, cards: 6, video: 0, cta: 4 },
  },
};
const lire = (extra: Record<string, unknown>) =>
  sanitizeDraft({ version: DRAFT_VERSION, savedAt: 1, ...extra }, DEPS)!;

describe('Persistance et export', () => {
  it('un brouillon sans animation se relit comme avant', () => {
    expect(lire({}).textAnimation).toBeUndefined();
  });

  it('relit chacun des cinq effets', () => {
    for (const k of TEXT_ANIMATION_KEYS) {
      expect(lire({ textAnimation: k }).textAnimation, k).toBe(k);
    }
  });

  it('écarte un effet inconnu', () => {
    for (const v of ['bounce', '', 42, null, {}]) {
      expect(lire({ textAnimation: v }).textAnimation, JSON.stringify(v)).toBeUndefined();
    }
  });

  it('l effet part au compositeur ET dans les métadonnées du post', () => {
    // Deux blocs `design` : celui du rendu, celui que le Calendrier relit.
    // `cardStyle` est devenu un ETAT — il etait fige a « Compact » — d'ou la
    // disparition de la constante dans les deux blocs.
    expect(wizard.split('textAnimation,\n            cardStyle,').length - 1).toBe(2);
  });

  it('un nouveau montage repart sans animation', () => {
    const debut = wizard.indexOf('const reset = ()');
    const reset = wizard.slice(debut, wizard.indexOf('\n  };', debut));
    expect(reset).toContain('setTextAnimation(DEFAULT_TEXT_ANIMATION);');
  });
});
