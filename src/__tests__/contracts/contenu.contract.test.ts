/**
 * CONTRAT C-CONTENT — le contenu de l'aperçu EST celui du rendu ET celui du
 * Calendrier.
 *
 *  - Autopilote : aperçu (`sample.ts`) = post préparé (`engine.ts`) = design
 *    rendu (`design.ts`) = metadata = options relues par le Calendrier.
 *  - Créer : les deux moteurs (compositeur navigateur, Remotion) assemblent
 *    avec la même spécification (`designSpec.buildSequences`), et le contrat
 *    de design canonique relit/réécrit une metadata À L'IDENTIQUE.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAutopilotSample } from '@/lib/autopilot/sample';
import { choisirContenuManuel, signatureApercuAutopilote } from '@/lib/autopilot/contenu-manuel';
import { preparePosts } from '@/lib/autopilot/engine';
import { buildAutopilotDesign, buildAutopilotMetadata } from '@/lib/autopilot/design';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import { signatureContenu } from '@/lib/creer/signature-contenu';
import { optionsRenduDepuisMetadata } from '@/lib/rendus/options-depuis-metadata';
import { buildSequences } from '@/lib/creer/designSpec';
import { fromPostMetadata, toPostMetadata } from '@/lib/creer/postMetadata';
import { ADVANCED_METADATA, ASSISTANT_METADATA } from '../fixtures/canonical-design';

const NOW = Date.UTC(2026, 9, 12, 17, 31);
const PROJETS: Array<{ topics: string[]; brief: Record<string, unknown> }> = [
  { topics: ['danse'], brief: { cta: 'ESSAYER MAINTENANT' } },
  { topics: ['finance'], brief: { cta: 'Commence maintenant', duree: 30 } },
  { topics: ['nutrition'], brief: {} },
];

function produire(p: (typeof PROJETS)[number], recents: string[] = []) {
  const cfg: AutopilotConfig = { ...DEFAULT_CONFIG, topics: p.topics, brief: p.brief, mode: 'review', platforms: [] };
  const signatureEcran = signatureApercuAutopilote(cfg);
  const choix = choisirContenuManuel({ config: cfg, apercuSignature: signatureEcran, recents, now: NOW });
  if (!choix.ok) throw new Error(choix.message);
  const [post] = preparePosts({ config: cfg, topic: choix.topic, count: 1, now: NOW, seeds: choix.seeds });
  const design = buildAutopilotDesign(post, { config: cfg });
  const metadata = buildAutopilotMetadata({ post, design, videoUrl: 'https://studiio.pro/x.mp4', mode: 'review' });
  return { cfg, signatureEcran, post, design, metadata, apercu: buildAutopilotSample(cfg) };
}

describe('C-CONTENT — Autopilote : aperçu = rendu = Calendrier', () => {
  it.each(PROJETS.map((p) => [p.topics[0], p] as const))('%s : titre, sous-titre, cartes, CTA identiques partout', (_n, p) => {
    const r = produire(p, ['autre-sujet']);
    // Aperçu → rendu
    expect(r.design.title).toBe(r.apercu.title);
    expect(r.design.subtitle).toBe(r.apercu.subtitle);
    expect((r.design.cards ?? []).map((c) => [c.title, c.value])).toEqual(r.apercu.cards.map((c) => [c.title, c.value]));
    expect(r.design.ctaText).toBe(r.apercu.cta);
    expect(r.design.ctaSubText ?? '').toBe(r.apercu.ctaSub);
    // Empreinte de l'écran = empreinte du rendu
    expect(signatureContenu({ title: r.design.title, subtitle: r.design.subtitle, cards: r.design.cards, cta: r.design.ctaText, ctaSub: r.design.ctaSubText })).toBe(r.signatureEcran);
    // Rendu → metadata (ce que le Calendrier relit)
    const m = r.metadata as Record<string, unknown>;
    expect((m.cards as Array<{ title: string }>).map((c) => c.title)).toEqual(r.apercu.cards.map((c) => c.title));
    expect(m.subtitle).toBe(r.apercu.subtitle);
    // Metadata → options de « Régénérer » du Calendrier
    const o = optionsRenduDepuisMetadata({ title: r.post.title, metadata: m }, 'regenerer', { cards: m.cards as never });
    expect(o.subtitle ?? '').toBe(r.apercu.subtitle); // '' et absent = pas de sous-titre
    expect((o.cards ?? []).map((c: { title: string }) => c.title)).toEqual(r.apercu.cards.map((c) => c.title));
  });

  it('aperçu périmé (réglages changés) : refus, jamais un autre contenu à la place', () => {
    const a = { ...DEFAULT_CONFIG, topics: ['danse'], brief: {} };
    const b = { ...DEFAULT_CONFIG, topics: ['nutrition'], brief: {} };
    expect(choisirContenuManuel({ config: b, apercuSignature: signatureApercuAutopilote(a), recents: [], now: NOW }).ok).toBe(false);
  });
});

describe('C-CONTENT — Créer : une seule spécification pour l’aperçu et les deux moteurs', () => {
  const lire = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  it('compositeur navigateur, Remotion et entrée serveur appellent buildSequences de designSpec', () => {
    const composer = lire('src/lib/video-composer.ts');
    expect(composer).toContain("from '@/lib/creer/designSpec'");
    expect(composer).toContain('buildSequences({');
    const remotion = lire('remotion/CreerSimpleMontage.tsx');
    expect(remotion).toContain("from '../src/lib/creer/designSpec'");
    expect(remotion).toContain('buildSequences({');
    expect(lire('src/lib/render/creerSimple.ts')).toContain('buildSequences({');
    expect(lire('remotion/index.tsx')).toContain('durationInFrames: totalDurationFrames(sequences, 30)');
  });

  it('buildSequences : ordre canonique et durées, déterministe', () => {
    const e = { introDuration: 4, cardsDuration: 6, videoDuration: 5, ctaDuration: 4, cardCount: 3, hasVideoBackground: true, videoRequested: true };
    const s = buildSequences(e as never);
    expect(s.map((x: { type: string }) => x.type)).toEqual(['intro', 'cards', 'video', 'cta']);
    expect(buildSequences(e as never)).toEqual(s);
  });

  it.each([['éditeur avancé', ADVANCED_METADATA], ['assistant', ASSISTANT_METADATA]] as const)(
    '%s : metadata relue puis réécrite à l’identique (le Calendrier relit ce qui a été validé)',
    (_n, meta) => {
      expect(toPostMetadata(fromPostMetadata(meta), meta)).toStrictEqual(meta);
    },
  );
});
