import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  maskToSegments,
  applyVoiceDucking,
  sampleKeyframes,
  type AudioKeyframe,
} from '../lib/creer/audioDucking';

/**
 * La musique baisse quand la voix off parle.
 *
 * L'auto-mix ne savait le faire que pour le RUSH. L'étendre à la voix pose
 * une difficulté qui n'existait pas : **deux sources de ducking doivent
 * cohabiter sur une seule courbe**. Si la passe « voix » réécrit la courbe
 * du rush, elle peut remonter la musique au milieu d'une phrase du rush —
 * exactement l'inverse de ce qu'on veut.
 *
 * D'où le choix d'une passe PURE appliquée par-dessus : le rush n'est pas
 * modifié d'une ligne, et `Math.min` garantit qu'on ne remonte jamais un
 * passage déjà baissé. C'est ce que ces tests gardent.
 */

const KF = (time: number, music: number, rush = 0.5, voice = 1): AudioKeyframe => ({
  id: `k-${time}`,
  time,
  musicVolume: music,
  rushVolume: rush,
  voiceVolume: voice,
});

describe('maskToSegments — où ça parle', () => {
  it('transforme un masque en intervalles', () => {
    expect(maskToSegments([false, true, true, false, true], 0.5)).toEqual([
      { start: 0.5, end: 1.5 },
      { start: 2, end: 2.5 },
    ]);
  });

  it('ferme un segment encore ouvert à la fin de la piste', () => {
    // Sans cela, une voix qui parle jusqu'au dernier échantillon ne
    // produirait aucun segment — et ne ducquerait rien.
    expect(maskToSegments([false, true, true], 1)).toEqual([{ start: 1, end: 3 }]);
  });

  it('ne rend rien sur du silence', () => {
    expect(maskToSegments([false, false], 0.5)).toEqual([]);
    expect(maskToSegments([], 0.5)).toEqual([]);
  });
});

describe('La musique descend pendant la voix, puis remonte', () => {
  it('baisse à l’entrée et rétablit à la sortie', () => {
    const curve = [KF(0, 1)];
    const out = applyVoiceDucking(curve, [{ start: 2, end: 4 }], { totalDuration: 10 });
    expect(sampleKeyframes(out, 1).musicVolume).toBe(1);
    expect(sampleKeyframes(out, 3).musicVolume).toBeLessThan(1);
    // Remontée : c'est la moitié de la promesse.
    expect(sampleKeyframes(out, 5).musicVolume).toBe(1);
  });

  it('respecte le niveau de musique choisi', () => {
    // L'utilisateur a mis la musique à 60 % : ducker doit descendre SOUS
    // 60 %, pas revenir à un absolu qui l'ignorerait.
    const out = applyVoiceDucking([KF(0, 0.6)], [{ start: 1, end: 2 }], { totalDuration: 10 });
    expect(sampleKeyframes(out, 1.5).musicVolume).toBeLessThan(0.6);
    expect(sampleKeyframes(out, 3).musicVolume).toBe(0.6);
  });

  it('gère plusieurs phrases', () => {
    const out = applyVoiceDucking(
      [KF(0, 1)],
      [{ start: 1, end: 2 }, { start: 5, end: 6 }],
      { totalDuration: 10 },
    );
    expect(sampleKeyframes(out, 1.5).musicVolume).toBeLessThan(1);
    expect(sampleKeyframes(out, 3).musicVolume).toBe(1);
    expect(sampleKeyframes(out, 5.5).musicVolume).toBeLessThan(1);
    expect(sampleKeyframes(out, 7).musicVolume).toBe(1);
  });
});

