/**
 * MULTI-RUSH — plusieurs rushes enchaînés dans la séquence « Vidéo ».
 *
 * - 1 rush : plan, options de rendu, metadata et relecture INCHANGÉS ;
 * - 2 rushes : les deux dans le plan (ordre, durées), dans les options du
 *   compositeur relues depuis la metadata, dans la composition Remotion ;
 * - sauvegarde → rechargement conserve l'ordre ; retrait d'un rush.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('remotion', () => {
  const Div = ({ children, ...p }: { children?: React.ReactNode }) => React.createElement('div', p as object, children);
  return {
    AbsoluteFill: Div,
    Audio: () => null,
    Img: () => null,
    OffthreadVideo: ({ src }: { src: string }) => React.createElement('video', { 'data-src': src }),
    Sequence: ({ children, from, durationInFrames }: { children?: React.ReactNode; from?: number; durationInFrames?: number }) =>
      React.createElement('div', { 'data-rush-seq': '', 'data-from': from, 'data-duree': durationInFrames ?? 'fin' }, children),
    useVideoConfig: () => ({ fps: 30, width: 1080, height: 1920, durationInFrames: 900 }),
    useCurrentFrame: () => 0,
    delayRender: () => 0,
    continueRender: () => undefined,
    interpolate: () => 0,
  };
});
vi.mock('@remotion/transitions', () => {
  const TS = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children);
  TS.Sequence = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children);
  TS.Transition = () => null;
  return { TransitionSeries: TS, linearTiming: () => ({}) };
});
vi.mock('@remotion/transitions/fade', () => ({ fade: () => ({}) }));
vi.mock('@remotion/transitions/slide', () => ({ slide: () => ({}) }));
vi.mock('@remotion/transitions/wipe', () => ({ wipe: () => ({}) }));
vi.mock('@remotion/transitions/iris', () => ({ iris: () => ({}) }));
vi.mock('@remotion/media-utils', () => ({ getAudioDurationInSeconds: async () => 1 }));

import {
  planRushs, dureeMultiRush, deplacer, retirer, segmentA,
  rushSegmentsDepuisMetadata, rushsDepuisSegments,
} from '@/lib/creer/multi-rush';
import { optionsRenduDepuisMetadata } from '@/lib/rendus/options-depuis-metadata';
import { toWizardDraft } from '@/lib/creer/postMetadata/to-wizard';
import { metadataPourEnregistrement } from '@/lib/creer/postMetadata/from-wizard';
import { sanitizeDraft, DRAFT_VERSION, type SanitizeDeps } from '@/lib/creer/draft';

const DEPS: SanitizeDeps = {
  themeIds: ['sommeil'], toneIds: ['punchy'], formats: ['9:16'], maxStep: 3,
  defaults: {
    themeId: 'sommeil', toneId: 'punchy', format: '9:16',
    titleStyle: {}, subtitleStyle: {}, ctaStyle: {},
    sequences: [{ key: 'intro', enabled: true }, { key: 'cards', enabled: true }, { key: 'video', enabled: false }, { key: 'cta', enabled: true }],
    durations: { intro: 4, cards: 6, video: 0, cta: 4 },
  },
};
import { CreerSimpleMontage } from '../../remotion/CreerSimpleMontage';

const A = 'https://cdn.test/media/u1/a.mp4';
const B = 'https://cdn.test/media/u1/b.mp4';

describe('plan multi-rush (module partagé)', () => {
  it('1 rush : le rush unique d’avant, toute la séquence', () => {
    expect(planRushs([{ url: A, secondes: 7 }], 10)).toEqual([{ url: A, debut: 0, fin: 10 }]);
  });

  it('2 rushes : ordre respecté, parts proportionnelles aux durées, contiguës', () => {
    const plan = planRushs([{ url: A, secondes: 4 }, { url: B, secondes: 6 }], 10);
    expect(plan).toEqual([{ url: A, debut: 0, fin: 4 }, { url: B, debut: 4, fin: 10 }]);
    expect(segmentA(plan, 3.9)?.url).toBe(A);
    expect(segmentA(plan, 4)?.url).toBe(B);
  });

  it('durée inconnue : parts égales ; durée de séquence = somme retenue', () => {
    expect(planRushs([{ url: A }, { url: B, secondes: 6 }], 8)).toEqual([
      { url: A, debut: 0, fin: 4 }, { url: B, debut: 4, fin: 8 },
    ]);
    expect(dureeMultiRush([4, 6], 6)).toBe(10);
    expect(dureeMultiRush([null, 6], 6)).toBe(12);
  });

  it('monter / descendre / retirer', () => {
    expect(deplacer([A, B], 1, -1)).toEqual([B, A]);
    expect(deplacer([A, B], 0, -1)).toEqual([A, B]);
    expect(retirer([A, B], 0)).toEqual([B]);
  });

  it('rushSegments : moins de 2 entrées ou mal formé → null (post mono-rush)', () => {
    expect(rushSegmentsDepuisMetadata(undefined)).toBeNull();
    expect(rushSegmentsDepuisMetadata([{ url: A, debut: 0, fin: 5 }])).toBeNull();
    expect(rushSegmentsDepuisMetadata([{ url: A, debut: 0, fin: 5 }, { url: B, debut: 5, fin: 5 }])).toBeNull();
  });
});

const post = (metadata: Record<string, unknown>) => ({
  id: 'p1', title: 'T', format: 'reel', metadata: {
    sequences: { intro: 3, cards: 0, video: 10, cta: 3, order: ['intro', 'video', 'cta'] },
    ...metadata,
  },
});

describe('relecture metadata → options du compositeur', () => {
  it('1 rush : aucune clé `rushs` — options identiques à avant', () => {
    const o = optionsRenduDepuisMetadata(post({ rushUrls: [A] }) as never, 'regenerer', { cards: [], rushLut: null } as never);
    expect(o.videoUrl).toBe(A);
    expect('rushs' in o).toBe(false);
  });

  it('banque Agent IA (rushUrls à 3 entrées, sans segments) : rushUrls[0] seul, comme avant', () => {
    const o = optionsRenduDepuisMetadata(post({ rushUrls: [A, B, 'https://cdn.test/c.mp4'] }) as never, 'regenerer', { cards: [], rushLut: null } as never);
    expect(o.videoUrl).toBe(A);
    expect('rushs' in o).toBe(false);
  });

  it('2 rushes (rushSegments) : les deux, dans l’ordre, avec leurs durées', () => {
    const o = optionsRenduDepuisMetadata(post({
      rushUrls: [A, B],
      rushSegments: [{ url: A, debut: 0, fin: 4 }, { url: B, debut: 4, fin: 10 }],
    }) as never, 'regenerer', { cards: [], rushLut: null } as never);
    expect(o.videoUrl).toBe(A);
    expect(o.rushs).toEqual([{ url: A, secondes: 4 }, { url: B, secondes: 6 }]);
  });
});

describe('sauvegarde → rechargement (to-wizard / from-wizard / brouillon)', () => {
  it('1 rush : le brouillon relu ne porte aucun champ multi-rush', () => {
    const d = toWizardDraft(post({ rushUrls: [A] }) as never);
    expect(d.rushUrl).toBe(A);
    expect(d.rushSuivants).toBeUndefined();
  });

  it('2 rushes : relus dans l’ordre, avec leurs durées, et survivent à sanitizeDraft', () => {
    const d = toWizardDraft(post({
      rushUrls: [B, A],
      rushSegments: [{ url: B, debut: 0, fin: 6 }, { url: A, debut: 6, fin: 10 }],
    }) as never);
    expect(d.rushUrl).toBe(B);
    expect(d.rushSecondes).toBe(6);
    expect(d.rushSuivants).toEqual([{ url: A, name: '', secondes: 4 }]);
    const s = sanitizeDraft({ ...JSON.parse(JSON.stringify(d)), version: DRAFT_VERSION, savedAt: 1 }, DEPS);
    expect(s?.rushUrl).toBe(B);
    expect(s?.rushSuivants?.map((r) => r.url)).toEqual([A]);
  });

  it('Modifier : un post mono-rush enregistré sans changement n’écrit ni rushUrls ni rushSegments', () => {
    const v = { rushUrls: [A], rushSegments: null };
    const envoi = metadataPourEnregistrement({ rushUrls: [A] }, v, { rushUrls: [A], rushSegments: null });
    expect(envoi).not.toHaveProperty('rushSegments');
    expect(envoi).not.toHaveProperty('rushUrls');
  });

  it('Modifier : ajout puis retrait d’un rush', () => {
    const segs = planRushs([{ url: A, secondes: 4 }, { url: B, secondes: 6 }], 10);
    const ajout = metadataPourEnregistrement({ rushUrls: [A] }, { rushUrls: [A, B], rushSegments: segs }, { rushUrls: [A], rushSegments: null });
    expect(ajout.rushUrls).toEqual([A, B]);
    expect(ajout.rushSegments).toEqual(segs);
    // Retrait de A : B reste seul, les segments sont effacés.
    const reste = retirer([A, B], 0);
    const retrait = metadataPourEnregistrement(
      { rushUrls: [A, B], rushSegments: segs }, { rushUrls: reste, rushSegments: null }, { rushUrls: [A, B], rushSegments: segs },
    );
    expect(retrait.rushUrls).toEqual([B]);
    expect(retrait.rushSegments).toBeNull();
    expect(rushsDepuisSegments(segs)).toEqual([{ url: A, secondes: 4 }, { url: B, secondes: 6 }]);
  });
});

describe('composition Remotion (CreerSimpleMontage)', () => {
  const base = { title: 'T', introDuration: 0, cardsDuration: 0, videoDuration: 10, ctaDuration: 0, videoUrl: A };

  it('1 rush : un seul OffthreadVideo, aucun Sequence de rush', () => {
    const { container } = render(<CreerSimpleMontage {...(base as never)} />);
    expect([...container.querySelectorAll('video')].map((v) => v.getAttribute('data-src'))).toEqual([A]);
    expect(container.querySelectorAll('[data-rush-seq]').length).toBe(0);
  });

  it('2 rushes : deux Sequence successives, dans l’ordre, aux bonnes frames', () => {
    const { container } = render(
      <CreerSimpleMontage {...(base as never)} rushs={[{ url: A, secondes: 4 }, { url: B, secondes: 6 }]} />,
    );
    expect([...container.querySelectorAll('video')].map((v) => v.getAttribute('data-src'))).toEqual([A, B]);
    const seqs = [...container.querySelectorAll('[data-rush-seq]')];
    expect(seqs.map((s) => [s.getAttribute('data-from'), s.getAttribute('data-duree')])).toEqual([
      ['0', '120'], ['120', 'fin'],
    ]);
  });
});

describe('câblage (sources)', () => {
  const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf8');
  const wizard = readFileSync(resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf8');

  it('le compositeur n’active le multi-rush qu’à partir de 2 rushes et garde le chemin mono-rush', () => {
    expect(composer).toMatch(/options\.rushs\.filter\(\(r\) => r\?\.url\)\.length >= 2/);
    expect(composer).toMatch(/rushsLus\.length >= 2 && videoSeqPlan/);
    expect(composer).toMatch(/const rushEls: HTMLVideoElement\[\] = rushPlan \? rushPlan\.map\(\(s\) => s\.el\) : \(videoEl \? \[videoEl\] : \[\]\)/);
    // LUT : le même étalonneur reçoit le rush courant.
    expect(composer).toMatch(/drawVideoSeq\(target, width, height, rushCourant,[^\n]*lutGrader\)/);
  });

  it('le wizard écrit rushSegments seulement avec ≥ 2 rushes', () => {
    expect(wizard).toMatch(/rushsDurables\.length >= 2\s*\?\s*planRushs\(rushsDurables, duree\('video'\)\)/);
    expect(wizard).toMatch(/rushs: rushListe\.length >= 2 \? rushListe : null/);
  });
});
