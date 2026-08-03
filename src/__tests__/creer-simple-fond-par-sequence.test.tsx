import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  Preview, seqBgKeyForFocus, resolveBackground, POSTER_TRANSFORM_NEUTRAL,
  type SeqBackgrounds,
} from '@/app/dashboard/creer-simple/AssistantWizard';
import { sanitizeDraft, DRAFT_VERSION, type SanitizeDeps } from '@/lib/creer/draft';

/**
 * Un fond par séquence — Mode simple.
 *
 * Chaque séquence peut avoir sa propre photo, recadrée à la souris comme
 * l'affiche globale. **Sans fond propre, tout se comporte comme avant** :
 * l'affiche globale s'applique partout, et le compositeur ne reçoit rien de
 * nouveau.
 */

const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);
const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');

const GLOBAL = 'https://exemple.test/global.jpg';
const TITRE = 'https://exemple.test/titre.jpg';
const T = POSTER_TRANSFORM_NEUTRAL;
const ZOOM = { scale: 2, offsetX: 0.1, offsetY: 0 };

describe('seqBgKeyForFocus — quelle séquence est visée', () => {
  it('traduit les onglets vers les clés du compositeur', () => {
    // L'aperçu dit « intro » et « cards », le compositeur « titre » et
    // « cartes » : la traduction vit à un seul endroit.
    expect(seqBgKeyForFocus('intro')).toBe('titre');
    expect(seqBgKeyForFocus('cards')).toBe('cartes');
    expect(seqBgKeyForFocus('video')).toBe('video');
    expect(seqBgKeyForFocus('cta')).toBe('cta');
  });

  it('« Tout » ne vise aucune séquence — on y édite l affiche globale', () => {
    // L'aperçu empile les séquences : il ne saurait pas laquelle montrer.
    expect(seqBgKeyForFocus('all')).toBeNull();
  });
});

describe('resolveBackground — le fond réellement montré', () => {
  const seqs: SeqBackgrounds = { titre: { url: TITRE, transform: ZOOM } };

  it('la séquence qui a son fond le montre, avec SON recadrage', () => {
    expect(resolveBackground('intro', seqs, GLOBAL, T)).toEqual({ url: TITRE, transform: ZOOM });
  });

  it('les autres héritent de l affiche globale', () => {
    expect(resolveBackground('cards', seqs, GLOBAL, T)).toEqual({ url: GLOBAL, transform: T });
    expect(resolveBackground('cta', seqs, GLOBAL, T)).toEqual({ url: GLOBAL, transform: T });
  });

  it('« Tout » montre l affiche globale', () => {
    expect(resolveBackground('all', seqs, GLOBAL, T)).toEqual({ url: GLOBAL, transform: T });
  });

  it('sans fond propre ni affiche : rien, donc le dégradé', () => {
    expect(resolveBackground('intro', {}, null, T)).toEqual({ url: null, transform: T });
  });

  it('une entrée sans URL ne masque pas l affiche globale', () => {
    const abime = { titre: { url: '', transform: T } } as unknown as SeqBackgrounds;
    expect(resolveBackground('intro', abime, GLOBAL, T).url).toBe(GLOBAL);
  });
});

