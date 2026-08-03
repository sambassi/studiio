import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Preview } from '@/app/dashboard/creer-simple/AssistantWizard';

/**
 * Onglets de l'aperçu — Mode simple.
 *
 * Deux changements : la séquence « Vidéo » a désormais son onglet, et « Tout »
 * ferme la marche. « Tout » reste la vue **par défaut** — sa place dans la
 * rangée ne change que la lecture, pas le comportement.
 */

const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);

const generated = {
  title: 'Routine matin',
  subtitle: 'Sous-titre',
  cards: [{ id: 'a', icon: 'Flame', title: 'Matin', description: '', value: '70%' }],
  cta: 'JE ME LANCE',
  ctaSub: 'LIEN EN BIO',
};
const TEXT = {
  title: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
  subtitle: { font: null, color: null, scale: 1 },
  cta: { font: 'Inter', color: '#FFFFFF', subColor: '#EC4899', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
};
const base = {
  generated,
  format: '9:16' as const,
  displayScale: 0.25,
  gradStart: '#7C3AED',
  gradEnd: '#EC4899',
  gradientOpacity: 0.5,
  accent: '#7C3AED',
  watermark: 'Studiio.pro',
  text: TEXT,
  // Les onglets ne paraissent qu'avec un gestionnaire : un apercu en lecture
  // seule n'a rien a piloter.
  onFocusChange: () => {},
};
const RUSH = 'https://exemple.test/rush.mp4';
const AVEC_VIDEO = ['intro', 'cards', 'video', 'cta'];
const SANS_VIDEO = ['intro', 'cards', 'cta'];

afterEach(cleanup);

const onglets = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).map((b) =>
    b.textContent?.trim(),
  );
const onglet = (nom: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
    (b) => b.textContent?.trim() === nom,
  )!;
const rush = () => document.querySelector('video');
const cartes = () => document.querySelectorAll('[data-card-id]');

describe('L ordre des onglets', () => {
  it('suit les séquences, « Tout » en dernier', () => {
    render(<Preview {...base} activeOrder={AVEC_VIDEO} rushUrl={RUSH} />);
    expect(onglets()).toEqual(['Titre', 'Cartes', 'Vidéo', 'CTA', 'Tout']);
  });

  it('« Tout » reste la vue par défaut malgré sa place', () => {
    // Seule la lecture change : l'état démarre toujours sur la composition
    // entière.
    expect(wizard).toContain("useState<PreviewFocus>('all')");
  });
});

describe('L onglet Vidéo', () => {
  it('est actif quand un rush est présent', () => {
    render(<Preview {...base} activeOrder={AVEC_VIDEO} rushUrl={RUSH} />);
    expect(onglet('Vidéo').disabled).toBe(false);
  });

  it('est désactivé sans rush — sans rien ajouter côté gating', () => {
    // `activeOrder` ne contient `'video'` que lorsqu'un rush existe.
    render(<Preview {...base} activeOrder={SANS_VIDEO} />);
    expect(onglet('Vidéo').disabled).toBe(true);
  });

  it('montre le rush, et lui seul', () => {
    render(<Preview {...base} activeOrder={AVEC_VIDEO} rushUrl={RUSH} focus="video" />);
    expect(rush()).not.toBeNull();
    // Titre, cartes et CTA disparaissent : `shows()` ne retient une séquence
    // que sur « Tout » ou sur son propre onglet.
    expect(cartes()).toHaveLength(0);
    expect(screen.queryByText('ROUTINE MATIN')).toBeNull();
    expect(screen.queryByText('JE ME LANCE')).toBeNull();
  });

  it('le rush reste visible sur « Tout »', () => {
    render(<Preview {...base} activeOrder={AVEC_VIDEO} rushUrl={RUSH} focus="all" />);
    expect(rush()).not.toBeNull();
    expect(cartes()).toHaveLength(1);
  });

  it('le rush ne paraît pas sur les autres onglets', () => {
    for (const focus of ['intro', 'cards', 'cta'] as const) {
      cleanup();
      render(<Preview {...base} activeOrder={AVEC_VIDEO} rushUrl={RUSH} focus={focus} />);
      expect(rush(), focus).toBeNull();
    }
  });

  it('sans rush, l onglet Vidéo ne montre rien', () => {
    render(<Preview {...base} activeOrder={SANS_VIDEO} focus="video" />);
    expect(rush()).toBeNull();
    expect(cartes()).toHaveLength(0);
  });
});

describe('Rétro-compatibilité', () => {
  it('un onglet devenu impossible ramène à « Tout »', () => {
    // Retirer le rush pendant qu'on est sur « Vidéo » laisserait un aperçu
    // vide sans ce garde-fou, déjà en place.
    expect(wizard).toContain(
      "if (previewFocus !== 'all' && !activeOrder.includes(previewFocus)) setPreviewFocus('all');",
    );
  });

  it('la capture de l aperçu force toujours la composition entière', () => {
    // Une photo prise depuis l'onglet « Vidéo » figerait des cartes vides.
    expect(wizard).toContain("flushSync(() => setPreviewFocus('all'));");
  });

  it('le type de focus est nommé une fois, pas répété', () => {
    expect(wizard).toContain("type PreviewFocus = 'all' | 'intro' | 'cards' | 'video' | 'cta';");
  });
});
