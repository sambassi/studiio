import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CLASSE_LECTEUR_GENERATION, LECTEUR_LARGEUR_MIN_PX, LECTEUR_LARGEUR_MAX_PX, LECTEUR_RETRAIT_REM, largeurLecteur,
} from '@/lib/ui/lecteur-generation';

/**
 * MON AVATAR — « Générer la vidéo » VISIBLE DÈS L'OUVERTURE, colonne d'aperçu collante.
 *
 * jsdom ne calcule pas de mise en page : le budget est vérifié avec la hauteur
 * HORS LECTEUR mesurée au navigateur (banc local, habillage réel du tableau de
 * bord) — du haut de l'écran au bas du bouton, moins le lecteur. Mesuré
 * 524 px le 2026-10-09 ; 493 px le 2026-10-10 (#538 : sélecteur de qualité
 * ajouté, réglages compactés, légende du lecteur passée dans son titre), à
 * 1366×768 comme à 1440×900, en 9:16, 16:9 et 1:1. Si une modification de la
 * colonne change cette hauteur, la remesurer ici.
 */
const HORS_LECTEUR_MESURE_PX = 493;
const MARGE_MIN_PX = 8;
const hauteurLecteur = (h: number) => (largeurLecteur(h) * 16) / 9;

describe('Lecteur de génération — taille et budget de hauteur', () => {
  it('⚠️ la classe Tailwind reprend EXACTEMENT les constantes (min, retrait, max)', () => {
    expect(CLASSE_LECTEUR_GENERATION).toBe(
      `lg:[&_.apercu-cadre]:max-w-[clamp(${LECTEUR_LARGEUR_MIN_PX}px,calc((100vh_-_${LECTEUR_RETRAIT_REM}rem)*9/16),${LECTEUR_LARGEUR_MAX_PX}px)]`,
    );
    // Grand écran seulement : le mobile garde la règle commune.
    expect(CLASSE_LECTEUR_GENERATION.startsWith('lg:')).toBe(true);
  });

  it('⚠️ la classe vit dans un dossier analysé par Tailwind (sinon purgée en production)', () => {
    const config = readFileSync(resolve(__dirname, '../../tailwind.config.ts'), 'utf-8');
    expect(config).toContain("'./src/lib/ui/**/*.ts'");
  });

  for (const [l, h] of [[1366, 768], [1280, 800], [1280, 900], [1440, 900]] as const) {
    it(`⚠️ ${l}×${h} : le bouton tient à l’écran dès l’ouverture (≥ ${MARGE_MIN_PX} px de marge)`, () => {
      expect(HORS_LECTEUR_MESURE_PX + hauteurLecteur(h)).toBeLessThanOrEqual(h - MARGE_MIN_PX);
    });
  }

  it('le lecteur reste lisible : jamais sous 130 px de large ; 200 px dès 900 px de haut', () => {
    expect(largeurLecteur(600)).toBe(LECTEUR_LARGEUR_MIN_PX);
    expect(largeurLecteur(768)).toBe(130);
    expect(largeurLecteur(900)).toBe(200);
    expect(largeurLecteur(1200)).toBe(LECTEUR_LARGEUR_MAX_PX);
  });

  it('la page pose bien cette classe sur la zone d’aperçu quand le formulaire de génération est affiché', () => {
    const page = readFileSync(resolve(__dirname, '../app/dashboard/avatar/page.tsx'), 'utf-8');
    expect(page).toContain("import { CLASSES_LECTEUR_GENERATION, ratioCadre, formatLecteurDepuisRatio } from '@/lib/ui/lecteur-generation';");
    // La classe du FORMAT CHOISI (9:16 garde exactement `CLASSE_LECTEUR_GENERATION`).
    expect(page).toContain("className={avatar && etatEffectif === 'valide' && !viaDid ? `${CLASSES_LECTEUR_GENERATION[formatLecteurDepuisRatio(zone.ratio)]} lg:!p-3 lg:!space-y-2` : ''}");
  });
});
