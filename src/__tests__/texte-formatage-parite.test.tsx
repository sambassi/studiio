import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, cleanup } from '@testing-library/react';
import SequenceTitle from '@/components/creer/SequenceTitle';
import SequenceCta from '@/components/creer/SequenceCta';
import SequenceCards from '@/components/creer/SequenceCards';
import {
  applyTextCase, cssTextTransform, cssTextDecoration, decorationLines, textLeftEdge,
  sanitizeTextAlign, sanitizeTextCase, DEFAULT_TEXT_CASE,
  DECORATION_THICKNESS_RATIO, UNDERLINE_OFFSET_RATIO, STRIKE_OFFSET_RATIO,
  TEXT_CASES, TEXT_ALIGNS,
} from '@/lib/creer/textFormat';
import {
  CARD_STYLES, CARD_STYLE_NAMES, DEFAULT_CARD_STYLE, isFrameless, sanitizeCardStyle,
} from '@/lib/creer/cardStyles';
import { sanitizeDesignStyle } from '@/lib/autopilot/textStyle';
import { buildAutopilotDesign } from '@/lib/autopilot/design';
import { sanitizeConfig, DEFAULT_CONFIG } from '@/lib/autopilot/rules';
import type { PreparedPost } from '@/lib/autopilot/engine';

/**
 * Souligné, barré, casse, alignement — et les cartes sans cadre.
 *
 * ⚠️ CE QUI SE VÉRIFIE ICI EST UNE PARITÉ. Le dépôt a DEUX moteurs de rendu :
 * les composants React partagés (`SequenceTitle`, `SequenceCta`,
 * `SequenceCards`), lus par l'aperçu ET par la composition Remotion, et le
 * compositeur CANVAS (`video-composer.ts`), qui produit l'export de « Créer
 * simple ». Un réglage appliqué d'un seul côté fait mentir l'aperçu — et
 * l'écart ne se voit qu'en comparant une vidéo livrée à l'écran qui l'a
 * produite, c'est-à-dire trop tard.
 *
 * ── CE QUI EST GARANTI, ET CE QUI NE L'EST PAS ─────────────────────────
 *
 * Casse et alignement : identiques, les deux moteurs lisent la même règle.
 *
 * Souligné et barré : proportionnels, pas identiques au pixel. CSS place son
 * trait sur une métrique de la police ; le canvas n'y a pas accès et doit le
 * tracer. Les deux dérivent leur épaisseur et leur décalage des MÊMES ratios,
 * et c'est cela qu'on vérifie — promettre plus serait mentir.
 */

const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');
const titreSrc = readFileSync(resolve(__dirname, '../components/creer/SequenceTitle.tsx'), 'utf-8');
const ctaSrc = readFileSync(resolve(__dirname, '../components/creer/SequenceCta.tsx'), 'utf-8');
const cardsSrc = readFileSync(resolve(__dirname, '../components/creer/SequenceCards.tsx'), 'utf-8');

afterEach(cleanup);

const TYPO = {
  font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false,
  letterSpacing: 0, lineHeight: 1.1,
};
const SUB = { font: null, color: null, scale: 1 };

const POST: PreparedPost = {
  title: 'sommeil', caption: '', scheduledDate: '2026-08-08', scheduledTime: '18:00',
  platforms: [], rushUrl: null,
  content: {
    subtitle: 'Sous-titre', tagLine: 'CTA',
    cards: [{ icon: 'Moon', title: 'A', description: 'a', value: '1' }],
  } as PreparedPost['content'],
};

