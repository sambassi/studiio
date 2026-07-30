import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, screen, cleanup } from '@testing-library/react';
import { Preview } from '../app/dashboard/creer-simple/AssistantWizard';

/**
 * Format 1:1 (carré, 1080×1080) dans « Créer (simple) ».
 *
 * Le piège de ce format n'est pas l'aperçu, c'est le compositeur : il ne
 * connaît pas les formats, il teste `isReel = h > w`. Pour un canvas carré
 * cette condition est FAUSSE, donc il applique les métriques du PAYSAGE — du
 * titre au CTA. Des ratios « mieux adaptés au carré » côté aperçu seraient
 * plus jolis à l'écran et faux dans la vidéo. Ces tests figent cette
 * contrainte, faute de quoi le prochain lecteur la « corrigera ».
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

const TEXT = {
  title: {
    font: 'Inter',
    color: '#FFFFFF',
    scale: 1,
    bold: true,
    italic: false,
    letterSpacing: 0,
    lineHeight: 1.1,
  },
  subtitle: { font: null, color: null, scale: 1 },
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

function renderPreview(format: '9:16' | '1:1' | '16:9') {
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
      watermark="Studiio.pro"
      text={TEXT}
    />,
  );
}

/** Le plateau est le seul élément à porter le `transform: scale()`. */
const plateau = (c: HTMLElement) => c.querySelector('[style*="scale"]') as HTMLElement;
/** Le cadre visible, parent du plateau — c'est lui qui porte l'`aspect-ratio`. */
const frame = (c: HTMLElement) => plateau(c).parentElement as HTMLElement;
const styleOf = (label: string) => (screen.getByText(label) as HTMLElement).style;

afterEach(cleanup);

describe('Aperçu — le carré est carré', () => {
  it('le cadre est au ratio 1 / 1', () => {
    const { container } = renderPreview('1:1');
    expect(frame(container).style.aspectRatio).toBe('1 / 1');
  });

  it('le plateau fait 1080 × 1080 — donc rien n’est étiré', () => {
    // Le plateau est à la résolution NATIVE, réduit par un `transform: scale`
    // uniforme. Une largeur et une hauteur égales garantissent qu'aucune
    // dimension n'est comprimée par rapport à l'autre.
    const { container } = renderPreview('1:1');
    const st = plateau(container).style;
    expect(st.width).toBe('1080px');
    expect(st.height).toBe('1080px');
    expect(st.transform).toBe('scale(0.25)');
  });

  it('les deux autres formats gardent leur cadre', () => {
    const { container: a } = renderPreview('9:16');
    expect(frame(a).style.aspectRatio).toBe('9 / 16');
    cleanup();
    const { container: b } = renderPreview('16:9');
    expect(frame(b).style.aspectRatio).toBe('16 / 9');
  });
});