describe('La courbe du rush n’est jamais abîmée', () => {
  /** Une courbe d'auto-mix typique : le rush parle de 4 à 8 s. */
  const rushCurve = [KF(0, 1), KF(4, 0.25, 1), KF(8, 1, 0.5)];

  it('ne remonte pas la musique au milieu d’une phrase du rush', () => {
    // Le piège : la voix se tait à 6 s, en plein duck du rush. Rétablir
    // « ce que disait la courbe » doit rendre 0.25, pas 1.
    const out = applyVoiceDucking(rushCurve, [{ start: 5, end: 6 }], { totalDuration: 12 });
    expect(sampleKeyframes(out, 6.5).musicVolume).toBe(0.25);
    expect(sampleKeyframes(out, 9).musicVolume).toBe(1);
  });

  it('ne touche ni au son du rush ni à celui de la voix', () => {
    // Deux réglages que la voix n'a aucune raison de modifier.
    const out = applyVoiceDucking(rushCurve, [{ start: 1, end: 2 }], { totalDuration: 12 });
    expect(sampleKeyframes(out, 5).rushVolume).toBe(1);
    expect(sampleKeyframes(out, 9).rushVolume).toBe(0.5);
    for (const k of out) expect(k.voiceVolume).toBe(1);
  });

  it('garde la courbe intacte quand la voix ne parle pas', () => {
    // Rendre l'objet d'origine, et pas une copie remaniée, c'est la
    // garantie qu'un export sans voix est identique à celui d'avant.
    expect(applyVoiceDucking(rushCurve, [], { totalDuration: 12 })).toBe(rushCurve);
  });

  it('produit une courbe ordonnée et sans doublon d’instant', () => {
    // Deux keyframes au même instant rendraient l'échantillonnage du
    // compositeur dépendant de l'ordre d'insertion.
    const out = applyVoiceDucking(rushCurve, [{ start: 4, end: 8 }], { totalDuration: 12 });
    const times = out.map((k) => k.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(new Set(times).size).toBe(times.length);
  });

  it('ignore ce qui déborde du montage', () => {
    // Une voix plus longue que le montage ne doit pas poser de keyframes
    // au-delà de la fin.
    const out = applyVoiceDucking([KF(0, 1)], [{ start: 20, end: 30 }], { totalDuration: 10 });
    expect(out.every((k) => k.time < 10)).toBe(true);
  });
});

describe('Default-safe', () => {
  const panel = readFileSync(
    resolve(__dirname, '../components/creer/AudioStudioPanel.tsx'),
    'utf-8',
  );
  const timeline = readFileSync(
    resolve(__dirname, '../components/creer/AudioDuckingTimeline.tsx'),
    'utf-8',
  );

  it('l’interrupteur est éteint par défaut', () => {
    // Tant qu'il n'est pas allumé, l'auto-mix se comporte exactement comme
    // avant : il ne ducke que sur le rush.
    expect(panel).toMatch(/const \[duckOnVoice, setDuckOnVoice\] = useState\(false\)/);
  });

  it('n’analyse la voix que si l’interrupteur est allumé ET qu’une voix existe', () => {
    expect(panel).toMatch(/const duckVoice = duckOnVoice && !!voiceUrl;/);
    expect(panel).toMatch(/if \(duckVoice\) \{/);
  });

  it('l’auto-mix du rush reste inchangé', () => {
    // La passe voix s'applique APRÈS, sur le résultat — le calcul du rush
    // n'est pas réécrit.
    const idxRush = panel.indexOf('analyseRushForDucking(rushUrl!)');
    const idxVoice = panel.indexOf('detectVoiceSpeech(voiceUrl!)');
    expect(idxRush).toBeGreaterThan(-1);
    expect(idxVoice).toBeGreaterThan(idxRush);
    expect(panel).toMatch(/curve = applyVoiceDucking\(curve, segments, \{ totalDuration \}\)/);
  });

  it('l’interrupteur disparaît pour un parent qui ne le gère pas', () => {
    // `/dashboard/creer` monte ce composant sans ces props : il ne doit
    // rien voir de nouveau.
    expect(timeline).toMatch(/typeof duckOnVoice === 'boolean' && onDuckOnVoiceChange &&/);
    const creer = readFileSync(
      resolve(__dirname, '../app/dashboard/creer/page.tsx'),
      'utf-8',
    );
    expect(creer).not.toMatch(/duckOnVoice/);
  });

  it('l’interrupteur est grisé sans voix off', () => {
    expect(timeline).toMatch(/disabled=\{!hasVoice\}/);
    expect(panel).toMatch(/hasVoice=\{!!voiceUrl\}/);
  });

  it('utilise une icône lucide, pas un emoji', () => {
    const bloc = timeline.slice(
      timeline.indexOf("aria-label=\"Musique s'adapte à la voix\""),
      timeline.indexOf('</button>', timeline.indexOf("aria-label=\"Musique s'adapte à la voix\"")),
    );
    expect(bloc).toMatch(/<Mic size=\{11\}/);
    // Aucun caractère hors du plan multilingue de base (les emojis y sont).
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(bloc)).toBe(false);
  });
});

describe('Le compositeur lit la courbe sans rien savoir de tout ça', () => {
  it('`sampleKeyframes` rend les trois volumes, comme avant', () => {
    // Le pipeline d'export n'est pas touché : la passe voix ne fait que
    // produire des keyframes de la même forme.
    const out = applyVoiceDucking([KF(0, 1)], [{ start: 1, end: 2 }], { totalDuration: 5 });
    for (const k of out) {
      expect(Object.keys(k).sort()).toEqual(
        ['id', 'musicVolume', 'rushVolume', 'time', 'voiceVolume'],
      );
    }
    const s = sampleKeyframes(out, 1.5);
    expect(s).toHaveProperty('musicVolume');
    expect(s).toHaveProperty('rushVolume');
    expect(s).toHaveProperty('voiceVolume');
  });

  it('la voix off garde son propre volume', () => {
    // Ducker la musique ne doit pas baisser la voix : ce serait absurde.
    const out = applyVoiceDucking([KF(0, 1, 0.5, 0.8)], [{ start: 1, end: 2 }], { totalDuration: 5 });
    expect(sampleKeyframes(out, 1.5).voiceVolume).toBe(0.8);
  });
});
