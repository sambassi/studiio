/**
 * A2 — LA VOIX DU JUMEAU EST AUDIBLE, LA MUSIQUE BAISSE SOUS ELLE.
 *
 * Défaut D4 (audit vidéo) : la vidéo du jumeau passait par le canal « son du
 * rush » (0,5) et la musique restait à 0,8 sans baisse — voix ≈ 4 dB SOUS la
 * musique sur la vidéo STRESS. Le réglage « voix » n'agissait pas sur l'avatar.
 *
 * 1. Caractérisation : SANS jumeau, design et volumes rendus identiques.
 * 2. Jumeau (mono) : piste au niveau des VOIX, musique ×0,1 pendant sa
 *    séquence, rampes de 0,25 s, retour au niveau nominal ensuite.
 * 3. Multi-sources avec jumeau : même fenêtre (voix continue dès 0).
 * 4. Pas de séquence vidéo / pas de vidéo : aucun ducking.
 * 5. Réglages explicites de l'utilisateur conservés.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, waitFor, cleanup } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

type Pistes = { kind: 'audio' | 'video'; src: string; from: number; volume: unknown }[];
const pistes: Pistes = [];
vi.mock('remotion', async () => {
  const R = await import('react');
  const Ctx = R.createContext(0);
  const Div = ({ children }: { children?: React.ReactNode }) => R.createElement('div', null, children);
  const piste = (kind: 'audio' | 'video') => function Piste({ src, volume }: { src: string; volume?: unknown }) {
    const from = R.useContext(Ctx);
    pistes.push({ kind, src, from, volume });
    return null;
  };
  return {
    AbsoluteFill: Div,
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
// Morceau plus long que le montage : une seule passe, frame ABSOLUE.
vi.mock('@remotion/media-utils', () => ({ getAudioDurationInSeconds: async () => 188 }));

import { CreerSimpleMontage, fenetreVoixJumeau as fenetreBrute, planFromProps, type CreerSimpleMontageProps } from '../../remotion/CreerSimpleMontage';
import { sequenceFrameOffsets, totalDurationFrames } from '@/lib/creer/designSpec';
import { baseSequenceFrames, transitionFrames } from '../../remotion/transitions';
import { facteurMusiqueJumeau, mixAt, DUCK_MUSIQUE_JUMEAU, RAMPE_DUCK_JUMEAU_S } from '../../remotion/audio';
import { buildAutopilotDesign } from '@/lib/autopilot/design';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import { versEntreeRemotion } from '@/lib/render/spec-rendu';

const MUSIQUE = 'https://cdn.test/musique.mp3';
const RUSH = 'https://cdn.test/rush.mp4';
const JUMEAU = 'https://cdn.test/avatar/j.mp4';
const FPS = 30;

/** Les repères que la composition calcule une fois, puis la fenêtre. */
function fenetreVoixJumeau(props: CreerSimpleMontageProps, fps: number) {
  const sequences = planFromProps(props);
  const offsets = sequenceFrameOffsets(sequences, fps);
  const base = baseSequenceFrames(offsets, totalDurationFrames(sequences, fps));
  return fenetreBrute(props, { sequences, offsets, base, tFrames: transitionFrames(base, fps), fps });
}

const post = {
  title: 'Sujet', content: { subtitle: 's', cards: [{ title: 'a', description: 'b', value: '1' }], tagLine: 'cta' }, rushUrl: RUSH,
} as unknown as Parameters<typeof buildAutopilotDesign>[0];
const config = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG, musicUrl: MUSIQUE, musicVolume: 0.8, voiceVolume: 1, rushVolume: 0.5, keepRushAudio: true, ...p,
});

async function rendre(props: CreerSimpleMontageProps) {
  pistes.length = 0;
  render(<CreerSimpleMontage {...props} />);
  await waitFor(() => expect(pistes.some((p) => p.src === MUSIQUE)).toBe(true));
  const vol = (src: string, kind: 'audio' | 'video') => {
    const p = [...pistes].reverse().find((x) => x.src === src && x.kind === kind);
    if (!p) throw new Error(`piste absente ${kind} ${src}`);
    const f = p.volume as (frame: number) => number;
    // Volume à l'instant ABSOLU t (secondes), quelle que soit la Sequence hôte.
    return (t: number) => f(Math.round(t * FPS) - p.from);
  };
  return { vol };
}

