import { describe, it, expect } from 'vitest';
import {
  ETAT_INTERACTIF,
  ETAT_INTERACTIF_SANS_FOND,
  ETAT_SELECTION,
  classesAction,
  classesOnglet,
  classesOption,
} from '@/lib/ui/etats';

/**
 * Module pur des états d'interaction.
 *
 * Deux garanties : chaque composition rend visibles survol, appui et focus
 * clavier ; une ACTION ponctuelle ne prend jamais le style « sélectionné ».
 * Le dernier bloc mesure les contrastes des couleurs choisies — les valeurs
 * hex sont celles de la palette Tailwind 3 et de `tailwind.config.ts`.
 */

const SELECTION_TOKENS = ETAT_SELECTION.split(/\s+/);

describe('compositions interactives', () => {
  it.each([
    ['ETAT_INTERACTIF', ETAT_INTERACTIF],
    ['ETAT_INTERACTIF_SANS_FOND', ETAT_INTERACTIF_SANS_FOND],
  ])('%s porte survol, appui, focus clavier et désactivé', (_n, cls) => {
    expect(cls).toMatch(/\bhover:/);
    expect(cls).toMatch(/\bactive:scale-\[0\.98\]/);
    expect(cls).toContain('focus-visible:outline-none');
    expect(cls).toContain('focus-visible:ring-2');
    expect(cls).toContain('focus-visible:ring-purple-400');
    expect(cls).toContain('focus-visible:ring-offset-2');
    expect(cls).toContain('disabled:opacity-50');
    expect(cls).toContain('disabled:cursor-not-allowed');
    // Pas de `pointer-events-none` : il retirerait le curseur interdit.
    expect(cls).not.toContain('pointer-events-none');
  });

  it('la composition complète colore le survol en violet, la variante sans fond non', () => {
    expect(ETAT_INTERACTIF).toContain('hover:bg-purple-500/10');
    expect(ETAT_INTERACTIF).toContain('hover:border-purple-500/40');
    expect(ETAT_INTERACTIF_SANS_FOND).not.toMatch(/hover:bg-/);
    expect(ETAT_INTERACTIF_SANS_FOND).not.toMatch(/active:bg-/);
  });
});

describe('sélection persistante', () => {
  it('ETAT_SELECTION = fond violet doux + anneau + texte blanc', () => {
    expect(ETAT_SELECTION).toContain('bg-purple-600/20');
    expect(ETAT_SELECTION).toContain('text-white');
    expect(ETAT_SELECTION).toContain('ring-1');
    expect(ETAT_SELECTION).toContain('ring-purple-500');
  });

  it.each([
    ['classesOption', classesOption],
    ['classesOnglet', classesOnglet],
  ])('%s : sélectionné porte ETAT_SELECTION, non sélectionné non — et les deux restent interactifs', (_n, fn) => {
    const oui = fn(true);
    const non = fn(false);
    for (const t of SELECTION_TOKENS) expect(oui).toContain(t);
    expect(non).not.toContain('ring-purple-500');
    expect(non).not.toContain('bg-purple-600/20');
    for (const cls of [oui, non]) {
      expect(cls).toMatch(/\bhover:/);
      expect(cls).toMatch(/\bactive:/);
      expect(cls).toContain('focus-visible:ring-2');
    }
    // Le survol d'un élément sélectionné DENSIFIE le violet au lieu de
    // retomber au fond de survol neutre (/10 < /20 l'aurait éclairci).
    expect(oui).not.toContain('hover:bg-purple-500/10');
    expect(oui).toContain('hover:bg-purple-600/30');
  });
});

