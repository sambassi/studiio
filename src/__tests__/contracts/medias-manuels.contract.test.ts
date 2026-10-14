/**
 * CONTRAT C-MEDIA-MANUAL — un média choisi par l'utilisateur n'est jamais
 * remplacé en silence.
 *
 * Garanties ACTUELLES verrouillées :
 *  - couverture : les rushes de l'utilisateur passent avant Médiathèque et
 *    stock, et ne sont jamais remplacés ;
 *  - plan multi-sources : un média FORCÉ dans un créneau y est repris tel
 *    quel ; indisponible, le repli est écrit dans `explications` ;
 *  - Autopilote : un rush mort est lâché ET signalé (`rushIgnore` + motif).
 *
 * Écarts constatés (BUG RÉEL, non corrigés ici) : marqués `it.fails` / `it.todo`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Harnais produireUnMontage (repris de autopilote-rush-ignore-metadata) ──
const renderAndUpload = vi.fn(async () => ({ videoUrl: 'https://cdn.test/rendu.mp4', thumbnailUrl: 'https://cdn.test/v.jpg', durationFrames: 900 }));
vi.mock('@/lib/autopilot/render', () => ({ renderAndUpload: (...a: unknown[]) => renderAndUpload(...(a as [])) }));
let rushPresent = true;
vi.mock('@/lib/autopilot/poster', () => ({
  rushEncorePresent: async () => rushPresent,
  probeRushSeconds: async () => 6,
  pickPosterUrl: async () => 'https://cdn.test/affiche.jpg',
  pickCustomPoster: () => null,
}));
vi.mock('@/lib/credits/system', () => ({ getVideoRenderCost: () => 10, deductCredits: async () => true }));
vi.mock('@/lib/credits/atomique', () => ({ referenceOperation: (p: string, id: string) => `${p}:${id}` }));
let insertions: Array<Record<string, unknown>> = [];
vi.mock('@/lib/db/supabase', () => {
  const from = () => ({
    insert(row: Record<string, unknown>) {
      insertions.push(row);
      return { select: async () => ({ data: [{ id: `p${insertions.length}` }], error: null }) };
    },
  });
  return { supabaseAdmin: { from }, supabase: { from } };
});

import { analyserCouvertureRushes } from '@/lib/stock/couverture';
import { planMultiSources } from '@/lib/autopilot/plan-multi-sources';
import { produireUnMontage } from '@/lib/autopilot/produire';
import { preparePosts } from '@/lib/autopilot/engine';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';

const R1 = 'https://studiio.pro/storage/v1/object/public/media/u1/rush-a.mp4';
const R2 = 'https://studiio.pro/storage/v1/object/public/media/u1/rush-b.mp4';
const SV1 = 'https://studiio.pro/storage/v1/object/public/media/u1/stock-pexels-video-111.mp4';
const P1 = 'https://images.pexels.com/photos/1/a.jpeg';
const AV = 'https://minio.test/videos/u1/avatar/gen-1.mp4';

describe('C-MEDIA-MANUAL — couverture : rushes utilisateur prioritaires', () => {
  it('stock listé en premier : les rushes de l’utilisateur prennent quand même les premiers plans, tous utilisés', () => {
    const c = analyserCouvertureRushes({
      plans: [{ cle: 'p1', role: 'HOOK' }, { cle: 'p2', role: 'BUILD' }, { cle: 'p3', role: 'PEAK' }],
      rushes: [
        { url: SV1, origine: 'stock', dureeSecondes: 8 },
        { url: R1, origine: 'utilisateur', dureeSecondes: 8 },
        { url: R2, origine: 'utilisateur', dureeSecondes: 8 },
      ],
      sujet: 'danse',
    });
    const parUrl = c.affectations.map((a) => a.rushUrl);
    expect(parUrl.slice(0, 2)).toEqual([R1, R2]);
    expect(c.affectations.filter((a) => a.origine === 'utilisateur')).toHaveLength(2);
    expect(c.rushesPersonnels).toBe(2);
  });
  it('plus de rushes utilisateur que de plans : aucun plan donné au stock', () => {
    const c = analyserCouvertureRushes({
      plans: [{ cle: 'p1', role: 'HOOK' }, { cle: 'p2', role: 'BUILD' }],
      rushes: [{ url: SV1, origine: 'stock', dureeSecondes: 8 }, { url: R1, origine: 'utilisateur', dureeSecondes: 8 }, { url: R2, origine: 'utilisateur', dureeSecondes: 8 }],
    });
    expect(c.affectations.every((a) => a.origine === 'utilisateur')).toBe(true);
  });
});

describe('C-MEDIA-MANUAL — plan multi-sources : média forcé', () => {
  const sources = { avatar: { url: AV, secondes: 20 }, rushes: [{ url: R1, secondes: 20 }], stockVideos: [{ url: SV1, secondes: 10 }], photos: [P1] };
  it('photo forcée dans un créneau « rush » : reprise telle quelle, à SA place', () => {
    const r = planMultiSources({ ...sources, cible: 20, gabarit: [{ id: 'a', type: 'auto' }, { id: 'b', type: 'rush', media: P1 }, { id: 'c', type: 'auto' }] });
    expect(r.plan[1]).toMatchObject({ url: P1 });
  });
  it('rush forcé dans un créneau « stock » : reprise tel quel', () => {
    const r = planMultiSources({ ...sources, cible: 20, gabarit: [{ id: 'a', type: 'avatar' }, { id: 'b', type: 'stock', media: R1 }, { id: 'c', type: 'avatar' }] });
    expect(r.plan.find((s) => s.url === R1)).toBeTruthy();
    expect(r.plan.some((s) => s.url === SV1)).toBe(false);
  });
  it('média forcé indisponible : repli DIT dans explications (jamais muet au niveau du plan)', () => {
    const r = planMultiSources({ ...sources, cible: 20, gabarit: [{ id: 'a', type: 'avatar' }, { id: 'b', type: 'stock', media: 'https://images.pexels.com/disparu.jpg' }, { id: 'c', type: 'avatar' }] });
    expect(r.explications.join(' ')).toMatch(/média choisi indisponible/);
  });

  // BUG RÉEL : le remplacement d'un média forcé n'est écrit que dans
  // `metadata.multiSources.explications` (produire.ts), qu'AUCUN écran ne lit
  // (ni Calendrier, ni composants) ; il n'entre pas non plus dans
  // `metadata.avertissements`, seule liste affichée par le Calendrier. Pour
  // l'utilisateur, le remplacement est donc silencieux.
  it.fails('le remplacement d’un média forcé est AFFICHÉ (Calendrier ou composant lit `explications`)', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/dashboard/calendar/page.tsx'), 'utf8');
    expect(page).toMatch(/explications/);
  });
});

describe('C-MEDIA-MANUAL — Autopilote : rush mort jamais remplacé en silence', () => {
  const T0 = Date.parse('2026-08-05T09:00:00.000Z');
  const cfg = (): AutopilotConfig => ({ ...DEFAULT_CONFIG, enabled: true, platforms: ['instagram'], rushUrls: [R1], voiceEnabled: false });
  const produire = async () => {
    const c = cfg();
    const post = preparePosts({ config: c, topic: 'routine du matin', count: 1, now: T0 })[0];
    const rendu = await produireUnMontage({ userId: 'u1', config: c, post, rang: 0, now: T0, jobId: 'autopilote-u1-2026-08-05-1' });
    return { rendu, meta: insertions[0]?.metadata as Record<string, unknown> };
  };
  beforeEach(() => { insertions = []; rushPresent = true; renderAndUpload.mockClear(); });

  it('rush expiré → lâché, `rushIgnore` + motif écrits dans le post', async () => {
    rushPresent = false;
    const { rendu, meta } = await produire();
    expect(rendu.rushUrl).toBeNull();
    expect(meta.rushIgnore).toBe(true);
    expect(meta.rushIgnoreMotif).toBe('rush expiré');
  });
  it('rush présent → gardé tel quel, aucun drapeau', async () => {
    const { rendu, meta } = await produire();
    expect(rendu.rushUrl).toBe(R1);
    expect(meta.rushIgnore).toBeUndefined();
    expect(meta.rushUrls).toEqual([R1]);
  });

  // BUG RÉEL : `rushIgnore` est écrit en metadata mais AUCUN écran ne le lit
  // (grep src/app, src/components : 0 occurrence) et `avertissementsMontage`
  // ne le reprend pas ; le Calendrier n'affiche que `metadata.avertissements`.
  // L'utilisateur ne voit donc pas que son rush a été écarté.
  it.fails('rush expiré → un avertissement AFFICHÉ par le Calendrier (`metadata.avertissements`) le dit', async () => {
    rushPresent = false;
    const { meta } = await produire();
    expect(Array.isArray(meta.avertissements)).toBe(true);
    expect((meta.avertissements as string[]).join(' ')).toMatch(/rush/i);
  });

  // BUG RÉEL (signalé par l'audit, à arbitrer) : `rushDuCreneau` (produire.ts:62),
  // quand la clé `sources` est réglée et que le rush pioché n'est plus dans les
  // rushes personnels ACTIFS, le remplace par un autre rush de la banque sans
  // rien écrire en metadata. Pas d'assertion : le rush pioché vient d'une
  // rotation (pas d'un choix manuel par créneau) — décision produit requise.
  it.todo('rushDuCreneau : un rush pioché remplacé par un autre rush est signalé dans le post');
});