beforeEach(() => { cleanup(); pistes.length = 0; });

describe('A2 — parité avec le compositeur canvas', () => {
  it('mêmes constantes que video-composer (×0,1, rampes 0,25 s)', () => {
    const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');
    expect(composer).toContain(`export const DUCK_MUSIQUE_JUMEAU = ${DUCK_MUSIQUE_JUMEAU};`);
    expect(composer).toContain(`const RAMPE_DUCK_S = ${RAMPE_DUCK_JUMEAU_S};`);
  });

  it('facteur : 1 hors fenêtre, 0,1 dedans, rampes linéaires', () => {
    const f = { debut: 10, fin: 20 };
    expect(facteurMusiqueJumeau(5, f)).toBe(1);
    expect(facteurMusiqueJumeau(9.75, f)).toBe(1);
    expect(facteurMusiqueJumeau(9.875, f)).toBeCloseTo(0.55, 6);
    expect(facteurMusiqueJumeau(10, f)).toBe(0.1);
    expect(facteurMusiqueJumeau(20, f)).toBe(0.1);
    expect(facteurMusiqueJumeau(20.125, f)).toBeCloseTo(0.55, 6);
    expect(facteurMusiqueJumeau(20.25, f)).toBe(1);
    expect(facteurMusiqueJumeau(30, f)).toBe(1);
    expect(facteurMusiqueJumeau(15, null)).toBe(1);
  });
});

describe('A2 — caractérisation SANS jumeau (identique)', () => {
  it('design : aucune clé voixJumeau, rush au niveau « rush »', () => {
    const d = buildAutopilotDesign(post, { config: config(), rushSeconds: 6 });
    expect('voixJumeau' in d).toBe(false);
    expect(fenetreVoixJumeau(versEntreeRemotion(d), FPS)).toBeNull();
  });

  it('volumes rendus : ceux de mixAt, sans aucun facteur', async () => {
    const d = versEntreeRemotion(buildAutopilotDesign(post, { config: config(), rushSeconds: 6 }));
    const { vol } = await rendre(d);
    const mo = { musicVolume: 0.8, voiceVolume: 1, rushVolume: 0.5, hasVoice: false, hasMixAudio: true };
    for (const t of [0, 3, 9.5, 10.2, 13, 15.9]) expect(vol(MUSIQUE, 'audio')(t)).toBe(mixAt(t, mo).music);
    expect(vol(RUSH, 'video')(12)).toBe(0.5);
  });
});

