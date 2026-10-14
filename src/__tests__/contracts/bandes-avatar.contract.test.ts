/**
 * CONTRAT C-BARS — l'avatar d'un montage final 9:16 n'a jamais de bandes
 * unies (blanches, claires, colorées ou noires). Validé par #565 (BUG 6) :
 * détection de bandes de toute couleur, recadrage « cover » sans étirement,
 * demande « remplir » au fournisseur depuis l'Autopilote, aval en cover.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── File Autopilote doublée : une seule réservation, aucun appel réel ─────
const chaine = (): Record<string, unknown> => {
  const api: Record<string, unknown> = {};
  Object.assign(api, {
    select: () => api, eq: () => api, in: () => api, order: () => api, lt: () => api,
    insert: () => api, update: () => api, delete: () => api,
    limit: async () => ({ data: [], error: null }),
    single: async () => ({ data: { id: 'att-1' }, error: null }),
    then: (r: (v: unknown) => void) => r({ data: null, error: null }),
  });
  return api;
};
vi.mock('@/lib/db/supabase', () => ({ supabaseAdmin: { from: () => chaine() }, supabase: {} }));
const genererVideoJumeau = vi.fn(async (..._a: unknown[]) => ({ ok: true, generationId: 'gen-1' }));
vi.mock('@/lib/avatar/moteur-jumeau', () => ({
  genererVideoJumeau: (...a: unknown[]) => genererVideoJumeau(...a),
  reconcilierLancement: async () => true,
}));
vi.mock('@/lib/avatar/statut', () => ({ avancerStatutGeneration: async () => null }));
vi.mock('@/lib/autopilot/produire', () => ({ produireUnMontage: async () => ({ postId: 'p' }), creneauxExistants: async () => new Set() }));

import { zoneBandesUnies, planCadrage, ratioDemande } from '@/lib/avatar/cadrage-jumeau';
import { lancerJumeauMontage } from '@/lib/autopilot/jumeau-async';
import { drawVideoSeq } from '@/lib/video-composer';

/** Image en luminance : fond uni `fond`, zone « image » bruitée. */
function image(l: number, h: number, fond: number, z: { x: number; y: number; l: number; h: number }, graine = 1): Uint8Array {
  const px = new Uint8Array(l * h).fill(fond);
  let s = graine;
  for (let y = z.y; y < z.y + z.h; y++) for (let x = z.x; x < z.x + z.l; x++) { s = (s * 1103515245 + 12345) & 0x7fffffff; px[y * l + x] = 30 + (s % 180); }
  return px;
}

describe('C-BARS — détection et recadrage (règle pure)', () => {
  const SRC = { l: 720, h: 1280 };
  const UTILE = { x: 0, y: 437, l: 720, h: 406 }; // avatar 16:9 posé au centre d'un 9:16 (mesuré en prod)

  it.each([255, 243, 120, 0])('bandes unies de luminance %i : détectées, recadrage cover 9:16 DANS l’image utile', (fond) => {
    const z = zoneBandesUnies(image(SRC.l, SRC.h, fond, UTILE), SRC);
    const plan = planCadrage(SRC, z, ratioDemande('9:16'));
    expect(plan).not.toBeNull();
    expect(plan!.sortie).toEqual({ l: 720, h: 1280 });
    expect(plan!.coupe.l / plan!.coupe.h).toBeCloseTo(9 / 16, 1);
    // Aucune ligne de fond ne survit : la coupe est strictement dans l'image utile.
    expect(plan!.coupe.y).toBeGreaterThanOrEqual(UTILE.y);
    expect(plan!.coupe.y + plan!.coupe.h).toBeLessThanOrEqual(UTILE.y + UTILE.h);
  });

  it('image pleine 9:16 : aucun recadrage inutile', () => {
    const z = zoneBandesUnies(image(SRC.l, SRC.h, 243, { x: 0, y: 0, l: 720, h: 1280 }), SRC);
    expect(planCadrage(SRC, z, ratioDemande('9:16'))).toBeNull();
  });
});

describe('C-BARS — le fournisseur est prié de REMPLIR le 9:16 (Autopilote)', () => {
  beforeEach(() => genererVideoJumeau.mockClear());
  it('lancerJumeauMontage demande 9:16 + cadrage « remplir », même avatar seul', async () => {
    const post = { title: 'Routine', content: { subtitle: 'Trois gestes', cards: [], tagLine: 'On commence ?' }, brief: { message: 'Rejoins le cours' }, rushUrl: null } as never;
    const r = await lancerJumeauMontage({ userId: 'u1', config: {} as never, post, rang: 0, now: 1, jobId: 'j', slotKey: 's' });
    expect(r.ok).toBe(true);
    expect(genererVideoJumeau).toHaveBeenCalledTimes(1);
    expect(genererVideoJumeau).toHaveBeenCalledWith(expect.objectContaining({ aspectRatio: '9:16', cadrage: 'remplir' }));
  });
});

describe('C-BARS — l’aval est en cover (aucune bande ajoutée)', () => {
  it('Remotion : chaque vidéo (rush, avatar) en objectFit cover, jamais contain', () => {
    const code = readFileSync(join(process.cwd(), 'remotion/CreerSimpleMontage.tsx'), 'utf8');
    const videos = code.match(/<OffthreadVideo[\s\S]*?\/>/g) ?? [];
    expect(videos.length).toBeGreaterThanOrEqual(2);
    for (const v of videos) { expect(v).toMatch(/objectFit: 'cover'/); expect(v).not.toMatch(/contain/); }
  });
  it('compositeur navigateur : un avatar 16:9 / 1:1 couvre tout le 9:16, sans étirement', () => {
    for (const src of [[1920, 1080], [1080, 1080]] as const) {
      const appels: number[][] = [];
      const ctx = new Proxy({}, {
        get: (_o, k) => (k === 'drawImage' ? (_s: unknown, ...a: number[]) => appels.push(a) : k === 'measureText' ? () => ({ width: 0 }) : () => undefined),
        set: () => true,
      }) as unknown as CanvasRenderingContext2D;
      drawVideoSeq(ctx, 1080, 1920, { videoWidth: src[0], videoHeight: src[1] } as unknown as HTMLVideoElement, null, 0.5);
      const [x, y, l, h] = appels[0];
      expect(x).toBeLessThanOrEqual(0); expect(y).toBeLessThanOrEqual(0);
      expect(x + l).toBeGreaterThanOrEqual(1080); expect(y + h).toBeGreaterThanOrEqual(1920);
      expect(l / src[0]).toBeCloseTo(h / src[1], 3);
    }
  });
});
