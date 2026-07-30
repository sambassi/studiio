import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, screen, cleanup } from '@testing-library/react';
import { Preview } from '../app/dashboard/creer-simple/AssistantWizard';

/**
 * Chantier 3, point 5 — réglages typographiques par zone dans
 * « Créer (simple) », incrément 1.
 *
 * Le fil rouge de ces tests : un réglage n'a de valeur que s'il traverse
 * TOUTE la chaîne. Un contrôle qui bouge l'aperçu sans partir au compositeur
 * produit une vidéo différente de ce qui a été validé à l'écran ; un champ
 * envoyé au compositeur qu'il ne lit pas est un bouton mort. Les deux sont
 * vérifiés ici — le rendu sur le DOM réellement produit, le câblage sur le
 * source (il faut un navigateur pour exécuter le compositeur).
 */

const wizardSource = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);

const composerSource = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');

const GENERATED = {
  title: 'Mon titre',
  subtitle: 'Mon sous-titre',
  cards: [{ icon: 'Droplet', title: 'Carte', description: 'Description', value: '80%' }],
  cta: 'JE ME LANCE',
  ctaSub: 'LIEN EN BIO',
};

const BASE_TEXT = {
  title: {
    font: 'Inter',
    color: '#FFFFFF',
    scale: 1,
    bold: true,
    italic: false,
    letterSpacing: 0,
    lineHeight: 1.1,
  },
  cta: {
    font: 'Inter',
    color: '#FFFFFF',
    subColor: '#EC4899',
    scale: 1,
    letterSpacing: 0,
    lineHeight: 1.2,
  },
};

type TextProp = React.ComponentProps<typeof Preview>['text'];

function renderPreview(text: TextProp = BASE_TEXT, format: '9:16' | '16:9' = '9:16') {
  return render(
    <Preview
      generated={GENERATED}
      format={format}
      displayScale={0.25}
      activeOrder={['intro', 'cards', 'cta']}
      gradStart="#7C3AED"
      gradEnd="#EC4899"
      gradientOpacity={0.5}
      accent="#7C3AED"
      watermark=""
      text={text}
    />,
  );
}

const styleOf = (label: string) => (screen.getByText(label) as HTMLElement).style;

afterEach(cleanup);

