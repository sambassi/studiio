import { describe, it, expect } from 'vitest';
import {
  choisirFormatEnregistrement, typeEtExtension, messageErreurCamera, verifierPriseSource, formaterDuree,
} from '@/lib/avatar/capture';

/**
 * CAPTURE DE LA SOURCE — les règles pures de l'enregistrement caméra + micro.
 * Repris à l'identique des tests « enregistrement caméra » de la PR #530
 * (seule partie de #530 reprise : celle dont dépend l'enregistrement direct).
 */

describe('enregistrement caméra', () => {
  it('format : WebM si possible, sinon MP4 ; MP4 exigé → MP4 ou rien', () => {
    expect(choisirFormatEnregistrement((m) => m.startsWith('video/webm'))).toBe('video/webm;codecs=vp9,opus');
    expect(choisirFormatEnregistrement((m) => m === 'video/mp4')).toBe('video/mp4');
    expect(choisirFormatEnregistrement((m) => m.startsWith('video/webm'), true)).toBeNull();
    expect(choisirFormatEnregistrement((m) => m.startsWith('video/mp4'), true)).toBe('video/mp4;codecs=avc1,mp4a');
  });
  it('type et extension acceptés par l’import', () => {
    expect(typeEtExtension('video/webm;codecs=vp9,opus')).toEqual({ type: 'video/webm', extension: 'webm' });
    expect(typeEtExtension('video/mp4;codecs=avc1')).toEqual({ type: 'video/mp4', extension: 'mp4' });
  });
  it('messages clairs : permission refusée, caméra absente, caméra occupée', () => {
    expect(messageErreurCamera('NotAllowedError')).toMatch(/refusé/);
    expect(messageErreurCamera('NotFoundError')).toMatch(/Aucune caméra/);
    expect(messageErreurCamera('NotReadableError')).toMatch(/autre application/);
    expect(messageErreurCamera(undefined)).toMatch(/importer une vidéo/);
  });
  it('⚠️ exigences documentées du fournisseur, vérifiées AVANT envoi : 15–600 s, grand côté ≥ 640 px, 32 Mo', () => {
    const ok = { dureeS: 120, largeur: 1280, hauteur: 720, octets: 20 * 1024 * 1024 };
    expect(verifierPriseSource(ok)).toEqual([]);
    expect(verifierPriseSource({ ...ok, dureeS: 9 })[0]).toMatch(/au moins 15 secondes/);
    expect(verifierPriseSource({ ...ok, dureeS: 700 })[0]).toMatch(/10 minutes maximum/);
    expect(verifierPriseSource({ ...ok, largeur: 480, hauteur: 360 })[0]).toMatch(/résolution/);
    expect(verifierPriseSource({ ...ok, octets: 40 * 1024 * 1024 })[0]).toMatch(/trop lourde/);
    // La source réelle de l'incident (848×478, 122,8 s, 23 Mo) respecte ces règles.
    expect(verifierPriseSource({ dureeS: 122.84, largeur: 848, hauteur: 478, octets: 23.05 * 1024 * 1024 })).toEqual([]);
  });
  it('durée affichée', () => {
    expect(formaterDuree(0)).toBe('0:00');
    expect(formaterDuree(75.9)).toBe('1:15');
  });
});
