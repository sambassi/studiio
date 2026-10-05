/**
 * #503 — trois régressions réelles de DANSE (9), rendu AUTOPILOTE (post
 * `09325157`) :
 *  1. CTA : la config Autopilote porte `brief.cta` (« Réservez votre cours
 *     d'essai sur afroboost.com. ») mais le design ne l'envoyait pas :
 *     `ctaSubText` absent → `defaultProps` Remotion = « LIEN EN BIO ».
 *  2. Fin : noir et blanc lent à 22–25 s puis retour couleur (cartes dans
 *     l'ordre de DANSE (9), 30,3 s) — la reprise couleur n'était permise
 *     que sous le CTA.
 *  3. Accord badge ↔ plan : score MESURÉ partagé (mouvement, amplitude,
 *     lumière, lisibilité), sur toute la fenêtre de la carte.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import danse from '@/__tests__/fixtures/conseiller-danse.json';
import { buildAutopilotDesign } from '@/lib/autopilot/design';
import type { PreparedPost } from '@/lib/autopilot/engine';
import { planMontage, mesuresSegments, type AnalyseRush } from '@/lib/creer/smart-montage';
import {
  contexteMontageDepuis, rapportPlan, estNoirEtBlanc, ajustementTexteImage, matchCartesImages, memeTimecode, FENETRE_FLASH_S,
} from '@/lib/creer/smart-montage-regles';
import { planOverlays } from '@/lib/creer/overlays';

const CTA = 'Réservez votre cours d’essai sur afroboost.com.';
const post = (brief?: PreparedPost['brief']): PreparedPost => ({
  title: 'danse', caption: '', scheduledDate: '2026-10-05', scheduledTime: '18:00', platforms: [],
  rushUrl: 'https://exemple.test/rush.mp4',
  content: { subtitle: 'Danser active plus de muscles', tagLine: 'LE SPORT LE PLUS COMPLET', cards: [] } as unknown as PreparedPost['content'],
  ...(brief ? { brief } : {}),
});

// ── 1. CTA ────────────────────────────────────────────────────────────────
describe('Autopilote : le CTA du brief est la ligne d’action', () => {
  it('CTA utilisateur avec URL → présent tel quel, « LIEN EN BIO » absent ; headline gardée', () => {
    const d = buildAutopilotDesign(post({ cta: CTA }), {}) as { ctaText?: string; ctaSubText?: string };
    expect(d.ctaText).toBe('LE SPORT LE PLUS COMPLET');
    expect(d.ctaSubText).toBe(CTA);
    expect(d.ctaSubText).toContain('afroboost.com');
    expect(JSON.stringify(d)).not.toMatch(/LIEN EN BIO/i);
  });

  it('aucun CTA utilisateur → aucune ligne envoyée (le repli « LIEN EN BIO » du rendu reste permis)', () => {
    const d = buildAutopilotDesign(post(), {}) as { ctaSubText?: string };
    expect(d.ctaSubText).toBeUndefined();
    const vide = buildAutopilotDesign(post({ cta: '   ' }), {}) as { ctaSubText?: string };
    expect(vide.ctaSubText).toBeUndefined();
  });

  it('même règle que Créer (`avecCtaDuBrief`)', () => {
    expect(readFileSync(resolve(process.cwd(), 'src/lib/autopilot/design.ts'), 'utf-8')).toContain('avecCtaDuBrief({ cta: post.content.tagLine');
  });
});

// ── 2 + 3. DANSE (9) : ordre réel des cartes, plusieurs durées ─────────────
const analyses = danse.analyses as AnalyseRush[];
const TITRES = ['300+ MUSCLES', 'RISQUE RÉDUIT', 'CARDIO COMPLET', 'OS RENFORCÉS', 'ANTI-ÂGE'];
const contexte = contexteMontageDepuis({ theme: 'DANSE', titre: 'DANSE', sousTitre: 'Danser active plus de muscles que la plupart des sports', cartes: TITRES.map((title) => ({ title })) });

describe.each([24.288, 27, 30.3])('DANSE (9), %s s', (cible) => {
  const plan = planMontage(analyses, cible, { rythme: danse.rythme, contexte })!;
  const ms = mesuresSegments(plan, analyses)!;
  const r = rapportPlan('CARDIO_DANCE', ms, danse.rythme);
  const fin = plan.at(-1)!.fin;
  const dernieres = ms.filter((s) => s.fin > fin - 10);

  it('LAST_10S_BW_DURATION = 0 (couleur disponible), COLOR_BREAK_COUNT = 0, aucun plan très sombre', () => {
    const bw = dernieres.reduce((t, s) => t + (estNoirEtBlanc(s.saturation) ? s.fin - Math.max(s.debut, fin - 10) : 0), 0);
    expect(bw).toBe(0); // avant : 3,28 s à 30,3 s
    expect(r.COLOR_STYLE_BREAKS).toBe(0); // avant : 2
    expect(dernieres.filter((s) => (s.luminosite ?? 1) < 0.2)).toHaveLength(0);
  });

  it('reprises : jamais dans la fenêtre de 3 s, seulement en fin de vidéo et dites', () => {
    expect(r.RECENT_DUPLICATE_EXACT_COUNT).toBe(0);
    for (let i = 0; i < ms.length; i++) {
      for (let j = i + 1; j < ms.length; j++) {
        if (!memeTimecode(ms[i], ms[j])) continue;
        expect(ms[j].debut - ms[i].fin).toBeGreaterThanOrEqual(FENETRE_FLASH_S);
        expect(plan[j].fin).toBeGreaterThan(fin - 10);
        expect(plan[j].raison).toMatch(/repris/);
      }
    }
  });

  it('TEXT_VIDEO_VISUAL_FIT : « 300+ MUSCLES » et « CARDIO COMPLET » sur des plans lisibles et dynamiques', () => {
    const o = planOverlays({ duree: cible, nbCartes: 5, finHook: plan.filter((s) => s.phase === 'HOOK').at(-1)!.fin, profil: 'CARDIO_DANCE' });
    const m = matchCartesImages(ms, o.cartes, TITRES);
    const de = (t: string) => m.find((x) => x.titre === t)!;
    expect(de('300+ MUSCLES').ajustement!).toBeGreaterThanOrEqual(0.75);
    expect(de('CARDIO COMPLET').ajustement!).toBeGreaterThanOrEqual(0.75);
  });

  it('synchro #499 : coupes sur percussions inchangées en qualité', () => {
    expect(r.CUTS_IN_STRONG_ZONE_LE_80MS! / r.CUTS_IN_STRONG_ZONE!).toBeGreaterThanOrEqual(0.7);
    expect(r.CUTS_PERCUSSION_LE_80MS! / r.CUTS_TOTAL).toBeGreaterThanOrEqual(0.7);
  });
});

describe('TEXT_VIDEO_VISUAL_FIT : la règle', () => {
  it('un contre-jour très sombre est pénalisé, même en mouvement ; un plan lumineux et actif l’emporte', () => {
    const sombre = ajustementTexteImage({ energie: 0.9, luminosite: 0.12, amplitude: 0.9, nettete: 0.4 }, true)!;
    const clair = ajustementTexteImage({ energie: 0.9, luminosite: 0.5, amplitude: 0.9, nettete: 0.6 }, true)!;
    const statique = ajustementTexteImage({ energie: 0.1, luminosite: 0.5, amplitude: 0.1, nettete: 0.6 }, true)!;
    expect(clair).toBeGreaterThan(sombre + 0.25);
    expect(clair).toBeGreaterThan(statique + 0.3);
    expect(sombre).toBeLessThan(0.75);
  });

  it('carte non énergique : la lisibilité pèse plus que le mouvement', () => {
    const calmeLisible = ajustementTexteImage({ energie: 0.3, luminosite: 0.5, nettete: 0.8 }, false)!;
    const agiteSombre = ajustementTexteImage({ energie: 0.9, luminosite: 0.15, nettete: 0.3 }, false)!;
    expect(calmeLisible).toBeGreaterThan(agiteSombre);
  });

  it('le montage l’utilise sous les cartes énergiques (même moteur Créer + Autopilote)', () => {
    const s = readFileSync(resolve(process.cwd(), 'src/lib/creer/smart-montage.ts'), 'utf-8');
    expect(s).toContain('ajustementTexteImage({ energie, luminosite: m.luminosite');
  });
});
