/**
 * CTA D'AUTOPILOTE LISIBLE + ▶ DE L'APERÇU CLIQUABLE.
 *
 * Rendu réel (pile locale, 19/10/2026) : brief « Réserve ton cours d'essai
 * gratuit », slogan généré « AFRO + ENTRAÎN. ».
 *  - l'action est la petite ligne (règle VERROUILLÉE, la même que Créer —
 *    `contracts/autopilot.contract.test.ts`), mais rose (#EC4899) sur le
 *    dégradé rose, en 30 px : ≈ 1,2:1 mesuré sur l'image du MP4 ; la légende
 *    ne portait que le slogan, et les conseils disaient « pas une action » ;
 *  - le ▶ de l'aperçu était recouvert par les bascules « repères / grille »
 *    (même coin, même z-index) : un clic de souris tombait sur elles.
 *
 * Chaque test « correctif » échoue sur la base (aa2a9dc) et passe après.
 * L'instantané (`fixtures/cta-autopilote-instantane-base.json`), écrit SUR LA
 * BASE, prouve que tout le reste — sans brief, slogan déjà égal à l'action,
 * CTA de Créer, aperçu de Créer sans calque — sort à l'octet près.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import React from 'react';
import { render, cleanup } from '@testing-library/react';

vi.mock('@/lib/db/supabase', () => ({ supabaseAdmin: {}, supabase: {} }));

import { preparePosts } from '@/lib/autopilot/engine';
import { buildAutopilotDesign, buildAutopilotMetadata } from '@/lib/autopilot/design';
import { buildAutopilotSample } from '@/lib/autopilot/sample';
import { DEFAULT_CONFIG, type AutopilotConfig } from '@/lib/autopilot/rules';
import { conseillerVideo } from '@/lib/creer/conseiller';
import { avecCtaDuBrief, suivreCtaDuBrief } from '@/lib/creer/validation-rendu';
import { Preview } from '@/app/dashboard/creer/AssistantWizard';
import { GEL_TEXT } from './fixtures/zones-sures-916-entrees';
import { FONT_RATIO } from '@/lib/creer/designSpec';

class NoopResizeObserver { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = NoopResizeObserver;

afterEach(() => cleanup());

const NOW = Date.UTC(2026, 9, 19);
const ACTION = 'Réserve ton cours d\'essai gratuit';

function config(topics: string[], brief?: Record<string, unknown>): AutopilotConfig {
  return { ...DEFAULT_CONFIG, topics, rushUrls: [], ...(brief ? { brief } : {}) } as AutopilotConfig;
}
function produire(c: AutopilotConfig) {
  const sample = buildAutopilotSample(c);
  const [post] = preparePosts({ config: c, topic: sample.topic, count: 1, now: NOW, seeds: [sample.seed] });
  const design = buildAutopilotDesign(post, { config: c });
  const metadata = buildAutopilotMetadata({ post, design, videoUrl: 'http://local/v.mp4', mode: 'review' });
  return { sample, post, design, metadata };
}

// ── Contraste WCAG ─────────────────────────────────────────────────────────
type Rgb = [number, number, number];
const hex = (h: string): Rgb => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = ([r, g, b]: Rgb) => {
  const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contraste = (a: Rgb, b: Rgb) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** `rgba(r,g,b,a)` posé sur `fond`. */