describe('Aperçu — les métriques du carré sont celles que rendra la vidéo', () => {
  it('le compositeur range le carré du côté PAYSAGE', () => {
    // C'est le fait qui commande tout le reste : `h > w` est faux pour un
    // canvas carré.
    expect(composerSource).toMatch(/const isReel = h > w;/);
    expect(1080 > 1080).toBe(false);
  });

  it('titre et sous-titre reprennent donc les ratios du 16:9', () => {
    renderPreview('1:1');
    // 0.035 et 0.0215 : les valeurs que `drawIntro` applique quand
    // `isReel` est faux.
    expect(styleOf('Mon titre').fontSize).toBe(`${1080 * 0.035}px`);
    expect(styleOf('Mon sous-titre').fontSize).toBe(`${1080 * 0.0215}px`);
    expect(composerSource).toMatch(/isReel \? 0\.04375 : 0\.035/);
    expect(composerSource).toMatch(/isReel \? 0\.028 : 0\.0215/);
  });

  it('le CTA et son sous-texte aussi', () => {
    renderPreview('1:1');
    expect(styleOf('JE ME LANCE').fontSize).toBe(`${1080 * 0.031}px`);
    expect(styleOf('LIEN EN BIO').fontSize).toBe(`${1080 * 0.023}px`);
    expect(composerSource).toMatch(/isReel \? 0\.0375 : 0\.031/);
    expect(composerSource).toMatch(/isReel \? 0\.028 : 0\.023/);
  });

  it('la table du carré est identique à celle du paysage', () => {
    // Si quelqu'un « améliore » ces valeurs pour le carré, l'aperçu et
    // l'export divergent aussitôt. Ce test le rendra visible.
    const table = wizardSource.slice(
      wizardSource.indexOf('const FONT_RATIO = {'),
      wizardSource.indexOf('const CARD_RATIO'),
    );
    const carre = /'1:1': \{ title: ([\d.]+), subtitle: ([\d.]+), cta: ([\d.]+), ctaSub: ([\d.]+) \}/.exec(table);
    const paysage = /'16:9': \{ title: ([\d.]+), subtitle: ([\d.]+), cta: ([\d.]+), ctaSub: ([\d.]+) \}/.exec(table);
    expect(carre).not.toBeNull();
    expect(paysage).not.toBeNull();
    expect(carre!.slice(1)).toEqual(paysage!.slice(1));
  });

  it('le fond suit la diagonale du carré, pas celle du paysage', () => {
    // `createLinearGradient(0, 0, w, h)` sur un carré, c'est 45° — soit 135°
    // en CSS. Avec les dimensions codées en dur, le carré héritait de l'angle
    // du paysage et son fond différait de la vidéo.
    const { container } = renderPreview('1:1');
    expect(plateau(container).style.background).toContain('135.00deg');
    cleanup();
    const { container: b } = renderPreview('9:16');
    expect(plateau(b).style.background).toContain('150.64deg');
  });

  it('le filigrane descend d’un point pour ne pas toucher le CTA', () => {
    // Même largeur qu'en 9:16 (donc même taille de filigrane) mais un cadre
    // deux fois moins haut : à 95 % il venait toucher le CTA ancré à 92 %.
    renderPreview('1:1');
    const st = styleOf('Studiio.pro');
    expect(st.top).toBe('96%');
    expect(st.fontSize).toBe(`${1080 * 0.0375}px`);
  });
});

describe('Export — 1080 × 1080 part vraiment au compositeur', () => {
  it('les dimensions viennent de la table, plus d’un ternaire', () => {
    expect(wizardSource).toMatch(/'1:1': \{ w: 1080, h: 1080 \}/);
    expect(wizardSource).toMatch(/const size = VIDEO_SIZE\[format\];/);
    expect(wizardSource).toMatch(/width: size\.w,\s*\n\s*height: size\.h,/);
    // L'ancien ternaire ne pouvait produire que 1080×1920 ou 1920×1080.
    expect(wizardSource).not.toMatch(/width: isReel \? 1080 : 1920/);
  });

  it('persiste les dimensions réelles pour le Calendrier', () => {
    // `post.format` ne connaît que « reel » et « tv » : un carré y tombe du
    // côté « tv » et serait recadré dans un conteneur 16:9 — on en perdrait
    // le haut et le bas, CTA compris.
    expect(wizardSource).toMatch(/videoSize: \{ w: size\.w, h: size\.h \}/);
    const calendarSource = readFileSync(
      resolve(__dirname, '../app/dashboard/calendar/page.tsx'),
      'utf-8',
    );
    expect(calendarSource).toMatch(/const vs = meta\?\.videoSize;/);
    expect(calendarSource).toMatch(/aspectRatio: `\$\{vs!\.w\} \/ \$\{vs!\.h\}`/);
    // `contain` : équivalent à `cover` quand le conteneur porte le ratio
    // exact, mais aucun format futur ne sera rogné.
    expect(calendarSource).toMatch(/w-full h-full object-contain/);
  });

  it('ne facture pas le carré au tarif paysage', () => {
    // Aussi large que le 9:16 et deux fois moins haut : le rendu est plus
    // petit, pas plus gros.
    expect(wizardSource).toMatch(/const cost = format === '16:9' \? COST\.tv : COST\.reel;/);
  });

  it('le carré est classé « tv », comme le compositeur le classe', () => {
    expect(wizardSource).toMatch(/const renderFormat: 'reel' \| 'tv' = isReel \? 'reel' : 'tv';/);
    expect(wizardSource).toMatch(/const isReel = format === '9:16';/);
  });
});

describe('Sélecteur de format', () => {
  it('propose les trois formats, carré compris', () => {
    expect(wizardSource).toMatch(/\['9:16', '1:1', '16:9'\] as const/);
    expect(wizardSource).toMatch(/'1:1': 'Post carré'/);
  });

  it('le type Format porte les trois valeurs', () => {
    expect(wizardSource).toMatch(/type Format = '9:16' \| '1:1' \| '16:9';/);
  });
});
