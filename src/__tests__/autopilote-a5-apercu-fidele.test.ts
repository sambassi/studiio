/**
 * A5 — l'aperçu de l'Autopilote prend LES MÊMES DÉCISIONS DE DURÉE que la
 * vidéo finale (`buildAutopilotDesign`).
 *
 * Parité testée : pour les cibles 20 / 30 / 45 / 60 s (et sans cible),
 *  - avec jumeau ESTIMÉ (avant génération : script du montage au débit du
 *    rythme) — ce que l'aperçu affiche ;
 *  - avec jumeau RÉEL (durée mesurée quelconque) — même règle des deux côtés ;
 *  - sans jumeau — l'aperçu d'avant, inchangé (4 / 6 / 6 / 4 s).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/supabase', () => ({ supabaseAdmin: {}, supabase: {} }));

import { preparePosts } from '@/lib/autopilot/engine';
import { buildAutopilotDesign } from '@/lib/autopilot/design';
import { buildAutopilotSample, postDeLEchantillon } from '@/lib/autopilot/sample';
import { scriptJumeauMontage as scriptPur } from '@/lib/autopilot/script-jumeau';
import { scriptJumeauMontage } from '@/lib/autopilot/jumeau-async';
import {
  dureeSequenceJumeau, dureesMontageJumeau, estimerParoleJumeau, etapesApercuAutopilote,
} from '@/lib/autopilot/durees-sequences';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import type { RythmeBrief } from '@/lib/creer/brief';

const ORDRE_JUMEAU = ['intro', 'cards', 'video', 'cta'];
const NOW = Date.UTC(2026, 9, 16);

/** Config « avatar seul » (sources par défaut : aucun rush, aucun stock). */
function configAvatar(duree?: number, rythme?: RythmeBrief, topics: string[] = ['finance']): AutopilotConfig {
  return {
    ...DEFAULT_CONFIG,
    topics,
    rushUrls: [],
    jumeauAvatar: true,
    brief: { ...(duree ? { duree } : {}), ...(rythme ? { rythme } : {}) },
  };
}

/** Le montage que le moteur prépare depuis l'aperçu (« Produire maintenant »). */
function postMoteur(config: AutopilotConfig) {
  const sample = buildAutopilotSample(config);
  const [post] = preparePosts({ config, topic: sample.topic, count: 1, now: NOW, seeds: [sample.seed] });
  return { sample, post };
}

function dureesDesign(d: ReturnType<typeof buildAutopilotDesign>) {
  return { intro: d.introDuration, cards: d.cardsDuration, video: d.videoDuration, cta: d.ctaDuration };
}
function dureesApercu(steps: Array<{ key: string; seconds: number }>) {
  return Object.fromEntries(steps.map((s) => [s.key, s.seconds]));
}

describe('A5 — script estimé : l’aperçu fait dire au jumeau EXACTEMENT le script du montage', () => {
  for (const topic of ['finance', 'yoga', 'nutrition', 'sommeil']) {
    for (const duree of [undefined, 20, 30, 45, 60]) {
      it(`${topic}, cible ${duree ?? 'aucune'}`, () => {
        const config = configAvatar(duree, undefined, [topic]);
        const { sample, post } = postMoteur(config);
        // Les cartes de l'aperçu = celles du montage (le brief ENTIER est appliqué).
        expect(sample.cards.map((c) => c.title)).toEqual(post.content.cards.slice(0, 5).map((c) => c.title));
        expect(scriptPur(postDeLEchantillon(sample, config.brief), config)).toBe(scriptJumeauMontage(post, config));
      });
    }
  }
});

