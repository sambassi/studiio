/**
 * #499 — FINITION CARDIO_DANCE : badges complets, sortie dynamique, coupes
 * sur les percussions. Référence : les 3 rushes DANSE réels + la même musique.
 *
 * Avant (#498) sur cette référence :
 *  - badges : libellé réduit à « … » quand l'échelle des cartes monte
 *    (mesuré dans Chromium : 57 px pour « OS RENFORCÉS » à l'échelle 3,5) ;
 *  - sortie : vidéo arrêtée à 19,9 s, CTA sur un gros plan NOIR ET BLANC
 *    d'énergie 0,42, étiré jusqu'à la fin ;
 *  - coupes : 10/15 à ≤ 80 ms d'une percussion réelle (la fin du morceau,
 *    sans percussion forte, retombait sur la grille BPM théorique).
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import danse from '@/__tests__/fixtures/conseiller-danse.json';
import { planMontage, mesuresSegments, profilMontageDuContexte, type AnalyseRush } from '@/lib/creer/smart-montage';
import { contexteMontageDepuis, rapportPlan, estNoirEtBlanc, SEUIL_ENERGIE_CALME } from '@/lib/creer/smart-montage-regles';
import { planOverlays } from '@/lib/creer/overlays';
import { miseEnPageSurimpression, badgeValide, ajusterBadge } from '@/lib/creer/surimpressions-mise-en-page';
import { cardRatios } from '@/lib/creer/designSpec';
import { PlateauSurimpression } from '@/components/creer/PlateauSurimpression';

const analyses = danse.analyses as AnalyseRush[];
const CARTES = [
  { icon: 'Dumbbell', title: '300+ MUSCLES', value: '300+' },
  { icon: 'Brain', title: 'RISQUE RÉDUIT', value: '-76%' },
  { icon: 'Heart', title: 'CARDIO COMPLET', value: '3-en-1' },
  { icon: 'Bone', title: 'OS RENFORCÉS', value: '+2%/an' },
  { icon: 'Sparkles', title: 'ANTI-ÂGE', value: '-10 ans' },
];
const TEXTES = { sousTitre: 'Danser active plus de muscles que la plupart des sports', cartes: CARTES.map((c) => ({ title: c.title })) };
const cCreer = contexteMontageDepuis({ theme: 'danse', titre: 'DANSE', ...TEXTES });
const cAuto = contexteMontageDepuis({ theme: 'DANSE', titre: 'DANSE', ...TEXTES });

// ── 1. BADGES ────────────────────────────────────────────────────────────
describe('badges : toujours TITRE + VALEUR', () => {
  const m = miseEnPageSurimpression('CARDIO_DANCE')!;
  const plateau = (cards: typeof CARTES, i: number, scale: number) => renderToStaticMarkup(
    <PlateauSurimpression
      element={{ carte: i }} miseEnPage={m} format="9:16" largeur={1080} hauteur={1920}
      titre={{ title: 'DANSE', typography: { font: 'Inter', color: '#fff', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 } as never, subtitleTypography: { font: null, color: null, scale: 1 } as never }}
      cartes={{ cards, typography: { scale }, valueColor: '#882591' }}
      cta={{ text: 'x', typography: { font: 'Inter', color: '#fff', subColor: '#EC4899', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 } as never }}
    />,
  );

  it('BADGE_VALID = titre non vide ET valeur non vide', () => {
    expect(CARTES.every(badgeValide)).toBe(true);
    expect(badgeValide({ title: '', value: '-76%' })).toBe(false);
    expect(badgeValide({ title: '  ', value: '-76%' })).toBe(false);
    expect(badgeValide({ title: 'RISQUE RÉDUIT', value: '' })).toBe(false);
  });

  it('BADGES_TOTAL 5 × 6 échelles : chaque badge rendu porte son titre ET sa valeur, sans ellipse', () => {
    for (const scale of [1, 1.5, 2, 2.5, 3, 3.5]) {
      CARTES.forEach((c, i) => {
        const html = plateau(CARTES, i, scale);
        expect(html).toContain(`>${c.title.replace(/&/g, '&amp;')}<`);
        expect(html).toContain(`>${c.value}<`);
        expect(html).not.toContain('text-overflow:ellipsis');
        expect(html).toContain('white-space:normal');
      });
    }
  });

  it('EMPTY_TITLE_RENDERED = NON : un badge sans titre n’est pas affiché (jamais la valeur seule)', () => {
    const html = plateau([{ icon: 'Brain', title: '', value: '-76%' }] as typeof CARTES, 0, 1);
    expect(html).not.toContain('-76%');
    expect(html).not.toContain('data-card-id');
  });

  it('ajustement : l’échelle baisse (jusqu’à la moitié), puis l’icône part — titre et valeur tiennent toujours', () => {
    const CR = cardRatios(false);
    const base = { largeurPx: 1080 * 0.84, texte: 1080 * CR.text, valeurPx: 1080 * CR.value, icone: 1080 * CR.icon, ecart: 1080 * CR.gap, padX: 1080 * CR.padX };
    for (const c of CARTES) {
      const petit = ajusterBadge({ ...base, titre: c.title, valeur: c.value, echelle: 1.6 });
      expect(petit).toEqual({ echelle: 1.6, icone: true }); // rien à changer
      const grand = ajusterBadge({ ...base, titre: c.title, valeur: c.value, echelle: 5.6 });
      expect(grand.echelle).toBeLessThan(5.6);
      expect(grand.echelle).toBeGreaterThanOrEqual(2.8 - 1e-9);
    }
    // Libellé trop long même à mi-échelle : texte seul, sans icône.
    const long = ajusterBadge({ ...base, titre: 'ENDURANCECARDIOVASCULAIRE', valeur: '+300%', echelle: 4 });
    expect(long.icone).toBe(false);
  });

  it('Créer et Autopilote : le MÊME composant décide (badge = carte en surimpression)', () => {
    const sc = readFileSync(resolve(process.cwd(), 'src/components/creer/SequenceCards.tsx'), 'utf-8');
    expect(sc).toContain('const badge = fond != null && !!cardBoxes;');
    expect(sc).toContain('const cartesAffichees = badge ? cards.filter(badgeValide) : cards;');
    // Remotion (Autopilote, images du rendu hybride) passe le même fond.
    expect(readFileSync(resolve(process.cwd(), 'remotion/CreerSimpleMontage.tsx'), 'utf-8')).toContain('fond={props.cardBackground ?? null}');
  });
});

// ── 2 + 3. SORTIE DYNAMIQUE ET COUPES ──────────────────────────────────────
describe.each([21.45, 24.288])('référence DANSE, cible %s s', (cible) => {
  const plan = planMontage(analyses, cible, { rythme: danse.rythme, contexte: cCreer })!;
  const ms = mesuresSegments(plan, analyses)!;
  const r = rapportPlan('CARDIO_DANCE', ms, danse.rythme);

  it('la vidéo va aussi loin que la matière UNIQUE le permet, et conclut par le CTA (avant : 19,9 s, dernier plan étiré)', () => {
    // #504 VERROU : plus aucun passage repris — 24,288 s n'est atteignable
    // qu'en répétant ; la vidéo propre fait 23 s (l'utilisateur est prévenu).
    expect(plan.at(-1)!.fin).toBeGreaterThanOrEqual(Math.min(cible, 23) - 1e-6);
    expect(plan.at(-1)!.fin).toBeLessThanOrEqual(cible + 1e-6);
    expect(plan.at(-1)!.phase).toBe('CTA');
  });

  it('CTA : couleur, en mouvement — jamais noir et blanc ni statique ; raison mesurée', () => {
    const cta = ms.at(-1)!;
    expect(estNoirEtBlanc(cta.saturation)).toBe(false); // CTA_BW = NON
    expect(cta.energie!).toBeGreaterThanOrEqual(0.7); // CTA_STATIC = NON (avant : 0,42)
    expect(plan.at(-1)!.raison).toMatch(/CTA dynamique : énergie 0\.\d+, saturation 0\.\d+/);
    // Toute la sortie (plans visibles sous le CTA) reste en couleur et en mouvement.
    const debutCta = planOverlays({ duree: cible, nbCartes: 0, finHook: null, profil: 'CARDIO_DANCE' }).cta![0];
    ms.filter((s) => s.fin > debutCta).forEach((s) => {
      expect(estNoirEtBlanc(s.saturation)).toBe(false);
      expect(s.energie!).toBeGreaterThanOrEqual(SEUIL_ENERGIE_CALME);
    });
    expect(r.COLOR_STYLE_BREAKS).toBe(0);
  });

  it('coupes : percussions fortes là où elles existent, percussion réelle ailleurs — jamais de micro-plan', () => {
    expect(r.CUTS_IN_STRONG_ZONE_LE_80MS).toBeGreaterThanOrEqual(8); // inchangé (8 avant)
    expect(r.CUTS_PERCUSSION_LE_80MS! / r.CUTS_TOTAL).toBeGreaterThanOrEqual(0.85); // avant : 10/15
    expect(r.CUTS_PERCUSSION_GT_120MS!).toBeLessThanOrEqual(2); // avant : 4
    plan.slice(0, -1).forEach((s) => expect(s.fin - s.debut).toBeGreaterThanOrEqual(0.64 - 1e-6));
    expect(r.SHOTS_OVER_2S).toBe(0);
    plan.forEach((s) => expect(s.vitesse ?? 1).toBeGreaterThanOrEqual(0.6));
  });

  it('parité Créer / Autopilote : même profil, même plan', () => {
    expect(profilMontageDuContexte(cAuto).profil).toBe('CARDIO_DANCE');
    expect(planMontage(analyses, cible, { rythme: danse.rythme, contexte: cAuto })).toEqual(plan);
  });
});

describe('non-régression', () => {
  it('anti-gels #498 intact (pilote non modifié)', () => {
    const c = readFileSync(resolve(process.cwd(), 'src/lib/video-composer.ts'), 'utf-8');
    expect(c).toContain('const el = pilote.image(dedans ? t - vs : null);');
  });
});
