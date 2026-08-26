import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Preview } from '@/app/dashboard/creer/AssistantWizard';

/**
 * Aperçu des cartes en PAYSAGE — Mode simple.
 *
 * L'aperçu empilait les cartes en colonne quel que soit le format. En 16:9 le
 * conteneur occupe 48 % de la hauteur vidéo alors que la taille des cartes
 * suit la LARGEUR : cinq cartes formaient une pile de 160 px dans un conteneur
 * de 94 px, soit 33 px de débordement en haut comme en bas.
 *
 * Ce n'était pas un défaut cosmétique : ce conteneur est **photographié**
 * (`modern-screenshot`) puis blitté tel quel dans la vidéo, donc le montage
 * sortait avec des cartes rognées.
 *
 * Le compositeur, lui, dispose les cartes en grille en paysage
 * (`cols = isReel ? 2 : 3`) et les dimensionne sur une fenêtre de référence de
 * **512 px** et non 320. C'est ce dimensionnement qui tient dans le conteneur.
 * L'aperçu s'y aligne ici — et **le portrait ne bouge pas d'un pixel**.
 */

// Les ratios de carte vivent depuis la Phase 2 dans la spec PARTAGEE : la
// composition Remotion dessine les memes cartes et lit les memes mesures.
// Depuis la Phase 2, les cartes sont rendues par le composant PARTAGE
// `SequenceCards`, en styles EN LIGNE et non en classes Tailwind : Remotion a
// son propre bundle, sans la feuille CSS de l'application, et les classes n'y
// produisaient rien. Les assertions visent donc le style calcule.
const spec = readFileSync(resolve(__dirname, '../lib/creer/designSpec.ts'), 'utf-8');
const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'),
  'utf-8',
);
const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');

const generated = {
  title: 'Routine matin',
  subtitle: 'Sous-titre',
  cards: ['a', 'b', 'c', 'd', 'e'].map((id) => ({
    id, icon: 'Flame', title: `Carte ${id}`, description: '', value: '70%',
  })),
  cta: 'JE ME LANCE',
  ctaSub: 'LIEN EN BIO',
};
const TEXT = {
  title: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
  subtitle: { font: null, color: null, scale: 1 },
  cta: { font: 'Inter', color: '#FFFFFF', subColor: '#EC4899', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
};
const props = (format: '9:16' | '1:1' | '16:9') => ({
  generated,
  format,
  displayScale: 0.25,
  activeOrder: ['intro', 'cards', 'cta'],
  gradStart: '#7C3AED',
  gradEnd: '#EC4899',
  gradientOpacity: 0.5,
  accent: '#7C3AED',
  watermark: 'Studiio.pro',
  text: TEXT,
});

afterEach(cleanup);

const grille = () => document.querySelector<HTMLElement>('[data-cards-grid]')!;
const cartes = () =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-cards-grid] [data-card-id]'));

/** Largeur vidéo de chaque format — la base de tous les ratios de l'aperçu. */
const VW = { '9:16': 1080, '1:1': 1080, '16:9': 1920 } as const;

describe('Le portrait ne change pas', () => {
  it('garde sa colonne centrée', () => {
    render(<Preview {...props('9:16')} />);
    const host = grille();
    expect(host.style.display).toBe('flex');
    expect(host.style.flexDirection).toBe('column');
    expect(host.style.justifyContent).toBe('center');
    expect(host.style.gridTemplateColumns).toBe('');
  });

  it('garde ses cartes en ligne : icône, libellé, valeur', () => {
    render(<Preview {...props('9:16')} />);
    for (const el of cartes()) {
      expect(el.style.display).toBe('flex');
      expect(el.style.alignItems).toBe('center');
      expect(el.style.flexDirection).not.toBe('column');
    }
  });

  it('garde ses dimensions d origine — base 330', () => {
    // 9/330 pour le texte, 6/330 pour l'écart : les valeurs historiques.
    render(<Preview {...props('9:16')} />);
    expect(grille().style.gap).toBe(`${VW['9:16'] * (6 / 330)}px`);
    const libelle = cartes()[0].querySelector('span')!;
    expect(libelle.style.fontSize).toBe(`${VW['9:16'] * (9 / 330)}px`);
  });

  it('le carré aussi : il tient déjà dans son conteneur', () => {
    // Le compositeur le traite comme un paysage (`isReel = h > w`), mais sa
    // colonne tient — le basculer changerait des montages existants sans
    // nécessité.
    render(<Preview {...props('1:1')} />);
    expect(grille().style.flexDirection).toBe('column');
    expect(grille().style.gridTemplateColumns).toBe('');
  });
});

