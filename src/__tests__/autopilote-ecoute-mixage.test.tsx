import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import AutopilotPanel from '@/components/creer/AutopilotPanel';
import { DEFAULT_CONFIG, sanitizeConfig, pickRush, type AutopilotConfig } from '@/lib/autopilot/rules';
import { DEFAULT_SEQUENCE_SECONDS, RUSH_SEQUENCE_SECONDS } from '@/lib/creer/designSpec';
import { mixAt } from '../../remotion/audio';
import type { AudioKeyframe } from '@/lib/creer/audioDucking';

/**
 * « Écouter le mixage » dans l'Autopilote.
 *
 * Le lecteur (`AudioMixPreview`) est remplacé par un composant qui CAPTURE
 * ses props : ce qu'on vérifie, c'est ce que l'écran lui donne — musique,
 * rush, image-clé — et que ce sont les nombres que le rendu serveur
 * appliquera. Aucun Web Audio ici, jsdom n'en a pas.
 */

const propsRecues: Array<Record<string, unknown>> = [];
vi.mock('@/components/creer/AudioMixPreview', () => ({
  default: (props: Record<string, unknown>) => {
    propsRecues.push(props);
    return <div data-test-audio-mix-preview />;
  },
}));

const MUSIQUE = 'https://studiio.pro/storage/v1/object/public/media/u/musique.mp3';
const RUSH_A = 'https://studiio.pro/storage/v1/object/public/media/u/a.mp4';
const RUSH_B = 'https://studiio.pro/storage/v1/object/public/media/u/b.mp4';

let configServeur: AutopilotConfig = DEFAULT_CONFIG;
let envois: AutopilotConfig[] = [];

