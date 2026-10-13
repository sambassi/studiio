/**
 * COHÉRENCE D'UN PROJET — aperçu = rendu = metadata = Calendrier.
 *
 * Bugs constatés en production (2026-10-12) :
 *
 * 1. L'Autopilote produisait « NUTRITION — Nutrition et microbiote : ton
 *    second cerveau influence tout » alors que l'utilisateur venait de régler
 *    un autre projet : « Produire maintenant » tirait son PROPRE sujet et sa
 *    propre variante, sans rapport avec l'aperçu.
 * 2. Le CTA du brief n'était substitué qu'au rendu : l'aperçu montrait le
 *    sous-texte généré, la vidéo et le Calendrier celui du brief.
 * 3. Un sous-texte vide (`''`) était relu par le Calendrier comme absent et
 *    remplacé par le CTA PRINCIPAL — peint deux fois à la régénération.
 *
 * Ces tests exécutent les VRAIES fonctions (échantillon, choix du sujet,
 * préparation, design, metadata, adaptateur Calendrier, `drawCTA`) et
 * comparent les textes produits. Aucun ne relit le source.
 */
import { describe, it, expect } from 'vitest';
import { buildAutopilotSample } from '@/lib/autopilot/sample';
import { choisirContenuManuel, signatureApercuAutopilote } from '@/lib/autopilot/contenu-manuel';
import { preparePosts } from '@/lib/autopilot/engine';
import { buildAutopilotDesign, buildAutopilotMetadata } from '@/lib/autopilot/design';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import { signatureContenu } from '@/lib/creer/signature-contenu';
import { avecCtaDuBrief, suivreCtaDuBrief } from '@/lib/creer/validation-rendu';
import { optionsRenduDepuisMetadata } from '@/lib/rendus/options-depuis-metadata';
import { drawCTA } from '@/lib/video-composer';
import { creditsFournisseurEpuises, MESSAGES_AVATAR, trahitUnFournisseur } from '@/lib/avatar/fournisseurs';

const NOW = Date.UTC(2026, 9, 12, 17, 31);

const PROJET_A = { topics: ['danse'], brief: { cta: 'ESSAYER MAINTENANT' } };
const PROJET_B = { topics: ['nutrition'], brief: { cta: 'LIEN EN BIO' } };

function config(p: { topics: string[]; brief: { cta: string } }): AutopilotConfig {
  return { ...DEFAULT_CONFIG, topics: p.topics, brief: p.brief, mode: 'review', platforms: [] };
}

/** Le chemin COMPLET de « Produire maintenant », de l'écran au post enregistré. */
function produireDepuisApercu(p: typeof PROJET_A, recents: string[]) {
  const cfg = config(p);
  const signatureEcran = signatureApercuAutopilote(cfg);
  const choix = choisirContenuManuel({ config: cfg, apercuSignature: signatureEcran, recents, now: NOW });
  if (!choix.ok) throw new Error(choix.message);
  const [post] = preparePosts({ config: cfg, topic: choix.topic, count: 1, now: NOW, seeds: choix.seeds });
  const design = buildAutopilotDesign(post, { config: cfg });
  const metadata = buildAutopilotMetadata({ post, design, videoUrl: 'https://studiio.pro/x.mp4', mode: 'review' });
  return { cfg, signatureEcran, post, design, metadata };
}

/** Textes peints par le VRAI `drawCTA` sur un contexte qui enregistre. */
function textesCta(o: ReturnType<typeof optionsRenduDepuisMetadata>): string[] {
  const peints: string[] = [];
  const etat: Record<string, unknown> = { globalAlpha: 1, filter: 'none' };
  const degrade = { addColorStop: () => {} };
  const base: Record<string, unknown> = {
    measureText: (t: string) => ({ width: Array.from(t).length * 10 }),
    fillText: (t: string) => { peints.push(t); },
    strokeText: () => {}, save: () => {}, restore: () => {}, translate: () => {}, rotate: () => {},
    scale: () => {}, setTransform: () => {}, beginPath: () => {}, closePath: () => {}, moveTo: () => {},
    lineTo: () => {}, arc: () => {}, rect: () => {}, roundRect: () => {}, clip: () => {}, fill: () => {},
    stroke: () => {}, setLineDash: () => {}, fillRect: () => {}, clearRect: () => {}, strokeRect: () => {},
    drawImage: () => {}, createLinearGradient: () => degrade, createRadialGradient: () => degrade,
    createPattern: () => null,
  };
  const ctx = new Proxy(base, {
    get: (t, k) => (k in t ? (t as never)[k] : etat[k as string]),
    set: (_t, k, v) => { etat[k as string] = v; return true; },
    has: () => true,
  }) as unknown as CanvasRenderingContext2D;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = o as any;
  drawCTA(ctx, 1080, 1920, '#7C3AED', a.ctaText, a.ctaSubText, undefined, a.watermarkText, null, 1, a.design);
  return peints;
}

