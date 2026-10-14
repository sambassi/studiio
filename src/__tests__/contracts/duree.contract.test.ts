/**
 * CONTRAT C-DUREE — Autopilote : la durée cible et le rythme sont respectés,
 * par CONCEPTION (unités entières), jamais par troncature.
 * Validé par #563 (src/lib/autopilot/duree-cible.ts).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/supabase', () => ({ supabaseAdmin: {}, supabase: {} }));

import { contenuPourDuree, minutagePlan, scriptPourDuree } from '@/lib/autopilot/duree-cible';
import { gabaritSuggere } from '@/lib/autopilot/medias-prevus';
import { preparePosts } from '@/lib/autopilot/engine';
import { buildAutopilotDesign } from '@/lib/autopilot/design';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import { generateSmartContent } from '@/lib/smart-content';

const NOW = Date.UTC(2026, 9, 13);
const contenu = generateSmartContent('finance', 7);

describe('C-DUREE — contenu conçu pour la durée', () => {
  it('chaque carte gardée est une carte d’origine ENTIÈRE ; plus de cartes à 45 s qu’à 15 s ; jamais zéro', () => {
    for (const duree of [15, 30, 45]) {
      const c = contenuPourDuree(contenu, 'finance', { duree });
      expect(c.cards.length).toBeGreaterThanOrEqual(1);
      for (const carte of c.cards) expect(contenu.cards).toContainEqual(carte);
    }
    expect(contenuPourDuree(contenu, 'finance', { duree: 15 }).cards.length)
      .toBeLessThan(contenuPourDuree(contenu, 'finance', { duree: 45 }).cards.length);
  });

  it('sans durée cible : contenu inchangé (rétro-compatibilité)', () => {
    expect(contenuPourDuree(contenu, 'finance', {})).toBe(contenu);
  });

  it('script avatar : phrases d’origine complètes, CTA en dernier, borné par la durée', () => {
    const cartes = contenu.cards;
    const s = (duree: number) => scriptPourDuree({ titre: 'Finance', sousTitre: contenu.subtitle, cartes, cta: 'Commence maintenant', brief: { duree } })!;
    for (const d of [15, 30, 45]) {
      expect(s(d).endsWith('Commence maintenant')).toBe(true);
      expect(s(d).length).toBeLessThanOrEqual(d * 14 + 2);
    }
    expect(s(15).length).toBeLessThan(s(45).length);
    // Aucune carte coupée : un titre de carte présent dans le script y est en entier, suivi de sa suite.
    const s45 = s(45);
    for (const c of cartes) {
      const unite = [c.title, c.description, c.value].filter(Boolean).join('. ').replace(/[.\s]+$/, '');
      if (s45.includes(c.title)) expect(s45).toContain(unite);
    }
  });

  it('rythme : calme ≤ dynamique en texte ; séquences calculées (15 s Normal = 4, 30 s Dynamique = 12, 45 s Calme = 9)', () => {
    const sc = (rythme: 'calme' | 'dynamique') => scriptPourDuree({ titre: 'finance', sousTitre: contenu.subtitle, cartes: contenu.cards, cta: contenu.tagLine, brief: { duree: 30, rythme } })!;
    expect(sc('calme').length).toBeLessThanOrEqual(sc('dynamique').length);
    const n = (dureeSecondes: number, rythme: 'normal' | 'dynamique' | 'calme') => gabaritSuggere({ avatar: true, rushes: 1, stock: 12 }, { dureeSecondes, rythme }).length;
    expect(n(15, 'normal')).toBe(4);
    expect(n(30, 'dynamique')).toBe(12);
    expect(n(45, 'calme')).toBe(9);
  });

  it('minutage : contigu, se termine EXACTEMENT à la durée cible', () => {
    for (const [n, T] of [[4, 15], [12, 30], [9, 45]] as const) {
      const m = minutagePlan(n, T);
      expect(m).toHaveLength(n);
      expect(m[0].debut).toBe(0);
      for (let i = 1; i < m.length; i++) expect(m[i].debut).toBe(m[i - 1].fin);
      expect(m[m.length - 1].fin).toBe(T);
    }
  });
});

describe('C-DUREE — le moteur applique la durée', () => {
  const config: AutopilotConfig = { ...DEFAULT_CONFIG, brief: { duree: 15, cta: 'Commence maintenant' } };
  it('preparePosts : 15 s < 45 s en cartes ; sans brief = contenu générique complet', () => {
    const [p15] = preparePosts({ config, topic: 'finance', count: 1, now: NOW, seeds: [7] });
    const [p45] = preparePosts({ config: { ...config, brief: { ...config.brief, duree: 45 } }, topic: 'finance', count: 1, now: NOW, seeds: [7] });
    const [libre] = preparePosts({ config: { ...config, brief: {} }, topic: 'finance', count: 1, now: NOW, seeds: [7] });
    expect(p15.content.cards.length).toBeLessThan(p45.content.cards.length);
    expect(libre.content.cards.length).toBe(generateSmartContent('finance', 7).cards.length);
  });
  it('mono-rush : la somme des séquences tient la cible (± 1,5 s)', () => {
    const [post] = preparePosts({ config: { ...DEFAULT_CONFIG, rushUrls: ['https://x/r.mp4'], brief: { duree: 15 } }, topic: 'finance', count: 1, now: NOW, seeds: [7] });
    const voix = { titre: { url: 'v1', seconds: 4 }, cartes: { url: 'v2', seconds: 6 }, cta: { url: 'v3', seconds: 2 } } as never;
    const d = buildAutopilotDesign(post, { rushSeconds: 20, voices: voix });
    const total = (d.introDuration ?? 0) + (d.cardsDuration ?? 0) + (d.videoDuration ?? 0) + (d.ctaDuration ?? 0);
    expect(Math.abs(total - 15)).toBeLessThanOrEqual(1.5);
  });
});
