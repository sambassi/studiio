import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  DRAFT_VERSION,
  draftKey,
  persistableUrl,
  readDraft,
  writeDraft,
  clearDraft,
  sanitizeDraft,
  sanitizeSequences,
  type SanitizeDeps,
} from '../lib/creer/draft';

/**
 * Brouillon de « Créer (simple) ».
 *
 * Un rafraîchissement perdait tout le travail. Deux dangers viennent avec le
 * remède, et ce sont eux que ces tests surveillent :
 *
 * 1. **Ce qu'on relit n'est pas digne de confiance.** Un brouillon peut dater
 *    d'une version antérieure, avoir été écrit par un autre onglet, ou
 *    modifié à la main. Restaurer une police disparue du catalogue, une durée
 *    aberrante ou zéro séquence active casserait l'aperçu ET l'export.
 * 2. **Une URL `blob:` ne survit pas au rafraîchissement.** Persistée, elle
 *    reviendrait en pointant vers rien.
 */

const wizardSource = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);

const DEPS: SanitizeDeps = {
  themeIds: ['sommeil', 'nutrition'],
  toneIds: ['punchy', 'pro'],
  formats: ['9:16', '1:1', '16:9'],
  maxStep: 3,
  defaults: {
    themeId: 'sommeil',
    toneId: 'punchy',
    format: '9:16',
    titleStyle: {
      font: 'Inter',
      color: '#FFFFFF',
      scale: 1,
      bold: true,
      italic: false,
      letterSpacing: 0,
      lineHeight: 1.1,
    },
    subtitleStyle: { font: null, color: null, scale: 1 },
    ctaStyle: {
      font: 'Inter',
      color: '#FFFFFF',
      subColor: '',
      scale: 1,
      bold: true,
      italic: false,
      letterSpacing: 0,
      lineHeight: 1.2,
    },
    sequences: [
      { key: 'intro', enabled: true },
      { key: 'cards', enabled: true },
      { key: 'video', enabled: false },
      { key: 'cta', enabled: true },
    ],
    durations: { intro: 4, cards: 6, video: 0, cta: 4 },
  },
};

const valid = (over: Record<string, unknown> = {}) => ({
  version: DRAFT_VERSION,
  savedAt: 1,
  started: true,
  step: 1,
  themeId: 'nutrition',
  toneId: 'pro',
  format: '1:1',
  titleStyle: { ...DEPS.defaults.titleStyle, font: 'Anton', color: '#00FF00' },
  subtitleStyle: DEPS.defaults.subtitleStyle,
  ctaStyle: DEPS.defaults.ctaStyle,
  sequences: DEPS.defaults.sequences,
  ...over,
});

describe('Aller-retour : ce qu’on règle est ce qu’on retrouve', () => {
  it('rend les valeurs réglées, pas les défauts', () => {
    const d = sanitizeDraft(valid({ customTopic: 'yoga du matin', introDuration: 7 }), DEPS)!;
    expect(d.themeId).toBe('nutrition');
    expect(d.toneId).toBe('pro');
    expect(d.format).toBe('1:1');
    expect(d.customTopic).toBe('yoga du matin');
    expect(d.introDuration).toBe(7);
    expect(d.titleStyle!.font).toBe('Anton');
    expect(d.titleStyle!.color).toBe('#00FF00');
    expect(d.started).toBe(true);
  });

  it('conserve les états « suit le titre » et « suit le dégradé »', () => {
    // `null` sur la police du sous-titre et `''` sur la sous-couleur du CTA
    // ne sont pas des valeurs manquantes : ce sont des choix, qui veulent
    // dire « hérite ». Les remplacer par un défaut changerait le rendu.
    const d = sanitizeDraft(valid(), DEPS)!;
    expect(d.subtitleStyle!.font).toBeNull();
    expect(d.subtitleStyle!.color).toBeNull();
    expect(d.ctaStyle!.subColor).toBe('');
  });

  it('conserve le contenu généré, cartes comprises', () => {
    const d = sanitizeDraft(
      valid({
        generated: {
          title: 'MON TITRE',
          subtitle: 'sous-titre',
          cta: 'JE ME LANCE',
          ctaSub: 'LIEN EN BIO',
          cards: [{ icon: 'Droplet', title: 'Carte', description: 'desc', value: '80%' }],
        },
      }),
      DEPS,
    )!;
    const g = d.generated as { title: string; cards: unknown[] };
    expect(g.title).toBe('MON TITRE');
    expect(g.cards).toHaveLength(1);
  });
});

