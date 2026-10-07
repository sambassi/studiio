import { describe, it, expect } from 'vitest';
import { phrasesCartes, texteCartes, phrasesDansTexte, segmentsPhrases } from '@/lib/voice/phrases-cartes';
import { planOverlays } from '@/lib/creer/overlays';
import { buildAutoFillText } from '@/lib/types/voice';
import { segmentsCartes } from '@/lib/autopilot/voice';
import { normaliserPourTTS } from '@/lib/voice/normalisation-tts';
import type { PreparedPost } from '@/lib/autopilot/engine';

/**
 * Synchro voix off ↔ cartes en surimpression : chaque carte apparaît quand
 * la voix COMMENCE sa phrase. Aucun moteur réel : un « moteur simulé » parle
 * à débit constant (lettres) avec une courte pause par ponctuation.
 */

/** Tolérance explicite : 150 ms entre le début de la phrase et l'apparition. */
const TOLERANCE_S = 0.15;

const CARTES = [
  { label: 'Cardio', description: 'Brûle les graisses', value: '76%' },
  { label: 'Force', description: 'Muscle tout le corps en profondeur, sans matériel', value: '3x' },
  { label: 'Souffle', description: 'Selon le NEJM', value: '+2%/an' },
];

/** Moteur simulé : 0,07 s par lettre/chiffre, 0,2 s par pause. Rend les débuts RÉELS de chaque phrase. */
function moteurSimule(phrasesDites: string[]) {
  const duree = (t: string) => (t.match(/[\p{L}\p{N}]/gu)?.length ?? 0) * 0.07 + (t.match(/[.!?…;:,]/g)?.length ?? 0) * 0.2;
  const debuts: number[] = [];
  let t = 0;
  phrasesDites.forEach((p, i) => {
    debuts.push(t);
    t += duree(p) + (i < phrasesDites.length - 1 ? 0.2 : 0);
  });
  return { debuts, total: t };
}

describe('une seule liste de phrases pilote texte, ordre et apparition', () => {
  it('le texte narré des cartes est inchangé (même chaîne qu’avant)', () => {
    const ancien = CARTES
      .map((c) => [c.label, c.description, c.value].filter((s) => s && String(s).trim().length > 0).join('. '))
      .filter((s) => s.length > 0).join(' ').trim();
    expect(texteCartes(phrasesCartes(CARTES))).toBe(ancien);
    expect(buildAutoFillText({ title: 't', cards: CARTES }).cartes).toBe(ancien);
  });

  it('une carte vide garde le rang des suivantes', () => {
    const p = phrasesCartes([CARTES[0], { label: '', description: '', value: '' }, CARTES[2]]);
    expect(p.map((x) => x.index)).toEqual([0, 2]);
  });

  it('texte tronqué : la phrase coupée garde sa partie dite, la suivante disparaît', () => {
    const p = phrasesCartes(CARTES);
    const texte = texteCartes(p).slice(0, p[0].texte.length + 1 + 6);
    expect(phrasesDansTexte(p, texte)).toEqual([p[0], { index: 1, texte: 'Force.' }]);
  });
});

describe('phrase N audio → ligne N', () => {
  const dites = phrasesCartes(CARTES).map((p) => ({ index: p.index, dit: normaliserPourTTS(p.texte) }));
  const reel = moteurSimule(dites.map((d) => d.dit));

  it('les segments retombent sur les débuts réels des phrases, à la tolérance près', () => {
    const seg = segmentsPhrases(dites, reel.total);
    expect(seg.map((s) => s.index)).toEqual([0, 1, 2]);
    seg.forEach((s, i) => expect(Math.abs(s.debut - reel.debuts[i])).toBeLessThanOrEqual(TOLERANCE_S));
    expect(seg[0].debut).toBe(0);
    expect(seg.at(-1)!.fin).toBe(Math.round(reel.total * 1000) / 1000);
  });

  it('planOverlays : carte 1 / 2 / 3 apparaissent au début des phrases 1 / 2 / 3', () => {
    const seg = segmentsPhrases(dites, reel.total);
    const o = planOverlays({ duree: 30, nbCartes: 3, voix: { titre: 2, cartes: reel.total, cta: 2 }, phrasesCartes: seg });
    const depart = o.voix.cartes!;
    expect(o.cartes.map((c) => c.index)).toEqual([0, 1, 2]);
    o.cartes.forEach((c, i) => expect(Math.abs(c.debut - (depart + reel.debuts[i]))).toBeLessThanOrEqual(TOLERANCE_S));
    // Jamais deux cartes à la fois, jamais sous le CTA.
    o.cartes.slice(1).forEach((c, i) => expect(c.debut).toBeGreaterThanOrEqual(o.cartes[i].fin));
    expect(o.cartes.at(-1)!.fin).toBeLessThanOrEqual(o.cta![0]);
  });

  it('voix du titre plus longue : la voix des cartes est décalée, les cartes AUSSI', () => {
    const seg = segmentsPhrases(dites, reel.total);
    const court = planOverlays({ duree: 40, nbCartes: 3, voix: { titre: 2, cartes: reel.total }, phrasesCartes: seg });
    const long = planOverlays({ duree: 40, nbCartes: 3, voix: { titre: 9, cartes: reel.total }, phrasesCartes: seg });
    const decalage = long.voix.cartes! - court.voix.cartes!;
    expect(decalage).toBeGreaterThan(0);
    long.cartes.forEach((c, i) => expect(c.debut).toBeCloseTo(court.cartes[i].debut + decalage, 3));
  });

  it('les prononciations (NEJM → Nèjm) entrent dans le calcul : texte DIT, pas affiché', () => {
    const post = { content: { cards: CARTES.map((c) => ({ title: c.label, description: c.description, value: c.value })) } } as unknown as PreparedPost;
    const texte = texteCartes(phrasesCartes(CARTES));
    const seg = segmentsCartes(post, texte, reel.total, normaliserPourTTS);
    expect(seg).toEqual(segmentsPhrases(dites, reel.total));
  });
});

describe('rétro-compatibilité', () => {
  it('sans phrases, planOverlays rend exactement les fenêtres d’avant', () => {
    const base = { duree: 30, nbCartes: 3, voix: { titre: 2, cartes: 6, cta: 2 } };
    expect(planOverlays({ ...base, phrasesCartes: null })).toEqual(planOverlays(base));
    expect(planOverlays({ ...base, phrasesCartes: [] })).toEqual(planOverlays(base));
  });

  it('phrases sans voix des cartes : rien ne change', () => {
    const seg = [{ index: 0, debut: 0, fin: 2 }];
    expect(planOverlays({ duree: 30, nbCartes: 3, phrasesCartes: seg })).toEqual(planOverlays({ duree: 30, nbCartes: 3 }));
  });

  it('durée inconnue ou texte vide : aucun segment', () => {
    expect(segmentsPhrases([{ index: 0, dit: 'a' }], 0)).toEqual([]);
    expect(segmentsPhrases([], 5)).toEqual([]);
  });
});
