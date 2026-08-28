import { describe, it, expect, afterEach } from 'vitest';
import { etatDepuisReponse, messagePhotos } from '@/lib/creer/photosEtat';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Preview } from '@/app/dashboard/creer/AssistantWizard';
import { sanitizeDraft, DRAFT_VERSION, type SanitizeDeps } from '@/lib/creer/draft';

/**
 * Photo d'affiche — Mode simple.
 *
 * Le fond du montage était le seul dégradé des couleurs. On peut désormais lui
 * substituer une photo, cherchée sur Pexels ou Unsplash, ou envoyée depuis le
 * poste.
 *
 * L'exigence qui commande le reste : **l'aperçu doit montrer ce que la vidéo
 * montrera**. Le compositeur peint la photo puis le VOILE du dégradé
 * par-dessus (`drawIntro` → `paintSeqGradient`, position « both » par défaut).
 * L'aperçu doit donc faire pareil — y laisser le dégradé plein cacherait la
 * photo à l'écran alors que la vidéo la montrerait.
 */

const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'),
  'utf-8',
);
const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');

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
const props = {
  generated,
  format: '9:16' as const,
  displayScale: 0.25,
  activeOrder: ['intro', 'cards', 'cta'],
  gradStart: '#7C3AED',
  gradEnd: '#EC4899',
  gradientOpacity: 0.5,
  accent: '#7C3AED',
  watermark: 'Studiio.pro',
  text: TEXT,
};
const PHOTO = 'https://images.pexels.com/photos/1/yoga.jpg';

afterEach(cleanup);

const plateau = (c: HTMLElement) => c.querySelector('[style*="scale"]') as HTMLElement;

describe('Default-safe : sans photo, le fond ne change pas', () => {
  it("l'aperçu garde son dégradé plein", () => {
    const { container } = render(<Preview {...props} />);
    const fond = plateau(container).style.background;
    expect(fond).toContain('linear-gradient');
    expect(fond).not.toContain('url(');
  });

  it('une photo absente ou nulle revient au même', () => {
    const { container } = render(<Preview {...props} posterUrl={null} />);
    expect(plateau(container).style.background).not.toContain('url(');
  });

  it("l'export n'envoie rien quand aucune photo n'est retenue", () => {
    // Hors lot, l'affiche est la photo unique — `undefined` sans photo.
    expect(wizard).toContain('(posterUrl ?? undefined);');
    expect(wizard).toContain('posterUrl: affiche,');
  });
});

describe('Avec une photo, l aperçu montre ce que la vidéo montrera', () => {
  it('la photo est un CALQUE, en couverture', () => {
    // Deux calques distincts — photo puis voile — au lieu d'un seul fond CSS :
    // c'est ce qui permet de recadrer la photo sans toucher au voile.
    render(<Preview {...props} posterUrl={PHOTO} />);
    const photo = document.querySelector<HTMLImageElement>('[data-poster-layer]')!;
    expect(photo).not.toBeNull();
    expect(photo.getAttribute('src')).toBe(PHOTO);
    expect(photo.style.objectFit).toBe('cover');
  });

  it('le VOILE du dégradé est un calque AU-DESSUS de la photo', () => {
    const { container } = render(<Preview {...props} posterUrl={PHOTO} />);
    const photo = container.querySelector('[data-poster-layer]')!;
    const voile = photo.nextElementSibling as HTMLElement;
    expect(voile.style.background).toContain('linear-gradient');
    // Une seule couche : le voile haut/bas, pas le dégradé plein.
    expect(voile.style.background.match(/linear-gradient/g)).toHaveLength(1);
    expect(voile.style.background).toContain('rgba(0, 0, 0, 0) 40%');
  });

  it('le plateau lui-même ne peint plus de dégradé sous la photo', () => {
    const { container } = render(<Preview {...props} posterUrl={PHOTO} />);
    expect(plateau(container).style.background).not.toContain('linear-gradient');
  });

  it("la photo n'intercepte pas les clics hors du mode recadrage", () => {
    // Sinon elle volerait les prises du titre, des cartes et des éléments.
    render(<Preview {...props} posterUrl={PHOTO} />);
    const photo = document.querySelector<HTMLImageElement>('[data-poster-layer]')!;
    expect(photo.style.pointerEvents).toBe('none');
  });
});

