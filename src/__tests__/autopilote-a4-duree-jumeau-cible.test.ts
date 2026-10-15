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
  dureeEffectiveAvatarSeul, conseilDureeAvatar, DUREE_MIN_AVATAR_SEUL, DUREE_RECOMMANDEE_AVATAR,
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
        // A4 v2 : sous 20 s, la cible effective avec avatar est 30 s.
        const eff = dureeEffectiveAvatarSeul(cible) as number;
        const reste = eff - J;
        if (reste >= 8 && reste <= 21) expect(Math.abs(total - eff)).toBeLessThanOrEqual(0.2);
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
      const eff = dureeEffectiveAvatarSeul(cible) as number;
      expect(Math.abs(dureeRendue(d) - eff)).toBeLessThanOrEqual(tol(eff));
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

  it('cible minimale (5 s) : cible effective 30 s, jumeau entier', () => {
    const { post } = postPour(5);
    const d = buildAutopilotDesign(post, { jumeau: { videoUrl: 'https://x/j.mp4', seconds: 14 } });
    expect(d.videoDuration).toBe(14);
    expect(Math.abs(dureeRendue(d) - 30)).toBeLessThanOrEqual(0.2);
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

describe('A4 v2 — cible courte avec avatar : message complet ou 30 s', () => {
  const texteCarte0 = (post: ReturnType<typeof postPour>['post']) => {
    const c = post.content.cards[0];
    return [c.title, c.description, c.value].map((x) => (x ?? '').trim().replace(/[.\s]+$/, '')).filter(Boolean)[0];
  };
  for (const cible of [10, 15, 20, 30]) {
    it(`cible ${cible} s : accroche + idée + CTA, parole ≥ 7 s`, () => {
      const { post, config } = postPour(cible);
      const s = scriptJumeauMontage(post, config);
      expect(s.startsWith(post.title.trim())).toBe(true);
      expect(s).toContain(texteCarte0(post));
      expect(s.endsWith((post.brief?.cta || post.content.tagLine || '').trim().replace(/[.\s]+$/, ''))).toBe(true);
      expect(s.length / 14).toBeGreaterThanOrEqual(7);
      const eff = dureeEffectiveAvatarSeul(cible);
      expect(eff).toBe(cible < DUREE_MIN_AVATAR_SEUL ? DUREE_RECOMMANDEE_AVATAR : cible);
      const conseil = conseilDureeAvatar(cible, true);
      if (cible < 20) expect(conseil?.message).toContain('nous recommandons 30 s');
      else expect(conseil).toBeNull();
    });
  }

  it('30 s : script et montage identiques à A4 v1', () => {
    const { post, config } = postPour(30);
    const v1 = scriptPourDuree({ titre: post.title, sousTitre: post.content.subtitle, cartes: post.content.cards, cta: post.brief?.cta || post.content.tagLine, brief: post.brief, secondesReservees: 12 });
    expect(scriptJumeauMontage(post, config)).toBe(v1);
  });

  it('pas de conseil sans avatar seul ni sans cible', () => {
    expect(conseilDureeAvatar(15, false)).toBeNull();
    expect(conseilDureeAvatar(undefined, true)).toBeNull();
    expect(dureeEffectiveAvatarSeul(undefined)).toBeUndefined();
  });

  it('UI : le conseil s’affiche sous la durée et « Passer à 30 s » pose 30 s (clic explicite)', async () => {
    const React = await import('react');
    const { render, cleanup, fireEvent } = await import('@testing-library/react');
    const { default: BriefVideo } = await import('@/components/creer/BriefVideo');
    const onChange = vi.fn();
    const r = render(React.createElement(BriefVideo, { brief: { duree: 15 }, onChange, avecDureeRythme: true, conseilDuree: conseilDureeAvatar(15, true) }));
    const bloc = r.container.querySelector('[data-brief-conseil-duree]');
    expect(bloc?.textContent).toContain('15 s est trop court pour un message complet : nous recommandons 30 s');
    fireEvent.click(r.container.querySelector('[data-brief-conseil-duree-appliquer]') as Element);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ duree: 30 }));
    cleanup();
    const r2 = render(React.createElement(BriefVideo, { brief: { duree: 15 }, onChange, avecDureeRythme: true }));
    expect(r2.container.querySelector('[data-brief-conseil-duree]')).toBeNull();
    cleanup();
  });
});
