import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, act } from '@testing-library/react';

/**
 * LISSAGE — l'aperçu en direct = le fichier préparé, MÊME pour une source 4K.
 *
 * ffmpeg applique le filtre bilatéral APRÈS la réduction à 1920 px
 * (`argumentsFfmpeg` : crop → scale → bilateral). Son rayon est en pixels de
 * SORTIE : sur une source 3840 px, il couvre deux fois plus de visage que le
 * même rayon en pixels de source. L'aperçu doit donc suivre cette réduction,
 * sinon il montre deux fois moins de lissage que le fichier qui partira.
 * Réseau simulé ; aucun fournisseur, aucun transcodage.
 */

const apercu = vi.hoisted(() => ({ appels: [] as Array<{ largeurReelle: number; lissage: number; echelleSortie: number | undefined }> }));
vi.mock('@/lib/avatar/lissage-apercu', async (orig) => {
  const reel = await orig<typeof import('@/lib/avatar/lissage-apercu')>();
  return {
    ...reel,
    dessinerApercuLisse: (_t: unknown, _s: unknown, largeurReelle: number, _h: number, lissage: number, _max?: number, echelleSortie?: number) => {
      apercu.appels.push({ largeurReelle, lissage, echelleSortie });
      return true;
    },
  };
});

const envoi = vi.hoisted(() => ({ reponse: null as unknown }));
vi.mock('@/lib/http/envoiAvecProgression', async () => {
  const reel = await vi.importActual<Record<string, unknown>>('@/lib/http/envoiAvecProgression');
  return { ...reel, envoyerFormulaire: vi.fn(async () => envoi.reponse) };
});

import { echelleApercuLissage, lisserImage } from '../lib/avatar/lissage-apercu';
import { argumentsFfmpeg, geometrieSortie, AMELIORATION_NEUTRE } from '../lib/avatar/preparation-source-regles';
import PreparationSource from '../components/avatar/studio/PreparationSource';

