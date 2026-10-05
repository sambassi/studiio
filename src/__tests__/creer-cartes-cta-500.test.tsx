/**
 * #500 — CARTES ABSENTES + CTA DU BRIEF IGNORÉ (rendu réel DANSE (7), 30,3 s).
 *
 * Constat staging (metadata du post `fc02f02b`) : 5 fenêtres de cartes
 * planifiées, 5 cartes au contenu… toutes avec `label: ""` et `emoji: ""`.
 * Origine : le post Autopilote `1b402f05` (cartes `icon` / `title`) rouvert
 * dans Créer — `toWizardDraft` ne lisait que `emoji` / `label`. Les 4 posts
 * Créer suivants ont hérité de cartes réduites à leur valeur ; #499 ne
 * montre plus un badge sans titre → 0 carte à l'écran, sans un mot.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { toWizardDraft } from '@/lib/creer/postMetadata/to-wizard';
import { planOverlays } from '@/lib/creer/overlays';
import { bilanCartesSurimpression, erreurCartesSurimpression, avecCtaDuBrief } from '@/lib/creer/validation-rendu';
import { miseEnPageSurimpression } from '@/lib/creer/surimpressions-mise-en-page';
import { PlateauSurimpression } from '@/components/creer/PlateauSurimpression';

// Cartes telles que l'Autopilote les écrit (post `1b402f05`).
const CARTES_AUTOPILOTE = [
  { icon: 'Brain', title: 'MÉMOIRE BOOSTÉE', value: '-76%', description: 'Apprendre des chorégraphies stimule ta mémoire' },
  { icon: 'Heart', title: 'CARDIO COMPLET', value: '3-en-1', description: 'La danse combine cardio, renforcement et souplesse' },
  { icon: 'Bone', title: 'OS RENFORCÉS', value: '+2%/an', description: 'Les impacts de la danse augmentent ta densité osseuse' },
  { icon: 'Sparkles', title: 'ANTI-ÂGE', value: '-10 ans', description: 'Les danseurs réguliers vieillissent 10 ans moins vite' },
  { icon: 'Dumbbell', title: '300+ MUSCLES', value: '300+', description: 'La danse sollicite plus de 300 muscles' },
];
const CTA_BRIEF = 'Réservez votre cours d’essai sur afroboost.com.';
const DUREE = 30.3;

const cartesRouvertes = (cards: unknown[]) =>
  (toWizardDraft({ id: 'p1', title: 'DANSE', metadata: { cards } }).generated as { cards: Array<{ title: string; icon: string; value: string }> }).cards;

describe('Modifier → Créer : les cartes gardent titre et icône', () => {
  it('post Autopilote (`icon` / `title`) : SCRIPT_CARDS_COUNT 5 → WIZARD_CARDS_COUNT 5, complètes', () => {
    const c = cartesRouvertes(CARTES_AUTOPILOTE);
    expect(c).toHaveLength(5);
    c.forEach((x, i) => {
      expect(x.title).toBe(CARTES_AUTOPILOTE[i].title);
      expect(x.icon).toBe(CARTES_AUTOPILOTE[i].icon);
      expect(x.value).toBe(CARTES_AUTOPILOTE[i].value);
    });
  });

  it('post Créer (`emoji` / `label`) : inchangé', () => {
    const c = cartesRouvertes([{ emoji: 'Heart', label: 'CARDIO', value: '3-en-1' }]);
    expect(c[0]).toMatchObject({ icon: 'Heart', title: 'CARDIO', value: '3-en-1' });
  });
});

describe('pipeline DANSE : 5 cartes de bout en bout', () => {
  const fenetres = planOverlays({ duree: DUREE, nbCartes: 5, finHook: 1, profil: 'CARDIO_DANCE' });
  const cartes = cartesRouvertes(CARTES_AUTOPILOTE);

  it('PLAN_CARD_WINDOWS_COUNT = 5, une fenêtre par carte, successives (jamais simultanées)', () => {
    expect(fenetres.cartes).toHaveLength(5);
    fenetres.cartes.slice(1).forEach((f, i) => expect(f.debut).toBeGreaterThanOrEqual(fenetres.cartes[i].fin));
    const b = bilanCartesSurimpression(cartes, fenetres.cartes);
    expect(b).toEqual({ attendues: 5, valides: 5, incompletes: [], sansFenetre: [] });
    expect(erreurCartesSurimpression(b)).toBeNull();
  });

  it('RENDERED_CARDS = 5 : chaque plateau de carte porte titre ET valeur', () => {
    const m = miseEnPageSurimpression('CARDIO_DANCE')!;
    fenetres.cartes.forEach((f) => {
      const html = renderToStaticMarkup(
        <PlateauSurimpression
          element={{ carte: f.index }} miseEnPage={m} format="9:16" largeur={1080} hauteur={1920}
          titre={{ title: 'DANSE', typography: { font: 'Inter', color: '#fff', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 } as never, subtitleTypography: { font: null, color: null, scale: 1 } as never }}
          cartes={{ cards: cartes, valueColor: '#882591' }}
          cta={{ text: 'x', typography: { font: 'Inter', color: '#fff', subColor: '#EC4899', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 } as never }}
        />,
      );
      expect(html).toContain(CARTES_AUTOPILOTE[f.index].title);
      expect(html).toContain(CARTES_AUTOPILOTE[f.index].value);
    });
  });

  it('cartes perdues (cas réel DANSE (7)) : le rendu S’ARRÊTE avec un message, jamais 0 carte en silence', () => {
    const vides = CARTES_AUTOPILOTE.map((c) => ({ title: '', value: c.value }));
    const b = bilanCartesSurimpression(vides, fenetres.cartes);
    expect(b.valides).toBe(0);
    expect(b.incompletes).toEqual([1, 2, 3, 4, 5]);
    expect(erreurCartesSurimpression(b)).toMatch(/Les cartes 1, 2, 3, 4, 5 n’ont pas de titre ou de valeur.*Rien n’a été composé ni débité/);
  });

  it('vidéo trop courte pour toutes les cartes : signalé (sans fenêtre), pas une erreur', () => {
    const court = planOverlays({ duree: 8, nbCartes: 5, finHook: 1, profil: 'CARDIO_DANCE' });
    const b = bilanCartesSurimpression(cartes, court.cartes);
    expect(b.sansFenetre.length).toBe(5 - court.cartes.length);
    expect(erreurCartesSurimpression(b)).toBeNull();
  });
});

describe('CTA : le brief est la source de vérité', () => {
  const contenu = { cta: 'LE SPORT LE PLUS COMPLET', ctaSub: '' };

  it('CTA_USER_TEXT_RENDERED : l’action du brief sous la headline gardée', () => {
    const r = avecCtaDuBrief(contenu, { cta: CTA_BRIEF });
    expect(r).toEqual({ cta: 'LE SPORT LE PLUS COMPLET', ctaSub: CTA_BRIEF });
    const html = renderToStaticMarkup(
      <PlateauSurimpression
        element="cta" miseEnPage={miseEnPageSurimpression('CARDIO_DANCE')!} format="9:16" largeur={1080} hauteur={1920}
        titre={{ title: 'DANSE', typography: {} as never, subtitleTypography: {} as never }}
        cartes={{ cards: [], valueColor: '#882591' }}
        cta={{ text: r.cta, subText: r.ctaSub, typography: { font: 'Inter', color: '#fff', subColor: '#EC4899', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 } as never }}
      />,
    );
    expect(html).toContain('LE SPORT LE PLUS COMPLET'); // CTA_HEADLINE_RENDERED
    expect(html).toContain('Réservez votre cours d’essai sur afroboost.com.');
  });

  it('jamais remplacé par plus générique ; brief vide : contenu inchangé ; déjà présent : pas de doublon', () => {
    expect(avecCtaDuBrief({ cta: 'LE SPORT LE PLUS COMPLET', ctaSub: 'Rejoins-nous' }, { cta: CTA_BRIEF }).ctaSub).toBe(CTA_BRIEF);
    expect(avecCtaDuBrief({ cta: '', ctaSub: 'x' }, { cta: CTA_BRIEF })).toEqual({ cta: CTA_BRIEF, ctaSub: 'x' });
    expect(avecCtaDuBrief(contenu, { cta: '  ' })).toBe(contenu);
    expect(avecCtaDuBrief(contenu, null)).toBe(contenu);
    const deja = { cta: CTA_BRIEF, ctaSub: '' };
    expect(avecCtaDuBrief(deja, { cta: CTA_BRIEF })).toBe(deja);
  });
});

describe('câblage du Wizard', () => {
  const w = readFileSync(resolve(process.cwd(), 'src/app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');
  it('CTA du brief appliqué au contenu rendu (vidéo, surimpression, metadata)', () => {
    expect(w).toContain('contenu = avecCtaDuBrief(contenu, brief);');
  });
  it('validation avant capture, avant toute réservation', () => {
    const i = w.indexOf('const erreurCartes = erreurCartesSurimpression(bilanCartes);');
    expect(i).toBeGreaterThan(0);
    expect(w.indexOf('if (erreurCartes) throw new Error(erreurCartes);')).toBeGreaterThan(i);
    expect(w.indexOf("setRenderStage('Textes sur la vidéo…');")).toBeGreaterThan(i);
  });
});
