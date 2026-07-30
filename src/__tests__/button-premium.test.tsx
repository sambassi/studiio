import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { Button } from '@/components/ui/Button';

/**
 * Bouton partagé — contrat de style et de props.
 *
 * Trois niveaux, du plus faible au plus fort :
 *   1. le composant : les props existants (83 appels dans l'app) ;
 *   2. la règle CSS source, extraite par comptage d'accolades — pas par
 *      `indexOf` sur un nom de classe voisin, qui cassait dès qu'on renommait
 *      `.text-gradient` et rendait les assertions négatives vides ;
 *   3. **le CSS compilé par Tailwind** : c'est le seul niveau qui prouve la
 *      raison d'être de la PR (un utilitaire de l'appelant doit gagner sur
 *      `.button-*`) et les valeurs réellement livrées.
 *
 * Le rendu visuel a par ailleurs été mesuré dans un vrai navigateur —
 * hauteurs, graisse, rayon, absence d'ombre. Voir le corps de la PR.
 */

const cssPath = resolve(__dirname, '../app/globals.css');
const css = readFileSync(cssPath, 'utf-8');

/** Corps d'une règle `.nom { … }`, accolades équilibrées, tolérant au formatage. */
function rule(name: string): string {
  const m = new RegExp(`\\.${name}\\s*\\{`).exec(css);
  if (!m) return '';
  let depth = 0;
  for (let i = m.index + m[0].length - 1; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(m.index, i + 1);
    }
  }
  return '';
}

const BUTTON_RULES = ['button-base', 'button-primary', 'button-secondary', 'button-ghost', 'button-accent'];

