import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  sanitizePhotos, urlUtilisable, taillesVignette, vignetteAffichable, photoUtilisable,
  type PosterPhotoValide,
} from '@/lib/creer/posterPhotos';

/**
 * Vignettes cassées et glisser-déposer — Mode simple.
 *
 * **Les deux bugs signalés n'en faisaient qu'un.**
 *
 * `/api/pexels` construit ses entrées par enchaînement optionnel, sans repli
 * final (`url: p.src?.large2x || p.src?.large`). Une photo dont le
 * fournisseur ne renvoie pas ces tailles arrive donc avec `url: undefined`,
 * et l'écran rangeait la réponse **telle quelle**. D'où :
 *
 * 1. une vignette cassée — `src={undefined}` ne charge rien ;
 * 2. un glisser qui « ne marche pas » sur ces photos-là : le dépôt posait la
 *    chaîne « undefined » comme affiche, l'aperçu ne changeait pas, et on en
 *    concluait que le geste avait échoué.
 *
 * Il n'y a par ailleurs **qu'une seule grille** — l'hypothèse « une grille a
 * le drag, l'autre non » ne tient pas : `posterPhotos.map` n'apparaît qu'une
 * fois.
 */

const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'),
  'utf-8',
);
const routePexels = readFileSync(resolve(__dirname, '../app/api/pexels/route.ts'), 'utf-8');

const photo = (p: Partial<PosterPhotoValide> = {}): PosterPhotoValide => ({
  id: 1, url: 'https://cdn.test/pleine.jpg', ...p,
});

describe('La cause : l API peut rendre une URL absente', () => {
  it('les deux fournisseurs enchaînent sans repli final', () => {
    // C'est la ligne exacte qui produit `undefined`.
    expect(routePexels).toContain('url: p.src?.large2x || p.src?.large');
    expect(routePexels).toContain('url: p.urls?.regular || p.urls?.full');
  });

  it('l écran ne range plus la réponse telle quelle', () => {
    expect(wizard).toContain('setPosterPhotos(sanitizePhotos(data.photos));');
  });
});

describe('urlUtilisable', () => {
  it('accepte http et https', () => {
    expect(urlUtilisable('https://a.test/x.jpg')).toBe(true);
    expect(urlUtilisable('http://a.test/x.jpg')).toBe(true);
  });

  it('refuse tout le reste — y compris ce que produisait le bug', () => {
    for (const v of [undefined, null, '', '   ', 'undefined', 'blob:http://x/y', 'data:image/png;base64,AA', 42, {}]) {
      expect(urlUtilisable(v), JSON.stringify(v)).toBe(false);
    }
  });
});