describe('Rien de ce qu’on relit n’est digne de confiance', () => {
  it('ignore un brouillon d’une autre version — retour au comportement d’avant', () => {
    expect(sanitizeDraft({ ...valid(), version: 999 }, DEPS)).toBeNull();
    expect(sanitizeDraft(null, DEPS)).toBeNull();
    expect(sanitizeDraft('pas un objet', DEPS)).toBeNull();
    expect(sanitizeDraft([], DEPS)).toBeNull();
  });

  it('remplace une police disparue du catalogue', () => {
    // La garder ferait rendre l'aperçu ET la vidéo en police de repli, sans
    // que rien ne l'explique.
    const d = sanitizeDraft(
      valid({ titleStyle: { ...DEPS.defaults.titleStyle, font: 'Police Supprimée' } }),
      DEPS,
    )!;
    expect(d.titleStyle!.font).toBe('Inter');
  });

  it('remplace un thème, un ton ou un format inconnus', () => {
    const d = sanitizeDraft(
      valid({ themeId: 'disparu', toneId: 'inconnu', format: '4:3' }),
      DEPS,
    )!;
    expect(d.themeId).toBe('sommeil');
    expect(d.toneId).toBe('punchy');
    expect(d.format).toBe('9:16');
  });

  it('borne les nombres aberrants', () => {
    const d = sanitizeDraft(
      valid({
        introDuration: 99999,
        cardsDuration: -5,
        musicVolume: 12,
        titleStyle: { ...DEPS.defaults.titleStyle, scale: NaN, lineHeight: 0 },
      }),
      DEPS,
    )!;
    expect(d.introDuration).toBe(4);
    expect(d.cardsDuration).toBe(6);
    expect(d.musicVolume).toBe(0.5);
    expect(d.titleStyle!.scale).toBe(1);
    expect(d.titleStyle!.lineHeight).toBe(1.1);
  });

  it('rejette une couleur qui n’en est pas une', () => {
    const d = sanitizeDraft(
      valid({
        colors: { accent: 'javascript:alert(1)', gradStart: '#GGGGGG', gradEnd: '#EC4899', gradientOpacity: 0.3 },
      }),
      DEPS,
    )!;
    expect(d.colors!.accent).toBe('#7C3AED');
    expect(d.colors!.gradStart).toBe('#7C3AED');
    // La valeur valide, elle, est conservée.
    expect(d.colors!.gradEnd).toBe('#EC4899');
    expect(d.colors!.gradientOpacity).toBe(0.3);
  });

  it('rend ce qu’il a de bon quand le reste est cassé', () => {
    // Un brouillon partiellement invalide ne doit pas tout perdre.
    const d = sanitizeDraft(
      { version: DRAFT_VERSION, themeId: 'nutrition', titleStyle: 'cassé', sequences: 42 },
      DEPS,
    )!;
    expect(d).not.toBeNull();
    expect(d.themeId).toBe('nutrition');
    expect(d.titleStyle!.font).toBe('Inter');
    expect(d.sequences).toEqual(DEPS.defaults.sequences);
  });

  it('ne restaure jamais l’écran d’envoi', () => {
    // Il annonce un rendu et un débit de crédits qui n'ont pas eu lieu. On
    // RAMENE à la dernière étape sûre plutôt que de repartir de la première :
    // renvoyer l'utilisateur au début lui ferait refaire tout le parcours.
    expect(sanitizeDraft(valid({ step: 4 }), DEPS)!.step).toBe(3);
    expect(sanitizeDraft(valid({ step: 99 }), DEPS)!.step).toBe(3);
    expect(sanitizeDraft(valid({ step: -1 }), DEPS)!.step).toBe(0);
    expect(sanitizeDraft(valid({ step: 'deux' }), DEPS)!.step).toBe(0);
  });

  it('tronque un sujet démesuré', () => {
    const d = sanitizeDraft(valid({ customTopic: 'a'.repeat(5000) }), DEPS)!;
    expect(d.customTopic!.length).toBe(300);
  });
});

