import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Preview } from '../app/dashboard/creer-simple/AssistantWizard';

/**
 * Refonte de la disposition de l'étape Style.
 *
 * Le retour utilisateur était précis : le panneau s'allonge et l'aperçu
 * disparaît quand on descend. La réponse tient en trois points — aperçu
 * collé, sections repliables une à la fois, onglets sur l'aperçu — et en une
 * règle : **rien ne doit disparaître**. Une refonte de disposition qui perd
 * un réglage en chemin est une régression, pas une amélioration. C'est ce que
 * ces tests surveillent en premier.
 */

const wizardSource = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);

const GENERATED = {
  title: 'Mon titre',
  subtitle: 'Mon sous-titre',
  cards: [{ icon: 'Droplet', title: 'Ma carte', description: 'Description', value: '80%' }],
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

function renderPreview(props: Partial<React.ComponentProps<typeof Preview>> = {}) {
  return render(
    <Preview
      generated={GENERATED}
      format="9:16"
      displayScale={0.25}
      activeOrder={['intro', 'cards', 'cta']}
      gradStart="#7C3AED"
      gradEnd="#EC4899"
      gradientOpacity={0.5}
      accent="#7C3AED"
      watermark="Studiio.pro"
      text={TEXT}
      {...props}
    />,
  );
}

afterEach(cleanup);

describe('Onglets de l’aperçu', () => {
  it('n’apparaissent que si le parent sait les gérer', () => {
    // Sans `onFocusChange`, l'aperçu reste la composition complète : pas
    // d'onglets morts à l'écran.
    renderPreview();
    expect(screen.queryByRole('tablist')).toBeNull();
    cleanup();
    renderPreview({ onFocusChange: () => {} });
    expect(screen.getByRole('tablist')).toBeDefined();
  });

  it('« Tout » montre la composition complète', () => {
    renderPreview({ onFocusChange: () => {}, focus: 'all' });
    expect(screen.getByText('Mon titre')).toBeDefined();
    expect(screen.getByText('Ma carte')).toBeDefined();
    expect(screen.getByText('JE ME LANCE')).toBeDefined();
  });

  it('chaque onglet isole son élément', () => {
    renderPreview({ onFocusChange: () => {}, focus: 'intro' });
    expect(screen.getByText('Mon titre')).toBeDefined();
    expect(screen.queryByText('Ma carte')).toBeNull();
    expect(screen.queryByText('JE ME LANCE')).toBeNull();

    cleanup();
    renderPreview({ onFocusChange: () => {}, focus: 'cards' });
    expect(screen.queryByText('Mon titre')).toBeNull();
    expect(screen.getByText('Ma carte')).toBeDefined();

    cleanup();
    renderPreview({ onFocusChange: () => {}, focus: 'cta' });
    expect(screen.queryByText('Ma carte')).toBeNull();
    expect(screen.getByText('JE ME LANCE')).toBeDefined();
    expect(screen.getByText('LIEN EN BIO')).toBeDefined();
  });

  it('remonte le choix au parent', () => {
    const seen: string[] = [];
    renderPreview({ onFocusChange: (f) => seen.push(f) });
    fireEvent.click(screen.getByRole('tab', { name: 'Cartes' }));
    fireEvent.click(screen.getByRole('tab', { name: 'CTA' }));
    expect(seen).toEqual(['cards', 'cta']);
  });

  it('désactive l’onglet d’une séquence masquée', () => {
    // Proposer « CTA » alors que la séquence est masquée afficherait un
    // aperçu vide sans dire pourquoi.
    renderPreview({ onFocusChange: () => {}, activeOrder: ['intro', 'cards'] });
    expect((screen.getByRole('tab', { name: 'CTA' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('tab', { name: 'Titre' }) as HTMLButtonElement).disabled).toBe(false);
    // « Tout » reste toujours atteignable.
    expect((screen.getByRole('tab', { name: 'Tout' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('ne montre pas le rush hors de la vue d’ensemble', () => {
    // Il occupe tout le plateau : il masquerait l'élément qu'on règle.
    const { container } = renderPreview({
      onFocusChange: () => {},
      activeOrder: ['intro', 'cards', 'video', 'cta'],
      rushUrl: 'https://exemple.test/rush.mp4',
      focus: 'all',
    });
    expect(container.querySelector('video')).not.toBeNull();
    cleanup();
    const { container: c2 } = renderPreview({
      onFocusChange: () => {},
      activeOrder: ['intro', 'cards', 'video', 'cta'],
      rushUrl: 'https://exemple.test/rush.mp4',
      focus: 'intro',
    });
    expect(c2.querySelector('video')).toBeNull();
  });

  it('le conteneur des cartes reste MONTÉ quel que soit l’onglet', () => {
    // C'est lui que l'export photographie (`cardsRef` + `domToCanvas`).
    // Démonté, `offsetWidth` vaudrait 0 et la capture serait silencieusement
    // sautée : le compositeur redessinerait les cartes lui-même, et la vidéo
    // cesserait d'être le décalque de l'aperçu.
    for (const focus of ['all', 'intro', 'cards', 'cta'] as const) {
      const { container } = renderPreview({ onFocusChange: () => {}, focus });
      expect(container.querySelector('[data-cards-grid]')).not.toBeNull();
      cleanup();
    }
  });
});

describe('Export — la photo part toujours de la composition complète', () => {
  it('force « Tout » avant la capture, et rend la main après', () => {
    // Prise depuis l'onglet « Titre », la photo aurait figé des cartes vides
    // dans la vidéo.
    const capture = wizardSource.slice(
      wizardSource.indexOf('const focusBeforeCapture = previewFocus;'),
      wizardSource.indexOf('// 3. Composition + upload'),
    );
    expect(capture).not.toHaveLength(0);
    expect(capture).toMatch(/flushSync\(\(\) => setPreviewFocus\('all'\)\)/);
    // Deux frames : React a commit, le navigateur doit encore peindre.
    expect(capture).toMatch(/requestAnimationFrame\(\(\) => requestAnimationFrame/);
    // Restauré même si la capture échoue.
    expect(capture).toMatch(/finally \{\s*if \(focusBeforeCapture !== 'all'\) setPreviewFocus\(focusBeforeCapture\);/);
  });
});

describe('Disposition — l’aperçu ne disparaît plus', () => {
  it('la colonne d’aperçu est collée', () => {
    expect(wizardSource).toMatch(/className="lg:col-span-2 lg:sticky lg:top-4"/);
    // `items-start` est ce qui rend le `sticky` opérant : sans lui la colonne
    // s'étire sur toute la hauteur et n'a plus rien à coller.
    expect(wizardSource).toMatch(/grid grid-cols-1 lg:grid-cols-5 gap-6 items-start/);
  });

  it('une seule section ouverte à la fois', () => {
    // Un tableau de sections ouvertes ramènerait la page à rallonge.
    expect(wizardSource).toMatch(/useState<SectionId \| null>\('format'\)/);
    expect(wizardSource).toMatch(
      /setOpenSection\(\(prev\) => \(prev === id \? null : id\)\)/,
    );
    for (const id of ['format', 'couleurs', 'texte', 'sequences']) {
      expect(wizardSource).toMatch(new RegExp(`open=\\{openSection === '${id}'\\}`));
    }
  });

  it('le contenu replié est masqué, pas démonté', () => {
    // Démonté, chaque section perdrait son état interne (couleur en cours
    // d'édition, zone de texte sélectionnée) à chaque repli.
    expect(wizardSource).toMatch(/<div id=\{`section-\$\{id\}`\} hidden=\{!open\}/);
  });
});

describe('Aucun réglage perdu', () => {
  it('les quatre sections couvrent tout ce qui existait', () => {
    const step = wizardSource.slice(
      wizardSource.indexOf('{step === S.style && ('),
      wizardSource.indexOf('{/* Étape 3 — audio'),
    );
    // Un contrôle par famille, pris dans le corps de l'étape : si la refonte
    // en avait laissé un dehors, il aurait disparu de l'écran.
    for (const marker of [
      'TONES.map',                       // ton
      "['9:16', '1:1', '16:9'] as const", // format
      'Revenir au kit de marque',        // couleurs
      'Opacité du fond',                 // opacité
      '<ColorWheel',                     // roue chromatique
      'FONT_GROUPS.map',                 // police
      'Interlettrage',                   // typo
      'Interligne',
      'aria-label={`Gras — ${zoneLabel}`}',
      'id="wm-text"',                    // filigrane
      'moveSequenceBy',                  // ordre des séquences
      'toggleSequence',                  // œil
      '<MediaLibrary',                   // import rush
      'Temps forts',                     // découpe
    ]) {
      expect(step).toContain(marker);
    }
  });

  it('les quatre sections sont bien celles annoncées', () => {
    expect(wizardSource).toMatch(/title="Ton et format"/);
    expect(wizardSource).toMatch(/title="Couleurs"/);
    expect(wizardSource).toMatch(/title="Texte"/);
    expect(wizardSource).toMatch(/title="Séquences"/);
  });

  it('chaque en-tête replié dit encore où en sont ses réglages', () => {
    // Replier ne doit pas revenir à cacher.
    expect(wizardSource).toMatch(/hint=\{`\$\{tone\.label\} · \$\{format\}`\}/);
    expect(wizardSource).toMatch(/hint=\{colors \? 'Personnalisées' : 'Kit de marque'\}/);
    expect(wizardSource).toMatch(/swatches=\{\[accent, gradStart, gradEnd\]\}/);
    expect(wizardSource).toMatch(/filigrane \$\{watermarkVisible \? 'affiché' : 'masqué'\}/);
  });

  it('n’a pas touché au rendu du compositeur', () => {
    // La consigne était une refonte de DISPOSITION.
    const composerSource = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');
    expect(composerSource).toMatch(/export async function composeAndUpload/);
    // Les valeurs envoyées au compositeur restent celles d'avant.
    expect(wizardSource).toMatch(/\.\.\.textDesign,/);
    expect(wizardSource).toMatch(/siteText: watermarkConfig/);
  });
});