describe('A5 — parité aperçu ↔ design final, jumeau ESTIMÉ', () => {
  for (const duree of [undefined, 20, 30, 45, 60]) {
    for (const rythme of [undefined, 'calme', 'dynamique'] as const) {
      it(`cible ${duree ?? 'aucune'}, rythme ${rythme ?? 'normal'}`, () => {
        const config = configAvatar(duree, rythme);
        const { sample, post } = postMoteur(config);
        const parole = estimerParoleJumeau(scriptPur(postDeLEchantillon(sample, config.brief), config), rythme);
        expect(parole).toBeGreaterThan(0);
        const apercu = dureesApercu(etapesApercuAutopilote({
          activeOrder: ORDRE_JUMEAU, paroleJumeau: parole, dureeCible: duree ?? null, avecCartes: sample.cards.length > 0,
        }));
        const design = dureesDesign(buildAutopilotDesign(post, { jumeau: { videoUrl: 'https://x/j.mp4', seconds: parole }, config }));
        expect(apercu).toEqual(design);
        // La séquence Vidéo n'est plus les 6 s fixes d'avant.
        expect(apercu.video).toBe(dureeSequenceJumeau(parole));
      });
    }
  }
});

describe('A5 — parité aperçu ↔ design final, jumeau RÉEL (durée mesurée)', () => {
  for (const duree of [undefined, 20, 30, 45, 60]) {
    for (const J of [7.3, 12, 18.46, 31, 44.9]) {
      it(`cible ${duree ?? 'aucune'}, jumeau ${J} s`, () => {
        const config = configAvatar(duree);
        const { sample, post } = postMoteur(config);
        const apercu = dureesApercu(etapesApercuAutopilote({
          activeOrder: ORDRE_JUMEAU, paroleJumeau: J, dureeCible: duree ?? null, avecCartes: sample.cards.length > 0,
        }));
        expect(apercu).toEqual(dureesDesign(buildAutopilotDesign(post, { jumeau: { videoUrl: 'https://x/j.mp4', seconds: J }, config })));
        expect(apercu).toEqual(dureesMontageJumeau({ paroleSecondes: J, dureeCible: duree, avecCartes: true }));
      });
    }
  }
});

describe('A5 — sans jumeau : l’aperçu d’avant, inchangé et fidèle', () => {
  const RUSH = 'https://studiio.pro/storage/v1/object/public/media/u/a.mp4';
  for (const duree of [undefined, 20, 30, 45, 60]) {
    it(`rush (durée non sondée), cible ${duree ?? 'aucune'} : 4 / 6 / 6 / 4 s = design`, () => {
      const config: AutopilotConfig = { ...DEFAULT_CONFIG, topics: ['finance'], rushUrls: [RUSH], brief: duree ? { duree } : {} };
      const { post } = postMoteur(config);
      const apercu = dureesApercu(etapesApercuAutopilote({ activeOrder: ORDRE_JUMEAU, paroleJumeau: null, dureeCible: duree ?? null, avecCartes: true }));
      // Les valeurs EXACTES d'avant A5 (constantes 4 / 6 / RUSH fallback 6 / 4).
      expect(apercu).toEqual({ intro: 4, cards: 6, video: 6, cta: 4 });
      expect(apercu).toEqual(dureesDesign(buildAutopilotDesign(post, { config })));
    });
  }
  it('sans séquence vidéo : titre / cartes / CTA 4 / 6 / 4 s', () => {
    const steps = etapesApercuAutopilote({ activeOrder: ['intro', 'cards', 'cta'], paroleJumeau: null, dureeCible: 30, avecCartes: true });
    expect(steps).toEqual([{ key: 'intro', seconds: 4 }, { key: 'cards', seconds: 6 }, { key: 'cta', seconds: 4 }]);
  });
});

describe('A5 — estimation de la parole', () => {
  it('longueur du script au débit de la voix de l’avatar (≈ 0,76 × le rythme), au dixième', () => {
    expect(estimerParoleJumeau('x'.repeat(106))).toBe(10);
    expect(estimerParoleJumeau('x'.repeat(91), 'calme')).toBe(10);
    expect(estimerParoleJumeau('x'.repeat(122), 'dynamique')).toBe(10);
    expect(estimerParoleJumeau('   ')).toBe(0);
  });
});