describe('Le compositeur fait bien la même chose', () => {
  it('il peint la photo puis le voile par-dessus', () => {
    const intro = composer.slice(composer.indexOf('function drawIntro'));
    expect(intro.indexOf('ctx.drawImage(posterImg')).toBeLessThan(
      intro.indexOf("paintSeqGradient(ctx, w, h, 'intro'"),
    );
  });

  it('la photo couvre TOUTES les séquences par défaut', () => {
    // `posterOnAllSequences` absent vaut « partout » — ce que montre l'aperçu,
    // qui empile les séquences sur un seul fond.
    expect(composer).toContain(
      "const usePoster = normalizedDesign?.posterOnAllSequences !== false || type === 'intro';",
    );
    // Le Mode simple ne passe PAS ce champ — seul son commentaire le nomme.
    expect(wizard).not.toContain('posterOnAllSequences:');
  });

  it('le voile reprend les couleurs et l opacité envoyées par le Mode simple', () => {
    expect(composer).toContain("color1: override?.color1 || design?.gradientColor1 || '#7C3AED'");
    expect(composer).toContain('opacity: override?.opacity ?? design?.gradientOpacity ?? 0.3');
    expect(composer).toContain("position: override?.position || 'both'");
    expect(wizard).toContain('gradientColor1: gradStart,');
    expect(wizard).toContain('gradientOpacity,');
  });
});

describe('La recherche', () => {
  it('interroge /api/pexels avec la source demandée', () => {
    // Le nombre demandé suit la taille du lot : il faut assez de photos
    // distinctes pour en donner une par vidéo.
    expect(wizard).toContain('`/api/pexels?query=${encodeURIComponent(q)}&count=${');
    expect(wizard).toContain('Math.max(POSTER_COUNT, photosToFetch(batchCountRef.current))');
    expect(wizard).toContain('&page=${p}&source=${source}`');
  });

  it('une page vide ramène à la première au lieu d afficher du vide', () => {
    expect(wizard).toContain('if ((!data?.success || !data.photos?.length) && page > 1)');
    expect(wizard).toContain('posterPageRef.current = 1;');
  });

  it('changer de source relance la recherche', () => {
    // Sinon la grille afficherait encore les résultats de l'autre source.
    expect(wizard).toContain('searchPhotos(photoQuery.trim() || currentTopic, source);');
  });

  it('la requête par défaut vient du sujet, pas d un mot figé', () => {
    expect(wizard).toContain(
      "const currentTopic = customTopic.trim() || (THEMES.find((t) => t.id === themeId) ?? THEMES[0]).topic;",
    );
  });

  it('un échec réseau est dit, il ne laisse pas une grille muette', () => {
    // Les messages vivent desormais dans `lib/creer/photosEtat`, parce qu'il
    // y en a QUATRE et non deux : rien trouvé, source non configurée, clé
    // refusée, quota atteint. L'ecran les distingue au lieu de tous les
    // rendre par « Aucune photo pour cette recherche » — qui accusait la
    // requête de l'utilisateur quand le fournisseur n'avait rien exécuté.
    expect(wizard).toContain("setPhotosEtat('indisponible');");
    expect(wizard).toContain("messagePhotos('indisponible', source)");
    expect(messagePhotos('vide', 'pexels')).toBe('Aucune photo pour cette recherche.');
  });

  it("une source non configurée le dit, au lieu de « aucune photo »", () => {
    // L'API renvoie `configured: false` quand la clé manque côté serveur.
    // Sans cette distinction, l'utilisateur reformule sa recherche sans fin.
    expect(etatDepuisReponse({ configured: false })).toBe('non-configure');
    expect(messagePhotos('non-configure', 'unsplash'))
      .toBe('Unsplash n’est pas configuré sur ce serveur.');
    expect(wizard).toContain('etatDepuisReponse(data)');
  });
});

