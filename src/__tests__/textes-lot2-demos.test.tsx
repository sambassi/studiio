/**
 * LOT 2 — défauts relevés sur les démos rendues (« MOTIVATION » Autopilote,
 * « LE SPORT LE PLUS COMPLET » Créer), un test par point.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sortieSurimpression } from '../../remotion/CreerSimpleMontage';
import { taillesBadge, BADGE_TEXTE_MIN_PX_916 } from '@/lib/creer/surimpressions-mise-en-page';
import SequenceCards from '@/components/creer/SequenceCards';
import { cardRatios } from '@/lib/creer/designSpec';
import { calageProportionnel, espacerApparitions, etatApres, DUREE_CARTE_LISIBLE_S } from '@/lib/creer/synchro-cartes';
import { echelleTitreDeDepart, ECHELLE_TITRE_LISIBLE } from '@/lib/creer/ajustementCta';
import { titreSur916, chassePolice } from '@/lib/creer/zones-sures-916';
import { fondsRushTexte, fondRushDeLOnglet } from '@/lib/creer/fond-rush-texte';
import { HALO_TEXTE_ALPHA, CONTOUR_TEXTE_ALPHA, contrasteSurVoile } from '@/lib/creer/contraste';

// ── 1. CTA plein jusqu'à la dernière image ────────────────────────────────
describe('Autopilote : surimpression qui finit avec la vidéo', () => {
  it('pas de fondu de sortie si la fenêtre finit avec la vidéo (« MOTIVATION » : CTA 22,18–24,68 s)', () => {
    expect(sortieSurimpression(24.682, 24.682, 30)).toBe(false);
    expect(sortieSurimpression(24.67, 24.682, 30)).toBe(false);
  });
  it('fondu de sortie gardé ailleurs (carte au milieu)', () => {
    expect(sortieSurimpression(8.07, 24.682, 30)).toBe(true);
  });
  it('câblage : CTA et cartes passent `sortie`, et une séquence qui suit la Vidéo garde la sortie', () => {
    const src = readFileSync(resolve(process.cwd(), 'remotion/CreerSimpleMontage.tsx'), 'utf8');
    expect(src).toMatch(/sortie=\{videoNonFinale \|\| sortieSurimpression\(props\.surimpressions\.cta\[1\]/);
    expect(src).toMatch(/sortie=\{videoNonFinale \|\| sortieSurimpression\(c\.fin/);
  });
});

// ── 2. Badges en surimpression lisibles ──────────────────────────────────
describe('Autopilote : badges lisibles en 9:16', () => {
  const R = cardRatios(false);
  it(`titre ≥ ${BADGE_TEXTE_MIN_PX_916} px sur 1080, valeur ≥ 1,25 × le titre`, () => {
    const t = taillesBadge({ vw: 1080, ratios: R, echelle: 0.85, portrait: true });
    expect(t.texte).toBeGreaterThanOrEqual(40);
    expect(t.valeur).toBeGreaterThanOrEqual(t.texte * 1.25 - 1e-9);
  });
  it('paysage : tailles d’avant', () => {
    const t = taillesBadge({ vw: 1920, ratios: R, echelle: 0.85, portrait: false });
    expect(t.texte).toBeCloseTo(1920 * R.text * 0.85, 9);
  });
  it('rendu : « HABIT STACKING » sur fond d’image ≥ 40 px, contour à 0,75', () => {
    const html = renderToStaticMarkup(
      <SequenceCards cards={[{ id: 'c0', icon: 'Zap', title: 'HABIT STACKING', value: 'ANCRÉ' }]} cardBoxes={{ c0: { x: 0, y: 72, w: 91.6, h: 22 } }}
        containerWidth={1080} landscape={false} zoneSure916 valueColor="#EC4899" fond="transparent" typography={{ scale: 1.6 }} />,
    );
    const tailles = Array.from(html.matchAll(/font-size:([\d.]+)px/g)).map((m) => Number(m[1]));
    expect(Math.min(...tailles)).toBeGreaterThanOrEqual(40);
    expect(html).toContain('rgba(0,0,0,0.75)');
    expect(CONTOUR_TEXTE_ALPHA).toBe(0.75);
    expect(HALO_TEXTE_ALPHA).toBeGreaterThan(0.9);
    expect(contrasteSurVoile('#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });
});

// ── 4. Ordre des cartes pendant le fondu ─────────────────────────────────
describe('Créer : la séquence Cartes ENTRANTE reste à 0 s', () => {
  it('le fondu passe `entrante` et les étapes datées des cartes y valent 0 s', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/video-composer.ts'), 'utf8');
    expect(src).toMatch(/drawSeq\(sequences\[seqIdx \+ 1\]\.type, [^\n]*, target, true\)/);
    expect(src).toMatch(/const secondesCartes = entrante \? 0 :/);
  });
});

// ── 5. Valeur avec sa carte ──────────────────────────────────────────────
describe('Créer : la valeur paraît avec sa carte', () => {
  const cartes = [
    { title: 'CARDIO COMPLET', description: 'Danser fait travailler le cœur.', value: '3-en-1' },
    { title: 'OS RENFORCÉS', description: 'Les sauts densifient les os.', value: '+2 %/an' },
    { title: 'ANTI-ÂGE', description: 'Coordination et mémoire.', value: '-10 ans' },
    { title: '300+ MUSCLES', description: 'Tout le corps est sollicité.', value: '300+' },
    { title: 'RISQUE RÉDUIT', description: 'Moins de risques cardio-vasculaires.', value: '-76 %' },
  ];
  it('à chaque étape, toute carte visible montre sa valeur', () => {
    const c = calageProportionnel(cartes, 14)!;
    for (let k = 1; k <= c.etapes.length; k++) {
      const e = etatApres(c, k);
      for (const i of e.cartes) expect(e.valeurs.has(i)).toBe(true);
    }
  });

  // ── 6. Durée lisible par carte ─────────────────────────────────────────
  it(`chaque carte tient ≥ min(${DUREE_CARTE_LISIBLE_S} s, durée / n) — 5 cartes sur 14 s : 2,8 s`, () => {
    const c = calageProportionnel(cartes, 14)!;
    const debuts = c.etapes.filter((e) => e.element === 'carte').map((e) => e.debut);
    expect(debuts.map((_, i) => c.etapes.filter((e) => e.element === 'carte')[i].carte)).toEqual([0, 1, 2, 3, 4]);
    const fins = [...debuts.slice(1), 14];
    debuts.forEach((d, i) => expect(fins[i] - d).toBeGreaterThanOrEqual(2.8 - 1e-6));
  });
  it('espacerApparitions : débuts déjà espacés inchangés, ordre gardé', () => {
    expect(espacerApparitions([0, 4, 8], 12)).toEqual([0, 4, 8]);
    expect(espacerApparitions([0, 0.5, 1, 1.5], 12)).toEqual([0, 3, 6, 9]);
  });
});

// ── 3. Titre lisible par défaut (v2, 9:16) ───────────────────────────────
describe('Créer : titre à taille lisible par défaut', () => {
  const base = { titre: 'LE SPORT LE PLUS COMPLET', format: '9:16', largeurPct: 84, police: 'Inter' };
  it('v2 9:16, échelle par défaut : ajustée dans les bornes, ≈ 80 % de la largeur sur ≤ 2 lignes', () => {
    const e = echelleTitreDeDepart({ ...base, echelle: 1, lisible: true });
    expect(e).toBeGreaterThanOrEqual(ECHELLE_TITRE_LISIBLE.min);
    expect(e).toBeLessThanOrEqual(ECHELLE_TITRE_LISIBLE.max);
    expect(e).toBeGreaterThan(1.5);
    // Toujours sans débordement après la garde du 9:16.
    const r = titreSur916({ format: '9:16', pos: { x: 8, y: 12 }, largeur: 84, echelle: e, titre: base.titre, police: 'Inter' });
    expect(7 * chassePolice('Inter', true).em * 1080 * 0.04375 * r.echelle).toBeLessThanOrEqual(1080 * 0.84);
  });
  it('Default safe : v1, échelle choisie, autre format → inchangé', () => {
    expect(echelleTitreDeDepart({ ...base, echelle: 1, lisible: false })).toBe(1);
    expect(echelleTitreDeDepart({ ...base, echelle: 1.3, lisible: true })).toBe(1.3);
    expect(echelleTitreDeDepart({ ...base, format: '16:9', echelle: 1, lisible: true })).toBe(1);
  });
});

// ── 3 & 7. Fonds en mouvement Titre / CTA ────────────────────────────────
describe('Créer : fond Titre / CTA = rush en mouvement (v2, sans affiche)', () => {
  const rushs = [{ url: 'https://x/r1.mp4', secondes: 4 }, { url: 'https://x/r2.mp4', secondes: 4 }, { url: 'https://x/r3.mp4', secondes: 5 }];
  it('Titre : premier rush depuis 0 ; CTA : dernier rush sur sa fin', () => {
    expect(fondsRushTexte({ lisible: true, affiche: false, rushs, dureeCta: 4.5 })).toEqual({
      intro: { url: 'https://x/r1.mp4', depuis: 0 }, cta: { url: 'https://x/r3.mp4', depuis: 0.5 },
    });
  });
  it('Default safe : v1, affiche, ou fond choisi pour la séquence → pas de fond en mouvement', () => {
    expect(fondsRushTexte({ lisible: false, affiche: false, rushs, dureeCta: 4.5 })).toBeNull();
    expect(fondsRushTexte({ lisible: true, affiche: true, rushs, dureeCta: 4.5 })).toBeNull();
    expect(fondsRushTexte({ lisible: true, affiche: false, rushs: [], dureeCta: 4.5 })).toBeNull();
    expect(fondsRushTexte({ lisible: true, affiche: false, rushs, dureeCta: 4.5, fondsSequence: { titre: { url: 'https://x/p.jpg' } } })?.intro).toBeNull();
  });
  it('aperçu : l’onglet Titre / Tout montre le fond du Titre, CTA le sien, Cartes / Vidéo aucun', () => {
    const f = fondsRushTexte({ lisible: true, affiche: false, rushs, dureeCta: 4.5 });
    expect(fondRushDeLOnglet(f, 'intro')?.url).toBe('https://x/r1.mp4');
    expect(fondRushDeLOnglet(f, 'all')?.url).toBe('https://x/r1.mp4');
    expect(fondRushDeLOnglet(f, 'cta')?.url).toBe('https://x/r3.mp4');
    expect(fondRushDeLOnglet(f, 'cards')).toBeNull();
  });
  it('câblage : aperçu (Preview + lecture) et export lisent la même décision', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf8');
    expect(src).toMatch(/fondRushTexte: affiche \? null : fondsRushProjet/);
    expect(src).toMatch(/fondRush=\{!fond\.url \? fondRushDeLOnglet\(fondsRushProjet, key\) : null\}/);
    expect(src).toMatch(/fondsRush: fondsRushProjet/);
  });
});
