import { describe, it, expect } from 'vitest';

/**
 * Tests de configuration du Video Composer.
 * On vérifie que les constantes critiques du fichier video-composer.ts
 * sont correctement définies pour éviter les régressions.
 */

// On lit le fichier source pour vérifier les configurations sans l'exécuter
// (le composer dépend de Canvas/MediaRecorder qui n'existent pas dans Node)
import { readFileSync } from 'fs';
import { resolve } from 'path';

const composerSource = readFileSync(
  resolve(__dirname, '../lib/video-composer.ts'),
  'utf-8'
);

describe('Video Composer Configuration', () => {
  it('doit préférer WebM (VP9/VP8) et NON MP4 pour le mode fast', () => {
    // Le fichier doit contenir les mimeTypes WebM en priorité
    expect(composerSource).toContain('video/webm');
    // S'assurer qu'on ne met pas MP4 en premier (bug Chrome connu)
    const webmIndex = composerSource.indexOf('video/webm');
    const mp4Index = composerSource.indexOf('video/mp4');
    if (mp4Index > -1) {
      expect(webmIndex).toBeLessThan(mp4Index);
    }
  });

  it('doit détecter le mode fast basé sur l\'absence d\'audio', () => {
    // La logique: useFastMode = !hasAudio
    expect(composerSource).toMatch(/useFastMode\s*=\s*!hasAudio/);
  });

  it('doit contenir le watchdog pour supporter les onglets en arrière-plan', () => {
    // Le watchdog timer est essentiel pour le mode real-time en background tab
    expect(composerSource).toContain('watchdog');
  });

  it('doit utiliser captureStream pour le mode fast', () => {
    expect(composerSource).toContain('captureStream');
    expect(composerSource).toContain('requestFrame');
  });

  it('doit gérer AudioContext pour le mode avec audio', () => {
    expect(composerSource).toContain('AudioContext');
    expect(composerSource).toContain('AudioBufferSourceNode');
  });

  it('doit exporter la fonction composeVideo ou composeAndUpload', () => {
    expect(
      composerSource.includes('export async function composeVideo') ||
      composerSource.includes('export async function composeAndUpload') ||
      composerSource.includes('export function composeVideo')
    ).toBe(true);
  });
});