describe('A2 — jumeau monté (chemin mono)', () => {
  const jumeau = { videoUrl: JUMEAU, seconds: 12.3 };
  // intro 4 s + cartes 6 s → vidéo nominale à 10 s, 13 s ; raccord 0,8 s
  // (24 images) : la piste du jumeau démarre à 9,2 s.
  it('design : voixJumeau posé, rush non coupé', () => {
    const d = buildAutopilotDesign(post, { config: config(), jumeau });
    expect(d.voixJumeau).toBe(true);
    expect(d.rushMuted).toBe(false);
    const f = fenetreVoixJumeau(versEntreeRemotion(d), FPS)!;
    expect(f.debut).toBeCloseTo(9.2, 6);
    expect(f.fin).toBeCloseTo(23, 6);
  });

  it('piste du jumeau au niveau des VOIX (1), plus au niveau « rush » (0,5)', async () => {
    const { vol } = await rendre(versEntreeRemotion(buildAutopilotDesign(post, { config: config(), jumeau })));
    expect(vol(JUMEAU, 'video')(12)).toBe(1);
  });

  it('musique : 0,8 avant, ×0,1 pendant, rampes, 0,8 après', async () => {
    const { vol } = await rendre(versEntreeRemotion(buildAutopilotDesign(post, { config: config(), jumeau })));
    const m = vol(MUSIQUE, 'audio');
    expect(m(5)).toBeCloseTo(0.8, 6);
    expect(m(8.9)).toBeCloseTo(0.8, 6);
    expect(m(9.2)).toBeCloseTo(0.08, 6);
    expect(m(15)).toBeCloseTo(0.08, 6);
    expect(m(23)).toBeCloseTo(0.08, 6);
    const montee = m(23.1);
    expect(montee).toBeGreaterThan(0.08);
    expect(montee).toBeLessThan(0.8);
    expect(m(23.3)).toBeCloseTo(0.8, 6);
    expect(m(26)).toBeCloseTo(0.8, 6);
  });

  it('réglages explicites conservés : voix 0,7 → avatar 0,7 ; musique 0,6 → 0,06 dessous, 0,6 hors', async () => {
    const { vol } = await rendre(versEntreeRemotion(buildAutopilotDesign(post, { config: config({ voiceVolume: 0.7, musicVolume: 0.6 }), jumeau })));
    expect(vol(JUMEAU, 'video')(12)).toBeCloseTo(0.7, 6);
    expect(vol(MUSIQUE, 'audio')(15)).toBeCloseTo(0.06, 6);
    expect(vol(MUSIQUE, 'audio')(2)).toBeCloseTo(0.6, 6);
  });

  it('images-clés de l’utilisateur conservées hors fenêtre, multipliées dedans', async () => {
    const d = versEntreeRemotion(buildAutopilotDesign(post, { config: config(), jumeau }));
    const { vol } = await rendre({ ...d, audioKeyframes: [{ id: 'k', time: 0, musicVolume: 0.4, rushVolume: 1, voiceVolume: 1 }] });
    expect(vol(MUSIQUE, 'audio')(2)).toBeCloseTo(0.4, 6);
    expect(vol(MUSIQUE, 'audio')(15)).toBeCloseTo(0.04, 6);
  });
});

describe('A2 — multi-sources avec jumeau', () => {
  it('voix continue dès 0 : musique baissée sur toute la séquence vidéo puis rendue', () => {
    const props: CreerSimpleMontageProps = {
      title: 'T', videoUrl: JUMEAU, rushMuted: true, sequenceVoiceUrls: { video: JUMEAU }, voixJumeau: true,
      introDuration: 0, cardsDuration: 0, ctaDuration: 0, videoDuration: 14, cards: [], musicUrl: MUSIQUE, musicVolume: 0.8,
    };
    const f = fenetreVoixJumeau(props, FPS)!;
    expect(f).toEqual({ debut: 0, fin: 14 });
    const mo = { musicVolume: 0.8, hasVoice: true, hasMixAudio: true };
    expect(mixAt(5, mo).music * facteurMusiqueJumeau(5, f)).toBeCloseTo(0.08, 6);
    // la voix (VoixDeSequence) reste au niveau des voix
    expect(mixAt(5, { ...mo, voiceVolume: 0.9 }).voice).toBe(0.9);
  });

  it('le design multi-sources hérite de voixJumeau (étalement de designBase)', () => {
    const base = buildAutopilotDesign(post, { config: config(), jumeau: { videoUrl: JUMEAU, seconds: 14 } });
    const multi = { ...base, rushMuted: true, sequenceVoiceUrls: { video: JUMEAU } };
    expect(multi.voixJumeau).toBe(true);
  });
});

describe('A2 — pas de ducking inutile', () => {
  it('voixJumeau sans vidéo ou sans séquence vidéo : aucune fenêtre', () => {
    expect(fenetreVoixJumeau({ title: 'T', cards: [], voixJumeau: true, videoUrl: null, introDuration: 4, cardsDuration: 0, videoDuration: 0, ctaDuration: 4 }, FPS)).toBeNull();
    expect(fenetreVoixJumeau({ title: 'T', cards: [], voixJumeau: true, videoUrl: JUMEAU, videoDuration: 0, introDuration: 4, cardsDuration: 0, ctaDuration: 4 }, FPS)).toBeNull();
  });
});