beforeEach(() => {
  propsRecues.length = 0;
  envois = [];
  configServeur = {
    ...DEFAULT_CONFIG,
    musicUrl: MUSIQUE,
    rushUrls: [RUSH_A, RUSH_B],
    lastRushUrl: RUSH_A,
    keepRushAudio: true,
    musicVolume: 0.6,
    voiceVolume: 0.9,
    rushVolume: 0.35,
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('/api/voice/clone')) {
      return { ok: true, json: async () => ({ success: true, voices: [] }) };
    }
    if (u.startsWith('/api/autopilot/config')) {
      if (init?.method === 'PUT') {
        const recu = sanitizeConfig(JSON.parse(String(init.body)));
        envois.push(recu);
        configServeur = recu;
        return { ok: true, json: async () => ({ success: true, config: recu }) };
      }
      return { ok: true, json: async () => ({ success: true, ready: true, config: configServeur }) };
    }
    return { ok: true, json: async () => ({ success: true }) };
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function ouvrirStyle() {
  render(<AutopilotPanel accent="#7C3AED" />);
  await waitFor(() => expect(screen.getByText('Sujets')).toBeTruthy());
  fireEvent.click(document.querySelector('[data-autopilot-etape="2"]') as Element);
  await waitFor(() => expect(screen.getByText('À quoi ressembleront vos vidéos ?')).toBeTruthy());
  // La configuration du serveur est arrivée : le curseur musique est à 60.
  await waitFor(() => expect((document.querySelector('[data-autopilot-volume="musicVolume"]') as HTMLInputElement).value).toBe('60'));
}

/** Déplie (ou replie) « Réglages avancés » comme le navigateur le ferait. */
async function basculerAvance(ouvrir: boolean) {
  const details = document.querySelector('[data-autopilot-style-avance]') as HTMLDetailsElement;
  await act(async () => {
    details.open = ouvrir;
    details.dispatchEvent(new Event('toggle'));
  });
}

function dernieresProps() {
  expect(propsRecues.length).toBeGreaterThan(0);
  return propsRecues[propsRecues.length - 1];
}

// ─────────────────────────────────────────────────────────────────────────
describe('A — le lecteur n existe que dans le bloc déplié', () => {
  it('replié : pas de lecteur ; déplié : le lecteur ; replié à nouveau : plus de lecteur', async () => {
    await ouvrirStyle();
    expect(document.querySelector('[data-test-audio-mix-preview]')).toBeNull();
    expect(document.querySelector('[data-autopilot-ecoute-mixage]')).toBeNull();

    await basculerAvance(true);
    await waitFor(() => expect(document.querySelector('[data-test-audio-mix-preview]')).toBeTruthy());

    await basculerAvance(false);
    await waitFor(() => expect(document.querySelector('[data-test-audio-mix-preview]')).toBeNull());
  });

  it('sur une autre étape, le lecteur est démonté', async () => {
    await ouvrirStyle();
    await basculerAvance(true);
    await waitFor(() => expect(document.querySelector('[data-test-audio-mix-preview]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-autopilot-etape="1"]') as Element);
    await waitFor(() => expect(document.querySelector('[data-test-audio-mix-preview]')).toBeNull());
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('B — ce que le lecteur reçoit', () => {
  it('la musique du compte, le PROCHAIN rush de la rotation, aucune voix, les durées par défaut', async () => {
    await ouvrirStyle();
    await basculerAvance(true);
    await waitFor(() => expect(document.querySelector('[data-test-audio-mix-preview]')).toBeTruthy());
    const p = dernieresProps();

    expect(p.musicUrl).toBe(MUSIQUE);
    // Le dernier rush utilisé est A : le cron prendra B — et c'est B qu'on écoute.
    expect(p.rushUrl).toBe(RUSH_B);
    expect(p.rushUrl).toBe(pickRush([RUSH_A, RUSH_B], RUSH_A, 0));
    expect(p.voiceUrl).toBeNull();
    expect(p.sequenceVoiceUrls).toBeUndefined();

    const { intro, cards, cta } = DEFAULT_SEQUENCE_SECONDS;
    const video = RUSH_SEQUENCE_SECONDS.fallback;
    expect(p.introDuration).toBe(intro);
    expect(p.cardsDuration).toBe(cards);
    expect(p.ctaDuration).toBe(cta);
    expect(p.videoSeqStart).toBe(intro + cards);
    expect(p.videoSeqDuration).toBe(video);
    expect(p.totalDuration).toBe(intro + cards + video + cta);

    const kf = p.audioKeyframes as AudioKeyframe[];
    expect(kf).toHaveLength(1);
    expect(kf[0]).toMatchObject({ time: 0, musicVolume: 0.6, rushVolume: 0.35, voiceVolume: 0.9 });
  });

  it('les images-clés gardent la même identité tant que les niveaux ne bougent pas', async () => {
    await ouvrirStyle();
    await basculerAvance(true);
    await waitFor(() => expect(document.querySelector('[data-test-audio-mix-preview]')).toBeTruthy());
    const avant = dernieresProps().audioKeyframes;
    // Un rendu sans rapport avec le mixeur : le fond des cartes.
    fireEvent.click(document.querySelector('[data-autopilot-cards-poster]') as Element);
    await waitFor(() => expect(envois.length).toBe(1));
    expect(dernieresProps().audioKeyframes).toBe(avant);
  });

  it('l image-clé suit les curseurs du mixeur', async () => {
    await ouvrirStyle();
    await basculerAvance(true);
    await waitFor(() => expect(document.querySelector('[data-test-audio-mix-preview]')).toBeTruthy());

    const musique = document.querySelector('[data-autopilot-volume="musicVolume"]') as HTMLInputElement;
    fireEvent.change(musique, { target: { value: '20' } });
    await waitFor(() => expect((dernieresProps().audioKeyframes as AudioKeyframe[])[0].musicVolume).toBeCloseTo(0.2));

    const rush = document.querySelector('[data-autopilot-volume="rushVolume"]') as HTMLInputElement;
    fireEvent.change(rush, { target: { value: '80' } });
    await waitFor(() => expect((dernieresProps().audioKeyframes as AudioKeyframe[])[0].rushVolume).toBeCloseTo(0.8));
  });

  it('son du rush coupé : rush à 0 dans l image-clé et aucun rush donné au lecteur', async () => {
    await ouvrirStyle();
    await basculerAvance(true);
    await waitFor(() => expect(document.querySelector('[data-test-audio-mix-preview]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-autopilot-keep-rush-audio]') as Element);
    await waitFor(() => expect(dernieresProps().rushUrl).toBeNull());
    const kf = dernieresProps().audioKeyframes as AudioKeyframe[];
    expect(kf[0].rushVolume).toBe(0);
    // La musique reste : le lecteur est toujours là.
    expect(dernieresProps().musicUrl).toBe(MUSIQUE);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('C — les textes qui disent ce que l écoute ne peut pas faire', () => {
  it('voix activée : la note dit qu elle n est pas incluse — et rien n est généré', async () => {
    configServeur = { ...configServeur, voiceEnabled: true };
    await ouvrirStyle();
    await basculerAvance(true);
    await waitFor(() => expect(document.querySelector('[data-autopilot-ecoute-voix]')).toBeTruthy());
    expect(screen.getByText(/Voix off non incluse dans l’écoute/)).toBeTruthy();
    expect(dernieresProps().voiceUrl).toBeNull();
    const appels = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));
    expect(appels.some((u) => u.includes('/api/tts') || u.includes('/api/voice/synth'))).toBe(false);
  });

  it('voix désactivée : pas de note', async () => {
    await ouvrirStyle();
    await basculerAvance(true);
    await waitFor(() => expect(document.querySelector('[data-test-audio-mix-preview]')).toBeTruthy());
    expect(document.querySelector('[data-autopilot-ecoute-voix]')).toBeNull();
  });

  it('rien à écouter (ni musique, ni son du rush gardé) : l invitation, pas de lecteur', async () => {
    configServeur = { ...configServeur, musicUrl: null, keepRushAudio: false };
    await ouvrirStyle();
    await basculerAvance(true);
    await waitFor(() => expect(document.querySelector('[data-autopilot-ecoute-vide]')).toBeTruthy());
    expect(screen.getByText(/Ajoutez une musique ou gardez le son du rush/)).toBeTruthy();
    expect(document.querySelector('[data-test-audio-mix-preview]')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('D — parité avec le rendu serveur', () => {
  /** L'image-clé de l'écran, construite comme dans `AutopilotPanel`. */
  function imageCle(c: Pick<AutopilotConfig, 'musicVolume' | 'rushVolume' | 'voiceVolume' | 'keepRushAudio'>): AudioKeyframe {
    return {
      id: 'autopilote-0', time: 0,
      musicVolume: c.musicVolume,
      rushVolume: c.keepRushAudio ? c.rushVolume : 0,
      voiceVolume: c.voiceVolume,
    };
  }

  it('mixAt(0) sur les volumes statiques du cron donne les nombres de l image-clé', () => {
    for (const keepRushAudio of [true, false]) {
      const c = { musicVolume: 0.6, voiceVolume: 0.9, rushVolume: 0.35, keepRushAudio };
      // Ce que `buildAutopilotDesign` transmet : trois volumes statiques et
      // `rushMuted` ; le rendu coupe le rush par `rushMuted`, soit un niveau 0.
      const serveur = mixAt(0, {
        musicVolume: c.musicVolume,
        voiceVolume: c.voiceVolume,
        rushVolume: keepRushAudio ? c.rushVolume : 0,
        hasVoice: true,
        hasMixAudio: true,
      });
      const kf = imageCle(c);
      expect(serveur.music).toBe(kf.musicVolume);
      expect(serveur.rush).toBe(kf.rushVolume);
      expect(serveur.voice).toBe(kf.voiceVolume);
    }
  });

  it('et l image-clé, donnée à mixAt, rend les mêmes nombres que les statiques', () => {
    const c = { musicVolume: 0.6, voiceVolume: 0.9, rushVolume: 0.35, keepRushAudio: true };
    const kf = imageCle(c);
    const parImageCle = mixAt(0, { keyframes: [kf], hasVoice: true, hasMixAudio: true });
    const parStatiques = mixAt(0, { musicVolume: 0.6, voiceVolume: 0.9, rushVolume: 0.35, hasVoice: true, hasMixAudio: true });
    expect(parImageCle.music).toBe(parStatiques.music);
    expect(parImageCle.rush).toBe(parStatiques.rush);
    expect(parImageCle.voice).toBe(parStatiques.voice);
  });
});
