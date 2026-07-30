import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, screen, cleanup } from '@testing-library/react';
import { Preview } from '../app/dashboard/creer-simple/AssistantWizard';

/**
 * Chantier 3, points 3 et 4 — filigrane par défaut et réglage des couleurs
 * dans « Créer (simple) ».
 *
 * Le filigrane est vérifié sur le DOM produit par `Preview` ; le câblage vers
 * le compositeur et les métadonnées est vérifié sur le source (il faut un
 * navigateur pour l'exécuter).
 */

const wizardSource = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);

const composerSource = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');

const GENERATED = {
  title: 'Titre',
  subtitle: 'Sous-titre',
  cards: [{ icon: 'Droplet', title: 'Carte', description: 'Description', value: '80%' }],
  cta: 'JE ME LANCE',
  ctaSub: 'LIEN EN BIO',
};


/** Réglages typographiques par défaut — identiques à ceux du wizard. */
const TEXT = {
  title: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
  cta: { font: 'Inter', color: '#FFFFFF', subColor: '#EC4899', scale: 1, letterSpacing: 0, lineHeight: 1.2 },
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
      watermark="Studiio.pro"
      accent="#7C3AED"
      text={TEXT}
      {...props}
    />,
  );
}

afterEach(cleanup);

describe('Filigrane — pourquoi ce réglage existe', () => {
  it('le compositeur écrit « Afroboost.com » quand on ne lui dit rien', () => {
    // C'est le comportement qui rendait le réglage nécessaire : le calque est
    // ALLUMÉ par défaut (`enabled !== false`) et son texte de repli n'est pas
    // neutre. Ce parcours ne transmettait rien : chaque montage sortait marqué
    // « Afroboost.com », sur les quatre séquences, sans que rien dans
    // l'interface ne l'annonce.
    expect(composerSource).toMatch(/siteText\?\.text \|\| 'Afroboost\.com'/);
    expect(composerSource).toMatch(/siteText\?\.enabled !== false/);
  });

  it('l’assistant transmet donc `siteText` explicitement au compositeur', () => {
    const call = wizardSource.slice(
      wizardSource.indexOf('const composed = await composeAndUpload({'),
      wizardSource.indexOf('onProgress: (pct, stage)'),
    );
    expect(call).toMatch(/siteText: watermarkConfig/);
    expect(wizardSource).toMatch(/text: watermarkLabel \|\| DEFAULT_WATERMARK/);
    // `enabled: false` est la SEULE façon d'éteindre le calque, et il doit
    // être un vrai booléen : `siteText?.enabled !== false` laisse passer
    // toute autre valeur falsy.
    expect(wizardSource).toMatch(/enabled: watermarkVisible/);
    expect(wizardSource).toMatch(/const watermarkVisible = !!watermarkLabel/);
  });

  it('le défaut est « Studiio.pro », et le kit de marque l’emporte', () => {
    expect(wizardSource).toMatch(/const DEFAULT_WATERMARK = 'Studiio\.pro'/);
    expect(wizardSource).toMatch(
      /watermarkOverride \?\? \(branding\.watermarkText \|\| DEFAULT_WATERMARK\)/,
    );
  });

  it('persiste le filigrane pour le Calendrier, avec son champ `sequences`', () => {
    // Le Calendrier relit `design.siteText` pour toute régénération du
    // montage, et pour sa reconstruction HTML. Cette dernière fait
    // `(siteText.sequences || []).includes(seq)` : un objet sans ce champ
    // n'affiche JAMAIS le filigrane, alors que le compositeur applique sa
    // propre liste par défaut. Les deux rendus divergeraient en silence.
    const metadata = wizardSource.slice(
      wizardSource.indexOf('const metadata = {'),
      wizardSource.indexOf("const res = await fetch('/api/posts'"),
    );
    expect(metadata).toMatch(/siteText: watermarkConfig/);
    expect(wizardSource).toMatch(/sequences: \[\.\.\.WATERMARK_SEQUENCES\]/);
    expect(wizardSource).toMatch(
      /const WATERMARK_SEQUENCES = \['titre', 'cartes', 'video', 'cta'\]/,
    );
    // Le garde du Calendrier qui rend ce champ obligatoire.
    const calendarSource = readFileSync(
      resolve(__dirname, '../app/dashboard/calendar/page.tsx'),
      'utf-8',
    );
    expect(calendarSource).toMatch(/siteTextConfig\.sequences \|\| \[\]/);
  });

  it('n’écrit qu’UNE définition du filigrane, partagée', () => {
    // En deux copies littérales, l'une aurait fini par dériver de l'autre —
    // et c'est le Calendrier, qui relit la seconde, qui aurait affiché autre
    // chose que la vidéo.
    expect(wizardSource.match(/siteText: watermarkConfig/g)).toHaveLength(2);
    expect(wizardSource.match(/const watermarkConfig = \{/g)).toHaveLength(1);
  });

  it('l’aperçu affiche le filigrane', () => {
    renderPreview();
    expect(screen.getByText('Studiio.pro')).toBeDefined();
  });

  it('l’aperçu reprend les métriques du compositeur', () => {
    // Compositeur : centré, graisse 700, `width * 0.0375 * size`, opacité
    // 0.85, base à 95 % de la hauteur en 9:16.
    renderPreview();
    const style = (screen.getByText('Studiio.pro') as HTMLElement).style;
    expect(style.top).toBe('95%');
    expect(style.textAlign).toBe('center');
    expect(style.fontWeight).toBe('700');
    expect(style.opacity).toBe('0.85');
    expect(style.fontSize).toBe(`${1080 * 0.0375}px`);
    // `y` désigne la LIGNE DE BASE côté canvas : le bloc CSS remonte d'une
    // ascendante. Un `translateY(-50%)` le centrerait, donc descendrait le
    // texte d'un tiers de cadratin sous sa place réelle.
    expect(style.transform).toBe('translateY(-0.8em)');
    expect(style.lineHeight).toBe('1');
  });

  it('garde la même taille de filigrane en 16:9 — sans chevaucher le CTA', () => {
    // Le compositeur indexe la taille sur la LARGEUR mais la position sur la
    // HAUTEUR : en 16:9, `1920 * 0.0375` donnait 72 px sur un cadre de 1080,
    // un filigrane plus gros que le sous-CTA, qui venait le chevaucher.
    renderPreview({ format: '16:9' });
    const style = (screen.getByText('Studiio.pro') as HTMLElement).style;
    expect(style.fontSize).toBe(`${1080 * 0.0375}px`); // 40,5 px, comme en 9:16
    expect(style.top).toBe('96%');
  });

  it('reprend la couleur d’accent dans le halo du filigrane', () => {
    // Le compositeur peint ce halo (`shadowColor = accentColor`). Sans lui
    // ici, régler l'accent ne se voyait nulle part dans l'aperçu.
    renderPreview({ accent: '#00FF00' });
    const shadow = (screen.getByText('Studiio.pro') as HTMLElement).style.textShadow;
    expect(shadow).toMatch(/#00FF00|rgb\(0,\s*255,\s*0\)/i);
  });

  it('n’affiche rien quand le filigrane est masqué ou vide', () => {
    renderPreview({ watermark: '' });
    expect(screen.queryByText('Studiio.pro')).toBeNull();
  });

  it('affiche un filigrane personnalisé tel quel', () => {
    renderPreview({ watermark: 'ma-marque.fr' });
    expect(screen.getByText('ma-marque.fr')).toBeDefined();
  });
});

describe('Couleurs — réglables, et effectivement propagées', () => {
  it('l’aperçu peint le fond avec les couleurs reçues', () => {
    const { container } = renderPreview({ gradStart: '#112233', gradEnd: '#445566' });
    // Le plateau est le seul élément à porter le `transform: scale()`.
    const plateau = container.querySelector('[style*="scale"]') as HTMLElement | null;
    expect(plateau).not.toBeNull();
    // jsdom normalise les couleurs du style en ligne : on accepte les deux
    // écritures plutôt que de dépendre de sa version.
    const bg = plateau!.style.background;
    expect(bg).toMatch(/#112233|rgb\(17,\s*34,\s*51\)/);
    expect(bg).toMatch(/#445566|rgb\(68,\s*85,\s*102\)/);
  });

  it('ne lit plus le kit de marque ailleurs que dans le repli', () => {
    // Le vrai risque n'est pas la forme de la surcharge (une regex qui récite
    // les lignes qu'on vient d'écrire ne prouve rien) : c'est qu'un endroit
    // continue de peindre avec `branding.*` au lieu de la couleur réglée.
    const body = wizardSource.slice(wizardSource.indexOf('export default function AssistantWizard'));
    const brandingReads = body.match(/branding\.\w+/g) || [];
    const allowed = new Set([
      'branding.accentColor',
      'branding.gradientColor1',
      'branding.gradientColor2',
      'branding.gradientOpacity',
      'branding.watermarkText',
    ]);
    for (const read of brandingReads) expect(allowed.has(read)).toBe(true);
    // …et chacune de ces lectures ne sert qu'à alimenter une variable `brand*`
    // ou le repli du filigrane, jamais un rendu directement.
    expect(wizardSource).not.toMatch(/(accentColor|gradientColor1|gradientColor2):\s*branding\./);
  });

  it('les couleurs réglées alimentent le compositeur', () => {
    const call = wizardSource.slice(
      wizardSource.indexOf('const composed = await composeAndUpload({'),
      wizardSource.indexOf('onProgress: (pct, stage)'),
    );
    expect(call).toMatch(/accentColor: accent/);
    expect(call).toMatch(/gradientColor1: gradStart/);
    expect(call).toMatch(/gradientColor2: gradEnd/);
    expect(call).toMatch(/gradientOpacity,/);
  });

  it('…et les métadonnées relues par le Calendrier', () => {
    const metadata = wizardSource.slice(
      wizardSource.indexOf('const metadata = {'),
      wizardSource.indexOf("const res = await fetch('/api/posts'"),
    );
    expect(metadata).toMatch(/accentColor: accent/);
    expect(metadata).toMatch(/gradientColor1: gradStart/);
    expect(metadata).toMatch(/gradientColor2: gradEnd/);
    expect(metadata).toMatch(/gradientOpacity,/);
  });

  it('offre un retour au kit de marque', () => {
    // Sans ce retour, une couleur réglée par curiosité resterait pour toute
    // la session, sans moyen de retrouver la charte enregistrée.
    // Motif volontairement insensible au formatage : la version précédente
    // exigeait les deux appels sur une même ligne et cassait au premier
    // passage de Prettier, sans qu'aucun comportement n'ait changé.
    expect(wizardSource).toMatch(/setColors\(null\)/);
    expect(wizardSource).toMatch(/Revenir au kit de marque/);
  });
});
