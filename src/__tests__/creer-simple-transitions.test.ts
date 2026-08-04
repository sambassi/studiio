import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  TRANSITION_KEYS,
  TRANSITION_LABELS,
  DEFAULT_TRANSITION,
  drawTransition,
} from '@/lib/video-composer';
import { sanitizeDraft, DRAFT_VERSION, type SanitizeDeps } from '@/lib/creer/draft';

/**
 * Transitions entre séquences — Mode simple.
 *
 * Un fait décide de tout le reste : **le compositeur applique déjà un fondu
 * enchaîné** à tout montage qui ne demande rien. `drawTransition` y retombe
 * pour `'crossfade'`, pour un style inconnu, et quand les calques manquent.
 *
 * Deux conséquences :
 *
 * 1. Le défaut default-safe est **`crossfade`**, pas « aucune ». Prendre
 *    « aucune » changerait le rendu de tous les montages existants.
 * 2. Il n'existe **pas** de valeur « aucune » dans `TransitionStyle`, et
 *    aucun chemin de coupe franche dans `drawTransition`. Une entrée
 *    « Aucune » au menu retomberait en silence sur le fondu — un réglage qui
 *    ment. Elle n'est donc pas proposée.
 */

const wizard = readFileSync(
  resolve(__dirname, '../app/dashboard/creer-simple/AssistantWizard.tsx'),
  'utf-8',
);
const composer = readFileSync(resolve(__dirname, '../lib/video-composer.ts'), 'utf-8');

describe('Le fait qui commande le défaut', () => {
  it('le compositeur retombe sur le fondu quand rien n est demandé', () => {
    expect(DEFAULT_TRANSITION).toBe('crossfade');
    expect(composer).toContain(
      "if (style === 'crossfade' || !TRANSITION_STYLES.includes(style) || !scratch) {",
    );
  });

  it('« aucune » n existe pas dans les styles du compositeur', () => {
    expect(TRANSITION_KEYS).not.toContain('none' as never);
    expect(TRANSITION_KEYS).not.toContain('aucune' as never);
  });

  it('un style inconnu ne coupe pas : il fond', () => {
    // C'est ce qui rend une entrée « Aucune » impossible à honorer sans
    // toucher au compositeur.
    const appels: string[] = [];
    const ctx = { globalAlpha: 1 } as unknown as CanvasRenderingContext2D;
    drawTransition(
      ctx, 100, 100,
      () => appels.push('A'),
      () => appels.push('B'),
      0.5,
      'none' as never,
      null,
    );
    expect(appels).toEqual(['A', 'B']);
  });

  it('le Mode simple prend donc le fondu par défaut', () => {
    expect(wizard).toContain(
      'const [transition, setTransition] = useState<TransitionStyle>(DEFAULT_TRANSITION);',
    );
  });
});

describe('La liste vient du compositeur, jamais d une copie', () => {
  it('les clés et les libellés sont importés', () => {
    expect(wizard).toContain('TRANSITION_KEYS, TRANSITION_LABELS, DEFAULT_TRANSITION, type TransitionStyle,');
    expect(wizard).toContain("} from '@/lib/video-composer';");
  });

  it('le menu boucle sur la liste importée', () => {
    // Recopiée, elle proposerait un jour un style que le compositeur ne sait
    // plus jouer — ou tairait ceux qu'il a gagnés.
    expect(wizard).toContain('{TRANSITION_KEYS.map((style) => {');
    expect(wizard).toContain('{TRANSITION_LABELS[style]}');
  });

  it('aucun libellé de transition n est écrit en dur dans l écran', () => {
    for (const label of Object.values(TRANSITION_LABELS)) {
      expect(wizard.includes(`>${label}<`), label).toBe(false);
    }
  });

  it('chaque style a sa phrase d explication', () => {
    // Le `Record` est exhaustif : ajouter un style au compositeur sans
    // l'expliquer ici casse la compilation plutôt que d'afficher un vide.
    expect(wizard).toContain('const TRANSITION_HINTS: Record<TransitionStyle, string> = {');
    for (const key of TRANSITION_KEYS) {
      expect(wizard.includes(`'${key}':`), key).toBe(true);
    }
  });

  it('les neuf styles sont proposés', () => {
    expect(TRANSITION_KEYS).toHaveLength(9);
    expect(TRANSITION_KEYS[0]).toBe(DEFAULT_TRANSITION);
  });
});

describe('L export', () => {
  it('le style part au compositeur', () => {
    const appel = wizard.slice(wizard.indexOf('const composed = await composeAndUpload({'));
    expect(appel.slice(0, 3000)).toContain('transition,');
  });

  it('l option porte bien ce nom côté compositeur', () => {
    expect(composer).toContain('transition?: TransitionStyle;');
  });

  it('elle prime sur le réglage rangé dans le design', () => {
    // `resolveTransitionStyle(seqType, perSequence, global, fromDesign)` —
    // l'ordre des arguments est la priorité.
    expect(composer).toContain('const candidate = perSeqValue ?? global ?? fromDesign;');
  });
});

describe('Le menu', () => {
  it('il a sa propre section, repliable comme les autres', () => {
    expect(wizard).toContain("type SectionId = 'format' | 'couleurs' | 'affiche' | 'texte' | 'sequences' | 'transition';");
    expect(wizard).toContain('id="transition"');
    expect(wizard).toContain('hint={TRANSITION_LABELS[transition]}');
  });

  it('le style retenu est annoncé aux lecteurs d écran', () => {
    expect(wizard).toContain('aria-pressed={choisi}');
  });

  it('la phrase affichée suit le style choisi', () => {
    expect(wizard).toContain('{TRANSITION_HINTS[transition]}');
  });

  it('des boutons, pas un menu déroulant natif', () => {
    expect(wizard).toContain('data-transition={style}');
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
  it('un brouillon sans transition se relit comme avant', () => {
    expect(lire({}).transition).toBeUndefined();
  });

  it('relit chacun des styles du compositeur', () => {
    for (const key of TRANSITION_KEYS) {
      expect(lire({ transition: key }).transition, key).toBe(key);
    }
  });

  it('écarte un style que le compositeur ne connaît pas', () => {
    // Validé contre SA liste, jamais contre une copie : un style retiré
    // là-bas doit cesser d'être relu ici.
    for (const v of ['none', 'fondu', '', 42, null, {}, []]) {
      expect(lire({ transition: v }).transition, JSON.stringify(v)).toBeUndefined();
    }
  });

  it('le brouillon écrit et relit bien le champ', () => {
    expect(wizard).toContain('if (draft.transition) setTransition(draft.transition as TransitionStyle);');
    const sauvegarde = wizard.slice(wizard.indexOf('    transition,\n    introDuration,'));
    expect(sauvegarde.slice(0, 40)).toContain('transition,');
  });

  it('un nouveau montage repart sur le fondu', () => {
    const debut = wizard.indexOf('const reset = ()');
    const reset = wizard.slice(debut, wizard.indexOf('\n  };', debut));
    expect(reset).toContain('setTransition(DEFAULT_TRANSITION);');
  });
});
