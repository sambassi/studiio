import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { Button } from '@/components/ui/Button';
import { ETAT_SELECTION } from '@/lib/ui/etats';

/**
 * `<Button>` — états d'interaction et d'action.
 *
 * Complète `button-premium.test.tsx` (géométrie, variantes, cascade CSS) :
 * ici, ce que le bouton DIT de son état — classes de survol/appui/focus,
 * `aria-busy`, icônes de forme, retour au repos après un succès, et la règle
 * « une action n'est jamais rendue comme une option sélectionnée ».
 */

afterEach(() => vi.useRealTimers());

const SELECTION_TOKENS = ETAT_SELECTION.split(/\s+/);

describe('interaction', () => {
  it('porte survol, appui et focus clavier sans écraser la couleur de la variante', () => {
    render(<Button variant="secondary">x</Button>);
    const cls = screen.getByRole('button').className;
    expect(cls).toContain('hover:-translate-y-px');
    expect(cls).toContain('active:scale-[0.98]');
    expect(cls).toContain('focus-visible:ring-2');
    expect(cls).toContain('focus-visible:ring-purple-400');
    // Les fonds restent dans `.button-secondary` (couche components).
    expect(cls).not.toMatch(/\bhover:bg-/);
    expect(cls).toContain('button-secondary');
  });

  it('au repos par défaut : data-etat=repos, ni aria-busy ni aria-pressed ni icône', () => {
    render(<Button>x</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('data-etat', 'repos');
    expect(btn).not.toHaveAttribute('aria-busy');
    expect(btn).not.toHaveAttribute('aria-pressed');
    expect(btn.querySelector('[data-etat-icone]')).toBeNull();
  });
});

describe('chargement', () => {
  it('aria-busy, spinner, libellé lu, et le clic est ignoré', () => {
    const onClick = vi.fn();
    render(<Button etat="chargement" onClick={onClick}>Exporter</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-busy', 'true');
    expect(btn).toHaveAttribute('data-etat', 'chargement');
    expect(btn.querySelector('[data-etat-icone="chargement"]')).toHaveClass('animate-spin');
    expect(btn).toHaveTextContent('Chargement…');
    // Pas `disabled` : le bouton garde le focus et son apparence active.
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('succès', () => {
  it('affiche la coche puis revient seul au repos et prévient le parent', () => {
    vi.useFakeTimers();
    const onEtatFin = vi.fn();
    render(<Button etat="succes" onEtatFin={onEtatFin}>Enregistrer</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('data-etat', 'succes');
    expect(btn.querySelector('[data-etat-icone="succes"]')).not.toBeNull();
    expect(btn).toHaveTextContent('Fait');
    expect(onEtatFin).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1499); });
    expect(btn).toHaveAttribute('data-etat', 'succes');

    act(() => { vi.advanceTimersByTime(1); });
    expect(btn).toHaveAttribute('data-etat', 'repos');
    expect(btn.querySelector('[data-etat-icone]')).toBeNull();
    expect(onEtatFin).toHaveBeenCalledTimes(1);
  });

  it('respecte une durée personnalisée', () => {
    vi.useFakeTimers();
    render(<Button etat="succes" dureeSucces={300}>x</Button>);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByRole('button')).toHaveAttribute('data-etat', 'repos');
  });
});

describe('erreur', () => {
  it('bordure rouge + triangle, sans aucune classe de sélection', () => {
    render(<Button etat="erreur" variant="secondary">Retouche IA</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('data-etat', 'erreur');
    expect(btn.className).toMatch(/border-red-500/);
    expect(btn.querySelector('[data-etat-icone="erreur"]')).not.toBeNull();
    expect(btn).toHaveTextContent('Échec');
    expect(btn).not.toHaveAttribute('aria-pressed');
    expect(btn).not.toHaveAttribute('data-selected');
    for (const t of SELECTION_TOKENS) expect(btn.className).not.toContain(t);
  });
});

describe('aucun état d’action ne ressemble à une sélection', () => {
  it.each(['repos', 'chargement', 'succes', 'erreur'] as const)('%s', (etat) => {
    render(<Button etat={etat}>x</Button>);
    const btn = screen.getByRole('button');
    expect(btn).not.toHaveAttribute('aria-pressed');
    expect(btn.className).not.toContain('ring-purple-500');
  });
});

describe('bascule (pressed)', () => {
  it('pressed=true : aria-pressed, style sélectionné ET coche', () => {
    render(<Button variant="ghost" pressed>Muet</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toHaveAttribute('data-selected', 'true');
    for (const t of SELECTION_TOKENS) expect(btn.className).toContain(t);
    expect(btn.querySelector('[data-etat-icone="selection"]')).not.toBeNull();
  });

  it('pressed=false : aria-pressed=false, sans style sélectionné', () => {
    render(<Button variant="ghost" pressed={false}>Muet</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn.className).not.toContain('ring-purple-500');
    expect(btn.querySelector('[data-etat-icone]')).toBeNull();
  });
});
