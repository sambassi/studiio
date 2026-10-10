import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/react';

/**
 * LE FORMAT CHOISI EST RÉELLEMENT REMPLI — de la source au lecteur.
 *
 *   SOURCE → RECADRAGE (choisi par la personne) → FICHIER PRÉPARÉ (ffmpeg)
 *   → HEYGEN (`aspect_ratio` + `fit: cover`) → VIDÉO GÉNÉRÉE → APERÇU
 *
 * Constaté en production le 2026-10-10 : avatar v4 entraîné sur une source
 * 16:9 (848 × 478), génération 9:16 SANS `fit` → HeyGen a rendu un fichier
 * 720 × 1280 dont seule une bande centrale de 720 × 405 contenait l'image.
 * Les bandes étaient DANS le fichier : aucun CSS ne pouvait les retirer.
 */

vi.mock('@/components/voice/VoiceCloneRecorder', () => ({ default: () => null }));
vi.mock('@/components/voice/MaVoixPanel', () => ({ default: () => null }));

import {
  recadrageDepuisReglages, bornerParametres, geometrieSortie, argumentsFfmpeg,
} from '../lib/avatar/preparation-source-regles';
import { formatLecteurDepuisRatio } from '../lib/ui/lecteur-generation';
import AvatarPage from '../app/dashboard/avatar/page';

const ratio = (g: { largeur: number; hauteur: number }) => g.largeur / g.hauteur;

/** Le recadrage choisi dans l'éditeur → le fichier PRÉPARÉ réellement produit par ffmpeg. */
function prepare(source: { largeur: number; hauteur: number }, cadre: '9:16' | '16:9' | '1:1' | 'original', centre = { x: 0.5, y: 0.5 }) {
  const recadrage = recadrageDepuisReglages(source, { rotation: 0, ratio: cadre, zoom: 1, centre });
  const p = bornerParametres({ debutS: 0, finS: 30, recadrage }, 30, source);
  const infos = { largeurEffective: source.largeur, hauteurEffective: source.hauteur };
  const g = geometrieSortie(p, infos);
  const args = argumentsFfmpeg('in.mp4', 'out.mp4', p, infos);
  return { recadrage, g, vf: args[args.indexOf('-vf') + 1] };
}

describe('Recadrage choisi → fichier préparé (ce qui entraîne l’avatar)', () => {
  it('⚠️ source 16:9 + cadre 9:16 : fichier préparé 9:16, recadré à l’endroit CHOISI, sans bande, sans étirement', () => {
    const { recadrage, g, vf } = prepare({ largeur: 1920, hauteur: 1080 }, '9:16', { x: 0.3, y: 0.5 });
    expect(ratio(g)).toBeCloseTo(9 / 16, 2);
    // Le centre choisi (30 % de la largeur) est respecté : le cadre est centré dessus.
    expect(recadrage!.x + recadrage!.largeur / 2).toBeCloseTo(0.3, 2);
    expect(vf).toMatch(/crop=\d+:\d+:\d+:\d+/);
    expect(vf).not.toMatch(/pad=|setsar=(?!1)/);
  });

  it('⚠️ source 16:9 + cadre 16:9 : rien à recadrer, le fichier reste 16:9', () => {
    const { recadrage, g, vf } = prepare({ largeur: 1920, hauteur: 1080 }, '16:9');
    expect(recadrage).toBeNull();
    expect(ratio(g)).toBeCloseTo(16 / 9, 2);
    expect(vf).not.toMatch(/crop=|pad=/);
  });

  it('⚠️ source 16:9 + cadre 1:1 : carré rempli, centre choisi respecté', () => {
    const { recadrage, g } = prepare({ largeur: 1920, hauteur: 1080 }, '1:1', { x: 0.6, y: 0.5 });
    expect(ratio(g)).toBeCloseTo(1, 2);
    expect(recadrage!.x + recadrage!.largeur / 2).toBeCloseTo(0.6, 2);
  });

  it('⚠️ source 9:16 + cadre 9:16 : aucune modification inutile', () => {
    const { recadrage, g, vf } = prepare({ largeur: 1080, hauteur: 1920 }, '9:16');
    expect(recadrage).toBeNull();
    expect([g.largeur, g.hauteur]).toEqual([1080, 1920]);
    expect(vf).not.toMatch(/crop=|scale=|pad=/);
  });
});

