/**
 * Durée cible et rythme = vraie contrainte de production de l'Autopilote :
 * contenu et script CONÇUS pour la durée (unités entières, jamais coupées),
 * nombre de séquences calculé, minutage du moteur, audio réel de référence.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/supabase', () => ({ supabaseAdmin: {}, supabase: {} }));

import {
  cibleVideoDuBrief, contenuPourDuree, dureeDeReference, horodatage, minutagePlan, nombreCreneaux, scriptPourDuree,
} from '@/lib/autopilot/duree-cible';
import { gabaritSuggere } from '@/lib/autopilot/medias-prevus';
import { planMultiSources, avatarSynchronise } from '@/lib/autopilot/plan-multi-sources';
import { preparePosts } from '@/lib/autopilot/engine';
import { scriptJumeauMontage } from '@/lib/autopilot/jumeau-async';
import { buildAutopilotDesign } from '@/lib/autopilot/design';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import { generateSmartContent } from '@/lib/smart-content';
import type { VideoBrief } from '@/lib/creer/brief';

const contenu = generateSmartContent('finance', 7);
const unites = (c: typeof contenu) => c.cards.map((x) => [x.title, x.description, x.value].filter(Boolean).join('. '));

describe('Script et contenu GÉNÉRÉS pour la durée (pas tronqués)', () => {
  it('15 s → moins d’idées que 30 s, 30 s → moins ou autant que 45 s ; jamais zéro', () => {
    const n = (duree: number) => contenuPourDuree(contenu, 'finance', { duree }).cards.length;
    expect(contenu.cards.length).toBeGreaterThanOrEqual(3);
    expect(n(15)).toBeGreaterThanOrEqual(1);
    expect(n(15)).toBeLessThan(n(45));
    expect(n(30)).toBeLessThanOrEqual(n(45));
  });

  it('chaque idée gardée est l’idée ENTIÈRE, jamais un morceau', () => {
    const c = contenuPourDuree(contenu, 'finance', { duree: 15 });
    for (const carte of c.cards) expect(contenu.cards).toContainEqual(carte);
  });

  it('le rythme change la quantité de texte : calme < dynamique', () => {
    const s = (rythme: VideoBrief['rythme']) => scriptPourDuree({
      titre: 'finance', sousTitre: contenu.subtitle, cartes: contenu.cards, cta: contenu.tagLine, brief: { duree: 30, rythme },
    })!;
    expect(s('calme').length).toBeLessThanOrEqual(s('dynamique').length);
  });

  it('le script avatar est composé d’unités entières, plus développé à 45 s qu’à 15 s', () => {
    const s = (duree: number) => scriptPourDuree({
      titre: 'Finance', sousTitre: contenu.subtitle, cartes: contenu.cards, cta: 'Commence maintenant',
      brief: { duree, message: 'Gérer son argent s’apprend' },
    })!;
    expect(s(15).length).toBeLessThan(s(45).length);
    expect(s(15)).toMatch(/^.*Finance.*Commence maintenant$/);
    // Toute phrase du script est une unité d'origine complète (rien de coupé).
    const origine = ['Gérer son argent s’apprend', 'Finance', contenu.subtitle, ...unites(contenu), 'Commence maintenant']
      .map((t) => (t ?? '').replace(/[.\s]+$/, ''));
    const script45 = s(45);
    for (const u of origine.filter((t) => script45.includes(t))) expect(script45).toContain(u);
    expect(script45.length).toBeLessThanOrEqual(45 * 14 + 2);
  });

  it('sans durée cible : contenu et script d’avant, à l’identique', () => {
    expect(contenuPourDuree(contenu, 'finance', {})).toBe(contenu);
    expect(scriptPourDuree({ titre: 't', cartes: [], brief: {} })).toBeNull();
  });

  it('la production Autopilote applique la durée : cartes et script avatar', () => {
    const config: AutopilotConfig = { ...DEFAULT_CONFIG, brief: { duree: 15, cta: 'Commence maintenant' } };
    const [p15] = preparePosts({ config, topic: 'finance', count: 1, now: Date.UTC(2026, 9, 13), seeds: [7] });
    const [p45] = preparePosts({ config: { ...config, brief: { ...config.brief, duree: 45 } }, topic: 'finance', count: 1, now: Date.UTC(2026, 9, 13), seeds: [7] });
    const [libre] = preparePosts({ config: { ...config, brief: {} }, topic: 'finance', count: 1, now: Date.UTC(2026, 9, 13), seeds: [7] });
    expect(p15.content.cards.length).toBeLessThan(p45.content.cards.length);
    expect(libre.content.cards.length).toBe(generateSmartContent('finance', 7).cards.length);
    expect(scriptJumeauMontage(p15).length).toBeLessThan(scriptJumeauMontage(p45).length);
    expect(scriptJumeauMontage(p15).endsWith('Commence maintenant')).toBe(true);
  });
});

describe('Nombre de séquences calculé (plus de nombre fixe)', () => {
  const base = { avatar: true, rushes: 1, stock: 4 };
  const n = (dureeSecondes: number, rythme: VideoBrief['rythme']) => gabaritSuggere(base, { dureeSecondes, rythme }).length;

  it('source actuelle sans durée : 5 séquences (avatar + 3 intercalés + avatar) — inchangé', () => {
    expect(gabaritSuggere(base).map((c) => c.type)).toEqual(['avatar', 'rush', 'stock', 'stock', 'avatar']);
  });

  it('15 s Normal < 30 s Dynamique ; 45 s Calme = séquences plus longues', () => {
    expect(n(15, 'normal')).toBeLessThan(n(30, 'dynamique'));
    expect(n(15, 'normal')).toBe(4); // 15 / 3,5 ≈ 4
    expect(n(30, 'dynamique')).toBe(12); // 30 / 2,5 = 12
    expect(n(45, 'calme')).toBe(9); // 45 / 5 = 9 → plans de 5 s
    expect(minutagePlan(n(45, 'calme'), 45)[0].duree).toBe(5);
  });

  it('avatar en ouverture et conclusion ; médias stock disponibles = plafond', () => {
    const g = gabaritSuggere({ avatar: true, rushes: 0, stock: 2 }, { dureeSecondes: 30, rythme: 'dynamique' });
    expect(g.map((c) => c.type)).toEqual(['avatar', 'stock', 'stock', 'avatar']);
    expect(nombreCreneaux({ dureeSecondes: 30, rythme: 'normal', avatar: false, rushes: 0, stock: 3 })).toEqual({ total: 3, intercales: 3 });
    expect(nombreCreneaux({ dureeSecondes: null, avatar: true, rushes: 1, stock: 1 })).toBeNull();
  });
});

describe('Minutage = celui du moteur ; audio réel = référence', () => {
  it('minutage contigu, durées égales, fin exacte', () => {
    expect(minutagePlan(4, 15)).toEqual([
      { debut: 0, fin: 3.8, duree: 3.8 }, { debut: 3.8, fin: 7.5, duree: 3.7 },
      { debut: 7.5, fin: 11.3, duree: 3.8 }, { debut: 11.3, fin: 15, duree: 3.7 },
    ]);
    expect(horodatage(65.5)).toBe('01:05,5');
    expect(horodatage(5)).toBe('00:05');
  });

  it('le plan rendu suit le minutage affiché (même partage)', () => {
    const gabarit = gabaritSuggere({ avatar: false, rushes: 0, stock: 4 }, { dureeSecondes: 15, rythme: 'normal' });
    const photos = ['https://images.pexels.com/a.jpg', 'https://images.pexels.com/b.jpg', 'https://images.pexels.com/c.jpg', 'https://images.pexels.com/d.jpg'];
    const r = planMultiSources({ photos, gabarit, cible: 15 });
    const attendu = minutagePlan(gabarit.length, 15);
    expect(r.plan).toHaveLength(attendu.length);
    r.plan.forEach((s, i) => expect(Math.abs(s.fin - attendu[i].fin)).toBeLessThanOrEqual(0.06));
  });

  it('audio réel 31,2 s pour une cible de 30 s → plan recalé sur 31,2 s, lip-sync intact', () => {
    expect(dureeDeReference(30, 31.2)).toBe(31.2);
    expect(dureeDeReference(30, null)).toBe(30);
    const gabarit = gabaritSuggere({ avatar: true, rushes: 0, stock: 3 }, { dureeSecondes: 30, rythme: 'normal' });
    const r = planMultiSources({
      avatar: { url: 'https://cdn/avatar.mp4', secondes: 31.2 },
      photos: ['https://images.pexels.com/a.jpg', 'https://images.pexels.com/b.jpg', 'https://images.pexels.com/c.jpg'],
      gabarit, cible: 31.2,
    });
    expect(r.duree).toBeCloseTo(31.2, 3);
    expect(avatarSynchronise(r.plan)).toBe(true);
    expect(r.plan.every((s) => (s.vitesse ?? 1) === 1)).toBe(true);
  });

  it('sans avatar : la séquence vidéo vise la part restante de la durée cible', () => {
    expect(cibleVideoDuBrief({ duree: 30 }, { introDuration: 4, cardsDuration: 8, ctaDuration: 3 }, false)).toBe(15);
    expect(cibleVideoDuBrief({ duree: 30 }, {}, true)).toBe(30);
    expect(cibleVideoDuBrief({}, {}, false)).toBeNull();
  });

  it('chemin mono-rush : la durée cible règle la séquence vidéo (bornée par le rush)', () => {
    const [post] = preparePosts({ config: { ...DEFAULT_CONFIG, rushUrls: ['https://x/r.mp4'], brief: { duree: 15 } }, topic: 'finance', count: 1, now: Date.UTC(2026, 9, 13), seeds: [7] });
    const voix = { titre: { url: 'v1', seconds: 4 }, cartes: { url: 'v2', seconds: 6 }, cta: { url: 'v3', seconds: 2 } } as never;
    const court = buildAutopilotDesign(post, { rushSeconds: 20, voices: voix });
    const sansCible = buildAutopilotDesign({ ...post, brief: {} }, { rushSeconds: 20, voices: voix });
    expect(court.videoDuration).toBeLessThan(sansCible.videoDuration as number);
    const total = (d: typeof court) => (d.introDuration ?? 0) + (d.cardsDuration ?? 0) + (d.videoDuration ?? 0) + (d.ctaDuration ?? 0);
    expect(Math.abs(total(court) - 15)).toBeLessThanOrEqual(1.5);
  });
});

describe('UI — Plan avant génération : durée, nombre, rythme, minutage', () => {
  it('affiche la durée cible, la durée planifiée, le nombre et le minutage, recalculés avec le rythme', async () => {
    const React = await import('react');
    const { render, cleanup } = await import('@testing-library/react');
    const { default: PlanAvantGeneration } = await import('@/components/creer/PlanAvantGeneration');
    const afficher = (dureeSecondes: number, rythme: VideoBrief['rythme']) => {
      cleanup();
      const suggestion = gabaritSuggere({ avatar: true, rushes: 0, stock: 12 }, { dureeSecondes, rythme });
      render(React.createElement(PlanAvantGeneration, {
        gabarit: [], suggestion, rushesPerso: [], stock: [], vignetteAvatar: null, avatarDisponible: true,
        onChange: () => {}, onRechercher: () => {}, duree: { cible: dureeSecondes, rythme: rythme ?? null },
      }));
      const q = (s: string) => document.querySelector(s) as HTMLElement;
      return {
        cible: q('[data-plan-duree-cible]').textContent,
        planifiee: q('[data-plan-duree-planifiee]').textContent,
        nombre: Number(q('[data-plan-nombre]').getAttribute('data-plan-nombre')),
        rythme: q('[data-plan-rythme]').textContent,
        premier: q('[data-plan-minutage="0"]').textContent,
      };
    };
    const a = afficher(15, 'normal');
    expect(a).toEqual({ cible: '15 s', planifiee: '15 s', nombre: 4, rythme: 'Normal', premier: '00:00 → 00:03,8 · Durée : 3,8 s' });
    const b = afficher(30, 'dynamique');
    expect(b.nombre).toBe(12);
    expect(b.premier).toBe('00:00 → 00:02,5 · Durée : 2,5 s');
    const c = afficher(45, 'calme');
    expect(c).toMatchObject({ cible: '45 s', planifiee: '45 s', nombre: 9, rythme: 'Calme', premier: '00:00 → 00:05 · Durée : 5 s' });
  });
});