describe('Séquences', () => {
  it('supprime les doublons et les clés inconnues', () => {
    const out = sanitizeSequences(
      [
        { key: 'intro', enabled: true },
        { key: 'intro', enabled: false },
        { key: 'inconnue', enabled: true },
        { key: 'cta', enabled: true },
      ],
      DEPS.defaults.sequences,
    );
    expect(out.filter((s) => s.key === 'intro')).toHaveLength(1);
    expect(out.some((s) => (s.key as string) === 'inconnue')).toBe(false);
  });

  it('complète les séquences manquantes', () => {
    // Une clé absente serait une séquence définitivement inaccessible.
    const out = sanitizeSequences([{ key: 'intro', enabled: true }], DEPS.defaults.sequences);
    expect(out.map((s) => s.key).sort()).toEqual(['cards', 'cta', 'intro', 'video']);
  });

  it('refuse un brouillon où plus rien n’est actif', () => {
    // Le compositeur retomberait sur une intro d'une seconde et le
    // Calendrier afficherait une progression NaN.
    const out = sanitizeSequences(
      [
        { key: 'intro', enabled: false },
        { key: 'cards', enabled: false },
        { key: 'video', enabled: false },
        { key: 'cta', enabled: false },
      ],
      DEPS.defaults.sequences,
    );
    expect(out).toEqual(DEPS.defaults.sequences);
  });

  it('conserve l’ordre choisi', () => {
    const out = sanitizeSequences(
      [
        { key: 'cta', enabled: true },
        { key: 'intro', enabled: true },
        { key: 'cards', enabled: true },
        { key: 'video', enabled: false },
      ],
      DEPS.defaults.sequences,
    );
    expect(out.map((s) => s.key)).toEqual(['cta', 'intro', 'cards', 'video']);
  });
});

describe('Aucune URL blob: n’est conservée', () => {
  it('les filtre à l’écriture', () => {
    expect(persistableUrl('blob:http://localhost/abcd')).toBeUndefined();
    expect(persistableUrl('https://storage.test/musique.mp3')).toBe('https://storage.test/musique.mp3');
    expect(persistableUrl(null)).toBeUndefined();
    expect(persistableUrl(undefined)).toBeUndefined();
  });

  it('le wizard les filtre pour les trois médias', () => {
    // Musique, voix et rush : trois occasions d'enregistrer une URL morte.
    const build = wizardSource.slice(
      wizardSource.indexOf('const buildDraft = useCallback'),
      wizardSource.indexOf('const draftRef = useRef'),
    );
    expect(build).not.toHaveLength(0);
    expect(build).toMatch(/musicUrl: persistableDraftUrl\(musicUrl\)/);
    expect(build).toMatch(/voiceUrl: persistableDraftUrl\(voiceUrl\)/);
    expect(build).toMatch(/rushUrl: persistableDraftUrl\(rushUrl\)/);
  });
});

describe('Stockage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('écrit puis relit', () => {
    const key = draftKey('a@b.c');
    expect(writeDraft(key, { version: DRAFT_VERSION, savedAt: 1, themeId: 'nutrition' })).toBe(true);
    expect((readDraft(key) as { themeId: string }).themeId).toBe('nutrition');
    clearDraft(key);
    expect(readDraft(key)).toBeNull();
  });

  it('sépare les utilisateurs', () => {
    // Deux comptes sur le même navigateur ne doivent pas hériter du
    // brouillon de l'autre, ni l'écraser.
    expect(draftKey('a@b.c')).not.toBe(draftKey('d@e.f'));
    expect(draftKey(null)).not.toBe(draftKey('a@b.c'));
    writeDraft(draftKey('a@b.c'), { version: DRAFT_VERSION, savedAt: 1, themeId: 'nutrition' });
    expect(readDraft(draftKey('d@e.f'))).toBeNull();
  });

  it('ne casse rien quand le stockage refuse d’écrire', () => {
    // Navigation privée, quota dépassé, stockage désactivé : rien de tout
    // cela ne doit interrompre une édition en cours.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => writeDraft(draftKey(), { version: DRAFT_VERSION, savedAt: 1 })).not.toThrow();
    expect(writeDraft(draftKey(), { version: DRAFT_VERSION, savedAt: 1 })).toBe(false);
  });

  it('traite un contenu illisible comme une absence de brouillon', () => {
    window.localStorage.setItem(draftKey(), '{ pas du json');
    expect(readDraft(draftKey())).toBeNull();
  });
});