describe('Lecteur : la classe de taille suit le ratio RÉEL du média', () => {
  it('720 × 1280 → 9:16 ; 1920 × 1080 → 16:9 ; 1080 × 1080 → 1:1', () => {
    expect(formatLecteurDepuisRatio('720 / 1280')).toBe('9:16');
    expect(formatLecteurDepuisRatio('1920 / 1080')).toBe('16:9');
    expect(formatLecteurDepuisRatio('1080 / 1080')).toBe('1:1');
    expect(formatLecteurDepuisRatio('n’importe quoi')).toBe('9:16');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// La page : rendu récent au ratio RÉEL, génération qui demande « remplir »
// ─────────────────────────────────────────────────────────────────────────

const A = '11111111-1111-4111-8111-000000000001';
const RENDU = 'https://studiio.pro/storage/v1/object/public/media/u/avatar/rendu.mp4';
const appels: Array<{ url: string; corps: unknown }> = [];
const etat = { orientation: 'landscape' as string | null };

beforeEach(() => {
  appels.length = 0;
  etat.orientation = 'landscape';
  window.localStorage.clear();
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    appels.push({ url: u, corps: init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : null });
    const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b } as unknown as Response);
    if (u === '/api/avatar/create') {
      return json({ success: true, data: {
        avatar: { id: A, name: 'Mon avatar vidéo', status: 'completed', avatar_type: 'video', created_at: '2026-10-06T00:00:00Z', etat: 'valide', version: 4, validated_at: '2026-10-10T04:50:00Z', provider: 'heygen' },
        voices: [{ voiceId: 'hg1', name: 'Yosef', language: 'French' }], defaultVoiceId: 'hg1', orientationAvatar: etat.orientation,
      } });
    }
    if (u === '/api/avatar/apercu') return json({ success: true, data: { apercu: { statut: 'aucun' }, renduRecent: { generationId: 'g1', url: RENDU, version: 4, creeLe: '2026-10-10' } } });
    if (u === '/api/avatar/generate') return json({ success: true, data: { generationId: '99999999-1111-4111-8111-000000000009', status: 'pending' } });
    return json({ success: true, data: { avatars: [], capacite: { nouvelAvatarPhoto: true, nouvelAvatarVideo: false, emplacementsVideoLibres: 0 } } });
  }) as unknown as typeof fetch;
});
afterEach(() => { cleanup(); });

const monter = async () => {
  render(<AvatarPage />);
  await waitFor(() => expect(document.querySelector('[data-avatar-generation]')).not.toBeNull());
};
const cadre = () => document.querySelector('[data-avatar-apercu-cadre]')!.getAttribute('data-avatar-apercu-cadre');
/** jsdom ne décode pas la vidéo : on lui donne ses dimensions réelles, puis l'événement. */
function charger(video: HTMLVideoElement, l: number, h: number) {
  Object.defineProperty(video, 'videoWidth', { value: l, configurable: true });
  Object.defineProperty(video, 'videoHeight', { value: h, configurable: true });
  fireEvent.loadedMetadata(video);
}

describe('Page Mon avatar — le lecteur respecte le média réel', () => {
  it('⚠️ rendu récent 16:9 : lecteur HORIZONTAL (pas un cadre 9:16 bordé de vide)', async () => {
    await monter();
    expect(cadre()).toBe('9 / 16');
    charger(document.querySelector('[data-avatar-rendu-recent]') as HTMLVideoElement, 1920, 1080);
    await waitFor(() => expect(cadre()).toBe('1920 / 1080'));
  });

  it('⚠️ rendu récent 9:16 (720 × 1280) : lecteur vertical', async () => {
    await monter();
    charger(document.querySelector('[data-avatar-rendu-recent]') as HTMLVideoElement, 720, 1280);
    await waitFor(() => expect(cadre()).toBe('720 / 1280'));
  });

  it('⚠️ avatar en paysage, format 9:16 : la page DIT que l’image est recadrée pour remplir le cadre ; rien en 16:9', async () => {
    await monter();
    expect(document.querySelector('[data-avatar-recadrage]')!.textContent).toMatch(/Avatar créé en paysage : en 9:16, l’image est recadrée pour remplir tout le cadre/);
    fireEvent.click([...document.querySelectorAll('[data-avatar-generation] button')].find((b) => b.textContent === '16:9')!);
    expect(document.querySelector('[data-avatar-recadrage]')).toBeNull();
  });
});
