import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  buildSequences, totalDurationSeconds, totalDurationFrames, sequenceFrameOffsets,
  editorViewportPx, maxVisibleCards, isReelFormat, gradientOverlayCss, hexToRgba,
  SEQ_NAME_MAP, VIDEO_SIZE, TRANSITION_SECONDS,
} from '@/lib/creer/designSpec';

/**
 * Spécification de montage partagée — la fondation du rendu serveur.
 *
 * Studiio compose désormais de deux façons : dans le navigateur (Canvas +
 * `MediaRecorder`) et sous Chromium sans tête (Remotion). **L'enjeu de la
 * Phase 1 n'est pas d'écrire une jolie composition, c'est d'empêcher les deux
 * moteurs de diverger.**
 *
 * D'où l'extraction de `buildSequences` : l'ordre des séquences, leurs durées
 * et la redistribution d'une vidéo morte sont désormais décidés **une seule
 * fois**, par la fonction que les deux moteurs appellent. Deux assemblages
 * indépendants divergeraient au premier réglage ajouté d'un seul côté — et
 * l'écart ne se verrait qu'en comparant deux vidéos image par image.
 */

const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');
const composition = readFileSync(resolve(__dirname, '../../remotion/CreerSimpleMontage.tsx'), 'utf-8');
const index = readFileSync(resolve(__dirname, '../../remotion/index.tsx'), 'utf-8');
const entree = readFileSync(resolve(__dirname, '../lib/render/creerSimple.ts'), 'utf-8');

const base = {
  introDuration: 4, cardsDuration: 6, videoDuration: 0, ctaDuration: 4,
  cardCount: 3, hasVideoBackground: false, videoRequested: false,
};

describe('Les DEUX moteurs assemblent avec la même fonction', () => {
  it('le compositeur navigateur l appelle', () => {
    expect(composer).toContain("from '@/lib/creer/designSpec'");
    expect(composer).toContain('const sequences = buildSequences({');
    // Plus d'assemblage local : c'était la source de divergence.
    expect(composer).not.toContain("sequences.push({ type: 'cards', duration: cardsDuration })");
  });

  it('la composition Remotion aussi', () => {
    expect(composition).toContain('buildSequences({');
    expect(composition).toContain("from '../src/lib/creer/designSpec'");
  });

  it('et l entrée de rendu serveur', () => {
    expect(entree).toContain('buildSequences({');
    expect(entree).toContain('totalDurationFrames(sequences, 30)');
  });

  it('la durée de la composition est DÉRIVÉE, jamais transmise', () => {
    // Une durée passée à la main finirait par ne plus correspondre aux
    // séquences réellement rendues.
    expect(index).toContain('durationInFrames: totalDurationFrames(sequences, 30)');
  });
});

describe('L ordre canonique et la redistribution', () => {
  it('intro → cartes → CTA quand il n y a pas de rush', () => {
    expect(buildSequences(base).map((s) => s.type)).toEqual(['intro', 'cards', 'cta']);
  });

  it('le rush s intercale avant le CTA', () => {
    const s = buildSequences({ ...base, videoDuration: 10, hasVideoBackground: true, videoRequested: true });
    expect(s.map((x) => x.type)).toEqual(['intro', 'cards', 'video', 'cta']);
  });

  it('une séquence à durée nulle est absente', () => {
    expect(buildSequences({ ...base, cardsDuration: 0 }).map((s) => s.type)).toEqual(['intro', 'cta']);
  });

  it('sans carte, pas de séquence cartes — même avec une durée', () => {
    expect(buildSequences({ ...base, cardCount: 0 }).map((s) => s.type)).toEqual(['intro', 'cta']);
  });

  it('une vidéo DEMANDÉE mais illisible redistribue sa durée', () => {
    // Le montage garderait sinon un trou de dix secondes.
    const s = buildSequences({ ...base, videoDuration: 10, hasVideoBackground: false, videoRequested: true });
    expect(s.map((x) => x.type)).toEqual(['intro', 'cards', 'cta']);
    expect(s[0].duration).toBe(4 + 5);   // intro + floor(10/2)
    expect(s[2].duration).toBe(4 + 5);   // cta + ceil(10/2)
  });

  it('la redistribution vise l ordre CANONIQUE, pas l ordre demandé', () => {
    // `sequences[0]` reçoit le bonus AVANT le tri : réordonner d'abord
    // l'enverrait à la mauvaise séquence.
    const s = buildSequences({
      ...base, videoDuration: 10, hasVideoBackground: false, videoRequested: true,
      sequenceOrder: ['cta', 'cartes', 'titre'],
    });
    const intro = s.find((x) => x.type === 'intro')!;
    expect(intro.duration).toBe(9);
  });
});

describe('Le réordonnancement', () => {
  it('accepte le vocabulaire de l éditeur', () => {
    const s = buildSequences({ ...base, sequenceOrder: ['cta', 'cartes', 'titre'] });
    expect(s.map((x) => x.type)).toEqual(['cta', 'cards', 'intro']);
    expect(SEQ_NAME_MAP.titre).toBe('intro');
  });

  it('comme celui du compositeur', () => {
    const s = buildSequences({ ...base, sequenceOrder: ['cta', 'cards', 'intro'] });
    expect(s.map((x) => x.type)).toEqual(['cta', 'cards', 'intro']);
  });

  it('les types absents de l ordre restent à la fin, dans leur ordre naturel', () => {
    const s = buildSequences({ ...base, sequenceOrder: ['cta'] });
    expect(s.map((x) => x.type)).toEqual(['cta', 'intro', 'cards']);
  });

  it('il ne peut jamais INSÉRER une séquence exclue', () => {
    // Le tri échange, il n'ajoute pas.
    const s = buildSequences({ ...base, cardCount: 0, sequenceOrder: ['cartes', 'titre', 'cta'] });
    expect(s.map((x) => x.type)).not.toContain('cards');
  });

  it('un ordre vide laisse l ordre canonique', () => {
    expect(buildSequences({ ...base, sequenceOrder: [] }).map((s) => s.type))
      .toEqual(['intro', 'cards', 'cta']);
  });
});