// ─────────────────────────────────────────────────────────────────────────
describe('A — la règle de casse est UNE, pas deux', () => {
  it('elle transforme le texte de la même façon partout', () => {
    expect(applyTextCase('Bonjour', 'uppercase')).toBe('BONJOUR');
    expect(applyTextCase('Bonjour', 'lowercase')).toBe('bonjour');
    expect(applyTextCase('Bonjour', 'none')).toBe('Bonjour');
    expect(applyTextCase('Bonjour', undefined)).toBe('Bonjour');
  });

  it('la valeur CSS et la transformation de chaîne disent la même chose', () => {
    // ⚠️ LE NAVIGATEUR TRANSFORME A L'AFFICHAGE, LE CANVAS DANS LA CHAINE.
    // `text-transform` agit AVANT la mise en lignes : les deux coupent donc
    // aux memes endroits. Encore faut-il qu'ils recoivent la meme consigne.
    for (const casse of TEXT_CASES) {
      expect(cssTextTransform(casse)).toBe(casse);
    }
  });

  it('elle est localisée — le « i » turc n est pas un « I »', () => {
    expect(applyTextCase('i', 'uppercase')).toBe('i'.toLocaleUpperCase());
  });

  it('le défaut historique est « capitales », des deux côtés', () => {
    // ⚠️ SANS CE DEFAUT, TOUS LES MONTAGES EXISTANTS PASSERAIENT EN
    // MINUSCULES : titre et CTA etaient en capitales EN DUR.
    expect(DEFAULT_TEXT_CASE).toBe('uppercase');
    expect(titreSrc).toContain('DEFAULT_TEXT_CASE');
    expect(ctaSrc).toContain('DEFAULT_TEXT_CASE');
    expect(composer).toContain('design?.titleCase ?? DEFAULT_TEXT_CASE');
    expect(composer).toContain('design?.ctaCase ?? DEFAULT_TEXT_CASE');
  });

  it('le compositeur applique la casse AVANT la mise en lignes', () => {
    // ⚠️ UNE MAJUSCULE N'A PAS LA LARGEUR DE SA MINUSCULE. Transformer apres
    // le `wrapText` ferait couper les lignes ailleurs que dans l'apercu.
    const i = composer.indexOf('title = applyTextCase(');
    const j = composer.indexOf('const titleLines = wrapText(');
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('B — l alignement', () => {
  it('les trois valeurs sont acceptées, une inconnue retombe', () => {
    for (const a of TEXT_ALIGNS) expect(sanitizeTextAlign(a, 'left')).toBe(a);
    expect(sanitizeTextAlign('justify', 'center')).toBe('center');
    expect(sanitizeTextAlign(undefined, 'right')).toBe('right');
    expect(sanitizeTextCase('CRIER', 'none')).toBe('none');
  });

  it('le compositeur accepte « right », qu il refusait', () => {
    // Il testait `=== 'left' ? 'left' : 'center'` : « right » y devenait
    // « center », silencieusement.
    expect(composer).toContain("sanitizeTextAlign(design?.titleAlign, 'center')");
    expect(composer).toContain("sanitizeTextAlign(design?.ctaAlign, 'center')");
    expect(composer).not.toContain("design?.titleAlign === 'left' ? 'left' : 'center'");
  });

  it('le titre rend l alignement demandé', () => {
    const { container } = render(
      <SequenceTitle
        title="Titre" typography={{ ...TYPO, align: 'right' }}
        subtitleTypography={SUB} format="9:16" containerWidth={1080}
      />,
    );
    // `container.firstElementChild` et non `querySelector('div')` : le second
    // rendrait le conteneur de la bibliotheque de test, pas le bloc de titre.
    const bloc = container.firstElementChild as HTMLElement;
    expect(bloc.style.textAlign).toBe('right');
  });

  it('le sous-titre peut différer du titre — et le suit à défaut', () => {
    const { container } = render(
      <SequenceTitle
        title="Titre" subtitle="Sous" typography={{ ...TYPO, align: 'center' }}
        subtitleTypography={{ ...SUB, align: 'right' }}
        format="9:16" containerWidth={1080}
      />,
    );
    const blocs = container.children;
    expect((blocs[0] as HTMLElement).style.textAlign).toBe('center');
    expect((blocs[1] as HTMLElement).style.textAlign).toBe('right');
  });

  it('le cadre du titre n impose plus d alignement', () => {
    // ⚠️ IL LE FIGEAIT A GAUCHE POUR LES DEUX BLOCS : titre et sous-titre
    // n'auraient jamais pu differer.
    expect(titreSrc).not.toMatch(/width: `\$\{TEXT_LAYOUT\.titleWidth\}%`,\s*\n\s*textAlign: 'left'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('C — souligné et barré : proportionnels des deux côtés', () => {
  it('la valeur CSS combine les deux, et vaut `undefined` sans rien', () => {
    expect(cssTextDecoration(true, false)).toBe('underline');
    expect(cssTextDecoration(false, true)).toBe('line-through');
    expect(cssTextDecoration(true, true)).toBe('underline line-through');
    // `undefined` et non `'none'` : une propriete absente ne touche a rien.
    expect(cssTextDecoration(false, false)).toBeUndefined();
    expect(cssTextDecoration(undefined, undefined)).toBeUndefined();
  });

  it('les traits du canvas sortent des MÊMES ratios que le CSS', () => {
    // C'est là toute la parité qu'on peut promettre : proportionnelle.
    const traits = decorationLines(100, true, true);
    expect(traits).toHaveLength(2);
    expect(traits[0].thickness).toBe(100 * DECORATION_THICKNESS_RATIO);
    expect(traits[0].offset).toBe(100 * UNDERLINE_OFFSET_RATIO);
    expect(traits[1].offset).toBe(-100 * STRIKE_OFFSET_RATIO);
    // Le souligné passe SOUS la ligne de base, le barré au-dessus.
    expect(traits[0].offset).toBeGreaterThan(0);
    expect(traits[1].offset).toBeLessThan(0);
  });

  it('les composants React posent ces mêmes ratios', () => {
    for (const [nom, src] of [['titre', titreSrc], ['cta', ctaSrc]] as const) {
      expect(src, nom).toContain('DECORATION_THICKNESS_RATIO');
      expect(src, nom).toContain('UNDERLINE_OFFSET_RATIO');
      expect(src, nom).toContain('cssTextDecoration');
    }
  });

  it('le trait n est jamais plus fin qu un pixel', () => {
    // A petite taille, `fontSize * 0,06` tombe sous 1 px : le trait
    // disparaitrait a l'export.
    expect(decorationLines(4, true, false)[0].thickness).toBe(1);
  });

  it('aucun trait demandé, aucun trait tracé', () => {
    expect(decorationLines(100, false, false)).toEqual([]);
    expect(decorationLines(100, undefined, undefined)).toEqual([]);
  });

  it('le titre et le CTA le rendent réellement', () => {
    const { container } = render(
      <SequenceTitle
        title="Titre" typography={{ ...TYPO, underline: true, strike: true }}
        subtitleTypography={SUB} format="9:16" containerWidth={1080}
      />,
    );
    const bloc = container.firstElementChild as HTMLElement;
    expect(bloc.style.textDecoration).toContain('underline');
    expect(bloc.style.textDecoration).toContain('line-through');
  });

  it('sans réglage, aucune décoration n est posée', () => {
    const { container } = render(
      <SequenceCta text="CTA" typography={{ ...TYPO, subColor: '#EC4899' }} format="9:16" containerWidth={1080} />,
    );
    expect((container.firstElementChild as HTMLElement).style.textDecoration).toBe('');
  });

  it('le compositeur trace APRÈS le texte, et le bord gauche est calculé', () => {
    expect(composer).toContain('function drawTextDecoration(');
    expect(composer).toContain('drawTextDecoration(');
    // ⚠️ `textLeftEdge` PLUTOT QU'UN CALCUL RECOPIE : `ctx.textAlign` decale
    // le trace autour d'un point d'ancrage, il faut le bord REEL.
    expect(composer).toContain('textLeftEdge(');
    expect(textLeftEdge(100, 40, 'left')).toBe(100);
    expect(textLeftEdge(100, 40, 'center')).toBe(80);
    expect(textLeftEdge(100, 40, 'right')).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('D — les cartes sans cadre', () => {
  const CARTES = [{ id: 'c1', icon: 'Zap', title: 'Carte', value: '10' }];

  it('« Text Only » figure dans la liste, et retire le cadre', () => {
    expect(CARD_STYLE_NAMES).toContain('Text Only');
    expect(isFrameless('Text Only')).toBe(true);
    expect(isFrameless('Compact')).toBe(false);
    expect(isFrameless(undefined)).toBe(false);
  });

  it('le défaut reste « Compact » — ce que tous les montages ont reçu', () => {
    // ⚠️ ET NON « Full Width », le repli du compositeur : l'ecran figeait
    // « Compact », c'est donc lui qu'ont recu tous les montages produits.
    expect(DEFAULT_CARD_STYLE).toBe('Compact');
    expect(sanitizeCardStyle('Inconnu')).toBe('Compact');
    expect(sanitizeCardStyle('Text Only')).toBe('Text Only');
  });

  it('SANS style, la carte garde son fond et son arrondi', () => {
    const { container } = render(
      <SequenceCards cards={CARTES} containerWidth={1080} landscape={false} valueColor="#EC4899" />,
    );
    const carte = container.querySelector('[data-card-id]') as HTMLElement;
    expect(carte.style.backgroundColor).toBeTruthy();
    expect(carte.style.borderRadius).toBeTruthy();
  });

  it('en « Text Only », ni fond, ni arrondi', () => {
    const { container } = render(
      <SequenceCards
        cards={CARTES} containerWidth={1080} landscape={false}
        valueColor="#EC4899" cardStyle="Text Only"
      />,
    );
    const carte = container.querySelector('[data-card-id]') as HTMLElement;
    expect(carte.style.backgroundColor).toBe('');
    expect(carte.style.borderRadius).toBe('');
  });

  it('le rembourrage horizontal part avec le fond', () => {
    // ⚠️ LE GARDER LAISSERAIT UN ESPACEMENT QUI N'ENTOURE PLUS RIEN : les
    // cartes paraitraient flotter loin les unes des autres, alors que le
    // compositeur canvas colle le texte au bord.
    const { container } = render(
      <SequenceCards
        cards={CARTES} containerWidth={1080} landscape={false}
        valueColor="#EC4899" cardStyle="Text Only"
      />,
    );
    const carte = container.querySelector('[data-card-id]') as HTMLElement;
    expect(carte.style.padding).toContain('0px');
  });

  it('le compositeur canvas sait DÉJÀ le dessiner — on ne l a pas réécrit', () => {
    // C'etait le manque cote ECRAN, pas cote rendu : le style etait fige.
    expect(composer).toContain("if (cardStyle === 'Text Only')");
  });

  it('les deux moteurs lisent le MÊME prédicat', () => {
    expect(cardsSrc).toContain('isFrameless(cardStyle)');
  });

  it('la liste vit dans un module FEUILLE, pas dans un composant client', () => {
    // ⚠️ LE VALIDATEUR DE L'AUTOPILOTE EN A BESOIN COTE SERVEUR. Importer un
    // composant `'use client'` depuis le cron pour trois chaines a deja casse
    // un build (cf. `tasks/lessons.md`, 2026-08-07).
    const feuille = readFileSync(resolve(__dirname, '../lib/creer/cardStyles.ts'), 'utf-8');
    // Aucune INSTRUCTION d'import — le mot peut figurer dans un commentaire.
    expect(feuille).not.toMatch(/^import /m);
    expect(CARD_STYLES.length).toBeGreaterThanOrEqual(6);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('E — l Autopilote hérite du formatage, sans migration', () => {
  const config = (designStyle: unknown) => sanitizeConfig({ ...DEFAULT_CONFIG, designStyle });

  it('casse, alignement et décoration sont validés', () => {
    const s = sanitizeDesignStyle({
      title: { textCase: 'lowercase', align: 'right', underline: true, strike: true },
    });
    expect(s.title).toEqual({ textCase: 'lowercase', align: 'right', underline: true, strike: true });
  });

  it('une valeur inconnue est ignorée, pas rendue telle quelle', () => {
    expect(sanitizeDesignStyle({ title: { textCase: 'CRIER', align: 'justify' } })).toEqual({});
  });

  it('le sous-titre y a droit AUSSI — le rendu les applique', () => {
    // Contrairement a la POSITION, que le rendu ne lui expose pas.
    const s = sanitizeDesignStyle({ subtitle: { align: 'center', underline: true, x: 10 } });
    expect(s.subtitle).toEqual({ align: 'center', underline: true });
  });

  it('le style de carte est restreint à la liste', () => {
    expect(sanitizeDesignStyle({ cardStyle: 'Text Only' }).cardStyle).toBe('Text Only');
    expect(sanitizeDesignStyle({ cardStyle: 'Sans Cadre' })).toEqual({});
  });

  it('le moteur les transmet au rendu', () => {
    const d = buildAutopilotDesign(POST, {
      config: config({
        title: { textCase: 'none', align: 'right', underline: true },
        cta: { strike: true },
        cardStyle: 'Text Only',
      }),
    });
    expect(d.titleCase).toBe('none');
    expect(d.titleAlign).toBe('right');
    expect(d.titleUnderline).toBe(true);
    expect(d.ctaStrike).toBe(true);
    expect(d.cardStyle).toBe('Text Only');
  });

  it('SANS style, aucun de ces champs n est écrit', () => {
    // ⚠️ C'EST LA RETRO-COMPATIBILITE. Ecrire `undefined` ferait passer un
    // design vide pour un design regle.
    const d = buildAutopilotDesign(POST, { config: config({}) }) as unknown as Record<string, unknown>;
    for (const champ of ['titleCase', 'titleAlign', 'titleUnderline', 'ctaStrike', 'cardStyle']) {
      expect(champ in d, champ).toBe(false);
    }
  });

  it('« false » est un réglage, pas une absence', () => {
    const d = buildAutopilotDesign(POST, {
      config: config({ title: { underline: false } }),
    }) as unknown as Record<string, unknown>;
    expect('titleUnderline' in d).toBe(true);
    expect(d.titleUnderline).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
describe('F — une seule barre d outils, deux écrans', () => {
  const wizard = readFileSync(
    resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'), 'utf-8');
  const barre = readFileSync(
    resolve(__dirname, '../components/creer/TextFormatToolbar.tsx'), 'utf-8');

  it('elle est montée par « Créer simple » ET par l Autopilote', () => {
    // ⚠️ DEUX BARRES RECOPIEES auraient fini par proposer des options
    // differentes, et l'utilisateur aurait attribue l'ecart a un bug.
    expect(wizard.split('<TextFormatToolbar').length - 1).toBe(2);
  });

  it('elle porte les six contrôles, en icônes lucide', () => {
    for (const icone of ['Bold', 'Italic', 'Underline', 'Strikethrough', 'CaseSensitive', 'AlignLeft', 'AlignCenter', 'AlignRight']) {
      expect(barre, icone).toContain(icone);
    }
    // Règle absolue du dépôt : aucun emoji.
    expect(barre).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it('elle affiche le défaut du RENDU, pas « Normal » par principe', () => {
    // Annoncer « Normal » sous un titre que la video sort en capitales
    // serait l'inverse de ce qui se passe.
    expect(barre).toContain('valeurs.textCase ?? defauts.textCase');
    expect(wizard).toContain('DEFAULT_TEXT_CASE');
  });
});
