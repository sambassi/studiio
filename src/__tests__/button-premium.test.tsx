import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Button } from '@/components/ui/Button';

/**
 * Bouton partagé — contrat de style et de props.
 *
 * Deux niveaux :
 *   1. le composant : quelles classes il émet, et surtout que les props
 *      existants continuent de fonctionner (83 appels dans l'app) ;
 *   2. le CSS livré : c'est lui qui porte le style « épuré », donc on le lit
 *      pour vérifier qu'il ne contient ni ombre ni dégradé et qu'il utilise
 *      bien le contour fin et `var(--radius)`.
 *
 * Le rendu visuel lui-même a été mesuré dans un vrai navigateur (hauteurs,
 * graisse, rayon, absence d'ombre) — voir le corps de la PR.
 */

const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf-8');
/** Le bloc des boutons, isolé pour ne pas tester le reste de la feuille. */
const buttonLayer = css.slice(css.indexOf('@layer components'), css.indexOf('.text-gradient'));

describe('Button — rétro-compatibilité des props', () => {
  it('rend la variante primary par défaut', () => {
    render(<Button>Enregistrer</Button>);
    expect(screen.getByRole('button')).toHaveClass('button-primary');
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

  it('les trois tailles donnent trois hauteurs distinctes : 28 / 34 / 40', () => {
    const heights = (['sm', 'md', 'lg'] as const).map((size) => {
      const { unmount } = render(<Button size={size}>x</Button>);
      const cls = screen.getByRole('button').className;
      unmount();
      return /min-h-\[(\d+)px\]/.exec(cls)?.[1];
    });
    expect(heights).toEqual(['28', '34', '40']);
  });

  it("le className de l'appelant est conservé, et placé en DERNIER", () => {
    // L'ordre compte pour la lisibilite du DOM, et les 83 appels existants
    // passent des classes comme `flex-1`, `w-full`, `mr-2`.
    render(<Button className="flex-1 w-full">x</Button>);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('flex-1');
    expect(cls).toContain('w-full');
    expect(cls.trim().endsWith('flex-1 w-full')).toBe(true);
  });

  it('les attributs de <button> passent toujours (disabled, type, aria, onClick)', async () => {
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
      const cls = screen.getByRole('button').className;
      expect(cls, variant).not.toMatch(/font-semibold|font-bold|shadow|gradient/);
      unmount();
    }
  });
});

describe('CSS livré — le style épuré', () => {
  it('aucune ombre ni dégradé sur les boutons', () => {
    expect(buttonLayer).not.toMatch(/shadow-(?!offset)/);
    expect(buttonLayer).not.toMatch(/gradient/);
  });

  it('contour fin de 0.5px et rayon pris sur var(--radius)', () => {
    expect(buttonLayer).toContain('border-[0.5px]');
    expect(buttonLayer).toContain('border-radius: var(--radius)');
    // Le jeton doit exister, sinon le rayon vaut 0.
    expect(css).toMatch(/:root\s*\{[^}]*--radius:/);
  });

  it('graisse 500 et hauteur de 34px sur la base', () => {
    expect(buttonLayer).toContain('font-medium');
    expect(buttonLayer).toContain('min-h-[34px]');
    expect(buttonLayer).not.toContain('font-semibold');
  });

  it('secondary et ghost sont transparents, primary est le seul aplat', () => {
    const rule = (name: string) => {
      const i = buttonLayer.indexOf(`.${name} {`);
      return buttonLayer.slice(i, buttonLayer.indexOf('}', i));
    };
    expect(rule('button-secondary')).toContain('bg-transparent');
    expect(rule('button-ghost')).toContain('bg-transparent');
    expect(rule('button-primary')).toMatch(/bg-studiio-primary/);
    // L'aplat est tenu en dessous de 100 % : c'est ce qui le rend discret.
    expect(rule('button-primary')).toMatch(/bg-studiio-primary\/\[?0?\.\d+\]?/);
  });

  it('les classes vivent dans la couche components, pour que l appelant puisse surcharger', () => {
    // Declarees apres `@tailwind utilities`, elles ecrasaient la couleur
    // demandee par l'appelant (`bg-purple-600`) sans rien dire.
    expect(buttonLayer.startsWith('@layer components')).toBe(true);
  });

  it('un etat focus visible au clavier est prevu', () => {
    expect(buttonLayer).toContain('focus-visible:ring-1');
  });
});
