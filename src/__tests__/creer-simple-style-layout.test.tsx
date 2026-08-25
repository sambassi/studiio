import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { Preview } from '../app/dashboard/creer/AssistantWizard';

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
  resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'),
  'utf-8',
);

const GENERATED = {
  title: 'Mon titre',
  subtitle: 'Mon sous-titre',
  cards: [{ id: 'c1', icon: 'Droplet', title: 'Ma carte', description: 'Description', value: '80%' }],
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
  it('la colonne d’aperçu est collée, sous la navbar et pas dessous', () => {
    const col = /<div className="([^"]*lg:sticky[^"]*)">/.exec(wizardSource);
    expect(col).not.toBeNull();
    const classes = col![1].split(/\s+/);
    expect(classes).toContain('lg:sticky');
    expect(classes).toContain('lg:col-span-2');
    // La navbar est `fixed h-16` (64 px) : `top-4` glissait 48 px de la carte
    // — en-tête et onglets compris — sous cette barre.
    const navbar = readFileSync(resolve(__dirname, '../components/layout/Navbar.tsx'), 'utf-8');
    expect(navbar).toMatch(/fixed[^"]*h-16/);
    const top = classes.find((c) => c.startsWith('lg:top-'));
    expect(top).toBeDefined();
    expect(Number(top!.replace('lg:top-', ''))).toBeGreaterThanOrEqual(16);
    // `items-start` rend le `sticky` opérant — il préexistait, on vérifie
    // seulement qu'il n'a pas été perdu en chemin.
    expect(wizardSource).toMatch(/lg:grid-cols-5[^"]*items-start/);
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
    // Bornes gardées : sans cela, un `indexOf` à -1 élargissait la tranche
    // jusqu'à l'étape Envoi et le test restait vert en ne testant plus rien.
    const from = wizardSource.indexOf('{step === S.style && (');
    const to = wizardSource.indexOf('{/* Étape 3 — audio');
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const step = wizardSource.slice(from, to);
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
      'aria-label={`Italique — ${zoneLabel}`}',
      'aria-label={`Taille du texte — ${zoneLabel}`}',
      'aria-label={`Couleur — ${zoneLabel}`}',
      'Couleur du sous-texte du CTA',    // sous-couleur CTA
      'Réinitialiser',                   // remise à zéro de la typo
      'id="wm-text"',                    // filigrane
      'moveSequenceBy',                  // ordre des séquences
      'onDrop',                          // glisser-déposer des séquences
      'toggleSequence',                  // œil
      '<MediaLibrary',                   // import rush
      'Temps forts',                     // découpe
      'onClick={clearRush}',             // retrait du rush
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

describe('Les trois pièges trouvés à l’audit', () => {
  it('le contenu est généré DÈS l’étape Style, pas deux étapes plus loin', () => {
    // Sans contenu, l'aperçu n'est qu'un placeholder : ni onglets, ni effet
    // visible des couleurs et de la typo — c'est-à-dire exactement ce que la
    // refonte devait apporter. Le contenu n'est plus généré à l'entrée de
    // « Contenu » mais à l'entrée de « Style ».
    expect(wizardSource).toMatch(/const goToStyle = \(\) => \{\s*setStep\(S\.style\);\s*ensureGenerated\(\);/);
    expect(wizardSource).toMatch(/onClick=\{goToStyle\}/);
    // …et il n'est PAS régénéré en avançant : le texte sur lequel on vient de
    // régler son style doit rester le même.
    expect(wizardSource).toMatch(
      /if \(generated && genSigRef\.current === `\$\{topicText\}\|\$\{tone\.id\}`\) return;/,
    );
    // Changer de sujet ou de ton le régénère quand même.
    expect(wizardSource).toMatch(/genSigRef\.current = `\$\{topicText\}\|\$\{tone\.id\}`;/);
  });

  it('un onglet ne reste pas braqué sur une séquence masquée', () => {
    // `disabled` empêche de CHOISIR un onglet mort, pas d'y RESTER : masquer
    // la séquence après coup laissait un plateau vide, sans explication.
    expect(wizardSource).toMatch(
      /if \(previewFocus !== 'all' && !activeOrder\.includes\(previewFocus\)\) setPreviewFocus\('all'\);/,
    );
    // Et choisir une zone de texte ne braque l'aperçu que sur une séquence
    // réellement active.
    expect(wizardSource).toMatch(/if \(activeOrder\.includes\(target\)\) setPreviewFocus\(target\);/);
  });

  it('l’attente de peinture ne peut pas bloquer l’envoi', () => {
    // `requestAnimationFrame` est GELÉ dans un onglet en arrière-plan :
    // lancer l'envoi puis changer d'onglet laissait la promesse pendante et
    // le bouton désactivé. Le fichier applique la même discipline 30 lignes
    // plus bas sur le décodage de la data URL.
    const capture = wizardSource.slice(
      wizardSource.indexOf('const focusBeforeCapture = previewFocus;'),
      wizardSource.indexOf('// 3. Composition + upload'),
    );
    expect(capture).toMatch(/setTimeout\(r, 300\)/);
    expect(capture).toMatch(/clearTimeout\(timer\)/);
  });

  it('« créer un autre contenu » repart d’une vue à plat', () => {
    const reset = wizardSource.slice(
      wizardSource.indexOf('const reset = () => {'),
      wizardSource.indexOf('// ── Rendu ──'),
    );
    expect(reset).not.toHaveLength(0);
    expect(reset).toMatch(/setPreviewFocus\('all'\)/);
    expect(reset).toMatch(/setOpenSection\('format'\)/);
    expect(reset).toMatch(/genSigRef\.current = '';/);
  });
});

