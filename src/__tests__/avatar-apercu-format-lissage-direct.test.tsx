import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent, act } from '@testing-library/react';

/**
 * MON AVATAR — APERÇU DU FORMAT CHOISI (≠ rendu récent) et LISSAGE EN DIRECT.
 * Réseau simulé ; aucun fournisseur, aucun transcodage pendant le curseur.
 */

vi.mock('@/components/voice/VoiceCloneRecorder', () => ({ default: () => null }));
vi.mock('@/components/voice/MaVoixPanel', () => ({ default: () => null }));

const apercu = vi.hoisted(() => ({ appels: [] as number[] }));
vi.mock('@/lib/avatar/lissage-apercu', async (orig) => {
  const reel = await orig<typeof import('@/lib/avatar/lissage-apercu')>();
  // jsdom n'a pas de canvas : on capte la demande d'aperçu (et son niveau) — le calcul est testé à part.
  return { ...reel, dessinerApercuLisse: (_t: unknown, _s: unknown, _l: number, _h: number, lissage: number) => { apercu.appels.push(lissage); return true; } };
});

import { lisserImage } from '../lib/avatar/lissage-apercu';
import AvatarPage from '../app/dashboard/avatar/page';
import PreparationPhoto from '../components/avatar/studio/PreparationPhoto';

// ─────────────────────────────────────────────────────────────────────────
// Le calcul de l'aperçu (pur)
// ─────────────────────────────────────────────────────────────────────────

/** Une image de « peau » granuleuse (bruit faible) avec un trait net au milieu. */
function image(l = 40, h = 40): Uint8ClampedArray {
  const d = new Uint8ClampedArray(l * h * 4);
  let graine = 7;
  const alea = () => { graine = (graine * 1103515245 + 12345) % 2147483648; return graine / 2147483648; };
  for (let y = 0; y < h; y += 1) for (let x = 0; x < l; x += 1) {
    const i = (y * l + x) * 4;
    const v = x === 20 ? 20 : 180 + Math.round((alea() - 0.5) * 18);
    d[i] = v; d[i + 1] = v - 20; d[i + 2] = v - 40; d[i + 3] = 255;
  }
  return d;
}
const rugosite = (d: Uint8ClampedArray, l = 40, h = 40) => {
  let s = 0;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < 15; x += 1) s += Math.abs(d[(y * l + x) * 4] - d[(y * l + x + 1) * 4]);
  return s;
};