describe('1. Projet A puis B — aucune contamination croisée (Autopilote)', () => {
  for (const [nom, p, autre] of [['A (DANSE)', PROJET_A, PROJET_B], ['B (NUTRITION)', PROJET_B, PROJET_A]] as const) {
    it(`${nom} : le post produit EST l'aperçu, et rien de l'autre projet`, () => {
      // L'autre projet vient d'être produit : il figure dans les sujets récents.
      const r = produireDepuisApercu(p, autre.topics);
      const apercu = buildAutopilotSample(r.cfg);

      expect(r.design.title).toBe(p.topics[0].toUpperCase());
      expect(r.design.title).toBe(apercu.title);
      expect(r.design.subtitle).toBe(apercu.subtitle);
      expect((r.design.cards ?? []).map((c) => c.title)).toEqual(apercu.cards.map((c) => c.title));
      // CTA : la ligne d'action du brief, à l'aperçu comme à la vidéo.
      expect(apercu.ctaSub || apercu.cta).toBe(p.brief.cta);
      expect(r.design.ctaText).toBe(apercu.cta);
      expect(r.design.ctaSubText ?? '').toBe(apercu.ctaSub);

      // Empreinte : aperçu = rendu = metadata.
      const rendu = signatureContenu({
        title: r.design.title, subtitle: r.design.subtitle, cards: r.design.cards,
        cta: r.design.ctaText, ctaSub: r.design.ctaSubText,
      });
      expect(rendu).toBe(r.signatureEcran);

      // Rien de l'autre projet, nulle part dans ce qui part en base.
      const tout = JSON.stringify({ design: r.design, metadata: r.metadata, caption: r.post.caption, title: r.post.title });
      expect(tout).not.toContain(autre.topics[0].toUpperCase());
      expect(tout).not.toContain(autre.brief.cta);
    });
  }

  it("le sujet n'est plus tiré ailleurs : sans thème coché, l'aperçu et le post restent le même sujet", () => {
    const cfg = { ...DEFAULT_CONFIG, topics: [] as string[], brief: {} };
    const sig = signatureApercuAutopilote(cfg);
    // Toutes les minutes d'une heure : jamais un autre sujet que l'aperçu.
    for (let m = 0; m < 60; m += 1) {
      const choix = choisirContenuManuel({ config: cfg, apercuSignature: sig, recents: [], now: NOW + m * 60_000 });
      expect(choix.ok && choix.topic).toBe(buildAutopilotSample(cfg).topic);
    }
  });

  it('aperçu périmé (réglages changés ailleurs) : refus, jamais un autre contenu', () => {
    const sigA = signatureApercuAutopilote(config(PROJET_A));
    const choix = choisirContenuManuel({ config: config(PROJET_B), apercuSignature: sigA, recents: [], now: NOW });
    expect(choix.ok).toBe(false);
  });

  it('sans empreinte (ancien écran) : la rotation d\'avant, inchangée', () => {
    const choix = choisirContenuManuel({ config: config(PROJET_A), recents: [], now: NOW });
    expect(choix).toMatchObject({ ok: true, topic: 'danse', depuisApercu: false });
    expect((choix as { seeds?: number[] }).seeds).toBeUndefined();
  });
});

