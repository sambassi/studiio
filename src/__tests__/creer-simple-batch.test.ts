import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  BATCH_ANGLES, MAX_BATCH, angleForIndex, clampBatchCount, batchCost,
  distinctPhotoForIndex, distinctUrls, autoAssignPhotos, batchPhotosReady, photosToFetch,
  batchDates, batchTopic, variationNonce,
} from '@/lib/creer/batch';
import { sanitizeDraft, DRAFT_VERSION, type SanitizeDeps } from '@/lib/creer/draft';

/**
 * Lot — Mode simple.
 *
 * Générer N montages d'un coup, chacun avec son angle, son affiche et sa date.
 *
 * Ce que ces tests protègent en priorité : **`batchCount = 1` doit reproduire
 * exactement le parcours d'avant**. Un lot touche aux crédits et crée des
 * posts ; une régression y coûte de l'argent réel à l'utilisateur.
 */

const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);

describe('clampBatchCount — on ne débite que ce que l écran propose', () => {
  it('ramène dans la plage 1..10', () => {
    expect(clampBatchCount(0)).toBe(1);
    expect(clampBatchCount(-5)).toBe(1);
    expect(clampBatchCount(99)).toBe(MAX_BATCH);
    expect(clampBatchCount(3)).toBe(3);
  });

  it('une valeur non finie vaut UN seul montage, pas dix', () => {
    // En cas de doute, on facture le minimum : l'inverse débiterait dix
    // rendus pour une valeur que personne n'a saisie.
    expect(clampBatchCount(Number.NaN)).toBe(1);
    expect(clampBatchCount(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampBatchCount(2.7)).toBe(2);
  });
});

describe('batchCost', () => {
  it('multiplie le coût unitaire par le nombre de montages', () => {
    expect(batchCost(10, 3)).toBe(30);
    expect(batchCost(15, 1)).toBe(15);
  });

  it('applique le même bornage — pas de facture hors plage', () => {
    expect(batchCost(10, 0)).toBe(10);
    expect(batchCost(10, 999)).toBe(10 * MAX_BATCH);
  });
});

describe('angleForIndex — chaque montage a le sien', () => {
  it('suit la liste dans l ordre', () => {
    expect(angleForIndex(0)).toBe(BATCH_ANGLES[0]);
    expect(angleForIndex(1)).toBe(BATCH_ANGLES[1]);
  });

  it('tourne au-delà de la liste plutôt que de manquer', () => {
    expect(angleForIndex(BATCH_ANGLES.length)).toBe(BATCH_ANGLES[0]);
    expect(angleForIndex(BATCH_ANGLES.length + 3)).toBe(BATCH_ANGLES[3]);
  });

  it('la liste est assez longue pour un lot maximal sans répétition', () => {
    const vus = new Set(Array.from({ length: MAX_BATCH }, (_, i) => angleForIndex(i)));
    expect(vus.size).toBe(MAX_BATCH);
  });
});

describe('batchTopic — l angle est un suffixe, pas le sujet', () => {
  it('laisse le sujet intact', () => {
    const t = batchTopic('yoga du matin', 0);
    expect(t.startsWith('yoga du matin')).toBe(true);
    expect(t).toContain('(angle:');
  });

  it('deux montages ne demandent pas la même chose', () => {
    expect(batchTopic('yoga', 0)).not.toBe(batchTopic('yoga', 1));
  });
});

describe('variationNonce', () => {
  it('distingue deux montages du même lot', () => {
    expect(variationNonce(0, 1000)).not.toBe(variationNonce(1, 1000));
  });

  it('distingue deux lancers du même montage', () => {
    expect(variationNonce(0, 1000)).not.toBe(variationNonce(0, 2000));
  });
});

describe('distinctPhotoForIndex — plus de recyclage', () => {
  const urls = ['a.jpg', 'b.jpg'];

  it("donne l'affiche de l'emplacement", () => {
    expect(distinctPhotoForIndex(urls, 0)).toBe('a.jpg');
    expect(distinctPhotoForIndex(urls, 1)).toBe('b.jpg');
  });

  it("au-delà de la liste : RIEN, surtout pas un doublon", () => {
    // L'ancienne version bouclait : trois vidéos et deux affiches donnaient
    // deux montages identiques — l'inverse de ce que le lot cherche.
    expect(distinctPhotoForIndex(urls, 2)).toBeUndefined();
    expect(distinctPhotoForIndex(urls, 3)).toBeUndefined();
    expect(distinctPhotoForIndex(urls, -1)).toBeUndefined();
  });

  it('sans affiche, rien', () => {
    expect(distinctPhotoForIndex([], 0)).toBeUndefined();
  });

  it('un emplacement vide ne vaut pas une affiche', () => {
    expect(distinctPhotoForIndex(['', 'b.jpg'], 0)).toBeUndefined();
  });
});

describe('distinctUrls', () => {
  it('dédoublonne en gardant l ordre', () => {
    expect(distinctUrls(['a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('écarte les valeurs vides', () => {
    expect(distinctUrls(['a', '', null, undefined, 'b'])).toEqual(['a', 'b']);
  });
});

describe('autoAssignPhotos — une affiche distincte par vidéo', () => {
  it('prend les N premières distinctes', () => {
    expect(autoAssignPhotos(['a', 'b', 'c', 'd'], 3)).toEqual(['a', 'b', 'c']);
  });

  it('ignore les doublons des résultats', () => {
    // Pexels et Unsplash proposent parfois le même cliché.
    expect(autoAssignPhotos(['a', 'a', 'b', 'b', 'c'], 3)).toEqual(['a', 'b', 'c']);
  });

  it("rend MOINS que demandé plutôt que d'inventer un doublon", () => {
    expect(autoAssignPhotos(['a', 'b'], 4)).toEqual(['a', 'b']);
  });

  it('aucune candidate : liste vide', () => {
    expect(autoAssignPhotos([], 3)).toEqual([]);
  });
});

describe('batchPhotosReady — le garde-fou de l envoi', () => {
  it('accepte une affiche par vidéo, toutes différentes', () => {
    expect(batchPhotosReady(['a', 'b', 'c'], 3)).toBe(true);
  });

  it('refuse un lot incomplet', () => {
    expect(batchPhotosReady(['a', 'b'], 3)).toBe(false);
    expect(batchPhotosReady([], 3)).toBe(false);
  });

  it('refuse un doublon, même si le compte y est', () => {
    expect(batchPhotosReady(['a', 'a', 'b'], 3)).toBe(false);
  });

  it('refuse un emplacement vide au milieu', () => {
    expect(batchPhotosReady(['a', '', 'c'], 3)).toBe(false);
  });

  it("hors lot, il n'y a rien à garantir", () => {
    // Une seule vidéo : la photo unique suffit, y compris aucune.
    expect(batchPhotosReady([], 1)).toBe(true);
  });
});

describe('photosToFetch — en demander assez pour couvrir le lot', () => {
  it('le double du lot, au moins six', () => {
    expect(photosToFetch(1)).toBe(6);
    expect(photosToFetch(3)).toBe(6);
    expect(photosToFetch(5)).toBe(10);
    expect(photosToFetch(10)).toBe(20);
  });
});

describe('batchDates — un jour après l autre', () => {
  it('étale vers l avant', () => {
    expect(batchDates(new Date(2026, 7, 3, 12), 3)).toEqual(['2026-08-03', '2026-08-04', '2026-08-05']);
  });

  it('un seul montage garde la date choisie', () => {
    expect(batchDates(new Date(2026, 7, 3, 12), 1)).toEqual(['2026-08-03']);
  });

  it('repart vers l arrière plutôt que de déborder du mois', () => {
    // Le 30 août + 3 sortirait de septembre : les débordements reculent.
    const d = batchDates(new Date(2026, 7, 30, 12), 4);
    expect(d[0]).toBe('2026-08-30');
    expect(d[1]).toBe('2026-08-31');
    expect(d[2]).toBe('2026-08-28');
    expect(d[3]).toBe('2026-08-27');
    // Aucune date ne quitte le mois de départ.
    for (const jour of d) expect(jour.startsWith('2026-08')).toBe(true);
  });

  it('toutes les dates sont distinctes', () => {
    const d = batchDates(new Date(2026, 7, 30, 12), 6);
    expect(new Set(d).size).toBe(d.length);
  });
});

describe('Rétro-compatibilité : un seul montage = le parcours d avant', () => {
  it("aucune variation IA n'est demandée hors lot", () => {
    // La condition porte sur `total > 1` ET sur le rang : la première vidéo
    // garde toujours le contenu que l'utilisateur vient de relire.
    expect(wizard).toContain('if (total > 1 && b > 0) {');
  });

  it("l'état de contenu n'est pas touché hors lot", () => {
    expect(wizard).toContain('if (contenu !== generated) flushSync(() => setGenerated(contenu));');
    expect(wizard).toContain('if (total > 1) setGenerated(contenuInitial);');
  });

  it('le nombre par défaut est 1', () => {
    expect(wizard).toContain('const [batchCount, setBatchCount] = useState(1);');
  });

  it("le débit reste unitaire : une vidéo, un débit", () => {
    // Débiter le total d'un coup ferait payer des montages qui ont échoué.
    expect(wizard).toContain("body: JSON.stringify({ cost, reason: 'render', format: renderFormat }),");
  });
});

describe('Câblage du lot', () => {
  it('le solde est vérifié pour le TOTAL avant de lancer', () => {
    expect(wizard).toContain('const coutTotal = batchCost(cost, total);');
    expect(wizard).toContain('balance < coutTotal');
  });

  it('chaque montage reçoit sa date et son affiche', () => {
    expect(wizard).toContain('scheduled_date: dates[b],');
    expect(wizard).toContain('? distinctPhotoForIndex(batchPhotoUrls, b)');
    expect(wizard).toContain('posterUrl: affiche,');
  });

  it('les titres déjà produits sont transmis pour éviter les répétitions', () => {
    expect(wizard).toContain('existingTitles: priorTitles,');
    expect(wizard).toContain('titresDejaVus.push(variation.title)');
  });

  it("une variation qui échoue n'interrompt pas le lot", () => {
    // Mieux vaut une vidéo de plus au même texte qu'un lot arrêté au milieu.
    expect(wizard).toContain('if (variation) {');
    expect(wizard).toContain('return null;');
  });

  it('la progression du lot est affichée', () => {
    expect(wizard).toContain('setBatchProgress({ done: b, total });');
    expect(wizard).toContain('Vidéo {batchProgress.done + 1} / {batchProgress.total}');
  });

  it('la sélection multi-photos est bornée au nombre de vidéos', () => {
    expect(wizard).toContain('if (prev.length >= batchCount) return prev;');
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

describe('Persistance du lot', () => {
  it('un brouillon sans lot se relit comme avant', () => {
    expect(lire({}).batchCount).toBeUndefined();
    expect(lire({}).batchPhotoUrls).toBeUndefined();
  });

  it('relit un lot valide', () => {
    expect(lire({ batchCount: 3 }).batchCount).toBe(3);
    expect(lire({ batchPhotoUrls: ['https://a/1.jpg'] }).batchPhotoUrls).toEqual(['https://a/1.jpg']);
  });

  it('un lot hors bornes est ramené ou oublié', () => {
    // Un brouillon abîmé ne doit pas faire débiter 500 crédits.
    expect(lire({ batchCount: 999 }).batchCount).toBe(10);
    expect(lire({ batchCount: 0 }).batchCount).toBeUndefined();
    expect(lire({ batchCount: 'trois' }).batchCount).toBeUndefined();
  });

  it('les affiches du lot doivent être des URL http(s)', () => {
    expect(lire({ batchPhotoUrls: ['data:image/png;base64,AA', 'https://a/1.jpg'] }).batchPhotoUrls)
      .toEqual(['https://a/1.jpg']);
    expect(lire({ batchPhotoUrls: ['blob:x'] }).batchPhotoUrls).toBeUndefined();
    expect(lire({ batchPhotoUrls: 'nope' }).batchPhotoUrls).toBeUndefined();
  });

  it('un nouveau montage repart à un seul montage', () => {
    const reset = wizard.slice(wizard.indexOf('const reset = ()'), wizard.indexOf('const reset = ()') + 1300);
    expect(reset).toContain('setBatchCount(1)');
    expect(reset).toContain('setBatchPhotoUrls([])');
  });
});

describe('Attribution des affiches — auto ou manuel', () => {
  it('le mode par défaut est automatique', () => {
    // C'est l'intérêt du lot : N publications différentes sans rien cocher.
    expect(wizard).toContain("useState<'auto' | 'manuel'>('auto')");
  });

  it("l'attribution auto se rejoue quand les résultats ou le lot changent", () => {
    expect(wizard).toContain('setBatchPhotoUrls(autoAssignPhotos(posterPhotos.map((p) => p.url), batchCount));');
    expect(wizard).toContain('}, [batchPhotoMode, batchCount, posterPhotos]);');
  });

  it("l'envoi est bloqué quand une vidéo n'a pas son affiche", () => {
    expect(wizard).toContain('if (total > 1 && !batchPhotosReady(batchPhotoUrls, total)) {');
    expect(wizard).toContain('ou repassez en mode automatique.');
  });

  it("remplacer une affiche déjà posée ailleurs ÉCHANGE au lieu de dupliquer", () => {
    expect(wizard).toContain('const ailleurs = next.findIndex((u, i) => u === url && i !== slot);');
    expect(wizard).toContain('if (ailleurs >= 0) next[ailleurs] = next[slot] ?? \'\';');
  });

  it('la recherche ramène de quoi couvrir le lot', () => {
    expect(wizard).toContain('Math.max(POSTER_COUNT, photosToFetch(batchCountRef.current))');
  });

  it('le manque de photos distinctes est dit, pas contourné', () => {
    expect(wizard).toContain('Pas assez de photos distinctes');
  });

  it('le mode est enregistré dans le brouillon', () => {
    expect(lire({ batchPhotoMode: 'manuel' }).batchPhotoMode).toBe('manuel');
    expect(lire({ batchPhotoMode: 'nawak' }).batchPhotoMode).toBeUndefined();
    expect(lire({}).batchPhotoMode).toBeUndefined();
  });
});