describe('sanitizePhotos — le filet à la réception', () => {
  it('écarte une entrée sans URL exploitable', () => {
    const out = sanitizePhotos([
      { id: 1, url: 'https://a.test/ok.jpg' },
      { id: 2, url: undefined },
      { id: 3 },
      { id: 4, url: 'pas-une-url' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe('https://a.test/ok.jpg');
  });

  it('écarte aussi les tailles intermédiaires invalides, sans jeter la photo', () => {
    // Une miniature absente ne condamne pas une photo dont la pleine
    // résolution est parfaite.
    const out = sanitizePhotos([{ id: 1, url: 'https://a.test/ok.jpg', small: undefined, medium: 'nope' }]);
    expect(out[0].small).toBeUndefined();
    expect(out[0].medium).toBeUndefined();
    expect(out[0].url).toBe('https://a.test/ok.jpg');
  });

  it('dédoublonne sur l URL, pas sur l id', () => {
    // Deux fournisseurs peuvent rendre le même cliché sous deux ids, et le
    // lot exige des affiches réellement distinctes.
    const out = sanitizePhotos([
      { id: 1, url: 'https://a.test/x.jpg' },
      { id: 2, url: 'https://a.test/x.jpg' },
    ]);
    expect(out).toHaveLength(1);
  });

  it('une réponse aberrante rend une liste vide, jamais une exception', () => {
    for (const v of [null, undefined, 'nope', 42, {}]) {
      expect(sanitizePhotos(v), JSON.stringify(v)).toEqual([]);
    }
    expect(sanitizePhotos([null, 'x', 42])).toEqual([]);
  });

  it('une photo sans id garde une clé — son URL', () => {
    expect(sanitizePhotos([{ url: 'https://a.test/x.jpg' } as never])[0].id).toBe('https://a.test/x.jpg');
  });
});

describe('Le repli de vignette', () => {
  it('part de la PLUS LÉGÈRE', () => {
    // Charger douze pleines résolutions pour une grille de 4 colonnes
    // gaspille la bande passante.
    const p = photo({ small: 'https://cdn.test/s.jpg', medium: 'https://cdn.test/m.jpg' });
    expect(taillesVignette(p)[0]).toBe('https://cdn.test/s.jpg');
    expect(vignetteAffichable(p, new Set())).toBe('https://cdn.test/s.jpg');
  });

  it('passe à la taille suivante quand la première casse', () => {
    const p = photo({ small: 'https://cdn.test/s.jpg', medium: 'https://cdn.test/m.jpg' });
    expect(vignetteAffichable(p, new Set(['https://cdn.test/s.jpg']))).toBe('https://cdn.test/m.jpg');
  });

  it('retombe sur la pleine résolution en dernier recours', () => {
    const p = photo({ small: 'https://cdn.test/s.jpg' });
    expect(vignetteAffichable(p, new Set(['https://cdn.test/s.jpg']))).toBe(p.url);
  });

  it('rend null quand toutes ont échoué', () => {
    const p = photo({ small: 'https://cdn.test/s.jpg' });
    expect(vignetteAffichable(p, new Set(['https://cdn.test/s.jpg', p.url]))).toBeNull();
  });

  it('une photo sans miniature reste affichable', () => {
    expect(vignetteAffichable(photo(), new Set())).toBe('https://cdn.test/pleine.jpg');
  });
});

describe('Ce qui est proposable', () => {
  it('une photo dont la vignette marche mais dont l AFFICHE est morte est écartée', () => {
    // C'est le cas subtil : la grille l'afficherait, et le clic poserait un
    // fond mort. Mieux vaut ne pas la proposer.
    const p = photo({ small: 'https://cdn.test/s.jpg' });
    expect(photoUtilisable(p, new Set([p.url]))).toBe(false);
  });

  it('une photo saine est proposable', () => {
    expect(photoUtilisable(photo(), new Set())).toBe(true);
  });

  it('toutes tailles cassées → non proposable', () => {
    const p = photo({ small: 'https://cdn.test/s.jpg' });
    expect(photoUtilisable(p, new Set(['https://cdn.test/s.jpg', p.url]))).toBe(false);
  });
});

describe('La grille', () => {
  it('il n y en a qu UNE — l hypothèse des deux grilles ne tient pas', () => {
    // Les deux autres `posterPhotos.map` ne rendent rien : ils extraient des
    // URL pour l'attribution automatique du lot.
    expect(wizard.split('{posterPhotos.map((photo) => {').length - 1).toBe(1);
    expect(wizard.split('posterPhotos.map((p) => p.url)').length - 1).toBe(2);
  });

  it('l attribution automatique du LOT hérite de la validation', () => {
    // Elle lisait `posterPhotos` brut : une entrée sans URL y entrait comme
    // affiche d'une des vidéos du lot.
    expect(wizard).toContain('autoAssignPhotos(posterPhotos.map((p) => p.url), batchCount)');
    expect(wizard).toContain('setPosterPhotos(sanitizePhotos(data.photos));');
  });

  it('une photo non proposable disparaît au lieu de rester brisée', () => {
    expect(wizard).toContain('if (!photoUtilisable(photo, brokenPhotos)) return null;');
  });

  it('l échec de chargement est écouté, et marque la TAILLE, pas la photo', () => {
    // Marquer la photo entière condamnerait une pleine résolution parfaite
    // pour une miniature absente.
    expect(wizard).toContain('onError={() => {');
    expect(wizard).toContain('marquerCassee(vignette);');
  });

  it('l état des cassées ne se réécrit pas pour rien', () => {
    // Un `setState` à chaque `onError` d'une même URL relancerait le rendu
    // en boucle.
    expect(wizard).toContain('setBrokenPhotos((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));');
  });

  it('la vignette affichée vient du repli, plus des trois tailles en dur', () => {
    expect(wizard).toContain('src={vignette}');
    expect(wizard).not.toContain('src={photo.small || photo.medium || photo.url}');
  });
});

describe('Le glisser-déposer', () => {
  it('un second filet refuse de partir avec une URL inexploitable', () => {
    // Sans lui, le dépôt posait « undefined » comme affiche.
    expect(wizard).toContain('if (!urlUtilisable(photo.url)) {');
    const bloc = wizard.slice(wizard.indexOf('if (!urlUtilisable(photo.url)) {'));
    expect(bloc.slice(0, 120)).toContain('e.preventDefault();');
  });

  it('toutes les vignettes posent le type dédié et arment la surface', () => {
    // Une seule grille, donc un seul `onDragStart` — mais il doit tout faire.
    expect(wizard.split('e.dataTransfer.setData(PHOTO_DND_TYPE, photo.url);').length - 1).toBe(1);
    expect(wizard).toContain('setPhotoDragging(true);');
    expect(wizard).toContain('onDragEnd={() => setPhotoDragging(false)}');
  });

  it('le type dédié reste celui du correctif précédent', () => {
    // `text/plain` sert au réordonnancement des séquences.
    expect(wizard).toContain("export const PHOTO_DND_TYPE = 'application/x-studiio-photo';");
  });
});
