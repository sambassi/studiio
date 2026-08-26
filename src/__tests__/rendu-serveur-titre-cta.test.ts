import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  FONT_RATIO, TEXT_LAYOUT, titleShadow, subtitleShadow, leadingTrim, letterSpacingPx,
} from '@/lib/creer/designSpec';

/**
 * Titre et CTA en composants partagés — Phase 4.
 *
 * Même méthode que les cartes (Phase 2), et les mêmes deux conditions :
 * présentation séparée des aides d'édition, et **aucune classe Tailwind** — le
 * bundle Remotion n'a pas la feuille de l'application, `uppercase` n'y
 * produirait rien et le titre sortirait en minuscules.
 *
 * Le point de mesure qui décide de la parité est `leadingTrim` : le canvas
 * dessine à partir de la LIGNE DE BASE, le DOM centre le glyphe dans sa boîte
 * de ligne. Sans compensation, l'écart atteint 24 px sur le titre à
 * l'interligne maximal — assez pour décaler tout le bloc.
 */

const titre = readFileSync(resolve(__dirname, '../components/creer/SequenceTitle.tsx'), 'utf-8');
const cta = readFileSync(resolve(__dirname, '../components/creer/SequenceCta.tsx'), 'utf-8');
const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'),
  'utf-8',
);
const composition = readFileSync(resolve(__dirname, '../../remotion/CreerSimpleMontage.tsx'), 'utf-8');

describe('Aucune classe Tailwind — la leçon de la Phase 2', () => {
  it('la casse est un style en ligne, des deux côtés', () => {
    // En classe Tailwind, le titre sortirait en minuscules côté serveur : le
    // bundle Remotion n'a pas la feuille de l'application.
    //
    // ⚠️ ELLE EST DESORMAIS REGLABLE, et non plus `'uppercase'` en dur. Le
    // repli reste `DEFAULT_TEXT_CASE` — c'est-a-dire capitales — donc tout
    // montage existant sort a l'identique.
    expect(titre).toContain('textTransform: cssTextTransform(');
    expect(cta).toContain('textTransform: casse');
    expect(titre).toContain('DEFAULT_TEXT_CASE');
    expect(cta).toContain('DEFAULT_TEXT_CASE');
    expect(titre).not.toContain('className="uppercase"');
    expect(cta).not.toContain('className="uppercase"');
  });

  it('les composants n utilisent aucune classe', () => {
    for (const [nom, src] of [['titre', titre], ['cta', cta]] as const) {
      expect(src, nom).not.toContain('className=');
    }
  });
});

describe('Présentation seule — les aides d édition restent dehors', () => {
  it('aucun gestionnaire de pointeur dans les composants', () => {
    // Côté serveur il n'y a ni pointeur ni glissement : rien ne peut se
    // graver dans la vidéo.
    for (const [nom, src] of [['titre', titre], ['cta', cta]] as const) {
      // Hors commentaires : l'en-tete NOMME ces aides pour dire qu'elles
      // restent dehors.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const interdit of ['onPointerDown', 'cursor:', 'zIndex', 'outline']) {
        expect(code, `${nom}/${interdit}`).not.toContain(interdit);
      }
    }
  });

  it('l aperçu garde le liseré et le curseur autour du composant', () => {
    expect(wizard).toContain("dragging === 'title' ? `${uiPx(1)}px dashed rgba(255,255,255,0.7)`");
    expect(wizard).toContain("dragging === 'cta' ? `${uiPx(1)}px dashed rgba(255,255,255,0.7)`");
  });
});

describe('Les deux moteurs montent les MÊMES composants', () => {
  it('l aperçu', () => {
    expect(wizard).toContain('<SequenceTitle');
    expect(wizard).toContain('<SequenceCta');
  });

  it('la composition Remotion', () => {
    expect(composition).toContain('<SequenceTitle');
    expect(composition).toContain('<SequenceCta');
    // Imports RELATIFS : le bundler Remotion ignore l'alias `@/`.
    expect(composition).toContain("from '../src/components/creer/SequenceTitle'");
    expect(composition).toContain("from '../src/components/creer/SequenceCta'");
  });

  it('et le MÊME cadre — c est lui qui porte la position', () => {
    for (const src of [wizard, composition]) {
      expect(src).toContain('titleFrameStyle');
      expect(src).toContain('ctaFrameStyle');
    }
  });

  it('le rendu approximé de la Phase 1 a disparu', () => {
    expect(composition).not.toContain("fontSize: 34 * echelle");
    expect(composition).not.toContain("fontSize: 12 * echelle, textTransform: 'uppercase'");
  });
});