describe('Button — rétro-compatibilité des props', () => {
  it('rend la variante primary et la taille md par défaut', () => {
    render(<Button>Enregistrer</Button>);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('button-primary');
    // Le défaut de `size` compte autant que les trois valeurs explicites.
    expect(cls).toContain('min-h-[34px]');
  });

  it('chaque variante garde sa classe dédiée', () => {
    const cases = [
      ['primary', 'button-primary'],
      ['secondary', 'button-secondary'],
      ['ghost', 'button-ghost'],
      ['accent', 'button-accent'],
    ] as const;
    for (const [variant, expected] of cases) {
      const { unmount } = render(<Button variant={variant}>x</Button>);
      expect(screen.getByRole('button'), variant).toHaveClass(expected);
      unmount();
    }
  });

  it('les trois tailles donnent 28 / 34 / 40, sans padding vertical surajouté', () => {
    const geo = (['sm', 'md', 'lg'] as const).map((size) => {
      const { unmount } = render(<Button size={size}>x</Button>);
      const cls = screen.getByRole('button').className;
      unmount();
      return {
        h: /min-h-\[(\d+)px\]/.exec(cls)?.[1],
        // Un `py-*` dans la classe de taille ferait grandir le bouton
        // au-delà de la hauteur annoncée.
        py: /\bpy-\d/.test(cls),
        // `text-sm` réintroduit un line-height et casse `leading-none`.
        arbitraryText: /text-\[\d+px\]/.test(cls),
      };
    });
    expect(geo.map((g) => g.h)).toEqual(['28', '34', '40']);
    expect(geo.map((g) => g.py)).toEqual([false, false, false]);
    expect(geo.map((g) => g.arbitraryText)).toEqual([true, true, true]);
  });

  it("le className de l'appelant est conservé, et placé en DERNIER", () => {
    render(<Button className="flex-1 w-full">x</Button>);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('flex-1');
    expect(cls.trim().endsWith('flex-1 w-full')).toBe(true);
  });

  it('les attributs de <button> passent toujours (disabled, type, aria, onClick)', () => {
    const onClick = vi.fn();
    render(
      <Button type="submit" disabled aria-label="Envoyer le formulaire" onClick={onClick}>
        Envoyer
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('type', 'submit');
    expect(btn).toHaveAttribute('aria-label', 'Envoyer le formulaire');
    btn.click();
    expect(onClick).not.toHaveBeenCalled();
  });

  it('accepte une icône à côté du libellé', () => {
    render(
      <Button variant="secondary">
        <svg data-testid="icone" />
        Continuer
      </Button>,
    );
    expect(screen.getByTestId('icone')).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveTextContent('Continuer');
  });

  it("n'emet plus aucun style lourd depuis le composant", () => {
    for (const variant of ['primary', 'secondary', 'ghost', 'accent'] as const) {
      const { unmount } = render(<Button variant={variant}>x</Button>);
      expect(screen.getByRole('button').className, variant).not.toMatch(/font-semibold|font-bold|shadow|gradient/);
      unmount();
    }
  });
});

describe('CSS source — la règle de base', () => {
  it('les cinq règles existent et ne sont pas vides', () => {
    // Garde-fou : sans lui, toutes les assertions NÉGATIVES ci-dessous
    // passeraient à vide si l'extraction échouait.
    for (const name of BUTTON_RULES) {
      expect(rule(name).length, name).toBeGreaterThan(40);
    }
  });

  it('la base porte le dessin épuré, et rien de lourd', () => {
    const base = rule('button-base');
    expect(base).toContain('min-h-[34px]');
    expect(base).toContain('font-medium');
    expect(base).toContain('leading-none');
    expect(base).toContain('items-center');
    expect(base).toContain('justify-center');
    expect(base).toContain('whitespace-nowrap');
    expect(base).toContain('border-radius: var(--radius)');
    expect(base).not.toContain('font-semibold');
    expect(base).not.toMatch(/shadow-(?!offset)/);
    expect(base).not.toMatch(/gradient/);
    // Une hauteur FIXE rognerait les appelants qui ajoutent du padding.
    // (le `(?<!min-)` evite de matcher `min-h-[34px]`)
    expect(base).not.toMatch(/(?<!min-)h-\[\d/);
  });

  it("la base n'introduit pas de `gap` : les appelants espacent déjà avec mr-2", () => {
    // 23 appels passent `mr-2` sur leur icône. Un `gap` s'y ajouterait au
    // lieu de fusionner, doublant l'écart sur tous les boutons à icône.
    expect(rule('button-base')).not.toMatch(/\bgap-/);
  });

  it('un état désactivé lisible, sans neutraliser le curseur', () => {
    const base = rule('button-base');
    const opacity = /disabled:opacity-(\d+)/.exec(base)?.[1];
    expect(Number(opacity)).toBeGreaterThanOrEqual(40);
    // `pointer-events-none` retire l'élément du hit-testing : le
    // `disabled:cursor-not-allowed` de six appelants ne s'appliquerait plus.
    expect(base).not.toContain('pointer-events-none');
    expect(base).toContain('disabled:cursor-not-allowed');
  });

  it('un focus clavier de 2 px, en couleur pleine', () => {
    const base = rule('button-base');
    expect(base).toContain('focus-visible:ring-2');
    // Un anneau translucide tombait à 2,2:1 contre le fond.
    expect(base).toMatch(/focus-visible:ring-studiio-primary(?!\/)/);
  });

  it('chaque variante porte son propre contour fin', () => {
    for (const name of ['button-primary', 'button-secondary', 'button-ghost', 'button-accent']) {
      expect(rule(name), name).toContain('border-[0.5px]');
    }
  });

  it('secondary et ghost sont transparents, primary et accent sont des aplats tenus', () => {
    expect(rule('button-secondary')).toContain('bg-transparent');
    expect(rule('button-ghost')).toContain('bg-transparent');
    // L'opacité < 1 est ce qui rend l'aplat discret ET, pour l'accent, ce qui
    // fait passer le texte blanc au-dessus du seuil AA.
    expect(rule('button-primary')).toMatch(/bg-studiio-primary\/\[0\.\d+\]/);
    expect(rule('button-accent')).toMatch(/bg-studiio-accent\/\[0\.\d+\]/);
  });

  it('les contours de secondary et ghost restent perceptibles', () => {
    // En dessous de 18 % de blanc sur le fond sombre, le contour passe sous
    // celui d'origine (`border-gray-700`) et le bouton cesse de se lire
    // comme un contrôle.
    const alpha = (name: string) => Number(/border-white\/\[0\.(\d+)\]/.exec(rule(name))?.[1] ?? '0') / 100;
    expect(alpha('button-secondary')).toBeGreaterThanOrEqual(0.18);
    expect(alpha('button-ghost')).toBeGreaterThanOrEqual(0.18);
    // Et la hiérarchie est respectée : secondary plus marqué que ghost.
    expect(alpha('button-secondary')).toBeGreaterThan(alpha('button-ghost'));
  });
});

describe('CSS compilé — ce que le navigateur reçoit vraiment', () => {
  /**
   * Compile la feuille avec une sonde contenant les utilitaires que les
   * appelants passent réellement. C'est la seule façon de prouver l'ordre de
   * cascade — le reste ne fait que lire du texte source.
   */
  async function compile() {
    const probe = 'bg-purple-600 text-red-400 px-6 py-3 rounded-none block w-full flex-1';
    const result = await postcss([
      tailwindcss({
        content: [{ raw: `<button class="button-primary button-secondary ${probe}"></button>`, extension: 'html' }],
        theme: {
          extend: {
            colors: {
              'studiio-primary': '#7C3AED',
              'studiio-accent': '#EC4899',
              'studiio-dark': '#0A0A0F',
            },
          },
        },
      }),
    ]).process(css, { from: cssPath });
    return result.css;
  }

  it("un utilitaire de l'appelant gagne sur .button-* (c'est l'objet de la PR)", async () => {
    const out = await compile();
    const iPrimary = out.lastIndexOf('.button-primary');
    // Couleur, padding et rayon : les trois familles que des appelants passent.
    for (const util of ['.bg-purple-600', '.text-red-400', '.px-6', '.rounded-none']) {
      expect(out.indexOf(util), util).toBeGreaterThan(iPrimary);
    }
  });

  it('livre bien 34 px, graisse 500, rayon 10 px, contour 0,5 px, aucune ombre', async () => {
    const out = await compile();
    // Uniquement les règles `.button-*` : découper « du premier bouton à la
    // fin du fichier » ramassait `.gradient-primary` et `.text-gradient`,
    // et faisait échouer l'assertion « aucun dégradé » pour rien.
    const compiled = (out.match(/\.button-[a-z-]+\s*(?::[a-z-]+\s*)?\{[^}]*\}/g) ?? []).join('\n');
    expect(compiled.length, 'aucune regle .button-* compilee').toBeGreaterThan(200);
    expect(compiled).toMatch(/min-height:\s*34px/);
    expect(compiled).toMatch(/font-weight:\s*500/);
    expect(compiled).toMatch(/border-width:\s*0?\.5px/);
    // Le jeton doit valoir un vrai rayon, pas 0 : `--radius: 0` passait
    // l'ancienne assertion, qui ne vérifiait que la déclaration.
    expect(out).toMatch(/--radius:\s*(?!0[^.\d])\d/);
    // Aucune ombre décorative : les seules `box-shadow` admises sont celles
    // que Tailwind utilise pour composer l'anneau de focus.
    const shadows = compiled.match(/box-shadow:[^;}]+/g) ?? [];
    for (const decl of shadows) {
      expect(decl, 'ombre decorative').toMatch(/var\(--tw-ring-|none/);
    }
    expect(compiled).not.toMatch(/linear-gradient/);
  });
});
