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
  cards: [{ id: 'c1', icon: 'Droplet', title: 'Carte', description: 'Description', value: '80%' }],
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
  subtitle: {
    font: null,
    color: null,
    scale: 1,
  },
  cta: {
    font: 'Inter',
    color: '#FFFFFF',
    subColor: '#EC4899',
    scale: 1,
    bold: true,
    italic: false,
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

describe('Sous-titre — sa typographie propre', () => {
  it('suit le titre tant qu’on ne lui donne rien', () => {
    // `null` = aucun champ transmis. Le compositeur retombe alors sur le
    // titre, et l'aperçu doit faire exactement pareil — c'est le rendu
    // d'avant ces réglages.
    renderPreview({
      ...BASE_TEXT,
      title: { ...BASE_TEXT.title, font: 'Anton', color: '#00FF00' },
    });
    const sub = styleOf('Mon sous-titre');
    expect(sub.fontFamily).toContain('var(--font-anton)');
    // `titleColor` à 80 %, le `CC` du compositeur.
    expect(sub.color).toMatch(/#00FF00CC|rgba\(0,\s*255,\s*0,\s*0\.8\)/i);
    expect(sub.fontSize).toBe(`${1080 * 0.028}px`);
  });

  it('applique sa police, sa taille et sa couleur propres', () => {
    renderPreview({
      ...BASE_TEXT,
      title: { ...BASE_TEXT.title, font: 'Anton' },
      subtitle: { font: 'Poppins', color: '#123456', scale: 1.4 },
    });
    const sub = styleOf('Mon sous-titre');
    expect(sub.fontFamily).toContain('var(--font-poppins)');
    // Une couleur choisie est peinte à PLEIN : pas d'atténuation surprise.
    expect(sub.color).toMatch(/#123456|rgb\(18,\s*52,\s*86\)/i);
    expect(sub.fontSize).toBe(`${1080 * 0.028 * 1.4}px`);
    // Le titre, lui, garde la sienne.
    expect(styleOf('Mon titre').fontFamily).toContain('var(--font-anton)');
  });

  it('la régénération depuis le Calendrier garde sa typographie', () => {
    // Persistés mais relus nulle part, les trois champs se perdaient : un
    // sous-titre Poppins bleu à 140 % se régénérait dans la police du titre,
    // blanc à 80 %, taille 100 %.
    const calendarSource = readFileSync(
      resolve(__dirname, '../app/dashboard/calendar/page.tsx'),
      'utf-8',
    );
    for (const field of ['subtitleFont', 'subtitleColor', 'subtitleScale']) {
      const uses = calendarSource.match(
        new RegExp(`${field}: (designMeta|calDesign\\?)\\.${field}`, 'g'),
      );
      expect(uses).toHaveLength(4); // les 4 appels a composeAndUpload
    }
  });

  it('le compositeur lit bien ces trois champs', () => {
    expect(composerSource).toMatch(/const subFamily = design\?\.subtitleFont \|\| fontFamily/);
    expect(composerSource).toMatch(/design\?\.subtitleScale \?\? 1/);
    expect(composerSource).toMatch(
      /ctx\.fillStyle = design\?\.subtitleColor \|\| hexToRgba\(titleColor, 0\.8\)/,
    );
    // La police du sous-titre doit être préchargée, sinon les premières
    // secondes rendent en police de repli.
    expect(composerSource).toMatch(/design\?\.titleFont, design\?\.subtitleFont/);
  });

  it('ne transmet rien tant que rien n’est choisi', () => {
    // Un `subtitleFont: undefined` explicite serait sans effet, mais un
    // `subtitleScale: 1` transmis ferait diverger la ligne de base d'un
    // arrondi. On n'envoie que ce qui a été choisi.
    expect(wizardSource).toMatch(
      /\.\.\.\(textStyles\.subtitle\.font \? \{ subtitleFont: textStyles\.subtitle\.font \} : \{\}\)/,
    );
    expect(wizardSource).toMatch(/textStyles\.subtitle\.scale !== 1 \? \{ subtitleScale:/);
  });

  it('garde graisse, italique et interligne du titre', () => {
    // `drawIntro` les lui impose : lui donner des contrôles afficherait des
    // réglages sans effet sur la vidéo.
    renderPreview({
      ...BASE_TEXT,
      title: { ...BASE_TEXT.title, bold: false, italic: true, lineHeight: 1.7 },
      subtitle: { font: 'Poppins', color: null, scale: 1 },
    });
    const sub = styleOf('Mon sous-titre');
    expect(sub.fontWeight).toBe('400');
    expect(sub.fontStyle).toBe('italic');
    expect(sub.lineHeight).toBe('1.7');
  });
});

describe('Aperçu — les réglages de CTA s’y voient', () => {
  it('applique police, taille et interligne aux deux lignes', () => {
    renderPreview({
      ...BASE_TEXT,
      cta: { ...BASE_TEXT.cta, font: 'Syne', scale: 1.2, lineHeight: 1.5 },
    });
    const main = styleOf('JE ME LANCE');
    const sub = styleOf('LIEN EN BIO');
    expect(main.fontFamily).toContain('var(--font-syne)');
    expect(sub.fontFamily).toContain('var(--font-syne)');
    expect(main.fontSize).toBe(`${1080 * 0.0375 * 1.2}px`);
    expect(sub.fontSize).toBe(`${1080 * 0.028 * 1.2}px`);
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

  it('rend le gras et l’italique du CTA', () => {
    // `drawCTA` écrivait `900` en dur à chaque `ctx.font` et ne lisait jamais
    // `ctaTypography.bold/italic`, pourtant déclarés : les deux réglages
    // existaient dans le type sans le moindre effet.
    renderPreview({ ...BASE_TEXT, cta: { ...BASE_TEXT.cta, bold: false, italic: true } });
    expect(styleOf('JE ME LANCE').fontWeight).toBe('400');
    expect(styleOf('JE ME LANCE').fontStyle).toBe('italic');
    expect(styleOf('LIEN EN BIO').fontWeight).toBe('400');
    // Plus aucune graisse figée dans `drawCTA` : tout passe par le helper.
    expect(composerSource).not.toMatch(/ctx\.font = `900 \$\{ctaFontSize\}px/);
    expect(composerSource).not.toMatch(/ctx\.font = `900 \$\{subFontSize\}px/);
    expect(composerSource).toMatch(/const ctaBold = design\?\.ctaTypography\?\.bold !== false/);
    expect(composerSource).toMatch(/const ctaItalic = !!design\?\.ctaTypography\?\.italic/);
  });

  it('garde la graisse 900 par défaut — rétro-compat du CTA', () => {
    renderPreview();
    expect(styleOf('JE ME LANCE').fontWeight).toBe('900');
    expect(styleOf('LIEN EN BIO').fontWeight).toBe('900');
    expect(styleOf('JE ME LANCE').fontStyle).toBe('normal');
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

  it('écrit AUSSI la forme imbriquée que relit le Calendrier', () => {
    // Le Calendrier lit `design.typography.title` / `.cta`, jamais les clés à
    // plat `titleTypography` / `ctaTypography` : sans cette seconde forme,
    // gras, italique et interligne disparaissaient à la régénération et dans
    // l'aperçu du Calendrier.
    const calendarSource = readFileSync(
      resolve(__dirname, '../app/dashboard/calendar/page.tsx'),
      'utf-8',
    );
    expect(calendarSource).toMatch(/titleTypography: designMeta\.typography\?\.title/);
    expect(calendarSource).toMatch(/ctaTypography: designMeta\.typography\?\.cta/);
    const block = wizardSource.slice(
      wizardSource.indexOf('const textDesign = {'),
      wizardSource.indexOf('const [started, setStarted]'),
    );
    expect(block).toMatch(/typography: \{\s*title: \{/);
    expect(block).toMatch(/cta: \{\s*bold: textStyles\.cta\.bold/);
  });

  it('fait suivre la police choisie à la régénération', () => {
    // Le Calendrier ne relisait AUCUNE police par élément : un titre réglé sur
    // Anton se régénérait en Inter.
    const calendarSource = readFileSync(
      resolve(__dirname, '../app/dashboard/calendar/page.tsx'),
      'utf-8',
    );
    // Les quatre appels à composeAndUpload du Calendrier.
    expect(calendarSource.match(/titleFont: (designMeta|calDesign\?)\.titleFont/g)).toHaveLength(4);
    expect(calendarSource.match(/watermarkFont: (designMeta|calDesign\?)\.watermarkFont/g)).toHaveLength(4);
  });

  it('empêche la taille du titre de grossir les cartes', () => {
    // `textScale` est aussi lu par `drawCards` et par la reconstruction HTML
    // du Calendrier. Sans compensation, régler « Taille » sous l'onglet Titre
    // grossissait le texte des cartes d'autant — invisible tant que la photo
    // de l'aperçu est blittée, mais bien réel dès qu'elle échoue.
    expect(composerSource).toMatch(
      /fontPx = \(cssPx: number\) => Math\.round\(w \* cssPx \/ editorViewportPx \* textScale \* cardsTextMul\)/,
    );
    expect(composerSource).toMatch(/cardsTextMul = \(design\?\.cardsTextScale \?\? 100\) \/ 100/);
    expect(wizardSource).toMatch(/cardsTextScale: 100 \/ textStyles\.title\.scale/);
  });

  it('l’aperçu et l’export lisent le MÊME objet', () => {
    // `textDesign` dérive de `textStyles`, qui est aussi ce que reçoit
    // `Preview` : aucune dérive possible entre ce qui est validé à l'écran et
    // ce qui est rendu.
    //
    // La valeur transite par `previewShared`, l'objet que lisent l'aperçu de
    // la colonne ET la fenêtre agrandie — l'indirection est justement ce qui
    // empêche les deux instances de diverger.
    expect(wizardSource).toMatch(/text: textStyles,/);
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
    expect(styleOf('JE ME LANCE').lineHeight).toBe('1.2');
  });

  it('aligne le haut du texte sur celui du canvas, quel que soit l’interligne', () => {
    // Le compositeur dessine en `textBaseline: 'top'` — le glyphe commence
    // EXACTEMENT à Y. CSS répartit `(L-1)·F` moitié au-dessus, moitié
    // au-dessous : sans correction, l'aperçu descendrait le titre de 24 px et
    // le sous-titre de 63 px à l'interligne maximal.
    expect(composerSource).toMatch(/ctx\.textBaseline = 'top'/);
    const F = 1080 * 0.04375;
    renderPreview({ ...BASE_TEXT, title: { ...BASE_TEXT.title, lineHeight: 2 } });
    const title = styleOf('Mon titre');
    expect(title.marginTop).toBe(`${-((2 - 1) * F) / 2}px`);
    expect(title.marginBottom).toBe(`${-((2 - 1) * F) / 2}px`);
    // À l'interligne 1, il n'y a rien à retrancher.
    cleanup();
    renderPreview({ ...BASE_TEXT, title: { ...BASE_TEXT.title, lineHeight: 1 } });
    expect(styleOf('Mon titre').marginTop).toBe('0px');
  });

  it('la couleur du sous-texte du CTA suit le dégradé tant qu’elle n’est pas choisie', () => {
    // C'est ce que faisait le code avant ces réglages (`ctaSubColor: gradEnd`).
    // Une valeur seedée au montage la figerait sur le repli neutre, le kit de
    // marque n'étant lu qu'ensuite, dans un effet.
    expect(wizardSource).toMatch(/subColor: ctaStyle\.subColor \|\| gradEnd/);
  });
});

describe('Catalogue de polices', () => {
  it('l’aperçu et le compositeur lisent LE MÊME catalogue', () => {
    // C'était une liste dans le wizard et une autre dans le compositeur :
    // une police connue d'un seul côté donnait un aperçu et une vidéo en
    // caractères différents. Une seule source supprime la classe entière de
    // bugs — reste à vérifier que les deux la consultent.
    expect(wizardSource).toMatch(/from '@\/lib\/fonts\/catalog'/);
    // Le Calendrier aussi : il portait sa propre table de six polices, si
    // bien qu'un post réglé hors de ces six s'y affichait en police système
    // alors que la vidéo, elle, la portait bien.
    const calendarSource = readFileSync(
      resolve(__dirname, '../app/dashboard/calendar/page.tsx'),
      'utf-8',
    );
    expect(calendarSource).toMatch(/from '@\/lib\/fonts\/catalog'/);
    expect(calendarSource).not.toMatch(/const FONT_CSS_MAP/);
    expect(composerSource).toMatch(
      /const \{ ensureFontsLoaded \} = await import\('@\/lib\/fonts\/catalog'\)/,
    );
    // Et plus aucune liste d'URL en dur côté compositeur.
    expect(composerSource).not.toMatch(/const FONT_URLS/);
  });

  it('classe les polices en Titres, Texte et Script', () => {
    expect(wizardSource).toMatch(/<optgroup key=\{g\.group\} label=\{g\.label\}>/);
  });
});
