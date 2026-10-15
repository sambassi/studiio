/**
 * A4 — Avec un jumeau, la vidéo finale respecte la durée cible du brief.
 *
 * Tolérance retenue : max(15 % de la cible, 3 s). 3 s couvre l'écart entre le
 * débit estimé du script (14 car./s) et la parole réelle de l'avatar sur les
 * cibles courtes ; 15 % le couvre sur les longues.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/supabase', () => ({ supabaseAdmin: {}, supabase: {} }));

import {
  enveloppeAutourDuJumeau, MINIMA_LISIBILITE_JUMEAU, secondesReserveesEnveloppeJumeau, scriptPourDuree, auDixiemeSuperieur,
} from '@/lib/autopilot/duree-cible';
import { preparePosts } from '@/lib/autopilot/engine';
import { buildAutopilotDesign } from '@/lib/autopilot/design';
import { scriptJumeauMontage } from '@/lib/autopilot/jumeau-async';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import { DEFAULT_SEQUENCE_SECONDS, buildSequences, totalDurationFrames } from '@/lib/creer/designSpec';

const tol = (cible: number) => Math.max(3, cible * 0.15);
const M = MINIMA_LISIBILITE_JUMEAU;

function postPour(duree: number | undefined, topic = 'finance') {
  const config: AutopilotConfig = { ...DEFAULT_CONFIG, brief: duree ? { duree } : {} };
  const [post] = preparePosts({ config, topic, count: 1, now: Date.UTC(2026, 9, 13), seeds: [7] });
  return { post, config };
}

/** Durée RÉELLE du montage, par la même règle que le rendu (buildSequences + images). */
function dureeRendue(d: ReturnType<typeof buildAutopilotDesign>) {
  const seqs = buildSequences({
    introDuration: d.introDuration ?? 4, cardsDuration: d.cardsDuration ?? 6, videoDuration: d.videoDuration ?? 0, ctaDuration: d.ctaDuration ?? 4,
    cardCount: d.cards?.length ?? 0, hasVideoBackground: !!d.videoUrl, videoRequested: !!d.videoUrl,
  });
  return totalDurationFrames(seqs, 30) / 30;
}

describe('A4 — matrice cible × durée du jumeau (montage)', () => {
  for (const cible of [15, 30, 45, 60]) {
    for (const J of [8, 15, 30, 45]) {
      it(`cible ${cible} s, jumeau ${J} s`, () => {
        const { post } = postPour(cible);
        const d = buildAutopilotDesign(post, { jumeau: { videoUrl: 'https://x/j.mp4', seconds: J } });
        const total = dureeRendue(d);
        // Le jumeau ENTIER, jamais coupé, au plus 3 images de marge.
        expect(d.videoDuration).toBeGreaterThanOrEqual(J);
        expect((d.videoDuration as number) - J).toBeLessThanOrEqual(0.1 + 1e-9);
        // Minima de lisibilité toujours tenus.
        expect(d.introDuration).toBeGreaterThanOrEqual(M.intro);
        expect(d.cardsDuration).toBeGreaterThanOrEqual(M.cards);
        expect(d.ctaDuration).toBeGreaterThanOrEqual(M.cta);
        expect(d.cards?.length).toBeGreaterThanOrEqual(1);
        const reste = cible - J;
        if (reste >= 8 && reste <= 21) expect(Math.abs(total - cible)).toBeLessThanOrEqual(0.2);
        else if (reste < 8) expect(total).toBeCloseTo(J + 8, 1); // cible trop courte : jumeau entier + minima
        else expect(total).toBeCloseTo(J + 21, 1); // jumeau trop court : enveloppe plafonnée à ×1,5
      });
    }
  }
});

describe('A4 — chaîne réelle : script dimensionné AVANT génération → montage', () => {
  for (const cible of [15, 30, 45, 60]) {
    it(`cible ${cible} s : total dans max(15 %, 3 s) quand la parole suit le débit estimé`, () => {
      const { post, config } = postPour(cible);
      const script = scriptJumeauMontage(post, config);
      const J = script.length / 14; // débit « normal » du brief
      const d = buildAutopilotDesign(post, { jumeau: { videoUrl: 'https://x/j.mp4', seconds: J } });
      expect(Math.abs(dureeRendue(d) - cible)).toBeLessThanOrEqual(tol(cible));
    });
  }

  it('avant A4, la même chaîne donnait ≈ cible + 14 s (régression évitée)', () => {
    const { post } = postPour(15);
    const scriptPlein = scriptJumeauMontage(post); // sans config = budget d'avant
    const J = scriptPlein.length / 14;
    const avantTotal = 4 + 6 + Math.ceil(J) + 4;
    expect(avantTotal - 15).toBeGreaterThan(tol(15));
  });
});

