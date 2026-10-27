/**
 * RÉGRESSION — la durée d'une voix off Autopilote doit se lire sur un VRAI
 * fichier local, sans mock.
 *
 * ⚠️ POURQUOI CE FICHIER EXISTE. `contracts/voice.contract.test.ts` mocke
 * entièrement `@remotion/media-parser` (`parseMedia: async () => ({
 * durationInSeconds: 3 })`), donc il ne peut jamais détecter une régression
 * dans l'appel réel. C'est exactement ce qui s'est passé en production le
 * 2026-10-27 : `dureeSecondes()` appelait `parseMedia({ src: cheminFichier,
 * ... })` SANS `reader: nodeReader`. Le lecteur par défaut est fondé sur
 * `fetch` (pensé pour une URL) ; donné un CHEMIN LOCAL, il échoue toujours.
 * L'exception était avalée, `dureeSecondes` rendait `null` pour les 4
 * séquences (titre, cartes, vidéo, CTA), et le MP4 final sortait avec la
 * musique mais SANS AUCUNE VOIX — sans qu'aucun test ne le voie, puisque
 * tous mockaient `parseMedia`.
 *
 * Ce test synthétise un VRAI MP3 avec ffmpeg (aucun réseau, aucun appel
 * TTS) et appelle `dureeSecondes` SANS mocker `@remotion/media-parser` :
 * c'est la seule façon de prouver que le chemin réel fonctionne.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { dureeSecondes } from '@/lib/autopilot/voice';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const FF: string = require('ffmpeg-static');
// Comme les autres tests « vrai ffmpeg » du dépôt : sauté si le binaire manque (CI dégradée).
const ffmpegPresent = typeof FF === 'string' && existsSync(FF);

describe.skipIf(!ffmpegPresent)('dureeSecondes() sur un VRAI fichier MP3 (sans mock parseMedia)', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'studiio-voix-duree-'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('un MP3 de ~3 s réellement synthétisé rend une durée lisible, pas null', async () => {
    const fichier = join(dir, 'voix-titre.mp3');
    execFileSync(FF, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=44100',
      '-codec:a', 'libmp3lame', fichier,
    ]);

    const seconds = await dureeSecondes(fichier);

    // ⚠️ C'EST EXACTEMENT LE BUG : avant le correctif, ceci rendait `null`
    // (le lecteur par défaut échoue sur un chemin local), et l'appelant
    // (`buildAutopilotVoices`) logguait « duree illisible pour titre, voix
    // ignoree » puis abandonnait la voix — silencieusement, pour les 4
    // séquences à la fois.
    expect(seconds).not.toBeNull();
    expect(seconds as number).toBeGreaterThan(2.5);
    expect(seconds as number).toBeLessThan(3.5);
  });

  it('une autre durée (≈1,5 s) se lit tout aussi fidèlement', async () => {
    const fichier = join(dir, 'voix-cta.mp3');
    execFileSync(FF, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1.5:sample_rate=44100',
      '-codec:a', 'libmp3lame', fichier,
    ]);

    const seconds = await dureeSecondes(fichier);
    expect(seconds).not.toBeNull();
    expect(seconds as number).toBeGreaterThan(1.2);
    expect(seconds as number).toBeLessThan(1.8);
  });

  it('un fichier illisible (pas un média) rend toujours null — le filet de sécurité reste intact', async () => {
    const fichier = join(dir, 'pas-un-mp3.mp3');
    writeFileSync(fichier, 'ceci n’est pas un fichier audio');

    const seconds = await dureeSecondes(fichier);
    expect(seconds).toBeNull();
  });

  it('un chemin inexistant rend null sans lever — un cycle ne doit jamais échouer sur ça', async () => {
    const seconds = await dureeSecondes(join(dir, 'absent.mp3'));
    expect(seconds).toBeNull();
  });
});