describe('Lissage — l’aperçu en direct (même filtre bilatéral, à la taille affichée)', () => {
  it('⚠️ 0 % : copie identique ; l’original n’est JAMAIS modifié', () => {
    const src = image(); const copie = new Uint8ClampedArray(src);
    expect(Array.from(lisserImage(src, 40, 40, 0))).toEqual(Array.from(src));
    lisserImage(src, 40, 40, 100);
    expect(Array.from(src)).toEqual(Array.from(copie));
  });

  it('⚠️ continu : le grain diminue à chaque palier 0 → 10 → 25 → 50 → 75 → 100 %', () => {
    const src = image();
    const r = [0, 10, 25, 50, 75, 100].map((l) => rugosite(lisserImage(src, 40, 40, l)));
    for (let i = 1; i < r.length; i += 1) expect(r[i]).toBeLessThanOrEqual(r[i - 1]);
    expect(r[5]).toBeLessThan(r[0]);
  });

  it('⚠️ les contours restent nets : le trait sombre n’est pas fondu dans la peau', () => {
    const sortie = lisserImage(image(), 40, 40, 100);
    expect(sortie[(10 * 40 + 20) * 4]).toBeLessThan(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Photo : l'aperçu suit le curseur, sans appel réseau
// ─────────────────────────────────────────────────────────────────────────

vi.mock('@/lib/http/envoiAvecProgression', () => ({
  detailEnvoi: () => '',
  envoyerFormulaire: async () => ({ ok: true, status: 200, json: { success: true, data: { cleOriginal: 'u/avatar/source-1-o.jpg' } } }),
}));

describe('Améliorer ma photo — aperçu EN DIRECT pendant le curseur', () => {
  beforeEach(() => { apercu.appels.length = 0; vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('⚠️ chaque déplacement du curseur redessine l’aperçu à SON niveau — aucun envoi réseau, aucun fournisseur', async () => {
    const { container } = render(<PreparationPhoto fichier={new File(['x'], 'moi.jpg', { type: 'image/jpeg' })} onAnnuler={() => {}} onPret={() => {}} />);
    await waitFor(() => expect(container.querySelector('[data-preparation-photo="edition"]')).not.toBeNull());
    const img = container.querySelector('[data-preparation-photo-image="originale"]') as HTMLImageElement;
    Object.defineProperty(img, 'naturalWidth', { value: 800 }); Object.defineProperty(img, 'naturalHeight', { value: 1000 });
    fireEvent.load(img);
    const regler = async (v: number) => {
      await act(async () => {
        fireEvent.change(container.querySelector('[data-curseur-lissage-entree]')!, { target: { value: String(v) } });
        await new Promise((r) => setTimeout(r, 30));
      });
    };
    await waitFor(() => expect(apercu.appels).toContain(25));
    for (const v of [40, 60, 80, 100, 10, 0]) await regler(v);
    expect(apercu.appels).toEqual(expect.arrayContaining([25, 40, 60, 80, 100, 10, 0]));
    expect(container.querySelector('[data-preparation-photo-apercu-direct]')!.getAttribute('data-preparation-photo-apercu-direct')).toBe('visible');
    // « Avant » : l'original, l'aperçu masqué.
    fireEvent.click(container.querySelector('[data-preparation-photo-direct="avant"]')!);
    expect(container.querySelector('[data-preparation-photo-apercu-direct]')!.getAttribute('data-preparation-photo-apercu-direct')).toBe('masque');
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Mon avatar : « Aperçu 9:16 / 16:9 / 1:1 » ≠ « Rendu récent »
// ─────────────────────────────────────────────────────────────────────────

const A = '11111111-1111-4111-8111-000000000001';
const V4 = '44444444-4444-4444-8444-000000000004';
const RENDU = 'https://studiio.pro/storage/v1/object/public/media/u/avatar/rendu.mp4';
const page = { rendu: true };

describe('Mon avatar — aperçu du format choisi', () => {
  beforeEach(() => {
    page.rendu = true;
    window.localStorage.clear();
    globalThis.fetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b } as unknown as Response);
      if (u === '/api/avatar/create') return json({ success: true, data: { avatar: { id: A, name: 'Mon avatar vidéo', status: 'completed', avatar_type: 'video', created_at: '2026-10-06T00:00:00Z', etat: 'valide', version: 4, active_version_id: V4, validated_at: '2026-10-10T04:50:00Z', provider: 'heygen' }, voices: [{ voiceId: 'hg1', name: 'Yosef', language: 'French' }], defaultVoiceId: 'hg1' } });
      if (u === '/api/avatar/apercu') return json({ success: true, data: { apercu: { statut: 'aucun' }, renduRecent: page.rendu ? { generationId: 'g1', url: RENDU, version: 4, creeLe: '2026-10-10' } : null } });
      return json({ success: true, data: { avatars: [], capacite: { nouvelAvatarPhoto: true, nouvelAvatarVideo: false, emplacementsVideoLibres: 0 } } });
    }) as unknown as typeof fetch;
  });
  afterEach(() => { cleanup(); });

  const monter = async () => {
    render(<AvatarPage />);
    await waitFor(() => expect(document.querySelector('[data-avatar-generation]')).not.toBeNull());
  };
  const cadre = () => document.querySelector('[data-avatar-apercu-cadre]')!.getAttribute('data-avatar-apercu-cadre');
  const format = (r: string) => fireEvent.click([...document.querySelectorAll('[data-avatar-generation] button')].find((b) => b.textContent === r)!);

  it('⚠️ le cadre suit IMMÉDIATEMENT le format : 9:16 → 16:9 → 1:1, rempli par l’avatar (cover), sans étirement', async () => {
    await monter();
    const video = () => document.querySelector('[data-avatar-apercu-format]') as HTMLVideoElement;
    expect(cadre()).toBe('9 / 16');
    // La source de la VERSION ACTIVE — et d'elle seule.
    expect(video().getAttribute('src')).toBe(`/api/avatars/versions/${V4}/source#t=1`);
    expect(video().className).toContain('object-cover');
    format('16:9');
    expect(cadre()).toBe('16 / 9');
    expect(document.querySelector('[data-avatar-vue-apercu="format"]')!.textContent).toBe('Aperçu 16:9');
    format('1:1');
    expect(cadre()).toBe('1 / 1');
  });

  it('⚠️ « Rendu récent » garde SON ratio réel — l’ancien fichier n’est jamais transformé', async () => {
    await monter();
    format('16:9');
    fireEvent.click(document.querySelector('[data-avatar-vue-apercu="rendu"]')!);
    const v = document.querySelector('[data-avatar-rendu-recent]') as HTMLVideoElement;
    expect(v.className).toContain('object-contain');
    Object.defineProperty(v, 'videoWidth', { value: 720 }); Object.defineProperty(v, 'videoHeight', { value: 1280 });
    fireEvent.loadedMetadata(v);
    await waitFor(() => expect(cadre()).toBe('720 / 1280'));
    // Revenir au format choisi : l'aperçu 16:9 est toujours là.
    format('16:9');
    expect(cadre()).toBe('16 / 9');
  });
});