describe('2-3. CTA aperçu = CTA export = CTA Calendrier (Créer)', () => {
  const genere = { title: 'T', subtitle: 'S', cards: [], cta: 'REJOINS LE MOUVEMENT', ctaSub: 'LIEN EN BIO' };

  it('le brief entre dans l\'état au fil de la frappe — l\'aperçu le montre', () => {
    let etat = avecCtaDuBrief(genere, {});
    let ancien = '';
    for (const frappe of ['E', 'ES', 'ESSAYER', 'ESSAYER MAINTENANT']) {
      etat = suivreCtaDuBrief(etat, ancien, frappe, 'LIEN EN BIO');
      ancien = frappe;
    }
    expect(etat).toMatchObject({ cta: 'REJOINS LE MOUVEMENT', ctaSub: 'ESSAYER MAINTENANT' });
    // Brief vidé : la petite ligne d'origine revient.
    expect(suivreCtaDuBrief(etat, ancien, '', 'LIEN EN BIO').ctaSub).toBe('LIEN EN BIO');
    // Le rendu n'applique plus rien au contenu courant : déjà présent = inchangé.
    expect(avecCtaDuBrief(etat, { cta: 'ESSAYER MAINTENANT' })).toBe(etat);
  });

  it('saisie manuelle du sous-texte : elle gagne, à l\'aperçu comme à la vidéo', () => {
    const etat = { ...suivreCtaDuBrief(genere, '', 'ESSAYER MAINTENANT'), ctaSub: 'MA LIGNE À MOI' };
    // Brief inchangé : rien ne la réécrit.
    expect(suivreCtaDuBrief(etat, 'ESSAYER MAINTENANT', 'ESSAYER MAINTENANT')).toBe(etat);
  });

  for (const [nom, ctaSub, attendu] of [
    ['sous-texte rempli', 'ESSAYER MAINTENANT', ['REJOINS LE MOUVEMENT', 'ESSAYER MAINTENANT']],
    ['sous-texte éteint', '', ['REJOINS LE MOUVEMENT']],
  ] as const) {
    it(`${nom} : metadata Créer → « Régénérer » → drawCTA peint exactement l'aperçu`, () => {
      const metadata = {
        branding: { ctaText: 'REJOINS LE MOUVEMENT', ctaSubText: ctaSub, watermarkText: 'REJOINS LE MOUVEMENT' },
        design: { ctaMainText: 'REJOINS LE MOUVEMENT', ctaSubText: ctaSub },
        sequences: { intro: 5, cards: 0, video: 0, cta: 5, order: ['intro', 'cta'] },
      };
      const o = optionsRenduDepuisMetadata({ title: 'T', metadata }, 'regenerer', { cards: [] });
      expect(textesCta(o)).toEqual([...attendu]);
    });
  }

  it('Autopilote sans brief : la vidéo n\'a pas de petite ligne — le Calendrier non plus', () => {
    const cfg = { ...DEFAULT_CONFIG, topics: ['danse'], brief: {} };
    const [post] = preparePosts({ config: cfg, topic: 'danse', count: 1, now: NOW });
    const design = buildAutopilotDesign(post, { config: cfg });
    const metadata = buildAutopilotMetadata({ post, design, videoUrl: 'https://studiio.pro/x.mp4', mode: 'review' });
    expect((metadata.design as { ctaSubText?: string }).ctaSubText).toBe('');
    const o = optionsRenduDepuisMetadata({ title: post.title, metadata }, 'regenerer', { cards: [] });
    const peints = textesCta(o);
    expect(peints.filter((t) => t === design.ctaText)).toHaveLength(1);
    expect(peints).toEqual([design.ctaText]);
  });
});

describe('5. Avatar — refus « crédits API » du fournisseur', () => {
  it('reconnu à partir du message réel de production', () => {
    expect(creditsFournisseurEpuises("Insufficient credit. This operation requires 'api' credits.")).toBe(true);
    expect(creditsFournisseurEpuises('avatar not found')).toBe(false);
    expect(creditsFournisseurEpuises(null)).toBe(false);
  });

  it('messages explicites, sans nom de fournisseur', () => {
    for (const m of [MESSAGES_AVATAR.creditsFournisseurAdmin, MESSAGES_AVATAR.creditsFournisseur, MESSAGES_AVATAR.creditsFournisseurRembourse]) {
      expect(trahitUnFournisseur(m)).toBe(false);
      expect(m.startsWith('La génération de la vidéo avec votre avatar a échoué.')).toBe(true);
    }
    expect(MESSAGES_AVATAR.creditsFournisseurAdmin).toMatch(/crédits API/);
  });
});
