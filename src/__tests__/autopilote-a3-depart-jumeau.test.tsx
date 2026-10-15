/**
 * A3 — LE JUMEAU PARLE AU DÉBUT DE SA SÉQUENCE.
 *
 * Défaut D5 (audit vidéo) : la séquence « Vidéo » de la `TransitionSeries`
 * démarre `tFrames` (0,8 s) plus tôt pour porter le fondu d'entrée ; la vidéo
 * du jumeau y démarrait à 0, donc il parlait PENDANT le fondu cartes→vidéo.
 *
 * Correction : son image ET sa voix partent au début NOMINAL (fondu terminé) ;
 * pendant le fondu, sa première image figée et muette. La séquence porte en
 * plus le fondu de sortie (design) : la parole finit avant le raccord vers le
 * CTA. Avec une durée cible, l'enveloppe A4 absorbe ce supplément.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, waitFor, cleanup } from '@testing-library/react';

type Piste = { kind: 'audio' | 'video'; src: string; from: number; fige: boolean; volume: unknown };
const pistes: Piste[] = [];
vi.mock('remotion', async () => {
  const R = await import('react');
  const Ctx = R.createContext(0);
  const Fige = R.createContext(false);
  const Div = ({ children }: { children?: React.ReactNode }) => R.createElement('div', null, children);
  const piste = (kind: 'audio' | 'video') => function Piste({ src, volume }: { src: string; volume?: unknown }) {
    pistes.push({ kind, src, from: R.useContext(Ctx), fige: R.useContext(Fige), volume });
    return null;
  };
  return {
    AbsoluteFill: Div,
    Freeze: ({ children }: { children?: React.ReactNode }) => R.createElement(Fige.Provider, { value: true }, children),
    Audio: piste('audio'),
    Img: () => null,
    OffthreadVideo: piste('video'),
    Sequence: ({ children, from = 0 }: { children?: React.ReactNode; from?: number }) => {
      const parent = R.useContext(Ctx);
      return R.createElement(Ctx.Provider, { value: parent + from }, children);
    },
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
vi.mock('@remotion/media-utils', () => ({ getAudioDurationInSeconds: async () => 188 }));

import { CreerSimpleMontage, fenetreVoixJumeau as fenetreBrute, planFromProps, type CreerSimpleMontageProps } from '../../remotion/CreerSimpleMontage';
import { sequenceFrameOffsets, totalDurationFrames } from '@/lib/creer/designSpec';
import { baseSequenceFrames, transitionFrames, TRANSITION_DURATION_SECONDS } from '../../remotion/transitions';
import { TRANSITION_DURATION_SECONDS as FONDU_DESIGN } from '@/lib/creer/transitionPreview';
import { buildAutopilotDesign } from '@/lib/autopilot/design';
import { auDixiemeSuperieur } from '@/lib/autopilot/duree-cible';
import { preparePosts } from '@/lib/autopilot/engine';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import { versEntreeRemotion } from '@/lib/render/spec-rendu';

const MUSIQUE = 'https://cdn.test/musique.mp3';
const RUSH = 'https://cdn.test/rush.mp4';
const JUMEAU = 'https://cdn.test/avatar/j.mp4';
const FPS = 30;

function reperes(props: CreerSimpleMontageProps) {
  const sequences = planFromProps(props);
  const offsets = sequenceFrameOffsets(sequences, FPS);
  const totalFrames = totalDurationFrames(sequences, FPS);
  const base = baseSequenceFrames(offsets, totalFrames);
  const tFrames = transitionFrames(base, FPS);
  const iVideo = sequences.findIndex((s) => s.type === 'video');
  return { sequences, offsets, base, tFrames, iVideo, totalFrames };
}

const post = {
  title: 'Sujet', content: { subtitle: 's', cards: [{ title: 'a', description: 'b', value: '1' }], tagLine: 'cta' }, rushUrl: RUSH,
} as unknown as Parameters<typeof buildAutopilotDesign>[0];
const config = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG, musicUrl: MUSIQUE, musicVolume: 0.8, voiceVolume: 1, rushVolume: 0.5, keepRushAudio: true, ...p,
});

async function pistesVideo(props: CreerSimpleMontageProps, src: string) {
  pistes.length = 0;
  render(<CreerSimpleMontage {...props} />);
  await waitFor(() => expect(pistes.some((p) => p.src === src)).toBe(true));
  // Un rendu peut se répéter : on garde la dernière passe.
  const toutes = pistes.filter((p) => p.src === src && p.kind === 'video');
  const n = new Set(toutes.map((p) => `${p.from}|${p.fige}`)).size;
  return toutes.slice(-n);
}

beforeEach(() => { cleanup(); pistes.length = 0; });

describe('A3 — constantes', () => {
  it('le fondu du design est celui du rendu (0,8 s)', () => {
    expect(FONDU_DESIGN).toBe(TRANSITION_DURATION_SECONDS);
  });
});

describe('A3 — le jumeau part au début NOMINAL de sa séquence', () => {
  const jumeau = { videoUrl: JUMEAU, seconds: 12.3 };

  it('première image parlante = offsets[vidéo] (et non offsets − tFrames)', async () => {
    const props = versEntreeRemotion(buildAutopilotDesign(post, { config: config(), jumeau }));
    const r = reperes(props);
    const p = await pistesVideo(props, JUMEAU);
    const parlante = p.find((x) => !x.fige)!;
    const figee = p.find((x) => x.fige)!;
    // La série monte la séquence à offsets − tFrames : le média part `tFrames` après.
    const departSerie = r.offsets[r.iVideo] - r.tFrames;
    expect(departSerie + parlante.from).toBe(r.offsets[r.iVideo]);
    expect(r.offsets[r.iVideo]).toBe(300); // 4 s + 6 s
    // Volume à l'instant ABSOLU : voix (1) dès le départ nominal.
    const vol = parlante.volume as (f: number) => number;
    expect(vol(0)).toBe(1);
    // Pendant le fondu : première image figée, MUETTE.
    expect(figee.from).toBe(0);
    expect(figee.volume).toBe(0);
  });

  it('fenêtre du ducking = départ nominal → fin nominale', () => {
    const props = versEntreeRemotion(buildAutopilotDesign(post, { config: config(), jumeau }));
    const r = reperes(props);
    expect(fenetreBrute(props, { ...r, fps: FPS })).toEqual({ debut: 10, fin: (r.offsets[r.iVideo] + r.base[r.iVideo]) / FPS });
  });

  it('la parole finit AVANT le fondu de sortie (séquence = parole + 0,8 s)', () => {
    for (const J of [2.2, 9.97, 12.3, 16.333333, 30]) {
      const d = buildAutopilotDesign(post, { config: config(), jumeau: { videoUrl: JUMEAU, seconds: J } });
      const r = reperes(versEntreeRemotion(d));
      const finParole = r.offsets[r.iVideo] + J * FPS;
      const debutFonduSortie = r.offsets[r.iVideo] + r.base[r.iVideo] - r.tFrames;
      expect(finParole).toBeLessThanOrEqual(debutFonduSortie + 1e-6);
      // Au plus 3 images figées avant le fondu (arrondi au dixième).
      expect(debutFonduSortie - finParole).toBeLessThanOrEqual(3 + 1e-6);
      expect(d.videoDuration).toBeCloseTo(auDixiemeSuperieur(J) + 0.8, 6);
    }
  });

  it('durée cible 30 s : le total reste la cible (± 0,2 s), l’enveloppe absorbe le fondu', () => {
    const cfg = { ...config(), brief: { duree: 30 } } as AutopilotConfig;
    const [p] = preparePosts({ config: cfg, topic: 'stress', count: 1, now: Date.UTC(2026, 9, 13), seeds: [7] });
    for (const J of [12, 16.333333, 20]) {
      const d = buildAutopilotDesign(p, { config: cfg, jumeau: { videoUrl: JUMEAU, seconds: J } });
      const r = reperes(versEntreeRemotion(d));
      expect(Math.abs(r.totalFrames / FPS - 30)).toBeLessThanOrEqual(0.2);
    }
  });
});

describe('A3 — inchangé hors jumeau mono', () => {
  it('SANS jumeau : le rush part avec la séquence (raccord compris), une seule piste, jamais figée', async () => {
    const props = versEntreeRemotion(buildAutopilotDesign(post, { config: config(), rushSeconds: 6 }));
    const p = await pistesVideo(props, RUSH);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ from: 0, fige: false });
    expect(fenetreBrute(props, { ...reperes(props), fps: FPS })).toBeNull();
  });

  it('jumeau en PREMIÈRE séquence (aucun raccord entrant) : chemin d’avant', async () => {
    const props: CreerSimpleMontageProps = {
      title: 'T', videoUrl: JUMEAU, voixJumeau: true, cards: [], musicUrl: MUSIQUE,
      introDuration: 0, cardsDuration: 0, videoDuration: 10, ctaDuration: 4, sequenceOrder: ['video', 'cta', 'intro', 'cards'],
    } as CreerSimpleMontageProps;
    const r = reperes(props);
    expect(r.iVideo).toBe(0);
    const p = await pistesVideo(props, JUMEAU);
    expect(p).toHaveLength(1);
    expect(p[0].from).toBe(0);
  });

  it('multi-sources avec jumeau : fenêtre dès 0 (voix continue), inchangée', () => {
    const props: CreerSimpleMontageProps = {
      title: 'T', videoUrl: JUMEAU, rushMuted: true, sequenceVoiceUrls: { video: JUMEAU }, voixJumeau: true,
      introDuration: 0, cardsDuration: 0, ctaDuration: 0, videoDuration: 14, cards: [], musicUrl: MUSIQUE, musicVolume: 0.8,
    };
    expect(fenetreBrute(props, { ...reperes(props), fps: FPS })).toEqual({ debut: 0, fin: 14 });
  });
});
