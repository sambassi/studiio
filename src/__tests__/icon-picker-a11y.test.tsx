import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import IconPicker from '@/components/creer/IconPicker';

/**
 * Accessibilité de `IconPicker` : bouton d'ouverture annoncé (aria-expanded /
 * aria-controls), fermeture par Échap, info-bulles en français.
 *
 * Le mode repliable est OPT-IN (`repliable`) : les deux appelants actuels
 * (assistant, Autopilote) gèrent eux-mêmes l'ouverture et doivent voir la
 * grille exactement comme avant.
 */

afterEach(() => cleanup());

const ouvreur = () => document.querySelector('[data-icon-picker-toggle]') as HTMLButtonElement;
const grille = () => document.querySelector('[data-icon-picker-grid]') as HTMLElement | null;

describe('IconPicker — bouton d’ouverture (mode repliable)', () => {
  it('le bouton porte aria-expanded=false et aria-controls vers la grille, fermée au départ', () => {
    render(<IconPicker repliable onPick={() => {}} />);
    const b = ouvreur();
    expect(b).not.toBeNull();
    expect(b.getAttribute('aria-expanded')).toBe('false');
    const id = b.getAttribute('aria-controls');
    expect(id).toBeTruthy();
    expect(grille()).toBeNull();
  });

  it('ouvrir la grille passe aria-expanded à true, et aria-controls pointe sur son id', () => {
    render(<IconPicker repliable onPick={() => {}} />);
    fireEvent.click(ouvreur());
    expect(ouvreur().getAttribute('aria-expanded')).toBe('true');
    const g = grille();
    expect(g).not.toBeNull();
    expect(g!.id).toBe(ouvreur().getAttribute('aria-controls'));
  });

  it('Échap dans la grille la ferme et rend le focus au bouton', () => {
    render(<IconPicker repliable onPick={() => {}} />);
    fireEvent.click(ouvreur());
    const recherche = document.querySelector('[data-icon-search]') as HTMLInputElement;
    recherche.focus();
    fireEvent.keyDown(recherche, { key: 'Escape' });
    expect(grille()).toBeNull();
    expect(ouvreur().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(ouvreur());
  });

  it('Échap depuis une icône de la grille la ferme aussi', () => {
    render(<IconPicker repliable onPick={() => {}} />);
    fireEvent.click(ouvreur());
    const icone = document.querySelector('[data-element-pick="Dumbbell"]') as HTMLButtonElement;
    fireEvent.keyDown(icone, { key: 'Escape' });
    expect(grille()).toBeNull();
  });

  it('une autre touche ne ferme pas la grille', () => {
    render(<IconPicker repliable onPick={() => {}} />);
    fireEvent.click(ouvreur());
    fireEvent.keyDown(document.querySelector('[data-icon-search]')!, { key: 'Enter' });
    expect(grille()).not.toBeNull();
  });

  it('choisir une icône appelle onPick', () => {
    const onPick = vi.fn();
    render(<IconPicker repliable onPick={onPick} />);
    fireEvent.click(ouvreur());
    fireEvent.click(document.querySelector('[data-element-pick="Heart"]')!);
    expect(onPick).toHaveBeenCalledWith('Heart');
  });

  it('le bouton d’ouverture a une info-bulle et un libellé en français', () => {
    render(<IconPicker repliable onPick={() => {}} />);
    expect(ouvreur().getAttribute('title')).toBe('Afficher les icônes');
    fireEvent.click(ouvreur());
    expect(ouvreur().getAttribute('title')).toBe('Masquer les icônes (Échap)');
  });
});

describe('IconPicker — mode par défaut inchangé', () => {
  it('sans `repliable`, la grille est affichée d’emblée et aucun bouton d’ouverture n’apparaît', () => {
    render(<IconPicker onPick={() => {}} />);
    expect(ouvreur()).toBeNull();
    expect(grille()).not.toBeNull();
    expect(document.querySelector('[data-element-pick="Dumbbell"]')).not.toBeNull();
  });

  it('sans `repliable`, Échap ne masque pas la grille (l’appelant gère son panneau)', () => {
    render(<IconPicker onPick={() => {}} />);
    fireEvent.keyDown(document.querySelector('[data-icon-search]')!, { key: 'Escape' });
    expect(grille()).not.toBeNull();
  });
});

describe('IconPicker — info-bulles en français', () => {
  it('une icône avec synonyme français l’affiche dans son info-bulle et son libellé', () => {
    render(<IconPicker onPick={() => {}} />);
    const b = document.querySelector('[data-element-pick="Dumbbell"]') as HTMLButtonElement;
    expect(b.getAttribute('title')).toBe('Choisir l’icône « haltère »');
    expect(b.getAttribute('aria-label')).toBe('Choisir l’icône « haltère »');
  });

  it('une icône sans synonyme garde son nom, précédé d’une consigne en français', () => {
    render(<IconPicker onPick={() => {}} />);
    const b = document.querySelector('[data-element-pick="Bike"]') as HTMLButtonElement;
    expect(b.getAttribute('title')).toBe('Choisir l’icône « Bike »');
  });

  it('plus aucune info-bulle ne se réduit au nom lucide anglais brut', () => {
    render(<IconPicker onPick={() => {}} />);
    const icones = Array.from(document.querySelectorAll('[data-element-pick]'));
    expect(icones.length).toBeGreaterThan(0);
    for (const el of icones) {
      expect(el.getAttribute('title')).toMatch(/^Choisir l’icône « .+ »$/);
    }
  });

  it('le champ de recherche a un libellé accessible en français', () => {
    render(<IconPicker onPick={() => {}} />);
    const recherche = document.querySelector('[data-icon-search]') as HTMLInputElement;
    expect(recherche.getAttribute('aria-label')).toBe('Rechercher une icône');
    expect(recherche.getAttribute('title')).toBe('Rechercher une icône (nom ou mot-clé en français)');
  });

  it('l’icône retenue reste annoncée par aria-pressed', () => {
    render(<IconPicker onPick={() => {}} selected="Heart" />);
    expect(document.querySelector('[data-element-pick="Heart"]')!.getAttribute('aria-pressed')).toBe('true');
  });
});