describe('Glisser-déposer', () => {
  const generated = {
    title: 'T', subtitle: 'S',
    cards: [{ id: 'a', icon: 'Flame', title: 'M', description: '', value: '1' }],
    cta: 'C', ctaSub: 'CS',
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
  afterEach(cleanup);

  it('une photo déposée sur la SURFACE remonte son URL', () => {
    // Le dépôt passe par une surface dédiée, affichée pendant le glissement :
    // les enfants absolus du plateau interceptaient l'événement sans
    // autoriser le dépôt.
    const recus: string[] = [];
    render(<Preview {...props} photoDragging onPhotoDrop={(u) => recus.push(u)} />);
    const surface = document.querySelector('[data-photo-drop]') as HTMLElement;
    expect(surface).not.toBeNull();
    const evt = new Event('drop', { bubbles: true }) as Event & { dataTransfer: unknown };
    (evt as { dataTransfer: unknown }).dataTransfer = {
      getData: (type: string) => (type === 'application/x-studiio-photo' ? TITRE : ''),
    };
    surface.dispatchEvent(evt);
    expect(recus).toEqual([TITRE]);
  });

  it('les vignettes de la grille sont glissables', () => {
    expect(wizard).toContain('draggable');
    expect(wizard).toContain('e.dataTransfer.setData(PHOTO_DND_TYPE, photo.url);');
    expect(wizard).toContain("e.dataTransfer.setData('text/uri-list', photo.url);");
  });

  it('un dépôt sans URL ne fait rien', () => {
    const recus: string[] = [];
    render(<Preview {...props} photoDragging onPhotoDrop={(u) => recus.push(u)} />);
    const surface = document.querySelector('[data-photo-drop]') as HTMLElement;
    const evt = new Event('drop', { bubbles: true }) as Event & { dataTransfer: unknown };
    (evt as { dataTransfer: unknown }).dataTransfer = { getData: () => '' };
    surface.dispatchEvent(evt);
    expect(recus).toEqual([]);
  });

  it("la surface n'existe pas hors glissement — elle bloquerait l'édition", () => {
    render(<Preview {...props} onPhotoDrop={() => {}} />);
    expect(document.querySelector('[data-photo-drop]')).toBeNull();
  });
});

describe('Câblage', () => {
  it('les actions photo visent la séquence affichée', () => {
    expect(wizard).toContain('const cle = seqBgKeyForFocus(previewFocusRef.current);');
    expect(wizard).toContain('setSeqBackgrounds((prev) => ({ ...prev, [cle]: { url, transform: POSTER_TRANSFORM_NEUTRAL } }));');
  });

  it('une nouvelle photo repart d un cadrage neutre', () => {
    // Le précédent visait une autre image : le garder rognerait au hasard.
    expect(wizard).toContain('transform: POSTER_TRANSFORM_NEUTRAL }');
  });

  it('le recadrage écrit là où il doit — séquence ou global', () => {
    expect(wizard).toContain('const applyTransform = useCallback');
    expect(wizard).toContain('if (!cle || !seqBackgroundsRef.current[cle]) {');
  });

  it("l'aperçu montre le fond résolu, pas l'affiche globale en dur", () => {
    expect(wizard).toContain('posterUrl: fondAffiche.url,');
    expect(wizard).toContain('posterTransform: fondAffiche.transform,');
  });

  it('« Réinitialiser » rend la séquence à l affiche globale', () => {
    expect(wizard).toContain('const resetSeqBackground = useCallback');
    expect(wizard).toContain('delete next[cle];');
  });

  it("l'export n'envoie rien tant qu'aucune séquence n'a son fond", () => {
    // Default-safe : le compositeur reçoit `undefined` et se comporte comme
    // avant.
    expect(wizard).toContain('sequenceBackgrounds: Object.keys(seqBackgrounds).length');
    expect(wizard).toContain(': undefined,');
  });

  it('le compositeur recadre les fonds par séquence comme l affiche', () => {
    // Même fonction, donc même convention : aperçu et vidéo s'accordent.
    expect(composer).toContain('seqBgImages[k] = cropPosterToComposition(');
    expect(composer).toContain('sequenceBackgrounds[k]?.transform,');
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

describe('Persistance', () => {
  it('un brouillon sans fond par séquence se relit comme avant', () => {
    expect(lire({}).seqBackgrounds).toBeUndefined();
  });

  it('relit une entrée valide', () => {
    const v = { titre: { url: TITRE, transform: ZOOM } };
    expect(lire({ seqBackgrounds: v }).seqBackgrounds).toEqual(v);
  });

  it('une entrée abîmée n emporte pas les autres', () => {
    const d = lire({
      seqBackgrounds: {
        titre: { url: TITRE, transform: ZOOM },
        cartes: { url: 'pas-une-url', transform: ZOOM },
      },
    });
    expect(Object.keys(d.seqBackgrounds!)).toEqual(['titre']);
  });

  it('un recadrage abîmé n annule pas le fond, il repart du neutre', () => {
    const d = lire({ seqBackgrounds: { titre: { url: TITRE, transform: { scale: 99 } } } });
    expect(d.seqBackgrounds!.titre).toEqual({ url: TITRE, transform: { scale: 1, offsetX: 0, offsetY: 0 } });
  });

  it('refuse une forme qui n est pas un objet', () => {
    for (const v of ['nope', 42, null, []]) {
      expect(lire({ seqBackgrounds: v }).seqBackgrounds, JSON.stringify(v)).toBeUndefined();
    }
  });

  it('un nouveau montage repart sans fond par séquence', () => {
    const reset = wizard.slice(wizard.indexOf('const reset = ()'), wizard.indexOf('const reset = ()') + 1400);
    expect(reset).toContain('setSeqBackgrounds({})');
  });
});