describe('Aperçu — les réglages de titre s’y voient', () => {
  it('applique la police choisie, par sa variable next/font', () => {
    // Il n'existe aucune `@font-face` nommée « Anton » dans la page : next/font
    // génère des noms obfusqués et n'expose que la variable CSS. Pointer le nom
    // brut seul afficherait la police de repli.
    renderPreview({ ...BASE_TEXT, title: { ...BASE_TEXT.title, font: 'Anton' } });
    expect(styleOf('Mon titre').fontFamily).toContain('var(--font-anton)');
  });

  it('met le sous-titre dans la même police que le titre', () => {
    // `drawIntro` impose au sous-titre la police du titre : lui en donner une
    // autre ici ferait diverger l'aperçu de la vidéo.
    renderPreview({ ...BASE_TEXT, title: { ...BASE_TEXT.title, font: 'Bebas Neue' } });
    expect(styleOf('Mon sous-titre').fontFamily).toContain('var(--font-bebas)');
  });

  it('multiplie la taille du titre ET du sous-titre par l’échelle', () => {
    // Côté compositeur c'est un seul levier (`textScale`), appliqué aux deux.
    renderPreview({ ...BASE_TEXT, title: { ...BASE_TEXT.title, scale: 1.5 } });
    expect(styleOf('Mon titre').fontSize).toBe(`${1080 * 0.04375 * 1.5}px`);
    expect(styleOf('Mon sous-titre').fontSize).toBe(`${1080 * 0.028 * 1.5}px`);
  });

  it('rend le gras et l’italique', () => {
    renderPreview({
      ...BASE_TEXT,
      title: { ...BASE_TEXT.title, bold: false, italic: true },
    });
    // `drawIntro` : `bold !== false ? 900 : 400` — pas de graisse intermédiaire.
    expect(styleOf('Mon titre').fontWeight).toBe('400');
    expect(styleOf('Mon titre').fontStyle).toBe('italic');
    // Le sous-titre hérite des deux, comme dans le compositeur.
    expect(styleOf('Mon sous-titre').fontWeight).toBe('400');
    expect(styleOf('Mon sous-titre').fontStyle).toBe('italic');
  });

  it('convertit l’interlettrage dans l’échelle du compositeur', () => {
    // Le compositeur multiplie la valeur saisie par `w / 320`. Sans cette
    // conversion, 2 px à l'écran donneraient 6,75 px dans la vidéo.
    renderPreview({ ...BASE_TEXT, title: { ...BASE_TEXT.title, letterSpacing: 2 } });
    expect(styleOf('Mon titre').letterSpacing).toBe(`${(2 * 1080) / 320}px`);
    expect(composerSource).toMatch(
      /titleLetterSpacing = \(design\?\.titleTypography\?\.letterSpacing \|\| 0\) \* \(w \/ 320\)/,
    );
  });

  it('applique interligne et couleur, sous-titre à 80 %', () => {
    renderPreview({
      ...BASE_TEXT,
      title: { ...BASE_TEXT.title, lineHeight: 1.6, color: '#00FF00' },
    });
    expect(styleOf('Mon titre').lineHeight).toBe('1.6');
    expect(styleOf('Mon titre').color).toMatch(/#00FF00|rgb\(0,\s*255,\s*0\)/i);
    expect(styleOf('Mon sous-titre').lineHeight).toBe('1.6');
    // `drawIntro` dessine le sous-titre en `titleColor` à 80 % — d'où le CC.
    expect(styleOf('Mon sous-titre').color).toMatch(/#00FF00CC|rgba\(0,\s*255,\s*0,\s*0\.8\)/i);
  });
});

describe('Aperçu — les réglages de CTA s’y voient', () => {
  it('applique police, taille, interlettrage et interligne aux deux lignes', () => {
    renderPreview({
      ...BASE_TEXT,
      cta: { ...BASE_TEXT.cta, font: 'Syne', scale: 1.2, letterSpacing: 3, lineHeight: 1.5 },
    });
    const main = styleOf('JE ME LANCE');
    const sub = styleOf('LIEN EN BIO');
    expect(main.fontFamily).toContain('var(--font-syne)');
    expect(sub.fontFamily).toContain('var(--font-syne)');
    expect(main.fontSize).toBe(`${1080 * 0.0375 * 1.2}px`);
    expect(sub.fontSize).toBe(`${1080 * 0.028 * 1.2}px`);
    expect(main.letterSpacing).toBe(`${(3 * 1080) / 320}px`);
    expect(main.lineHeight).toBe('1.5');
    expect(sub.lineHeight).toBe('1.5');
  });

  it('distingue la couleur du CTA de celle de son sous-texte', () => {
    renderPreview({
      ...BASE_TEXT,
      cta: { ...BASE_TEXT.cta, color: '#112233', subColor: '#445566' },
    });
    expect(styleOf('JE ME LANCE').color).toMatch(/#112233|rgb\(17,\s*34,\s*51\)/i);
    expect(styleOf('LIEN EN BIO').color).toMatch(/#445566|rgb\(68,\s*85,\s*102\)/i);
  });

  it('garde la graisse 900 : le compositeur l’écrit en dur', () => {
    // `drawCTA` fait `ctx.font = \`900 ${size}px …\`` et ne lit JAMAIS
    // `ctaTypography.bold/italic`, pourtant déclarés dans le type. Exposer un
    // bouton « gras » sur le CTA serait un bouton mort — d'où son absence.
    renderPreview();
    expect(styleOf('JE ME LANCE').fontWeight).toBe('900');
    expect(styleOf('LIEN EN BIO').fontWeight).toBe('900');
    expect(composerSource).toMatch(/ctx\.font = `900 \$\{ctaFontSize\}px/);
    expect(composerSource).toMatch(/ctx\.font = `900 \$\{subFontSize\}px/);
    expect(composerSource).not.toMatch(/ctaTypography\?\.(bold|italic)/);
  });

  it('respecte les ratios du format 16:9', () => {
    renderPreview(BASE_TEXT, '16:9');
    expect(styleOf('Mon titre').fontSize).toBe(`${1920 * 0.035}px`);
    expect(styleOf('JE ME LANCE').fontSize).toBe(`${1920 * 0.031}px`);
  });
});

describe('Export — les mêmes valeurs partent au compositeur', () => {
  it('n’écrit qu’UNE traduction, partagée par le compositeur et le Calendrier', () => {
    // En deux copies, l'une aurait fini par dériver de l'autre — et c'est le
    // Calendrier, qui relit la seconde, qui aurait affiché autre chose que la
    // vidéo.
    expect(wizardSource.match(/const textDesign = \{/g)).toHaveLength(1);
    expect(wizardSource.match(/\.\.\.textDesign,/g)).toHaveLength(2);
  });

  it('mappe chaque réglage sur le champ que le compositeur lit vraiment', () => {
    const block = wizardSource.slice(
      wizardSource.indexOf('const textDesign = {'),
      wizardSource.indexOf('const [started, setStarted]'),
    );
    for (const field of [
      'titleFont: textStyles.title.font',
      'titleColor: textStyles.title.color',
      'textScale: textStyles.title.scale',
      'ctaColor: textStyles.cta.color',
      'ctaSubColor: textStyles.cta.subColor',
      'ctaTextScale: textStyles.cta.scale',
    ]) {
      expect(block).toContain(field);
    }
    // Nommage déroutant du compositeur, vérifié dans son code : le GRAND texte
    // du CTA prend `watermarkFont`, le sous-texte `ctaFont`. La même police
    // doit donc partir dans les deux.
    expect(block).toContain('watermarkFont: textStyles.cta.font');
    expect(block).toContain('ctaFont: textStyles.cta.font');
    expect(composerSource).toMatch(
      /const watermarkFontFamily = design\?\.watermarkFont \|\| design\?\.font/,
    );
    expect(composerSource).toMatch(/const fontFamily = design\?\.ctaFont \|\| design\?\.font/);
  });

  it('l’aperçu et l’export lisent le MÊME objet', () => {
    // `textDesign` dérive de `textStyles`, qui est aussi ce que reçoit
    // `Preview` : aucune dérive possible entre ce qui est validé à l'écran et
    // ce qui est rendu.
    expect(wizardSource).toMatch(/text=\{textStyles\}/);
    expect(wizardSource).toMatch(/titleFont: textStyles\.title\.font/);
  });
});

describe('Rétro-compatibilité — sans réglage, rien ne bouge', () => {
  it('les défauts reproduisent les valeurs d’avant', () => {
    // Titre : 900 (donc `bold: true`), interligne 1.1, blanc, Inter.
    // CTA : interligne 1.2, blanc. Ce sont les valeurs qui étaient écrites en
    // dur dans l'aperçu, et les défauts du compositeur.
    const defaults = wizardSource.slice(
      wizardSource.indexOf('const DEFAULT_TEXT_STYLES'),
      wizardSource.indexOf('/** Style de cartes'),
    );
    expect(defaults).toMatch(/font: DESIGN\.font/);
    expect(defaults).toMatch(/color: DESIGN\.titleColor/);
    expect(defaults).toMatch(/color: DESIGN\.ctaColor/);
    expect(defaults).toMatch(/bold: true/);
    expect(defaults).toMatch(/italic: false/);
    expect(defaults).toMatch(/letterSpacing: 0/);
    expect(defaults).toMatch(/lineHeight: 1\.1/);
    expect(defaults).toMatch(/lineHeight: 1\.2/);
    expect(defaults).toMatch(/scale: 1,/);
  });

  it('rend exactement comme avant avec les défauts', () => {
    renderPreview();
    const title = styleOf('Mon titre');
    expect(title.fontWeight).toBe('900');
    expect(title.fontStyle).toBe('normal');
    expect(title.lineHeight).toBe('1.1');
    expect(title.fontSize).toBe(`${1080 * 0.04375}px`);
    expect(title.letterSpacing).toBe('0px');
    expect(styleOf('JE ME LANCE').lineHeight).toBe('1.2');
  });

  it('la couleur du sous-texte du CTA suit le dégradé tant qu’elle n’est pas choisie', () => {
    // C'est ce que faisait le code avant ces réglages (`ctaSubColor: gradEnd`).
    // Une valeur seedée au montage la figerait sur le repli neutre, le kit de
    // marque n'étant lu qu'ensuite, dans un effet.
    expect(wizardSource).toMatch(/subColor: ctaStyle\.subColor \|\| gradEnd/);
  });
});

describe('Catalogue de polices', () => {
  it('ne propose que des polices connues DES DEUX côtés', () => {
    // Une police que Next charge mais que le compositeur ne sait pas injecter
    // (ou l'inverse) donnerait un aperçu et une vidéo en caractères
    // différents.
    // Borné au littéral lui-même : les commentaires voisins contiennent des
    // apostrophes françaises que le motif prendrait pour des délimiteurs.
    const start = wizardSource.indexOf('const FONT_GROUPS');
    const groups = wizardSource.slice(start, wizardSource.indexOf('];', start));
    const offered = [...groups.matchAll(/'([^']+)'/g)]
      .map((m) => m[1])
      .filter((f) => f !== 'Titres' && f !== 'Texte');
    expect(offered.length).toBeGreaterThan(0);
    for (const font of offered) {
      // Connue du compositeur (FONT_URLS)…
      expect(composerSource).toContain(`'${font}':`);
      // …et exposée par next/font via une variable CSS.
      expect(wizardSource).toMatch(new RegExp(`'?${font}'?: 'var\\(--font-`));
    }
  });

  it('classe les polices en « Titres » et « Texte »', () => {
    expect(wizardSource).toMatch(/label: 'Titres'/);
    expect(wizardSource).toMatch(/label: 'Texte'/);
  });
});
