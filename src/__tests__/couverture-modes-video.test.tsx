/**
 * Hotfix #527 — modes de couverture indépendants et vidéo jamais bloquée.
 *
 * Production (2026-10-08) : dans Calendrier → Modifier le Post,
 * - « Image » ne faisait rien : `{ mode: 'upload' }` sans image est rejeté par
 *   `lireCouverture`, le Calendrier relisait « automatique » ;
 * - « Dans la vidéo » restait sur « Chargement de la vidéo… » : les montages
 *   WebM (MediaRecorder) n'ont pas de durée, Chrome annonce `Infinity`.
 *
 * Le parent ci-dessous NORMALISE comme le Calendrier (`lireCouverture`) :
 * c'est ce que le banc précédent ne faisait pas.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import { lireCouverture, type Couverture } from '@/lib/social/couverture';

vi.mock('@/lib/creer/posterUpload', () => ({
  uploadPosterFile: vi.fn(async () => ({ url: 'https://cdn.example/couv.png', dataUrl: false })),
}));
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;

import Zone from '@/components/social/ReglagesPublicationReseaux';

let enregistre: Record<string, unknown> = {};
function CommeLeCalendrier({ depart, videoUrl = '/montage.webm' }: { depart?: Couverture; videoUrl?: string | null }) {
  const [meta, setMeta] = useState<Record<string, unknown>>(depart ? { cover: depart } : {});
  enregistre = meta;
  return (
    <Zone
      reseaux={['instagram', 'facebook']}
      format="reel"
      videoUrl={videoUrl}
      value={{ cover: lireCouverture(meta), tiktok: null }}
      onChange={(m) => setMeta((p) => ({ ...p, ...(m.cover !== undefined ? { cover: m.cover } : {}) }))}
    />
  );
}
const actif = () => document.querySelector('[data-couverture-mode][aria-checked="true"]')?.getAttribute('data-couverture-mode');
const cliquer = (m: string) => fireEvent.click(document.querySelector(`[data-couverture-mode="${m}"]`)!);
const video = () => document.querySelector('[data-couverture-frame] video') as HTMLVideoElement;
const etatVideo = () => document.querySelector('[data-couverture-video-etat]')?.getAttribute('data-couverture-video-etat');
function duree(v: HTMLVideoElement, d: number) { Object.defineProperty(v, 'duration', { configurable: true, get: () => d }); }

let clicFichier: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  clicFichier = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('mode Image', () => {
  it('post sans couverture : « Image » s’affiche, ouvre le sélecteur, la couverture enregistrée reste automatique', () => {
    render(<CommeLeCalendrier />);
    cliquer('upload');
    expect(actif()).toBe('upload');
    expect(document.querySelector('[data-couverture-upload] input[type=file]')).toBeTruthy();
    expect(clicFichier).toHaveBeenCalledTimes(1);
    expect(enregistre.cover).toEqual({ mode: 'auto' });
  });
  it('image choisie → aperçu, puis Automatique', async () => {
    render(<CommeLeCalendrier />);
    cliquer('upload');
    const input = document.querySelector('[data-couverture-upload] input[type=file]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'c.png', { type: 'image/png' })] } });
    await waitFor(() => expect(document.querySelector('[data-couverture-upload] img')?.getAttribute('src')).toBe('https://cdn.example/couv.png'));
    expect(enregistre.cover).toEqual({ mode: 'upload', imageUrl: 'https://cdn.example/couv.png' });
    cliquer('auto');
    expect(actif()).toBe('auto');
    expect(enregistre.cover).toEqual({ mode: 'auto' });
  });
  it('Moment → Image : passe en Image (sélecteur ouvert), plus de moment enregistré', () => {
    render(<CommeLeCalendrier depart={{ mode: 'frame', frameMs: 3000 }} />);
    cliquer('upload');
    expect(actif()).toBe('upload');
    expect(enregistre.cover).toEqual({ mode: 'auto' });
  });
});

describe('mode Dans la vidéo', () => {
  it('WebM sans durée (Infinity) : saut en fin, durée réelle lue, curseur activé, retour au moment choisi', () => {
    render(<CommeLeCalendrier depart={{ mode: 'frame', frameMs: 4200 }} />);
    expect(etatVideo()).toBe('chargement');
    expect(document.querySelector('[data-couverture-progression]')).toBeTruthy();
    expect(document.querySelector('[data-couverture-curseur]')).toBeNull();
    const v = video();
    duree(v, Infinity);
    fireEvent.loadedMetadata(v);
    expect(v.currentTime).toBeGreaterThan(1e100);
    duree(v, 57.898);
    fireEvent.durationChange(v);
    expect(etatVideo()).toBe('pret');
    const c = document.querySelector('[data-couverture-curseur]') as HTMLInputElement;
    expect(c.max).toBe('57898');
    expect(c.value).toBe('4200');
    expect(v.currentTime).toBeCloseTo(4.2);
    expect(screen.getByText('sur 00:57.898')).toBeTruthy();
  });
  it('durée normale (MP4) : prêt tout de suite', () => {
    render(<CommeLeCalendrier depart={{ mode: 'frame', frameMs: 1000 }} />);
    duree(video(), 12.5);
    fireEvent.loadedMetadata(video());
    expect(etatVideo()).toBe('pret');
  });
  it('erreur de la vidéo : message clair + « Réessayer » qui relance le chargement', () => {
    render(<CommeLeCalendrier depart={{ mode: 'frame', frameMs: 1000 }} />);
    fireEvent.error(video());
    expect(screen.getByRole('alert').textContent).toBe('Impossible de charger la vidéo');
    fireEvent.click(document.querySelector('[data-couverture-video-reessayer]')!);
    expect(etatVideo()).toBe('chargement');
  });
  it('délai dépassé (20 s) : jamais « Chargement… » éternel', () => {
    vi.useFakeTimers();
    render(<CommeLeCalendrier depart={{ mode: 'frame', frameMs: 1000 }} />);
    act(() => { vi.advanceTimersByTime(20_001); });
    expect(etatVideo()).toBe('erreur');
    expect(screen.getByText('Impossible de charger la vidéo')).toBeTruthy();
  });
});

describe('aucun mode ne bloque les autres', () => {
  it('vidéo EN CHARGEMENT : Automatique puis Image répondent immédiatement', () => {
    render(<CommeLeCalendrier />);
    cliquer('frame');
    expect(etatVideo()).toBe('chargement');
    cliquer('auto');
    expect(actif()).toBe('auto');
    expect(enregistre.cover).toEqual({ mode: 'auto' });
    cliquer('frame');
    cliquer('upload');
    expect(actif()).toBe('upload');
  });
  it('Moment → Automatique', () => {
    render(<CommeLeCalendrier depart={{ mode: 'frame', frameMs: 2000 }} />);
    cliquer('auto');
    expect(actif()).toBe('auto');
  });
  it('rester en Moment conserve le moment choisi', () => {
    render(<CommeLeCalendrier depart={{ mode: 'frame', frameMs: 2600 }} />);
    cliquer('frame');
    expect(enregistre.cover).toEqual({ mode: 'frame', frameMs: 2600 });
  });
  it('post sans couverture : automatique, rien n’est écrit tant qu’on ne touche à rien', () => {
    render(<CommeLeCalendrier />);
    expect(actif()).toBe('auto');
    expect(enregistre.cover).toBeUndefined();
  });
});