describe('Un montage vide reste rendable', () => {
  it('toutes séquences masquées → une intro d une seconde', () => {
    // Une composition de durée nulle ferait tourner l'enregistreur dans le
    // vide côté navigateur, et Remotion la refuserait.
    const s = buildSequences({
      introDuration: 0, cardsDuration: 0, videoDuration: 0, ctaDuration: 0,
      cardCount: 0, hasVideoBackground: false, videoRequested: false,
    });
    expect(s).toEqual([{ type: 'intro', duration: 1 }]);
  });

  it('la durée en images n est jamais nulle', () => {
    expect(totalDurationFrames([], 30)).toBe(1);
    expect(totalDurationFrames([{ type: 'intro', duration: 0 }], 30)).toBe(1);
  });

  it('une cadence absurde retombe sur 30 images par seconde', () => {
    expect(totalDurationFrames([{ type: 'intro', duration: 2 }], 0)).toBe(60);
    expect(totalDurationFrames([{ type: 'intro', duration: 2 }], Number.NaN)).toBe(60);
  });
});

describe('Les repères temporels', () => {
  it('la durée totale est la somme des séquences', () => {
    expect(totalDurationSeconds(buildSequences(base))).toBe(14);
    expect(totalDurationFrames(buildSequences(base), 30)).toBe(420);
  });

  it('chaque séquence démarre à la fin de la précédente', () => {
    expect(sequenceFrameOffsets(buildSequences(base), 30)).toEqual([0, 120, 300]);
  });

  it('une durée négative ne fait pas reculer les suivantes', () => {
    const o = sequenceFrameOffsets([{ type: 'a', duration: -5 }, { type: 'b', duration: 2 }], 30);
    expect(o).toEqual([0, 0]);
  });

  it('la durée de transition reste celle du navigateur', () => {
    expect(TRANSITION_SECONDS).toBe(0.8);
  });
});

describe('Les règles de mesure', () => {
  it('le viewport de l éditeur dépend du format', () => {
    // Se tromper rend les polices du 16:9 60 % trop grandes.
    expect(editorViewportPx(true)).toBe(320);
    expect(editorViewportPx(false)).toBe(512);
  });

  it('le nombre de cartes visibles aussi', () => {
    expect(maxVisibleCards(true)).toBe(5);
    expect(maxVisibleCards(false)).toBe(6);
  });

  it('le carré est rangé du côté NON vertical', () => {
    expect(isReelFormat(1080, 1920)).toBe(true);
    expect(isReelFormat(1080, 1080)).toBe(false);
    expect(isReelFormat(1920, 1080)).toBe(false);
  });

  it('les dimensions natives sont les mêmes des deux côtés', () => {
    expect(VIDEO_SIZE['9:16']).toEqual({ w: 1080, h: 1920 });
    expect(VIDEO_SIZE['16:9']).toEqual({ w: 1920, h: 1080 });
    expect(index).toContain("VIDEO_SIZE['9:16'].w");
  });
});

describe('Le voile de dégradé', () => {
  it('laisse le MILIEU transparent — sinon la photo serait cachée', () => {
    const css = gradientOverlayCss('#7C3AED', '#EC4899', 0.5);
    expect(css).toContain('rgba(0,0,0,0) 40%');
    expect(css).toContain('rgba(0,0,0,0) 60%');
  });

  it('convertit les couleurs, et survit à une valeur illisible', () => {
    expect(hexToRgba('#7C3AED', 0.5)).toBe('rgba(124, 58, 237, 0.5)');
    expect(hexToRgba('pas-une-couleur', 0.5)).toBe('rgba(0,0,0,0.5)');
    expect(hexToRgba(undefined as never, 0.3)).toBe('rgba(0,0,0,0.3)');
  });

  it('l opacité est bornée', () => {
    expect(gradientOverlayCss('#000000', '#000000', 9)).toContain('1)');
    expect(gradientOverlayCss('#000000', '#000000', -3)).toContain('0)');
  });
});

describe('Ce que la Phase 1 ne rend PAS — dit explicitement', () => {
  it('la composition accepte les champs des phases suivantes sans les rendre', () => {
    // Leur signature existe déjà : la phase suivante n'aura pas à la changer.
    for (const champ of ['textAnimation', 'sequenceVoiceUrls']) {
      expect(composition, champ).toContain(`${champ}?:`);
    }
    expect(composition).toContain('Non rendu en Phase 1');
  });

  it('l approximation des cartes est documentée', () => {
    // Le navigateur blitte une PHOTOGRAPHIE du conteneur ; la composition
    // les redessine. La parité y sera une ressemblance, pas une identité.
    expect(composition).toContain('PHOTOGRAPHIE du conteneur');
  });

  it('les transitions, elles, sont RENDUES depuis la Phase 6', () => {
    // La Phase 1 assumait des coupes franches et le disait. Ce n'est plus
    // vrai : la composition monte une serie de transitions.
    expect(composition).not.toContain('coupes franches');
    expect(composition).toContain('<TransitionSeries.Transition');
  });
});