describe('Les ancrages', () => {
  it('le titre est ancré en HAUT-GAUCHE', () => {
    // Comme `drawIntro` avec `titleAlign: 'left'` et `textBaseline: 'top'`.
    expect(titre).toContain("left: `${position.x}%`");
    expect(titre).toContain("top: `${position.y}%`");
    // ⚠️ L'ALIGNEMENT A QUITTE LE CADRE POUR LE BLOC. Il y etait fige a
    // gauche pour titre ET sous-titre ; chacun porte desormais le sien, avec
    // 'left' pour repli — le rendu d'avant, a l'identique.
    expect(titre).toContain("typography.align ?? 'left'");
    expect(titre).toContain("subtitleTypography.align ?? typography.align ?? 'left'");
    expect(titre).not.toContain('translate(');
  });

  it('le CTA est ancré par le BAS, centré', () => {
    // `drawCTA` calcule `curY = ctaPosY - blockH` : `y` désigne le BAS du
    // bloc. Sans le `translate`, le CTA descendrait de sa propre hauteur.
    expect(cta).toContain("transform: 'translate(-50%, -100%)'");
    expect(cta).toContain("textAlign: 'center'");
  });

  it('les positions et largeurs par défaut sont partagées', () => {
    expect(TEXT_LAYOUT.titlePos).toEqual({ x: 8, y: 8 });
    expect(TEXT_LAYOUT.ctaPos).toEqual({ x: 50, y: 92 });
    expect(TEXT_LAYOUT.titleWidth).toBe(84);
    expect(TEXT_LAYOUT.ctaWidth).toBe(70);
  });
});

describe('Les mesures, partagées', () => {
  it('leadingTrim compense l interligne dans les DEUX sens', () => {
    // Le canvas dessine depuis la ligne de base ; le DOM centre le glyphe.
    expect(leadingTrim(100, 2)).toEqual({ marginTop: -50, marginBottom: -50 });
    // À l'interligne 1, rien à compenser.
    // `-0` et `0` sont distincts pour `toBe` : on compare la grandeur, qui
    // est ce qui compte pour un decalage en pixels.
    const neutre = leadingTrim(100, 1);
    expect(Math.abs(neutre.marginTop)).toBe(0);
    expect(Math.abs(neutre.marginBottom)).toBe(0);
  });

  it('l espacement des lettres part d une base 320', () => {
    expect(letterSpacingPx(2, 1080)).toBeCloseTo(6.75, 5);
    expect(letterSpacingPx(0, 1080)).toBe(0);
  });

  it('l ombre du titre a DEUX couches, celle du sous-titre une seule', () => {
    expect(titleShadow(1080).match(/drop-shadow/g)).toHaveLength(2);
    expect(subtitleShadow(1080).match(/drop-shadow/g)).toHaveLength(1);
  });

  it('l ombre ne descend jamais sous un pixel', () => {
    // Sur une vidéo minuscule, un rayon arrondi à zéro effacerait l'ombre.
    expect(titleShadow(10)).not.toContain('0px 0px');
  });

  it('le carré reprend les ratios du paysage', () => {
    // Le compositeur teste `isReel = h > w` : pour un 1080×1080 c'est FAUX,
    // il applique donc les métriques du paysage.
    expect(FONT_RATIO['1:1']).toEqual(FONT_RATIO['16:9']);
  });
});

describe('Le sous-titre n a pas de réglages propres', () => {
  it('il hérite graisse, italique et interligne du titre', () => {
    // `drawIntro` les lui impose : lui donner des contrôles ferait promettre
    // à l'aperçu ce que la vidéo ne rendrait pas.
    const bloc = titre.slice(titre.indexOf('{subtitle && ('));
    expect(bloc).toContain('fontWeight: weight');
    expect(bloc).toContain('fontStyle: style');
    expect(bloc).toContain('lineHeight: typography.lineHeight');
  });

  it('sa couleur retombe sur celle du titre à 80 %', () => {
    expect(titre).toContain('subtitleTypography.color || `${typography.color}CC`');
  });

  it('sa police retombe sur celle du titre', () => {
    expect(titre).toContain('subtitleTypography.font || typography.font');
  });
});

describe('Le format se déduit, il ne se déclare pas', () => {
  it('la composition le calcule depuis ses dimensions', () => {
    // Une prop séparée pourrait contredire la taille réelle du rendu.
    expect(composition).toContain("const format = isReel ? '9:16' : width === height ? '1:1' : '16:9';");
  });
});