describe('Structure du câblage', () => {
  // Le COMPORTEMENT (débounce, écriture au démontage, `pagehide`, « repartir
  // de zéro ») est vérifié en montant le vrai composant, dans
  // `creer-simple-draft-behaviour.test.tsx`. Les expressions régulières qui
  // s'en chargeaient ici passaient alors que trois de ces comportements
  // étaient cassés — elles ne testaient que la présence de texte.
  // Ne reste ici que ce qu'un test de comportement ne montre pas : qu'il
  // n'existe qu'un seul endroit où l'état est construit et écrit.
  it('construit l’état à sauvegarder en UN SEUL endroit', () => {
    // Trois moments d'écriture : minuterie, démontage, fermeture d'onglet.
    // Écrit trois fois, l'état aurait fini par diverger, et c'est le chemin
    // le moins testé qui aurait enregistré un brouillon incomplet.
    expect(wizardSource.match(/const buildDraft = useCallback/g)).toHaveLength(1);
    expect(wizardSource.match(/writeDraft\(/g)).toHaveLength(1);
  });

  it('n’a qu’un seul point d’écriture, et il porte le garde', () => {
    // Le garde doit vivre DANS l'écriture, pas seulement à l'entrée des
    // effets : « repartir de zéro » le baisse puis recharge, et c'est
    // `pagehide` qui réécrivait le brouillon effacé.
    const flush = wizardSource.slice(
      wizardSource.indexOf('const flushDraft = useCallback'),
      wizardSource.indexOf('const flushRef'),
    );
    expect(flush).not.toHaveLength(0);
    expect(flush).toMatch(/if \(!restoredRef\.current \|\| !sessionReady\) return;/);
    // Et rien n'est écrit tant qu'il n'y a pas de travail.
    expect(flush).toMatch(/if \(!draft\.started && !draft\.generated\) return;/);
  });
});

/**
 * LUT — seule la RÉFÉRENCE est conservée.
 *
 * Le fichier lui-même vit dans le stockage : une `.cube` de 6 Mo transformée
 * en data URL ferait sauter le quota `localStorage`, et l'auto-sauvegarde
 * échouerait ensuite en silence pour TOUT le brouillon, pas seulement pour la
 * LUT.
 */
describe('Brouillon — référence de LUT', () => {
  const LUT = { url: 'https://minio.example/luts/teal.cube', name: 'teal.cube', intensity: 0.6 };

  it('conserve une référence complète', () => {
    const d = sanitizeDraft(valid({ lut: LUT }), DEPS)!;
    expect(d.lut).toEqual(LUT);
  });

  it('ne restaure pas une LUT dont l’URL est un blob:', () => {
    // Elle pointerait vers rien après un rafraîchissement, et le rendu
    // échouerait sur un média fantôme.
    const d = sanitizeDraft(valid({ lut: { ...LUT, url: 'blob:http://x/1' } }), DEPS)!;
    expect(d.lut).toBeUndefined();
  });

  it('ramène une intensité hors plage à la pleine intensité', () => {
    expect(sanitizeDraft(valid({ lut: { ...LUT, intensity: 4 } }), DEPS)!.lut!.intensity).toBe(1);
    expect(sanitizeDraft(valid({ lut: { ...LUT, intensity: -2 } }), DEPS)!.lut!.intensity).toBe(1);
  });

  it('ignore une LUT sans URL', () => {
    expect(sanitizeDraft(valid({ lut: { name: 'x.cube', intensity: 1 } }), DEPS)!.lut).toBeUndefined();
  });

  it('ne conserve jamais de table parsée, même si le brouillon en porte une', () => {
    const d = sanitizeDraft(valid({ lut: { ...LUT, table: [1, 2, 3], size: 33 } }), DEPS)!;
    expect(d.lut).toEqual(LUT);
  });
});
