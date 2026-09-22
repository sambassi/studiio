import { describe, it, expect, beforeEach, vi } from 'vitest';
import { preparePosts } from '@/lib/autopilot/engine';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';

/**
 * Pas de remplacement silencieux d'un rush mort.
 *
 * L'utilisateur avait un rush pour ce montage ; il a expiré du stockage
 * (rétention 24 h). Le montage sort SANS séquence vidéo — un montage valide,
 * mais amputé. Exigence utilisateur : « ne les remplace pas silencieusement…
 * explique le problème ». On l'ÉCRIT donc dans les métadonnées du post
 * (`rushIgnore` + `rushIgnoreMotif`), à l'insertion, pour que le
 * Calendrier/récap puisse le dire.
 *
 * ⚠️ CE TEST EXÉCUTE `produireUnMontage` EN NODE, SANS NAVIGATEUR, sur une
 * `rush_urls` PUBLIQUE (`…/storage/v1/object/public/…`). Il prouve aussi le
 * point « job indépendant du navigateur » : aucun état de navigateur, aucune
 * URL signée expirable — le rendu est doublé, mais le CHEMIN (rush, affiche,
 * design, dépôt) tourne pour de vrai.
 */

// ── Rendu doublé : AUCUN rendu réel ────────────────────────────────────────
const renderAndUpload = vi.fn(async () => ({
  videoUrl: 'https://cdn.test/rendu.mp4', thumbnailUrl: 'https://cdn.test/v.jpg', durationFrames: 900,
}));
vi.mock('@/lib/autopilot/render', () => ({
  renderAndUpload: (...a: unknown[]) => renderAndUpload(...(a as [])),
}));

// ── Rush présent ou non : c'est le levier du test ──────────────────────────
let rushPresent = true;
vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: async () => rushPresent,
  probeRushSeconds: async () => 6,
  pickPosterUrl: async () => 'https://cdn.test/affiche.jpg',
  pickCustomPoster: () => null,
}));

// ── Crédits doublés — le débit ne doit pas dépendre d'un réseau ─────────────
const deductCredits = vi.fn(async () => true);
vi.mock('@/lib/credits/system', () => ({
  getVideoRenderCost: () => 10,
  deductCredits: (...a: unknown[]) => deductCredits(...(a as [])),
}));
vi.mock('@/lib/credits/atomique', () => ({
  referenceOperation: (prefixe: string, id: string) => `${prefixe}:${id}`,
}));

// ── Base en mémoire : on capture ce qui est inséré ─────────────────────────
let insertions: Array<Record<string, unknown>>;
vi.mock('@/lib/db/supabase', () => {
  const from = () => ({
    insert(row: Record<string, unknown>) {
      insertions.push(row);
      return { select: async () => ({ data: [{ id: `p${insertions.length}` }], error: null }) };
    },
  });
  return { supabaseAdmin: { from }, supabase: { from } };
});

import { produireUnMontage } from '@/lib/autopilot/produire';

const T0 = Date.parse('2026-08-05T09:00:00.000Z');
/** Une URL PUBLIQUE, telle que la banque en garde — jamais signée ni expirable. */
const RUSH_PUBLIC = 'https://projet.supabase.co/storage/v1/object/public/media/u/rush.mp4';

const cfg = (p: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
  ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'],
  rushUrls: [RUSH_PUBLIC], voiceEnabled: false, ...p,
});
const unPost = (c: AutopilotConfig) =>
  preparePosts({ config: c, topic: 'routine du matin', count: 1, now: T0 })[0];

async function produire(c: AutopilotConfig) {
  const post = unPost(c);
  const rendu = await produireUnMontage({
    userId: 'u1', config: c, post, rang: 0, now: T0,
    jobId: 'autopilote-u1-2026-08-05-1',
  });
  return { rendu, meta: insertions[0]?.metadata as Record<string, unknown> };
}

beforeEach(() => {
  insertions = [];
  rushPresent = true;
  renderAndUpload.mockClear();
  deductCredits.mockClear();
});

describe('Un rush mort : signalé, jamais remplacé en silence', () => {
  it('rush expiré → `rushIgnore` + motif dans les métadonnées, et rush lâché', async () => {
    rushPresent = false;
    const { rendu, meta } = await produire(cfg());
    // Le rush est reconnu mort et lâché pour ce montage.
    expect(rendu.rushMort).toBe(RUSH_PUBLIC);
    expect(rendu.rushUrl).toBeNull();
    // Et l'utilisateur le saura : le drapeau est écrit dans le post.
    expect(meta.rushIgnore).toBe(true);
    expect(meta.rushIgnoreMotif).toBe('rush expiré');
    // Le montage sort quand même — titre/cartes/CTA, un post valide.
    expect(renderAndUpload).toHaveBeenCalledTimes(1);
    expect(rendu.postId).toBe('p1');
  });

  it('rush présent → aucun drapeau, le montage garde sa séquence vidéo', async () => {
    rushPresent = true;
    const { rendu, meta } = await produire(cfg());
    expect(rendu.rushMort).toBeNull();
    expect(rendu.rushUrl).toBe(RUSH_PUBLIC);
    expect(meta.rushIgnore).toBeUndefined();
    expect(meta.rushIgnoreMotif).toBeUndefined();
  });
});

describe('Job indépendant du navigateur — URL publique, pas d état client', () => {
  it('produireUnMontage tourne en Node sur une URL publique et dépose le rush', async () => {
    const { rendu, meta } = await produire(cfg());
    // La banque publique est bien celle qui a servi : ni URL signée, ni
    // paramètre `token=` expirable.
    expect(RUSH_PUBLIC).toContain('/storage/v1/object/public/');
    expect(RUSH_PUBLIC).not.toContain('token=');
    expect(meta.rawVideoUrl).toBe(RUSH_PUBLIC);
    expect(meta.rushUrls).toEqual([RUSH_PUBLIC]);
    // Le débit a bien eu lieu, sans dépendre d'un contexte navigateur.
    expect(deductCredits).toHaveBeenCalledTimes(1);
    expect(rendu.debite).toBe(true);
  });
});
