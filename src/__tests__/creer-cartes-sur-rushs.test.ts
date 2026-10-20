/**
 * Export réel du 20/10 (85,6 s) : 44 s de cartes figées sur un dégradé, tous
 * les rushes à la fin, petite ligne du CTA illisible. Ce fichier verrouille :
 *
 *  1. la répartition narrative — les cartes passent SUR des plans des rushes,
 *     dans l'ordre de l'utilisateur, coupés aux apparitions, ≤ 6 s, sans
 *     répéter ce que la séquence Vidéo montre tant que la matière le permet ;
 *  2. l'apparition progressive, même sans photo (repli canvas) ;
 *  3. le contraste de la petite ligne du CTA (≥ 4,5:1) ;
 *  4. les planchers de lisibilité des cartes en 9:16.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/fonts/catalog', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fonts/catalog')>('@/lib/fonts/catalog');
  return { ...actual, ensureFontsLoaded: async () => [] };
});

import {
  cartesSurRushsApplicable, coupesCartes, planCartesSurRushs, sourcesDuPlan, cartesSurRushsDepuisMetadata,
  PLAN_MAX_S, SEUIL_NARRATION_LONGUE_S,
} from '@/lib/creer/narration-rushs';
import { besoinPastille, eclaircirPourContraste, fondPastillePire, hexVersRgb, ratioContraste } from '@/lib/creer/contraste';
import { capturerEtapesCartes, avecFondCartes } from '@/lib/creer/capture-etapes-cartes';
import { calageProportionnel } from '@/lib/creer/synchro-cartes';
import { drawCards, type DesignOptions } from '@/lib/video-composer';
import SequenceCards, { LISIBILITE_916 } from '@/components/creer/SequenceCards';
import { optionsRenduDepuisMetadata } from '@/lib/rendus/options-depuis-metadata';
import { echelleCtaAjustee, echelleCtaDeDepart, ECHELLE_CTA_LISIBLE_916 } from '@/lib/creer/ajustementCta';

const base = { dureeCartes: 39.5, dureeVideo: 25.2, nbCartes: 5, nbSources: 3, fondCartesExplicite: false, surimpressions: false };

describe('cartesSurRushsApplicable — seulement le fond PAR DÉFAUT d’une narration longue', () => {
  it('narration longue + rushes : oui', () => expect(cartesSurRushsApplicable(base)).toBe(true));
  it('durée par défaut (6 s) : rendu d’avant', () => expect(cartesSurRushsApplicable({ ...base, dureeCartes: 6 })).toBe(false));
  it('seuil inclus', () => expect(cartesSurRushsApplicable({ ...base, dureeCartes: SEUIL_NARRATION_LONGUE_S })).toBe(true));
  it('séquence Vidéo masquée, aucun rush, aucune carte : non', () => {
    expect(cartesSurRushsApplicable({ ...base, dureeVideo: 0 })).toBe(false);
    expect(cartesSurRushsApplicable({ ...base, nbSources: 0 })).toBe(false);
    expect(cartesSurRushsApplicable({ ...base, nbCartes: 0 })).toBe(false);
  });
  it('fond de cartes choisi par l’utilisateur, ou textes déjà sur la vidéo : jamais remplacé', () => {
    expect(cartesSurRushsApplicable({ ...base, fondCartesExplicite: true })).toBe(false);
    expect(cartesSurRushsApplicable({ ...base, surimpressions: true })).toBe(false);
  });
});

describe('sourcesDuPlan — vidéos seulement, ordre de l’utilisateur, sans doublon', () => {
  it('photos et avatar exclus, première apparition gardée', () => {
    const s = sourcesDuPlan([
      { url: 'b.mp4' }, { url: 'p.jpg', kind: 'image' }, { url: 'a.mp4' }, { url: 'av.mp4', kind: 'avatar' }, { url: 'b.mp4' },
    ], new Map([['a.mp4', 12]]));
    expect(s).toEqual([{ url: 'b.mp4', duree: null }, { url: 'a.mp4', duree: 12 }]);
  });
});

describe('coupesCartes — une carte = un plan, jamais plus de 6 s', () => {
  it('coupe aux apparitions puis redécoupe à parts égales', () => {
    const c = coupesCartes(39.5, [0, 8, 16, 24, 32]);
    expect(c[0]).toBe(0);
    expect(c.at(-1)).toBe(39.5);
    for (const t of [8, 16, 24, 32]) expect(c).toContain(t);
    for (let i = 1; i < c.length; i++) {
      expect(c[i] - c[i - 1]).toBeLessThanOrEqual(PLAN_MAX_S + 1e-6);
      expect(c[i] - c[i - 1]).toBeGreaterThan(1);
    }
  });
  it('sans apparition : plans réguliers ≤ 6 s', () => {
    const c = coupesCartes(13, []);
    expect(c).toEqual([0, 4.333, 8.667, 13]);
  });
});

describe('planCartesSurRushs — répartition narrative', () => {
  const sources = [{ url: 'a.mp4', duree: 30 }, { url: 'b.mp4', duree: 30 }, { url: 'c.mp4', duree: 30 }];
  const planVideo = [
    { url: 'a.mp4', debut: 0, fin: 8, depuis: 0 },
    { url: 'b.mp4', debut: 8, fin: 16, depuis: 0 },
    { url: 'c.mp4', debut: 16, fin: 24, depuis: 0 },
  ];

  it('couvre toute la séquence, rushes à tour de rôle dans l’ordre, jamais deux fois de suite le même', () => {
    const p = planCartesSurRushs({ sources, dureeCartes: 39.5, apparitions: [0, 7.9, 15.8, 23.7, 31.6], dejaUtilises: planVideo })!;
    expect(p[0].debut).toBe(0);
    expect(p.at(-1)!.fin).toBe(39.5);
    for (let i = 1; i < p.length; i++) {
      expect(p[i].debut).toBe(p[i - 1].fin);
      expect(p[i].url).not.toBe(p[i - 1].url);
    }
    // Ordre CYCLIQUE de l'utilisateur (a → b → c → a…), décalé pour que le
    // dernier plan ne soit pas le rush qui ouvre la Vidéo.
    const cycle = ['a.mp4', 'b.mp4', 'c.mp4'];
    for (let i = 1; i < p.length; i++) expect(cycle.indexOf(p[i].url)).toBe((cycle.indexOf(p[i - 1].url) + 1) % 3);
    expect(Math.max(...p.map((x) => x.fin - x.debut))).toBeLessThanOrEqual(PLAN_MAX_S + 1e-6);
  });

  it('évite les extraits déjà montés dans la séquence Vidéo tant que la matière le permet', () => {
    const p = planCartesSurRushs({ sources, dureeCartes: 39.5, apparitions: [], dejaUtilises: planVideo })!;
    for (const s of p) {
      const v = planVideo.find((x) => x.url === s.url)!;
      const a = s.depuis ?? 0;
      const chevauche = a < (v.depuis + (v.fin - v.debut)) && a + (s.fin - s.debut) > v.depuis;
      expect(chevauche).toBe(false);
      expect(a + (s.fin - s.debut)).toBeLessThanOrEqual(30 + 1e-6);
    }
  });

  it('matière insuffisante : reprend un rush plutôt que de figer un plan (jamais au-delà de sa fin)', () => {
    const courts = [{ url: 'a.mp4', duree: 8.4 }, { url: 'b.mp4', duree: 8.4 }];
    const p = planCartesSurRushs({ sources: courts, dureeCartes: 30, dejaUtilises: [{ url: 'a.mp4', debut: 0, fin: 8.4 }, { url: 'b.mp4', debut: 8.4, fin: 16.8 }] })!;
    expect(p.at(-1)!.fin).toBe(30);
    for (const s of p) expect((s.depuis ?? 0) + (s.fin - s.debut)).toBeLessThanOrEqual(8.4 + 1e-6);
  });

  it('raccord avec la Vidéo : le dernier plan des cartes ne vient jamais du rush qui ouvre la Vidéo', () => {
    for (const duree of [12, 20, 26, 39.5, 45]) {
      for (const n of [2, 3]) {
        const src = sources.slice(0, n);
        const p = planCartesSurRushs({ sources: src, dureeCartes: duree, dejaUtilises: planVideo.slice(0, n) })!;
        expect(p.at(-1)!.url).not.toBe('a.mp4');
        // Rotation dans l'ordre de l'utilisateur, toujours sans doublon consécutif.
        for (let i = 1; i < p.length; i++) expect(p[i].url).not.toBe(p[i - 1].url);
      }
    }
  });

  it('aucune source ou durée nulle : null (fond d’avant)', () => {
    expect(planCartesSurRushs({ sources: [], dureeCartes: 30 })).toBeNull();
    expect(planCartesSurRushs({ sources, dureeCartes: 0 })).toBeNull();
  });

  it('relecture de la métadonnée : plan valide gardé, forme invalide rejetée', () => {
    const p = planCartesSurRushs({ sources, dureeCartes: 12 })!;
    expect(cartesSurRushsDepuisMetadata(JSON.parse(JSON.stringify(p)))).toEqual(p);
    expect(cartesSurRushsDepuisMetadata([{ url: 'a.mp4', debut: 2, fin: 1 }])).toBeNull();
    expect(cartesSurRushsDepuisMetadata(undefined)).toBeNull();
  });

  it('« Régénérer » relit les MÊMES plans ; un ancien post n’en a pas', () => {
    const plan = planCartesSurRushs({ sources, dureeCartes: 12 })!;
    const post = (extra: Record<string, unknown>) => ({ title: 'T', format: 'reel', metadata: { rushUrls: ['a.mp4'], sequences: { intro: 3, cards: 12, video: 8, cta: 3 }, ...extra } });
    const avec = optionsRenduDepuisMetadata(post({ cartesSurRushs: plan }) as never, 'regenerer' as never, { cards: [] });
    expect(avec.cartesSurRushs).toEqual(plan);
    const sans = optionsRenduDepuisMetadata(post({}) as never, 'regenerer' as never, { cards: [] });
    expect('cartesSurRushs' in sans).toBe(false);
  });
});

describe('capturerEtapesCartes — cartes sur les rushes : une carte à la fois, fond sombre, DOM restauré', () => {
  const CARTES = [
    { id: 'c1', title: 'Cardio', value: '3-en-1' },
    { id: 'c2', title: 'Os', value: '+2%' },
    { id: 'c3', title: 'Muscles', value: '300+' },
  ];
  const dom = () => {
    const el = document.createElement('div');
    el.innerHTML = CARTES.map((c) => `<div data-card-id="${c.id}" style="background-color: rgba(255, 255, 255, 0.08)"><span>${c.title}</span><span data-card-value>${c.value}</span></div>`).join('');
    return el;
  };
  const etat = (el: HTMLElement) => CARTES.map((c) => {
    const carte = el.querySelector<HTMLElement>(`[data-card-id="${c.id}"]`)!;
    return `${carte.style.visibility || 'v'}|${carte.style.backgroundColor}`;
  });

  it('non cumulé : seule la carte en cours de narration est visible', async () => {
    const el = dom();
    const calage = calageProportionnel(CARTES, 12)!;
    const vus: string[][] = [];
    const out = await capturerEtapesCartes(el, calage, CARTES.map((c) => c.id), async () => { vus.push(etat(el)); return vus.length; }, { cumul: false, fondCarte: 'rgba(10,10,15,0.72)' });
    expect(out).not.toBeNull();
    // Dernière photo : seule la carte 3, sur fond sombre.
    const derniere = vus.at(-1)!;
    expect(derniere[0].startsWith('hidden')).toBe(true);
    expect(derniere[1].startsWith('hidden')).toBe(true);
    expect(derniere[2].startsWith('v') || derniere[2].startsWith('visible') || derniere[2].startsWith('|')).toBe(true);
    expect(derniere[2]).toContain('rgba(10, 10, 15, 0.72)');
    // DOM restauré.
    expect(etat(el)).toEqual(CARTES.map(() => 'v|rgba(255, 255, 255, 0.08)'));
  });

  it('sur un rush : la description COURTE apparaît en seconde ligne pendant la photo, masquée ensuite', async () => {
    const el = dom();
    el.querySelector('[data-card-id="c1"] span')!.insertAdjacentHTML('beforeend', '<span data-card-description style="display: none">Court</span>');
    const d = el.querySelector<HTMLElement>('[data-card-description]')!;
    const vus: string[] = [];
    await capturerEtapesCartes(el, calageProportionnel(CARTES, 12)!, CARTES.map((c) => c.id), async () => { vus.push(d.style.display); return 1; }, { cumul: false, fondCarte: '#000' });
    expect(vus.every((v) => v === 'block')).toBe(true);
    expect(d.style.display).toBe('none');
    await capturerEtapesCartes(el, calageProportionnel(CARTES, 12)!, CARTES.map((c) => c.id), async () => { vus.push(d.style.display); return 1; });
    expect(vus.at(-1)).toBe('none');
  });

  it('défaut (cumulé) : inchangé — les cartes s’accumulent', async () => {
    const el = dom();
    const calage = calageProportionnel(CARTES, 12)!;
    const vus: string[][] = [];
    await capturerEtapesCartes(el, calage, CARTES.map((c) => c.id), async () => { vus.push(etat(el)); return 1; });
    expect(vus.at(-1)!.every((x) => !x.startsWith('hidden'))).toBe(true);
  });

  it('avecFondCartes : fond posé pendant la photo, restauré même en cas d’échec', async () => {
    const el = dom();
    await expect(avecFondCartes(el, '#000000', async () => { expect(etat(el)[0]).toContain('rgb(0, 0, 0)'); throw new Error('x'); })).rejects.toThrow('x');
    expect(etat(el)[0]).toBe('v|rgba(255, 255, 255, 0.08)');
    expect(await avecFondCartes(el, null, async () => 7)).toBe(7);
  });
});

describe('drawCards — repli SANS photo : apparition progressive et fond vidéo', () => {
  function contexte() {
    const textes: string[] = [];
    const rects: number[] = [];
    const degrade = { addColorStop: () => {} };
    const base: Record<string, unknown> = {
      save: () => {}, restore: () => {},
      fillText: (t: string) => { textes.push(String(t)); },
      fillRect: () => { rects.push(1); },
      measureText: (t: string) => ({ width: String(t).length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
      createLinearGradient: () => degrade, createRadialGradient: () => degrade, createPattern: () => null,
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    };
    const ctx = new Proxy(base, { get: (t, p) => (p in t ? (t as never)[p] : () => {}), set: () => true }) as unknown as CanvasRenderingContext2D;
    return { ctx, textes };
  }
  const cartes = ['Alpha', 'Beta', 'Gamma'].map((label) => ({ emoji: '', label, value: '1', description: '', color: '#fff' }));
  const design = { cardStyle: 'Compact', cardsEtapes: [{ debut: 0, carte: 0 }, { debut: 4, carte: 1 }, { debut: 8, carte: 2 }] } as unknown as DesignOptions;

  it('seules les cartes déjà dites sont dessinées', () => {
    const a = (t: number) => { const { ctx, textes } = contexte(); drawCards(ctx, 1080, 1920, cartes, null, '#7C3AED', 1, design, null, 1, t); return textes.join(' '); };
    expect(a(1)).toContain('Alpha');
    expect(a(1)).not.toContain('Beta');
    expect(a(5)).toContain('Beta');
    expect(a(5)).not.toContain('Gamma');
    expect(a(9)).toContain('Gamma');
  });

  it('sans `cardsEtapes` : toutes les cartes, comme avant', () => {
    const { ctx, textes } = contexte();
    drawCards(ctx, 1080, 1920, cartes, null, '#7C3AED', 1, { cardStyle: 'Compact' } as DesignOptions, null, 1, 0);
    expect(textes.join(' ')).toContain('Gamma');
  });
});

describe('CTA 9:16 : plancher de lisibilité, jamais de débordement', () => {
  it('le plancher ne remplace que le DÉFAUT : une échelle choisie (plus petite comprise) est gardée', () => {
    expect(echelleCtaDeDepart(undefined, '9:16')).toBe(ECHELLE_CTA_LISIBLE_916);
    expect(echelleCtaDeDepart(1, '9:16')).toBe(ECHELLE_CTA_LISIBLE_916);
    expect(echelleCtaDeDepart(0.7, '9:16')).toBe(0.7);
    expect(echelleCtaDeDepart(1.2, '9:16')).toBe(1.2);
    expect(echelleCtaDeDepart(1, '16:9')).toBe(1);
    expect(echelleCtaDeDepart(1, '1:1')).toBe(1);
  });

  it('« JE ME LANCE » : échelle 1,5 (≈ 61 px, capitale ≈ 44 px) ; un texte long reste ajusté', () => {
    const v = { w: 1080, h: 1920 };
    expect(echelleCtaAjustee({ texte: 'JE ME LANCE', sousTexte: "RÉSERVE TON COURS D'ESSAI", echelle: ECHELLE_CTA_LISIBLE_916, largeurPct: 70, video: v })).toBe(1.5);
    expect(echelleCtaAjustee({ texte: 'ANTICONSTITUTIONNELLEMENT', echelle: ECHELLE_CTA_LISIBLE_916, largeurPct: 70, video: v })).toBeLessThan(1.5);
  });
});

describe('Contraste de la petite ligne du CTA', () => {
  it('le rose de marque sur le dégradé rose/violet échoue (export du 20/10)', () => {
    expect(besoinPastille('#EC4899', ['#7C3AED', '#EC4899'])).toBe(true);
  });
  it('une teinte déjà lisible n’a pas de pastille', () => {
    expect(besoinPastille('#FFFFFF', ['#000000', '#111111'])).toBe(false);
  });
  it('teinte éclaircie : ≥ 4,5:1 contre la pastille posée sur du BLANC (pire fond)', () => {
    const c = eclaircirPourContraste('#EC4899');
    expect(ratioContraste(hexVersRgb(c)!, fondPastillePire())).toBeGreaterThanOrEqual(4.5);
    // Même famille : le rouge domine toujours.
    const [r, g] = hexVersRgb(c)!;
    expect(r).toBeGreaterThan(g);
  });
});

describe('SequenceCards — planchers de lisibilité en 9:16', () => {
  const CARTES = [{ id: 'a', icon: 'Heart', title: 'Cardio complet', value: '3-en-1' }];
  const tailles = (html: string) => Array.from(html.matchAll(/font-size:([\d.]+)px/g)).map((m) => Number(m[1]));
  it('9:16 (zone sûre) : texte ≥ 4 % de la largeur, sans ellipse', () => {
    const html = renderToStaticMarkup(React.createElement(SequenceCards, { cards: CARTES, containerWidth: 1080, landscape: false, valueColor: '#EC4899', zoneSure916: true }));
    expect(Math.min(...tailles(html))).toBeGreaterThanOrEqual(Math.floor(1080 * LISIBILITE_916.text));
    expect(html).not.toContain('text-overflow:ellipsis');
  });
  it('description ≤ 40 caractères rendue MASQUÉE (seule la capture sur rush l’affiche) ; longue : omise', () => {
    const court = renderToStaticMarkup(React.createElement(SequenceCards, { cards: [{ ...CARTES[0], description: 'Brûle 3x plus de calories' }], containerWidth: 1080, landscape: false, valueColor: '#EC4899', zoneSure916: true }));
    expect(court).toContain('data-card-description');
    expect(court).toContain('display:none');
    const long = renderToStaticMarkup(React.createElement(SequenceCards, { cards: [{ ...CARTES[0], description: 'x'.repeat(41) }], containerWidth: 1080, landscape: false, valueColor: '#EC4899', zoneSure916: true }));
    expect(long).not.toContain('data-card-description');
  });

  it('sans zone sûre (autres appels) : rendu d’avant', () => {
    const html = renderToStaticMarkup(React.createElement(SequenceCards, { cards: CARTES, containerWidth: 1080, landscape: false, valueColor: '#EC4899' }));
    expect(Math.min(...tailles(html))).toBeLessThan(1080 * LISIBILITE_916.text);
    expect(html).toContain('text-overflow:ellipsis');
  });
});
