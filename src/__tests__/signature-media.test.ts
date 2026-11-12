/**
 * Détection des octets de tête — images ET vidéos.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_SORTIE_IA_BYTES, detecterSignatureImage, detecterSignatureMedia,
} from '@/lib/storage/image-signature';

const oct = (...n: number[]) => new Uint8Array([...n, ...Array(32).fill(0)]);
const PNG = oct(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const WEBP = oct(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50);
const MP4 = oct(0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d);
const WEBM = oct(0x1a, 0x45, 0xdf, 0xa3);
const HTML = new Uint8Array([...'<!DOCTYPE html>'].map((c) => c.charCodeAt(0)));
const GIF = new Uint8Array([...'GIF89a'].map((c) => c.charCodeAt(0)));

describe('signature média', () => {
  it('reconnaît les images comme avant', () => {
    expect(detecterSignatureMedia(PNG)).toEqual({ mime: 'image/png', ext: 'png' });
    expect(detecterSignatureMedia(WEBP)).toEqual({ mime: 'image/webp', ext: 'webp' });
  });

  it('reconnaît MP4 et WebM', () => {
    expect(detecterSignatureMedia(MP4)).toEqual({ mime: 'video/mp4', ext: 'mp4' });
    expect(detecterSignatureMedia(WEBM)).toEqual({ mime: 'video/webm', ext: 'webm' });
  });

  it('refuse ce qui n’est ni image ni vidéo', () => {
    for (const octets of [HTML, GIF, new Uint8Array()]) {
      expect(detecterSignatureMedia(octets)).toBeNull();
    }
  });

  it('⚠️ `detecterSignatureImage` n’accepte TOUJOURS pas une vidéo', () => {
    expect(detecterSignatureImage(MP4)).toBeNull();
    expect(detecterSignatureImage(WEBM)).toBeNull();
    expect(detecterSignatureImage(PNG)).not.toBeNull();
  });

  it('le plafond d’une sortie rapatriée laisse passer une vidéo courte', () => {
    expect(MAX_SORTIE_IA_BYTES).toBe(25 * 1024 * 1024);
  });
});
