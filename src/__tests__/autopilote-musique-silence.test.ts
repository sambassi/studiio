/**
 * LE BLANC AU DÉBUT D'UNE MUSIQUE.
 *
 * ---------------------------------------------------------------------------
 * ⚠️ LA MESURE QUI A DÉCIDÉ DE L'IMPLÉMENTATION
 * ---------------------------------------------------------------------------
 *
 * Le premier réflexe était `-ss` à l'entrée de ffmpeg : une option, zéro
 * fichier, zéro passe. Banc réel (ffmpeg 8.1, fichier « 2 s de silence + 3 s
 * de sinus », `-stream_loop -1 -ss 2 -i`) :
 *
 *   silence_start: 1.999  silence_start: 5.999  silence_start: 9.999 …
 *
 * Le silence REVENAIT à chaque tour de boucle : la boucle rejoue le fichier
 * depuis son début, pas depuis le point de recherche. Le même fichier COUPÉ
 * avant d'être bouclé donne zéro silence détecté. D'où une vraie coupe, dans
 * le dossier temporaire du rendu.
 *
 * Ces tests portent sur la partie PURE — celle qui décide. Elle se teste sans
 * ffmpeg, sur des sorties `silencedetect` telles qu'elles arrivent.
 */
import { describe, it, expect } from 'vitest';
import {
  silenceInitialSecondes, argumentsMesureSilence, argumentsCoupeSilence,
  SEUIL_SILENCE_MUSIQUE_DB, SILENCE_INITIAL_MIN_MS, MUSIQUE_TRIM_PREROLL_MS,
} from '@/lib/autopilot/analyse/musique-silence';

const sortie = (lignes: string[]) => lignes
  .map((l) => `[silencedetect @ 0x7f] ${l}`).join('\n');

// ═══════════════════════════════════════════════════════════════════════════
describe('1. Ce qui est coupé', () => {
  it('1.1 un blanc de 2 s au tout début', () => {
    const s = silenceInitialSecondes(sortie([
      'silence_start: 0',
      'silence_end: 2.0 | silence_duration: 2.0',
    ]));
    expect(s).toBe(2 - MUSIQUE_TRIM_PREROLL_MS / 1000);
  });

  it('1.2 le préroll garde l’attaque de la première note', () => {
    // Couper au sample près mange le début d'une percussion : `silencedetect`
    // place la fin du silence au premier échantillon AU-DESSUS du seuil.
    expect(MUSIQUE_TRIM_PREROLL_MS).toBe(50);
    expect(silenceInitialSecondes(sortie([
      'silence_start: 0', 'silence_end: 1.5',
    ]))).toBe(1.45);
  });

  it('1.3 un `silence_start` à 0.0000 compte comme le tout début', () => {
    expect(silenceInitialSecondes(sortie([
      'silence_start: 0.02', 'silence_end: 3.2',
    ]))).toBeGreaterThan(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. Ce qui n’est JAMAIS coupé', () => {
  it('2.1 une pause INTERNE — la couper décalerait tout le morceau', () => {
    expect(silenceInitialSecondes(sortie([
      'silence_start: 12.4',
      'silence_end: 14.0 | silence_duration: 1.6',
    ]))).toBe(0);
  });

  it('2.2 un silence de FIN', () => {
    expect(silenceInitialSecondes(sortie([
      'silence_start: 178.2', 'silence_end: 180.0',
    ]))).toBe(0);
  });

  it('2.3 un blanc trop court pour être gênant', () => {
    // 0,2 s moins le préroll : sous le plancher, donc rien.
    expect(silenceInitialSecondes(sortie([
      'silence_start: 0', 'silence_end: 0.2',
    ]))).toBe(0);
  });

  it('2.4 aucune détection : on ne coupe rien', () => {
    expect(silenceInitialSecondes('')).toBe(0);
    expect(silenceInitialSecondes('ffmpeg version 8.1\nStream #0:0: Audio')).toBe(0);
  });

  it('2.5 un début sans fin — mesure incomplète, donc aucune coupe', () => {
    expect(silenceInitialSecondes(sortie(['silence_start: 0']))).toBe(0);
  });

  it('2.6 une sortie incohérente ne devient pas une coupe', () => {
    expect(silenceInitialSecondes(sortie([
      'silence_start: 0', 'silence_end: -4',
    ]))).toBe(0);
    expect(silenceInitialSecondes(sortie([
      'silence_start: abc', 'silence_end: xyz',
    ]))).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. Le seuil ne confond pas « doux » et « rien »', () => {
  it('3.1 −50 dB, pas −35 dB', () => {
    // ⚠️ −35 dB est le seuil des RUSHES PARLÉS. Appliqué à une musique, une
    // nappe d'intro ou un fondu d'entrée passerait pour du vide et serait
    // coupé — on supprimerait l'intro que l'auteur a voulue.
    expect(SEUIL_SILENCE_MUSIQUE_DB).toBe(-50);
    expect(argumentsMesureSilence('/tmp/m.mp3').join(' '))
      .toContain('silencedetect=n=-50dB');
  });

  it('3.2 le plancher de durée est passé à ffmpeg, pas seulement vérifié après', () => {
    expect(SILENCE_INITIAL_MIN_MS).toBe(300);
    expect(argumentsMesureSilence('/tmp/m.mp3').join(' ')).toContain(':d=0.3');
  });

  it('3.3 la mesure n’écrit aucun fichier', () => {
    // `-f null -` : le muxer jette tout. La mesure vit dans stderr, pas
    // dans un fichier qu'il faudrait ensuite purger.
    expect(argumentsMesureSilence('/tmp/m.mp3').slice(-3)).toEqual(['-f', 'null', '-']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. La coupe elle-même', () => {
  const args = argumentsCoupeSilence('/tmp/m.mp3', '/tmp/m-sans-blanc.wav', 1.95);

  it('4.1 `atrim` en filtre, jamais `-ss` en entrée', () => {
    // Mesuré : `-ss` + `-c copy` s'aligne sur l'image-clé la plus proche et
    // rend un fichier plus court que demandé. Le filtre coupe au sample près.
    expect(args.join(' ')).toContain('atrim=start=1.950');
    expect(args).not.toContain('-ss');
    expect(args).not.toContain('copy');
  });

  it('4.2 l’horloge est remise à zéro', () => {
    // Sans `asetpts`, la piste garde son décalage et le blanc revient.
    expect(args.join(' ')).toContain('asetpts=PTS-STARTPTS');
  });

  it('4.3 la source et la destination sont distinctes', () => {
    // ⚠️ LE FICHIER DE L'UTILISATEUR N'EST JAMAIS TOUCHÉ.
    expect(args).toContain('/tmp/m.mp3');
    expect(args).toContain('/tmp/m-sans-blanc.wav');
    expect(args[args.length - 1]).toBe('/tmp/m-sans-blanc.wav');
  });

  it('4.4 aucune seconde génération de compression', () => {
    expect(args.join(' ')).toContain('-c:a pcm_s16le');
  });
});