describe('A4 — dimensionnement du script', () => {
  it('avatar seul : budget = (cible − réserve) × débit ; réserve 8 → 14 s', () => {
    expect(secondesReserveesEnveloppeJumeau(15)).toBe(8);
    expect(secondesReserveesEnveloppeJumeau(30)).toBe(12);
    expect(secondesReserveesEnveloppeJumeau(45)).toBe(14);
    expect(secondesReserveesEnveloppeJumeau(60)).toBe(14);
    expect(secondesReserveesEnveloppeJumeau(undefined)).toBe(0);
    for (const cible of [15, 30, 45, 60]) {
      const { post, config } = postPour(cible);
      const s = scriptJumeauMontage(post, config);
      const plein = scriptJumeauMontage(post);
      expect(s.length).toBeLessThanOrEqual(plein.length);
      expect(s.length).toBeLessThanOrEqual(Math.max((cible - secondesReserveesEnveloppeJumeau(cible)) * 14, s.length));
    }
  });

  it('avatar AVEC autres sources (surimpression) : script INCHANGÉ — toute la cible', () => {
    const { post } = postPour(30);
    const config = {
      ...DEFAULT_CONFIG, brief: { duree: 30 },
      designStyle: { sources: { actives: { avatar: true, rushes: true, stock: true }, stock: [{ url: 'https://images.pexels.com/p.jpg', type: 'photo' }], gabarit: [] } },
    } as unknown as AutopilotConfig;
    expect(scriptJumeauMontage(post, config)).toBe(scriptJumeauMontage(post));
  });

  it('sans durée cible : script d’avant, réserve ignorée', () => {
    const { post, config } = postPour(undefined);
    expect(scriptJumeauMontage(post, config)).toBe(scriptJumeauMontage(post));
    expect(scriptPourDuree({ titre: 't', cartes: [], brief: {}, secondesReservees: 8 })).toBeNull();
  });
});

describe('A4 — répartition et arrondi', () => {
  it('jumeau plus long que la cible : jumeau entier + minima, jamais coupé', () => {
    const { post } = postPour(15);
    const d = buildAutopilotDesign(post, { jumeau: { videoUrl: 'https://x/j.mp4', seconds: 22.37 } });
    expect(d.videoDuration).toBe(22.4);
    expect([d.introDuration, d.cardsDuration, d.ctaDuration]).toEqual([M.intro, M.cards, M.cta]);
  });

  it('cible minimale (5 s) : minima + jumeau entier', () => {
    const { post } = postPour(5);
    const d = buildAutopilotDesign(post, { jumeau: { videoUrl: 'https://x/j.mp4', seconds: 2 } });
    expect([d.introDuration, d.cardsDuration, d.videoDuration, d.ctaDuration]).toEqual([2.5, 3, 2, 2.5]);
  });

  it('enveloppe au prorata 4/6/4, bornée par minima et ×1,5', () => {
    const D = DEFAULT_SEQUENCE_SECONDS;
    expect(enveloppeAutourDuJumeau(14, D, true)).toEqual({ intro: 4, cards: 6, cta: 4 });
    expect(enveloppeAutourDuJumeau(7, D, true)).toEqual({ intro: 2.5, cards: 3, cta: 2.5 });
    expect(enveloppeAutourDuJumeau(8.4, D, true)).toEqual({ intro: 2.5, cards: 3.4, cta: 2.5 });
    expect(enveloppeAutourDuJumeau(40, D, true)).toEqual({ intro: 6, cards: 9, cta: 6 });
    // Sans carte : la part des cartes revient au titre et au CTA.
    expect(enveloppeAutourDuJumeau(8, D, false)).toEqual({ intro: 4, cards: 6, cta: 4 });
  });

  it('séquence du jumeau au dixième supérieur (plus de ~1 s de blanc)', () => {
    expect(auDixiemeSuperieur(10.2)).toBe(10.2);
    expect(auDixiemeSuperieur(10.21)).toBe(10.3);
    const { post } = postPour(undefined);
    const d = buildAutopilotDesign(post, { jumeau: { videoUrl: 'https://x/j.mp4', seconds: 9.97 } });
    expect(d.videoDuration).toBe(10);
    const d2 = buildAutopilotDesign(post, { jumeau: { videoUrl: 'https://x/j.mp4', seconds: 10.2 } });
    expect(d2.videoDuration).toBe(10.2); // avant : 11 (0,8 s de blanc)
    // Sans durée cible : enveloppe 4/6/4 d'avant.
    expect([d2.introDuration, d2.cardsDuration, d2.ctaDuration]).toEqual([4, 6, 4]);
  });
});
