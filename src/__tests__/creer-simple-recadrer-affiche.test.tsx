import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  Preview, clampPosterTransform, POSTER_TRANSFORM_NEUTRAL, POSTER_ZOOM_MIN, POSTER_ZOOM_MAX,
} from '@/app/dashboard/creer/AssistantWizard';
import { posterTransformActive, cropPosterToComposition } from '@/lib/video-composer';
import { sanitizeDraft, DRAFT_VERSION, type SanitizeDeps } from '@/lib/creer/draft';

/**
 * Recadrage de la photo d'affiche — Mode simple.
 *
 * L'exigence : ce qu'on cadre à l'écran est ce qui sort dans l'affiche ET dans
 * la vidéo. L'aperçu applique le recadrage par un `transform` CSS ; le
 * compositeur pré-recadre l'image une fois, à la taille de la composition.
 * Les deux suivent la **même convention** — zoom, puis décalages en fraction
 * du plateau — sans quoi l'écran mentirait sur le montage.
 */

const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'),
  'utf-8',
);

const generated = {
  title: 'Routine matin', subtitle: 'S',
  cards: [{ id: 'a', icon: 'Flame', title: 'Matin', description: '', value: '70%' }],
  cta: 'JE ME LANCE', ctaSub: 'LIEN EN BIO',
};
const TEXT = {
  title: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
  subtitle: { font: null, color: null, scale: 1 },
  cta: { font: 'Inter', color: '#FFFFFF', subColor: '#EC4899', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
};
const props = {
  generated, format: '9:16' as const, displayScale: 0.25,
  activeOrder: ['intro', 'cards', 'cta'],
  gradStart: '#7C3AED', gradEnd: '#EC4899', gradientOpacity: 0.5,
  accent: '#7C3AED', watermark: 'Studiio.pro', text: TEXT,
};
const PHOTO = 'https://images.pexels.com/photos/1/yoga.jpg';

afterEach(cleanup);
const photo = () => document.querySelector<HTMLImageElement>('[data-poster-layer]')!;

describe('clampPosterTransform', () => {
  it('borne le zoom', () => {
    expect(clampPosterTransform({ scale: 0.2 }).scale).toBe(POSTER_ZOOM_MIN);
    expect(clampPosterTransform({ scale: 99 }).scale).toBe(POSTER_ZOOM_MAX);
    expect(clampPosterTransform({ scale: 1.8 }).scale).toBe(1.8);
  });

  it("interdit de descendre sous 1 : le « cover » laisserait une bande vide", () => {
    expect(POSTER_ZOOM_MIN).toBe(1);
    expect(clampPosterTransform({ scale: 0 }).scale).toBe(1);
  });

  it('borne le décalage à ce que le zoom laisse dépasser', () => {
    // Sans zoom, aucun décalage possible : l'image couvre exactement le cadre.
    expect(clampPosterTransform({ scale: 1, offsetX: 0.5 })).toEqual(POSTER_TRANSFORM_NEUTRAL);
    // À 2×, la moitié du surplus de chaque côté, soit 0,5.
    expect(clampPosterTransform({ scale: 2, offsetX: 9, offsetY: -9 }))
      .toEqual({ scale: 2, offsetX: 0.5, offsetY: -0.5 });
  });

  it('une valeur absurde retombe sur le cadrage neutre', () => {
    expect(clampPosterTransform({ scale: Number.NaN, offsetX: Number.NaN, offsetY: Number.NaN }))
      .toEqual(POSTER_TRANSFORM_NEUTRAL);
    expect(clampPosterTransform(undefined)).toEqual(POSTER_TRANSFORM_NEUTRAL);
  });
});

describe('L aperçu applique le recadrage', () => {
  it('sans recadrage, aucun décalage ni zoom', () => {
    render(<Preview {...props} posterUrl={PHOTO} />);
    expect(photo().style.transform).toBe('translate(0%, 0%) scale(1)');
  });

  it('zoom et décalages suivent la convention du compositeur', () => {
    // `translate` en % de la largeur du calque — donc du plateau — puis
    // `scale` : exactement le `cx = w/2 + offX*w` du compositeur.
    render(<Preview {...props} posterUrl={PHOTO} posterTransform={{ scale: 2, offsetX: 0.25, offsetY: -0.1 }} />);
    expect(photo().style.transform).toBe('translate(25%, -10%) scale(2)');
  });

  it("la photo reste inerte : c'est une surface dédiée qui capte le glissement", () => {
    // La photo est SOUS le titre et les cartes — un clic au centre du plateau
    // les atteindrait avant elle, et le déplacement ne partirait jamais.
    render(<Preview {...props} posterUrl={PHOTO} cropping onPosterPanStart={() => {}} />);
    expect(photo().style.pointerEvents).toBe('none');
    const surface = document.querySelector<HTMLElement>('[data-poster-pan]')!;
    expect(surface).not.toBeNull();
    expect(surface.style.cursor).toBe('grab');
  });

  it("la surface de saisie n'existe qu'en mode recadrage, et jamais à la capture", () => {
    render(<Preview {...props} posterUrl={PHOTO} onPosterPanStart={() => {}} />);
    expect(document.querySelector('[data-poster-pan]')).toBeNull();
    cleanup();
    render(<Preview {...props} posterUrl={PHOTO} cropping capturing onPosterPanStart={() => {}} />);
    expect(document.querySelector('[data-poster-pan]')).toBeNull();
  });

  it('elle passe sous les poignées, pour ne pas leur voler la prise', () => {
    render(
      <Preview {...props} posterUrl={PHOTO} cropping onPosterPanStart={() => {}} onPosterZoomStart={() => {}} />,
    );
    const surface = document.querySelector<HTMLElement>('[data-poster-pan]')!;
    const poignee = document.querySelector<HTMLElement>('[data-poster-handle]')!;
    expect(Number(poignee.style.zIndex)).toBeGreaterThan(Number(surface.style.zIndex));
  });
});

describe('Les poignées de recadrage', () => {
  const handles = () => document.querySelectorAll('[data-poster-handle]');

  it('quatre coins, seulement en mode recadrage', () => {
    render(<Preview {...props} posterUrl={PHOTO} onPosterZoomStart={() => {}} />);
    expect(handles()).toHaveLength(0);
    cleanup();
    render(<Preview {...props} posterUrl={PHOTO} cropping onPosterZoomStart={() => {}} />);
    expect(handles()).toHaveLength(4);
  });

  it('aucune pendant la capture — elles ne peuvent pas finir dans l affiche', () => {
    render(<Preview {...props} posterUrl={PHOTO} cropping capturing onPosterZoomStart={() => {}} />);
    expect(handles()).toHaveLength(0);
  });

  it('la poignée zoome, elle ne déplace pas', () => {
    const vus: string[] = [];
    render(
      <Preview
        {...props} posterUrl={PHOTO} cropping
        onPosterZoomStart={() => vus.push('zoom')}
        onPosterPanStart={() => vus.push('pan')}
      />,
    );
    handles()[0].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(vus).toEqual(['zoom']);
  });
});

describe('Le compositeur applique le MÊME recadrage', () => {
  it('un recadrage neutre ne fabrique aucun canvas — rien ne change', () => {
    expect(posterTransformActive(undefined)).toBe(false);
    expect(posterTransformActive({ scale: 1, offsetX: 0, offsetY: 0 })).toBe(false);
    const img = { width: 100, height: 100 } as HTMLImageElement;
    expect(cropPosterToComposition(img, 200, 300, undefined)).toBe(img);
    expect(cropPosterToComposition(img, 200, 300, { scale: 1, offsetX: 0, offsetY: 0 })).toBe(img);
  });

  it('un recadrage actif est détecté', () => {
    expect(posterTransformActive({ scale: 1.5, offsetX: 0, offsetY: 0 })).toBe(true);
    expect(posterTransformActive({ scale: 1, offsetX: 0.2, offsetY: 0 })).toBe(true);
    expect(posterTransformActive({ scale: 1, offsetX: 0, offsetY: -0.2 })).toBe(true);
  });

  it('sans image, rien à recadrer', () => {
    expect(cropPosterToComposition(null, 200, 300, { scale: 2, offsetX: 0, offsetY: 0 })).toBeNull();
  });

  it('le recadrage est appliqué UNE fois, pour toutes les séquences', () => {
    const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');
    // Pré-recadrer à la taille de la composition fait retomber les dessins
    // « cover » sur un blit 1:1 — le recadrage vaut donc partout sans toucher
    // au code de chaque séquence.
    expect(composer).toContain('const posterCropped = cropPosterToComposition(');
    expect(composer).toContain('return { img: usePoster ? posterCropped : null, opacity: 1,');
  });
});

const DEPS: SanitizeDeps = {
  themeIds: ['sommeil'], toneIds: ['punchy'], formats: ['9:16', '1:1', '16:9'], maxStep: 3,
  defaults: {
    themeId: 'sommeil', toneId: 'punchy', format: '9:16',
    titleStyle: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
    subtitleStyle: { font: null, color: null, scale: 1 },
    ctaStyle: { font: 'Inter', color: '#FFFFFF', subColor: '', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
    sequences: [
      { key: 'intro', enabled: true }, { key: 'cards', enabled: true },
      { key: 'video', enabled: false }, { key: 'cta', enabled: true },
    ],
    durations: { intro: 4, cards: 6, video: 0, cta: 4 },
  },
};
const lire = (extra: Record<string, unknown>) =>
  sanitizeDraft({ version: DRAFT_VERSION, savedAt: 1, ...extra }, DEPS)!;

describe('Persistance du recadrage', () => {
  it('un brouillon sans recadrage se relit comme avant', () => {
    expect(lire({}).posterTransform).toBeUndefined();
  });

  it('relit un recadrage valide', () => {
    const t = { scale: 1.6, offsetX: 0.1, offsetY: -0.2 };
    expect(lire({ posterTransform: t }).posterTransform).toEqual(t);
  });

  it('écarte un recadrage hors bornes ou incomplet', () => {
    for (const t of [
      { scale: 9, offsetX: 0, offsetY: 0 },
      { scale: 0.5, offsetX: 0, offsetY: 0 },
      { scale: 1.5, offsetX: 5, offsetY: 0 },
      { scale: 1.5, offsetX: 0 },
      'nope', null, 42,
    ]) {
      expect(lire({ posterTransform: t }).posterTransform, JSON.stringify(t)).toBeUndefined();
    }
  });

  it("n'écrit rien quand le cadrage est neutre", () => {
    expect(wizard).toContain(
      'posterTransform: posterTransformActive(posterTransform) ? posterTransform : undefined,',
    );
  });

  it('changer de photo remet le cadrage à plat', () => {
    // Un recadrage vaut pour UNE photo : le garder rognerait la suivante sur
    // des repères qui n'ont plus de sens.
    expect(wizard).toContain('if (posterUrlPrecedent.current !== null && posterUrlPrecedent.current !== posterUrl)');
    expect(wizard).toContain('setPosterTransform(POSTER_TRANSFORM_NEUTRAL);');
  });

  it('le recadrage part au compositeur', () => {
    expect(wizard).toContain('posterTransform,');
  });
});
