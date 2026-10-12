/**
 * 9:16 — GEL DES SURIMPRESSIONS TELLES QUE LIVRÉES PAR #550 (754214b).
 *
 * La mise en page des formats larges (16:9, 1:1) a été corrigée APRÈS #550 :
 * ce gel prouve que rien n'a bougé en 9:16 (ni en l'absence de format, qui
 * vaut 9:16) — mise en page de l'Autopilote / de l'avatar
 * (`appliquerMiseEnPageSurimpression`), celle de Créer
 * (`miseEnPageSurimpression`) et le balisage du plateau photographié par
 * Créer (`PlateauSurimpression`), caractère pour caractère.
 *
 * Capturé sur 754214b, AVANT la correction des formats larges.
 * `GEL_ECRIRE=1` réécrit la fixture — à ne faire que sur ce commit-là.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { renderToStaticMarkup } from 'react-dom/server';
import { appliquerMiseEnPageSurimpression, miseEnPageSurimpression } from '@/lib/creer/surimpressions-mise-en-page';
import { PlateauSurimpression } from '@/components/creer/PlateauSurimpression';

const FICHIER = resolve(process.cwd(), 'src/__tests__/fixtures/surimpressions-916-gel-550.json');

const CINQ = [
  { icon: 'Zap', title: 'Énergie', value: '+60%' },
  { icon: 'Brain', title: 'Cerveau boosté', value: '+15%' },
  { icon: 'Flame', title: 'Calories brûlées par séance de danse', value: '600' },
  { icon: 'Heart', title: 'Endurance cardio', value: '+25 %' },
  { icon: 'Moon', title: 'Sommeil réparateur', value: '8 h' },
];
const JEUX: Record<string, Record<string, unknown>> = {
  court: { title: 'DANSE CARDIO', subtitle: 'Brûle 600 kcal', cards: CINQ.slice(0, 1), ctaText: 'ESSAI GRATUIT', ctaSubText: 'LIEN EN BIO' },
  long: { title: 'TROIS ERREURS DU SOIR QUI SABOTENT VOTRE SOMMEIL ET VOTRE ÉNERGIE', subtitle: 'Et comment les corriger dès ce soir, sans médicament', cards: CINQ, ctaText: 'Réservez votre bilan sommeil gratuit sur afroboost.com', ctaSubText: 'LIEN EN BIO', gradientEnd: '#EC4899' },
  echelles: { title: 'Court', subtitle: null, ctaText: 'GO', ctaSubText: 'lien en bio', titleScale: 1.2, subtitleScale: 0.9, ctaScale: 0.9, cardsTypography: { scale: 1.1, font: 'Anton' }, ctaSubColor: '#00FF00', gradientEnd: '#123456' },
  sansSousTexte: { title: 'BRÛLEZ 600 CALORIES', ctaText: 'Réservez votre cours d’essai sur afroboost.com' },
  vide: {},
};
const PROFILS = ['CARDIO_DANCE', 'EVENT_IMMERSIVE', 'STANDARD', 'TUTORIAL_EDUCATION', 'LIFESTYLE_BRAND', 'INCONNU', null];
const BANDES = [undefined, 'haut', 'bas'] as const;
const FORMATS = [undefined, '9:16'] as const;
const TYPO_T = { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 };
const TYPO_C = { font: 'Inter', color: '#FFFFFF', subColor: '#EC4899', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 };

function sorties(): Record<string, Record<string, string>> {
  const auto: Record<string, string> = {};
  const creer: Record<string, string> = {};
  const plateau: Record<string, string> = {};
  for (const [nom, d] of Object.entries(JEUX)) {
    for (const p of PROFILS) for (const b of BANDES) {
      // Format du design absent, 9:16 dans le design, 9:16 en option.
      auto[`${nom}|${p}|${b ?? '-'}|absent`] = JSON.stringify(appliquerMiseEnPageSurimpression({ ...d }, p, { ctaBande: b }));
      auto[`${nom}|${p}|${b ?? '-'}|design`] = JSON.stringify(appliquerMiseEnPageSurimpression({ ...d, format: '9:16' }, p, { ctaBande: b }));
      auto[`${nom}|${p}|${b ?? '-'}|option`] = JSON.stringify(appliquerMiseEnPageSurimpression({ ...d }, p, { ctaBande: b, format: '9:16' }));
    }
  }
  for (const [nom, d] of Object.entries(JEUX)) {
    for (const p of PROFILS) for (const b of BANDES) for (const f of FORMATS) {
      const cta = d.ctaText !== undefined ? { texte: d.ctaText as string, sousTexte: (d.ctaSubText as string | undefined) ?? null, echelle: (d.ctaScale as number | undefined) ?? 1 } : undefined;
      creer[`${nom}|${p}|${b ?? '-'}|${f ?? 'absent'}`] = JSON.stringify(miseEnPageSurimpression(p, { ctaBande: b, format: f, cta }));
    }
  }
  for (const [nom, d] of Object.entries(JEUX)) {
    if (!d.title) continue;
    for (const b of BANDES) {
      const m = miseEnPageSurimpression('CARDIO_DANCE', { ctaBande: b, format: '9:16', cta: { texte: d.ctaText as string, sousTexte: (d.ctaSubText as string | undefined) ?? null, echelle: 1 } })!;
      const base = {
        miseEnPage: m, format: '9:16' as const, largeur: 1080, hauteur: 1920,
        titre: { title: d.title as string, subtitle: (d.subtitle as string | undefined) ?? undefined, typography: TYPO_T, subtitleTypography: { font: null, color: null, scale: 1 } },
        cartes: { cards: (d.cards as typeof CINQ | undefined) ?? CINQ.slice(0, 2), valueColor: '#EC4899' },
        cta: { text: d.ctaText as string, subText: (d.ctaSubText as string | undefined) ?? undefined, typography: TYPO_C },
      };
      const elements: Array<[string, React.ComponentProps<typeof PlateauSurimpression>['element']]> = [['titre', 'titre'], ['cta', 'cta']];
      base.cartes.cards.forEach((_c, i) => elements.push([`carte${i}`, { carte: i }]));
      for (const [n, e] of elements) plateau[`${nom}|${b ?? '-'}|${n}`] = renderToStaticMarkup(<PlateauSurimpression {...base} element={e} />);
    }
  }
  return { auto, creer, plateau };
}

describe('9:16 — sorties identiques à #550 (754214b)', () => {
  const obtenu = sorties();
  if (process.env.GEL_ECRIRE === '1') writeFileSync(FICHIER, `${JSON.stringify(obtenu, null, 1)}\n`);
  const gel = JSON.parse(readFileSync(FICHIER, 'utf-8')) as ReturnType<typeof sorties>;
  it.each(['auto', 'creer', 'plateau'] as const)('%s : chaque sortie, caractère pour caractère', (partie) => {
    expect(Object.keys(obtenu[partie]).sort()).toEqual(Object.keys(gel[partie]).sort());
    for (const [cle, v] of Object.entries(gel[partie])) expect(obtenu[partie][cle], cle).toBe(v);
  });
  it('le gel couvre bien les trois chemins', () => {
    expect(Object.keys(gel.auto).length).toBe(5 * 7 * 3 * 3);
    expect(Object.keys(gel.creer).length).toBe(5 * 7 * 3 * 2);
    expect(Object.keys(gel.plateau).length).toBeGreaterThan(30);
  });
});