describe('action ponctuelle', () => {
  it.each(['repos', 'chargement', 'succes', 'erreur'] as const)(
    "l'état %s ne reçoit jamais ETAT_SELECTION",
    (etat) => {
      const cls = classesAction(etat);
      expect(cls).not.toContain('ring-purple-500');
      expect(cls).not.toContain('bg-purple-600/20');
      expect(cls).not.toContain('aria-pressed');
    },
  );

  it('succès et erreur se distinguent par la bordure, chargement par le curseur', () => {
    expect(classesAction('succes')).toMatch(/border-emerald/);
    expect(classesAction('erreur')).toMatch(/border-red/);
    expect(classesAction('chargement')).toContain('cursor-progress');
    expect(classesAction('repos')).toBe('');
  });
});

/* ── Contrastes ─────────────────────────────────────────────────────────── */

const FOND = '#0A0A0F';
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const blend = (fg: string, alpha: number, bg: string) =>
  hex(fg).map((c, i) => Math.round(c * alpha + hex(bg)[i] * (1 - alpha)));
const lum = ([r, g, b]: number[]) => {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const contraste = (a: number[], b: number[]) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

describe('contrastes des couleurs retenues (WCAG AA ≥ 4,5:1)', () => {
  it('texte blanc sur la sélection (purple-600 #9333EA à 20 % sur #0A0A0F)', () => {
    expect(contraste(hex('#FFFFFF'), blend('#9333EA', 0.2, FOND))).toBeGreaterThanOrEqual(4.5);
  });
  it('texte blanc sur button-primary (#7C3AED à 82 % sur #0A0A0F)', () => {
    expect(contraste(hex('#FFFFFF'), blend('#7C3AED', 0.82, FOND))).toBeGreaterThanOrEqual(4.5);
  });
  it('texte blanc sur button-primary enfoncé (#7C3AED à 100 %)', () => {
    expect(contraste(hex('#FFFFFF'), hex('#7C3AED'))).toBeGreaterThanOrEqual(4.5);
  });
  it('texte gray-400 (#9CA3AF) non sélectionné sur gray-800/60', () => {
    expect(contraste(hex('#9CA3AF'), blend('#1F2937', 0.6, FOND))).toBeGreaterThanOrEqual(4.5);
  });
  it("anneau de focus purple-400 (#C084FC) contre le fond de page (≥ 3:1, composant d'interface)", () => {
    expect(contraste(hex('#C084FC'), hex(FOND))).toBeGreaterThanOrEqual(3);
  });
  it('texte des états succès (emerald-200) et erreur (red-200) sur fond de page', () => {
    expect(contraste(hex('#A7F3D0'), hex(FOND))).toBeGreaterThanOrEqual(4.5);
    expect(contraste(hex('#FECACA'), hex(FOND))).toBeGreaterThanOrEqual(4.5);
  });
});

/* ── Purge Tailwind ─────────────────────────────────────────────────────── */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

describe('les classes du module survivent à la purge de production', () => {
  const moduleSource = readFileSync(resolve(__dirname, '../lib/ui/etats.ts'), 'utf-8');

  it('tailwind.config.ts scanne src/lib/ui (le module est hors components/)', () => {
    const config = readFileSync(resolve(__dirname, '../../tailwind.config.ts'), 'utf-8');
    expect(config).toContain("'./src/lib/ui/**/*.ts'");
  });

  it("l'extracteur Tailwind retrouve les classes dans la source du module", async () => {
    const out = (
      await postcss([
        tailwindcss({
          content: [{ raw: moduleSource, extension: 'ts' }],
          theme: { extend: { colors: { studiio: { dark: '#0A0A0F' } } } },
        }),
      ]).process('@tailwind utilities;', { from: undefined })
    ).css;
    for (const sel of [
      '.hover\\:bg-purple-500\\/10:hover',
      '.hover\\:-translate-y-px:hover',
      '.active\\:scale-\\[0\\.98\\]:active',
      '.focus-visible\\:ring-purple-400:focus-visible',
      '.focus-visible\\:ring-offset-studiio-dark:focus-visible',
      '.disabled\\:hover\\:translate-y-0:hover:disabled',
      '.bg-purple-600\\/20',
      '.ring-purple-500',
    ]) {
      expect(out, sel).toContain(sel);
    }
  });
});
