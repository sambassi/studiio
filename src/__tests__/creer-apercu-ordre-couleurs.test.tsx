/**
 * Créer — « Aperçu du style » : ordre des séquences et couleurs EN DIRECT.
 *
 * Deux causes constatées :
 *  - les onglets de l'aperçu suivaient un ordre codé en dur (Titre, Cartes,
 *    Vidéo, CTA) au lieu de l'ordre du montage ;
 *  - le montage rendu (« Voir le rendu », ou celui qui suit le jumeau)
 *    restait affiché sur « Tout » après un changement d'ordre ou de couleur :
 *    l'utilisateur regardait l'ANCIEN rendu. Il n'est plus montré que tant
 *    que l'empreinte de l'éditeur n'a pas changé.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Preview, ongletsApercu } from '@/app/dashboard/creer/AssistantWizard';
import { empreinteApercu } from '@/lib/creer/empreinteApercu';

afterEach(cleanup);

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
  onFocusChange: () => {},
  rushUrl: 'https://exemple.test/jumeau.mp4',
};
const onglets = () => Array.from(document.querySelectorAll('[role="tab"]')).map((b) => b.textContent?.trim());
type PropsPreview = Parameters<typeof Preview>[0];
const apercu = (sur: Partial<PropsPreview>) => <Preview {...(base as unknown as PropsPreview)} {...sur} />;

describe('ordre : les onglets suivent l’ordre du montage', () => {
  it.each([
    [['intro', 'cards', 'video', 'cta'], ['Titre', 'Cartes', 'Vidéo', 'CTA', 'Tout']],
    [['video', 'intro', 'cards', 'cta'], ['Vidéo', 'Titre', 'Cartes', 'CTA', 'Tout']],
    [['cta', 'video', 'cards', 'intro'], ['CTA', 'Vidéo', 'Cartes', 'Titre', 'Tout']],
  ])('9-11. ordre %j → onglets %j', (ordre, attendu) => {
    expect(ongletsApercu(ordre).map((t) => t.label)).toEqual(attendu);
  });

  it('séquence masquée : après les actives, désactivée ; réactivée : reprend sa place', () => {
    expect(ongletsApercu(['cards', 'intro', 'cta']).map((t) => t.label)).toEqual(['Cartes', 'Titre', 'CTA', 'Vidéo', 'Tout']);
  });

  it('dans l’aperçu monté : un nouvel ordre est affiché IMMÉDIATEMENT (rerender, sans rien d’autre)', () => {
    const { rerender } = render(apercu({ activeOrder: ['intro', 'cards', 'video', 'cta'] }));
    expect(onglets()).toEqual(['Titre', 'Cartes', 'Vidéo', 'CTA', 'Tout']);
    rerender(apercu({ activeOrder: ['video', 'cards', 'intro', 'cta'] }));
    expect(onglets()).toEqual(['Vidéo', 'Cartes', 'Titre', 'CTA', 'Tout']);
    rerender(apercu({ activeOrder: ['cards', 'intro', 'cta'] }));
    expect(onglets()).toEqual(['Cartes', 'Titre', 'CTA', 'Vidéo', 'Tout']);
    const video = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((b) => b.textContent?.trim() === 'Vidéo')!;
    expect(video.disabled).toBe(true);
  });
});

/** « #7C3AED » ou sa forme « rgb(124, 58, 237) » dans le HTML de l'aperçu. */
const contient = (hex: string) => {
  const h = hex.replace('#', '');
  const rgb = `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
  const html = document.body.innerHTML.toLowerCase();
  return html.includes(hex.toLowerCase()) || html.includes(rgb) || html.includes(rgb.replace(/ /g, ''));
};

describe('couleurs : l’aperçu en direct suit chaque changement', () => {
  const ordre = ['intro', 'cards', 'video', 'cta'];

  it('12-14. accent, dégradé début, dégradé fin : visibles dès le rendu suivant', () => {
    const { rerender } = render(apercu({ activeOrder: ordre }));
    expect(contient('#7C3AED')).toBe(true);
    rerender(apercu({ activeOrder: ordre, gradStart: '#12AB34' }));
    expect(contient('#12AB34')).toBe(true);
    rerender(apercu({ activeOrder: ordre, gradStart: '#12AB34', gradEnd: '#FEDC01' }));
    expect(contient('#FEDC01')).toBe(true);
    rerender(apercu({ activeOrder: ordre, gradStart: '#12AB34', gradEnd: '#FEDC01', accent: '#0099FF' }));
    expect(contient('#0099FF')).toBe(true);
  });

  it('15-16. onglet Vidéo (jumeau) : le plateau suit les nouvelles couleurs, la vidéo elle-même n’est pas filtrée', () => {
    const { rerender } = render(apercu({ activeOrder: ordre, focus: 'video' }));
    rerender(apercu({ activeOrder: ordre, focus: 'video', gradStart: '#12AB34', gradEnd: '#FEDC01' }));
    expect(contient('#12AB34')).toBe(true);
    expect(contient('#FEDC01')).toBe(true);
    const video = document.querySelector('video')!;
    expect(video).toBeTruthy();
    expect(video.style.filter || '').not.toMatch(/hue|sepia|saturate/);
    expect(video.style.mixBlendMode || '').toBe('');
  });
});

describe('le rendu en cache n’est montré que s’il correspond aux réglages actuels', () => {
  const couleurs = { accent: '#7C3AED', gradStart: '#7C3AED', gradEnd: '#EC4899', gradientOpacity: 0.5 };
  const brouillon = { sequences: [{ key: 'intro', enabled: true }, { key: 'video', enabled: true }], title: 'T', step: 3, scheduledDate: '2026-10-08' };

  it('changer l’ORDRE des séquences change l’empreinte', () => {
    const autre = { ...brouillon, sequences: [{ key: 'video', enabled: true }, { key: 'intro', enabled: true }] };
    expect(empreinteApercu(autre, couleurs)).not.toBe(empreinteApercu(brouillon, couleurs));
  });

  it('changer une COULEUR (accent, dégradé) change l’empreinte, kit de marque compris', () => {
    for (const k of ['accent', 'gradStart', 'gradEnd'] as const) {
      expect(empreinteApercu(brouillon, { ...couleurs, [k]: '#000000' })).not.toBe(empreinteApercu(brouillon, couleurs));
    }
    expect(empreinteApercu(brouillon, { ...couleurs, gradientOpacity: 0.8 })).not.toBe(empreinteApercu(brouillon, couleurs));
  });

  it('changer d’étape ou de date ne périme PAS le rendu (rien de visible n’a changé)', () => {
    expect(empreinteApercu({ ...brouillon, step: 4, scheduledDate: '2026-10-09', jumeauGenerationId: 'g' }, couleurs))
      .toBe(empreinteApercu(brouillon, couleurs));
  });
});