describe('Le paysage passe en grille', () => {
  it('trois colonnes, contenu centré verticalement', () => {
    render(<Preview {...props('16:9')} />);
    const host = grille();
    expect(host.style.display).toBe('grid');
    expect(host.style.flexDirection).toBe('');
    expect(host.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    expect(host.style.alignContent).toBe('center');
  });

  it('les cartes s empilent : icône au-dessus, libellé, valeur', () => {
    // Sur un tiers de largeur, une carte en ligne réduirait le libellé à deux
    // caractères et une ellipse.
    render(<Preview {...props('16:9')} />);
    for (const el of cartes()) {
      expect(el.style.flexDirection).toBe('column');
      expect(el.style.textAlign).toBe('center');
    }
  });

  it('adopte les dimensions du compositeur — base 512', () => {
    render(<Preview {...props('16:9')} />);
    const vw = VW['16:9'];
    expect(grille().style.gap).toBe(`${vw * (6 / 512)}px`);
    const carte = cartes()[0];
    // Vertical et horizontal identiques : le navigateur les fond en une valeur.
    expect(carte.style.padding).toBe(`${vw * (6 / 512)}px`);
    expect(carte.style.borderRadius).toBe(`${vw * (8 / 512)}px`);
    const [libelle, valeur] = Array.from(carte.querySelectorAll('span'));
    expect(libelle.style.fontSize).toBe(`${vw * (7 / 512)}px`);
    expect(valeur.style.fontSize).toBe(`${vw * (9 / 512)}px`);
  });

  it('le libellé tient sur une ligne, comme la troncature du compositeur', () => {
    render(<Preview {...props('16:9')} />);
    const libelle = cartes()[0].querySelector('span')!;
    // `truncate` de Tailwind = ces trois propriétés, désormais en ligne.
    expect(libelle.style.overflow).toBe('hidden');
    expect(libelle.style.textOverflow).toBe('ellipsis');
    expect(libelle.style.whiteSpace).toBe('nowrap');
    expect(libelle.style.lineHeight).toBe('1.5');
  });
});

describe('Les dimensions sont celles du compositeur, pas des valeurs inventées', () => {
  it('la fenêtre de référence du paysage est bien 512 px', () => {
    expect(composer).toContain('const editorViewportPx = isReel ? 320 : 512;');
  });

  it('le compositeur dispose bien trois colonnes en paysage', () => {
    expect(composer).toContain("const cols = isReel ? 2 : 3; // Editor: grid-cols-2 (9:16), grid-cols-3 (16:9)");
  });

  it('les tailles de police reprennent celles du compositeur', () => {
    // `labelSize = fontPx(7)`, `valueSize = fontPx(9)`, icône `fixedFontPx(18)`.
    expect(composer).toContain('const labelSize = fontPx(7);');
    expect(composer).toContain('const valueSize = fontPx(9);');
    expect(composer).toContain('const emojiSizeLocal = fixedFontPx(isReel ? 14 : 18);');
    expect(spec).toContain('text: 7 / 512,');
    expect(spec).toContain('value: 9 / 512,');
    expect(spec).toContain('icon: 18 / 512,');
  });

  it("l'interligne du texte est celui du compositeur", () => {
    expect(composer).toContain('const lineMul = 1.5;');
    expect(spec).toContain('line: 1.5,');
  });
});

describe('Le mode libre reste le mode libre', () => {
  const boxes = {
    a: { x: 5, y: 10, w: 30, h: 20 },
    b: { x: 40, y: 10, w: 30, h: 20 },
    c: { x: 5, y: 40, w: 30, h: 20 },
    d: { x: 40, y: 40, w: 30, h: 20 },
    e: { x: 5, y: 70, w: 30, h: 20 },
  };

  it('la grille cède la place aux emplacements posés à la main', () => {
    render(<Preview {...props('16:9')} cardBoxes={boxes} />);
    const host = grille();
    expect(host.style.gridTemplateColumns).toBe('');
    expect(host.style.display).not.toBe('grid');
    expect(cartes()[0].style.left).toBe('5%');
  });

  it('mais les dimensions du texte, elles, ne bougent pas', () => {
    // Sinon saisir une carte en changerait la taille de police sous le curseur.
    render(<Preview {...props('16:9')} cardBoxes={boxes} />);
    const libelle = cartes()[0].querySelector('span')!;
    expect(libelle.style.fontSize).toBe(`${VW['16:9'] * (7 / 512)}px`);
  });
});