describe('Ma photo', () => {
  it("passe par le stockage, jamais par un data URL dans le brouillon", () => {
    // Une photo en base64 pèse plusieurs Mo et ferait sauter le quota.
    expect(wizard).toContain('const envoye = await uploadPosterFile(file);');
  });

  it('un repli en data URL est signalé, pas caché', () => {
    expect(wizard).toContain('if (envoye.dataUrl) {');
    expect(wizard).toContain('elle ne survivra pas au rechargement');
  });

  it('la photo envoyée rejoint la grille et devient la sélection', () => {
    expect(wizard).toContain('setPosterPhotos((prev) => [perso, ...prev]);');
    // `applyPhoto` vise la séquence affichée, ou l'affiche globale sur « Tout ».
    expect(wizard).toContain('applyPhoto(envoye.url);');
  });
});

const DEPS: SanitizeDeps = {
  themeIds: ['sommeil'],
  toneIds: ['punchy'],
  formats: ['9:16', '1:1', '16:9'],
  maxStep: 3,
  defaults: {
    themeId: 'sommeil',
    toneId: 'punchy',
    format: '9:16',
    titleStyle: { font: 'Inter', color: '#FFFFFF', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.1 },
    subtitleStyle: { font: null, color: null, scale: 1 },
    ctaStyle: { font: 'Inter', color: '#FFFFFF', subColor: '', scale: 1, bold: true, italic: false, letterSpacing: 0, lineHeight: 1.2 },
    sequences: [
      { key: 'intro', enabled: true },
      { key: 'cards', enabled: true },
      { key: 'video', enabled: false },
      { key: 'cta', enabled: true },
    ],
    durations: { intro: 4, cards: 6, video: 0, cta: 4 },
  },
};
const lire = (extra: Record<string, unknown>) =>
  sanitizeDraft({ version: DRAFT_VERSION, savedAt: 1, ...extra }, DEPS)!;

describe('Persistance', () => {
  it('un brouillon sans photo se relit comme avant', () => {
    expect(lire({}).posterUrl).toBeUndefined();
    expect(lire({}).imageSource).toBeUndefined();
  });

  it('relit une URL http(s)', () => {
    expect(lire({ posterUrl: PHOTO }).posterUrl).toBe(PHOTO);
  });

  it('écarte un data URL — le quota du stockage local n y survivrait pas', () => {
    expect(lire({ posterUrl: 'data:image/jpeg;base64,AAAA' }).posterUrl).toBeUndefined();
  });

  it('écarte une URL qui meurt avec l onglet, ou n en est pas une', () => {
    for (const v of ['blob:http://x/y', 'javascript:alert(1)', '', 42, null, {}]) {
      expect(lire({ posterUrl: v }).posterUrl, JSON.stringify(v)).toBeUndefined();
    }
  });

  it('la source préférée n accepte que ses deux valeurs', () => {
    expect(lire({ imageSource: 'unsplash' }).imageSource).toBe('unsplash');
    expect(lire({ imageSource: 'pexels' }).imageSource).toBe('pexels');
    expect(lire({ imageSource: 'getty' }).imageSource).toBeUndefined();
  });

  it('le brouillon écrit ce qui est retenu, et la restauration le dit', () => {
    expect(wizard).toContain('posterUrl: posterUrl ?? undefined,');
    expect(wizard).toContain('if (draft.posterUrl) setPosterUrl(draft.posterUrl);');
    expect(wizard).toContain("draft.posterUrl ? 'affiche' : null,");
  });

  it('un nouveau montage repart sans photo', () => {
    const reset = wizard.slice(wizard.indexOf('const reset = ()'), wizard.indexOf('const reset = ()') + 1100);
    expect(reset).toContain('setPosterUrl(null)');
    expect(reset).toContain('setPosterPhotos([])');
  });
});