function composer(rgba: string | null | undefined, fond: Rgb): Rgb {
  const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(rgba ?? '');
  if (!m) return fond;
  const a = Number(m[4]);
  return [0, 1, 2].map((i) => Math.round(Number(m[i + 1]) * a + fond[i] * (1 - a))) as Rgb;
}
describe('CTA d\'action de l\'Autopilote — le cas du rendu réel', () => {
  const c = config(['danse afro cardio'], { cta: ACTION, duree: 30 });
  const { sample, post, design, metadata } = produire(c);
  const meta = metadata as Record<string, any>;
  const d = design as unknown as Record<string, any>;

  it('le contenu est bien celui de la preuve (slogan ≠ action)', () => {
    expect(post.content.tagLine).toBe('AFRO + ENTRAÎN.');
  });

  it('textes et places inchangés (règle verrouillée) : slogan en grand, action telle quelle en petit', () => {
    expect(design.ctaText).toBe('AFRO + ENTRAÎN.');
    expect(design.ctaSubText).toBe(ACTION);
  });

  it('contraste WCAG AA ≥ 4,5:1 pour la ligne d\'action ET le slogan, sur le pire fond du dégradé', () => {
    const fonds = ['#7C3AED', '#EC4899'].map(hex);
    const pire = (couleur: string) => Math.min(...fonds.map((f) => contraste(hex(couleur), composer(d.ctaBackground, f))));
    expect(pire(d.ctaSubColor ?? '#EC4899')).toBeGreaterThanOrEqual(4.5);
    expect(pire(d.ctaColor ?? '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });

  it('taille : la ligne d\'action passe de 30 px à au moins 48 px de corps sur 1080 (échelle du CTA #502)', () => {
    const px = 1080 * FONT_RATIO['9:16'].ctaSub * (d.ctaScale ?? 1);
    expect(px).toBeGreaterThanOrEqual(48);
    // et le bloc tient en largeur (ajusterCta, panneau compris) : échelle bornée.
    expect(d.ctaScale).toBeLessThanOrEqual(1.6);
  });

  it('métadonnées cohérentes avec la vidéo : panneau et teinte écrits ; la légende finit par l\'action', () => {
    expect(meta.design.ctaMainText).toBe('AFRO + ENTRAÎN.');
    expect(meta.design.ctaSubText).toBe(ACTION);
    expect(meta.design.ctaBackground).toBe('rgba(0,0,0,0.6)');
    expect(meta.design.ctaSubColor).toBe(d.ctaSubColor);
    expect(post.caption.split('\n\n').at(-1)).toBe(ACTION);
  });

  it('les conseils ne disent plus « pas une action » quand la petite ligne EST l\'action', () => {
    const r = conseillerVideo({ profil: 'STANDARD', textes: { profil: 'STANDARD', theme: null, objectif: null, titre: design.title, sousTitre: design.subtitle ?? null, cartes: [], cta: design.ctaText ?? null, ctaSecondaire: design.ctaSubText ?? null, fenetres: null } });
    const cta = r.conseils.find((x) => x.id === 'texte:cta');
    expect(cta?.probleme ?? '').not.toMatch(/pas une action/);
  });

  it('le moteur passe bien la petite ligne au conseiller', () => {
    const p = readFileSync(resolve(process.cwd(), 'src/lib/autopilot/produire.ts'), 'utf8');
    expect(p).toContain('ctaSecondaire: design.ctaSubText ?? null,');
  });

  it('l\'aperçu porte le même drapeau que la vidéo (même texte, même règle)', () => {
    expect(sample.cta).toBe(design.ctaText);
    expect(sample.ctaSub).toBe(design.ctaSubText);
    expect(sample.ctaActionEnPetiteLigne).toBe(true);
  });
});

describe('surimpression : la mise en page #502 n\'applique pas la lisibilité deux fois', () => {
  it('sansLisibiliteCtaAction rend le design d\'avant la lisibilité (échelle de l\'utilisateur)', async () => {
    // Import dynamique : le module n'existe pas sur la base — ce test y échoue seul.
    const chemin = '../lib/autopilot/cta-action';
    const { sansLisibiliteCtaAction } = await import(/* @vite-ignore */ chemin) as typeof import('@/lib/autopilot/cta-action');
    const { design } = produire(config(['danse afro cardio'], { cta: ACTION }));
    const sans = sansLisibiliteCtaAction(design as never, 1.2) as Record<string, unknown>;
    expect(sans.ctaBackground).toBeUndefined();
    expect(sans.ctaSubColor).toBeUndefined();
    expect(sans.ctaScale).toBe(1.2);
    const autre = { ctaSubColor: '#123456', ctaScale: 2 };
    expect(sansLisibiliteCtaAction(autre)).toBe(autre);
  });
  it('produire retire la lisibilité AVANT la mise en page en surimpression', () => {
    const p = readFileSync(resolve(process.cwd(), 'src/lib/autopilot/produire.ts'), 'utf8');
    const i = p.indexOf('if (overlays) design = sansLisibiliteCtaAction(');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(p.indexOf('if (overlays) design = appliquerMiseEnPageSurimpression(design, profilVideo, { ctaBande: zoneCta?.bande, avatar: surAvatar });'));
  });
});

// ── L'aperçu : panneau du CTA et bascules hors du coin du ▶ ─────────────────
function apercu(props: Record<string, unknown> = {}) {
  const frameRef = { current: null } as React.RefObject<HTMLDivElement>;
  return render(
    <Preview generated={{ title: 'TITRE', subtitle: 'Sous', cards: [], cta: ACTION, ctaSub: 'AFRO + ENTRAÎN.' } as never} format="9:16"
      frameRef={frameRef} displayScale={1} activeOrder={['intro', 'cta']} gradStart="#7C3AED" gradEnd="#EC4899"
      gradientOpacity={0.3} accent="#7C3AED" text={GEL_TEXT as never} {...props} />,
  );
}
const bascules = (root: HTMLElement) => (root.querySelector('button[title*="repères"]') as HTMLElement).parentElement as HTMLElement;

describe('aperçu', () => {
  it('ctaFond pose le panneau derrière le CTA', () => {
    const { container } = apercu({ ctaFond: 'rgba(0,0,0,0.6)' });
    const fond = container.querySelector('[data-cta-block] [data-cta-fond]') as HTMLElement;
    expect(fond).toBeTruthy();
    expect(fond.style.backgroundColor).toBe('rgba(0, 0, 0, 0.6)');
  });

  it('avec un calque de lecture, les bascules quittent le coin bas-gauche du ▶', () => {
    const lecteur = <div className="absolute bottom-2 left-2 z-40"><button data-play-sequences aria-label="Lire">▶</button></div>;
    const { container } = apercu({ overlay: lecteur });
    const b = bascules(container);
    expect(b.className).toMatch(/\bright-2\b/);
    expect(b.className).not.toMatch(/\bleft-2\b/);
  });
});

// ── NON-RÉGRESSION : instantané écrit sur la base ───────────────────────────
const FIXTURE = resolve(__dirname, 'fixtures/cta-autopilote-instantane-base.json');

function instantane(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const topic of ['danse afro cardio', 'finance', 'yoga', 'nutrition', 'sommeil']) {
    // Le slogan généré (#613 : `sample.cta` est désormais l'action dérivée de l'objectif sans brief).
    const echantillon = buildAutopilotSample(config([topic]));
    const slogan = echantillon.tagLine ?? echantillon.cta;
    const briefs: Record<string, Record<string, unknown> | undefined> = {
      sansBrief: undefined,
      briefVide: { cta: '' },
      dureeSeule: { duree: 30 },
      sloganEgalAction: { cta: slogan, duree: 30 },
      sloganEgalActionCasse: { cta: slogan.toLowerCase() },
    };
    for (const [nom, brief] of Object.entries(briefs)) {
      const { sample, post, design, metadata } = produire(config([topic], brief));
      const jumeau = buildAutopilotDesign(post, { config: config([topic], brief), jumeau: { videoUrl: 'http://local/j.mp4', seconds: 12 } });
      out[`${topic}|${nom}`] = JSON.stringify({ sample, caption: post.caption, design, jumeau, metadata });
    }
  }
  // Créer : la règle du CTA du brief, inchangée.
  out.creer = JSON.stringify([
    avecCtaDuBrief({ cta: 'SLOGAN', ctaSub: 'LIEN EN BIO' }, { cta: ACTION }),
    avecCtaDuBrief({ cta: '', ctaSub: '' }, { cta: ACTION }),
    avecCtaDuBrief({ cta: 'X', ctaSub: '' }, null),
    suivreCtaDuBrief({ cta: 'SLOGAN', ctaSub: 'A' }, 'A', ACTION, 'LIEN EN BIO'),
  ]);
  // Aperçu de Créer, sans calque ni panneau : le DOM d'avant.
  out.apercuCreer = apercu().container.innerHTML;
  cleanup();
  return out;
}

describe('non-régression — instantané de la base', () => {
  it('sans brief, slogan déjà égal à l\'action, Créer, aperçu sans calque : identiques à l\'octet', () => {
    const actuel = instantane();
    if (process.env.ECRIRE_INSTANTANE === '1') { writeFileSync(FIXTURE, JSON.stringify(actuel, null, 1)); return; }
    const base = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>;
    expect(Object.keys(actuel).sort()).toEqual(Object.keys(base).sort());
    for (const k of Object.keys(base)) expect(actuel[k], k).toBe(base[k]);
  });
});