describe('echelleApercuLissage — pixels affichés par pixel FILTRÉ par ffmpeg', () => {
  it('sans réduction : largeur affichée ÷ largeur réelle (comportement inchangé)', () => {
    expect(echelleApercuLissage(360, 1920)).toBeCloseTo(360 / 1920, 10);
    expect(echelleApercuLissage(360, 1920, 1)).toBeCloseTo(360 / 1920, 10);
  });

  it('⚠️ source 4K réduite à 1920 : l’échelle est celle d’une source 1920 (rayon deux fois plus grand)', () => {
    expect(echelleApercuLissage(360, 3840, 0.5)).toBeCloseTo(360 / 1920, 10);
  });

  it('valeurs illisibles : jamais d’agrandissement inventé', () => {
    expect(echelleApercuLissage(360, 1920, 0)).toBeCloseTo(360 / 1920, 10);
    expect(echelleApercuLissage(360, 1920, Number.NaN)).toBeCloseTo(360 / 1920, 10);
    expect(echelleApercuLissage(360, 1920, 3)).toBeCloseTo(360 / 1920, 10);
    expect(echelleApercuLissage(0, 1920)).toBe(1);
  });

  it('⚠️ le rendu de l’aperçu change réellement : plus lissé avec le facteur de sortie qu’avec l’échelle brute', () => {
    // Peau granuleuse (bruit faible), 48 × 48.
    const l = 48; const h = 48; const d = new Uint8ClampedArray(l * h * 4);
    let g = 3; const alea = () => { g = (g * 1103515245 + 12345) % 2147483648; return g / 2147483648; };
    for (let i = 0; i < l * h; i += 1) { const v = 170 + Math.round((alea() - 0.5) * 20); d.set([v, v - 20, v - 40, 255], i * 4); }
    const rugosite = (x: Uint8ClampedArray) => { let s = 0; for (let i = 0; i < l * h - 1; i += 1) s += Math.abs(x[i * 4] - x[(i + 1) * 4]); return s; };
    const brut = lisserImage(d, l, h, 100, 360 / 3840);
    const fidele = lisserImage(d, l, h, 100, echelleApercuLissage(360, 3840, 0.5));
    expect(rugosite(fidele)).toBeLessThan(rugosite(brut));
  });

  it('⚠️ la chaîne ffmpeg réduit AVANT de lisser : c’est bien la largeur de sortie qui compte', () => {
    const infos = { largeurEffective: 2160, hauteurEffective: 3840 };
    const p = { debutS: 0, finS: 20, rotation: 0 as const, recadrage: null, amelioration: { ...AMELIORATION_NEUTRE, lissage: 50 } };
    const vf = argumentsFfmpeg('e.mp4', 's.mp4', p, infos);
    const filtres = vf[vf.indexOf('-vf') + 1];
    expect(filtres.indexOf('scale=')).toBeGreaterThanOrEqual(0);
    expect(filtres.indexOf('scale=')).toBeLessThan(filtres.indexOf('bilateral='));
    const geo = geometrieSortie(p, infos);
    expect(geo.largeur / geo.avantEchelle.largeur).toBeCloseTo(0.5, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// L'éditeur vidéo transmet la réduction réelle à l'aperçu
// ─────────────────────────────────────────────────────────────────────────

const U = 'aaaaaaaa-1111-4111-8111-111111111111';
const CLE_O = `${U}/avatar/source-1-0123456789abcdef0123456789abcdef.mp4`;
const OK = { ok: true, motifs: [], avertissements: [] };
const infosVideo = (l: number, h: number) => ({
  conteneur: 'mov,mp4', codecVideo: 'h264', codecAudio: 'aac', largeur: l, hauteur: h, rotation: 0,
  largeurEffective: l, hauteurEffective: h, dureeS: 30, fps: 30, debitBps: null, tailleOctets: 9000,
});
const q = (s: string) => document.querySelector(s) as HTMLElement | null;

beforeEach(() => {
  apercu.appels.length = 0;
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:locale';
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ success: false }) }) as Response) as unknown as typeof fetch;
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({ drawImage: vi.fn(), getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4).fill(120) }), putImageData: vi.fn() }),
  });
  HTMLMediaElement.prototype.pause = vi.fn();
});
afterEach(() => { cleanup(); });

async function ouvrirAmeliorer(l: number, h: number) {
  envoi.reponse = { ok: true, status: 200, json: { success: true, data: { cleOriginal: CLE_O, infos: infosVideo(l, h), preflight: OK } } };
  render(<PreparationSource fichier={new File([new Uint8Array(4)], 'prise.mp4', { type: 'video/mp4' })} onPret={vi.fn()} onAnnuler={vi.fn()} />);
  await waitFor(() => expect(q('[data-preparation-editeur]')).not.toBeNull());
  const video = q('[data-preparation-video="locale"]') as HTMLVideoElement;
  Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: l });
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: h });
  fireEvent.click(q('[data-preparation-section="ameliorer"]')!);
  await act(async () => {
    fireEvent.change(q('[data-curseur-lissage-entree]')!, { target: { value: '60' } });
    await new Promise((r) => setTimeout(r, 40));
  });
  return apercu.appels.filter((a) => a.lissage === 60);
}

describe('Préparer ma vidéo — l’aperçu du lissage suit la réduction de sortie', () => {
  it('⚠️ source 4K portrait (2160 × 3840) : facteur 0,5 transmis à l’aperçu', async () => {
    const appels = await ouvrirAmeliorer(2160, 3840);
    expect(appels.length).toBeGreaterThan(0);
    const dernier = appels[appels.length - 1];
    expect(dernier.largeurReelle).toBe(2160);
    expect(dernier.echelleSortie).toBeCloseTo(0.5, 2);
  });

  it('source 1080p (1080 × 1920) : aucune réduction, facteur 1 (comportement inchangé)', async () => {
    const appels = await ouvrirAmeliorer(1080, 1920);
    expect(appels.length).toBeGreaterThan(0);
    expect(appels[appels.length - 1].echelleSortie).toBe(1);
  });
});
