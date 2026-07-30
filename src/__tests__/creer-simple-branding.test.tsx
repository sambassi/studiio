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
    expect(call).toMatch(/siteText: \{/);
    expect(call).toMatch(/text: watermarkLabel \|\| DEFAULT_WATERMARK/);
    // `enabled: false` est la SEULE façon d'éteindre le calque.
    expect(call).toMatch(/enabled: !!watermarkLabel/);
  });

  it('le défaut est « Studiio.pro », et le kit de marque l’emporte', () => {
    expect(wizardSource).toMatch(/const DEFAULT_WATERMARK = 'Studiio\.pro'/);
    expect(wizardSource).toMatch(
      /watermarkOverride \?\? \(branding\.watermarkText \|\| DEFAULT_WATERMARK\)/,
    );
  });

  it('persiste le filigrane pour le Calendrier', () => {
    // Le Calendrier relit `design.siteText` pour sa reconstruction HTML ET
    // pour toute régénération. Sans lui, les deux retombent sur
    // « Afroboost.com » : le post afficherait un filigrane que l'utilisateur
    // n'a jamais choisi, différent de sa vidéo.
    const metadata = wizardSource.slice(
      wizardSource.indexOf('const metadata = {'),
      wizardSource.indexOf("const res = await fetch('/api/posts'"),
    );
    expect(metadata).toMatch(/siteText: \{/);
    expect(metadata).toMatch(/enabled: !!watermarkLabel/);
  });

  it('l’aperçu affiche le filigrane', () => {
    renderPreview();
    expect(screen.getByText('Studiio.pro')).toBeDefined();
  });

  it('l’aperçu le place là où le compositeur le peint', () => {
    // Compositeur : centré, à 95 % de la hauteur, graisse 700.
    renderPreview();
    const style = (screen.getByText('Studiio.pro') as HTMLElement).style;
    expect(style.top).toBe('95%');
    expect(style.textAlign).toBe('center');
    expect(style.fontWeight).toBe('700');
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

  it('la surcharge part de `null` — le kit de marque charge après le montage', () => {
    // Quatre états seedés au montage captureraient les défauts neutres puis
    // ignoreraient le kit chargé une milliseconde plus tard, par un effet.
    expect(wizardSource).toMatch(/const \[colors, setColors\] = useState<\{/);
    expect(wizardSource).toMatch(/const accent = colors\?\.accent \?\? brandAccent/);
    expect(wizardSource).toMatch(/const gradStart = colors\?\.gradStart \?\? brandGradStart/);
    expect(wizardSource).toMatch(/const gradEnd = colors\?\.gradEnd \?\? brandGradEnd/);
    expect(wizardSource).toMatch(
      /const gradientOpacity = colors\?\.gradientOpacity \?\? brandGradientOpacity/,
    );
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
    expect(wizardSource).toMatch(/setColors\(null\); setEditedColor\(null\);/);
  });
});
