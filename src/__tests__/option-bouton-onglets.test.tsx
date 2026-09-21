import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { OptionBouton } from '@/components/ui/OptionBouton';
import { Onglets } from '@/components/ui/Onglets';
import { ETAT_SELECTION } from '@/lib/ui/etats';

/**
 * Option sélectionnable et onglets : la sélection est PERSISTANTE et lisible
 * par trois canaux (couleur, forme, ARIA). Navigation clavier des onglets.
 */

const SELECTION_TOKENS = ETAT_SELECTION.split(/\s+/);

describe('OptionBouton', () => {
  it('sélectionnée : aria-pressed, style sélectionné, coche visible', () => {
    render(<OptionBouton selected>Fondu</OptionBouton>);
    const btn = screen.getByRole('button', { name: 'Fondu' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(btn).toHaveAttribute('data-selected', 'true');
    for (const t of SELECTION_TOKENS) expect(btn.className).toContain(t);
    expect(btn.querySelector('[data-coche="visible"]')).toHaveClass('opacity-100');
  });

  it('non sélectionnée : aria-pressed=false, coche réservée mais invisible, survol/focus présents', () => {
    render(<OptionBouton selected={false}>Fondu</OptionBouton>);
    const btn = screen.getByRole('button', { name: 'Fondu' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn.className).not.toContain('ring-purple-500');
    expect(btn.querySelector('[data-coche="reservee"]')).toHaveClass('opacity-0');
    expect(btn.className).toMatch(/\bhover:bg-purple-500\/10/);
    expect(btn.className).toContain('focus-visible:ring-2');
    expect(btn.className).toContain('active:scale-[0.98]');
  });

  it('la sélection persiste après le clic (pas un état passager)', () => {
    function Groupe() {
      const [choix, setChoix] = useState('a');
      return (
        <>
          <OptionBouton selected={choix === 'a'} onSelect={() => setChoix('a')}>A</OptionBouton>
          <OptionBouton selected={choix === 'b'} onSelect={() => setChoix('b')}>B</OptionBouton>
        </>
      );
    }
    render(<Groupe />);
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('aria-pressed', 'false');
    // Un survol/blur ne change rien : l'état ne dépend pas du pointeur.
    fireEvent.mouseLeave(screen.getByRole('button', { name: 'B' }));
    fireEvent.blur(screen.getByRole('button', { name: 'B' }));
    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('type=button, className de l’appelant conservé en dernier, onClick ordinaire honoré', () => {
    const onClick = vi.fn();
    const onSelect = vi.fn();
    render(<OptionBouton selected={false} onClick={onClick} onSelect={onSelect} className="w-full">x</OptionBouton>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('type', 'button');
    expect(btn.className.trim().endsWith('w-full')).toBe(true);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

const ONGLETS = [
  { id: 'titre', label: 'Titre', panneauId: 'p-titre' },
  { id: 'cartes', label: 'Cartes', panneauId: 'p-cartes' },
  { id: 'video', label: 'Vidéo', disabled: true },
  { id: 'cta', label: 'CTA' },
];

function Groupe({ initial = 'titre', onChange }: { initial?: string; onChange?: (id: string) => void }) {
  const [actif, setActif] = useState(initial);
  return (
    <Onglets
      label="Séquences"
      onglets={ONGLETS}
      actif={actif}
      onChange={(id) => { setActif(id); onChange?.(id); }}
    />
  );
}

describe('Onglets', () => {
  it('rôles ARIA, aria-selected, aria-controls et un seul onglet tabulable', () => {
    render(<Groupe />);
    expect(screen.getByRole('tablist', { name: 'Séquences' })).toBeInTheDocument();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[0]).toHaveAttribute('aria-controls', 'p-titre');
    expect(tabs[0]).toHaveAttribute('tabindex', '0');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[1]).toHaveAttribute('tabindex', '-1');
    expect(tabs[2]).toBeDisabled();
  });

  it('l’onglet actif porte le fond violet doux ET la barre ; les autres ni l’un ni l’autre', () => {
    render(<Groupe />);
    const [titre, cartes] = screen.getAllByRole('tab');
    for (const t of SELECTION_TOKENS) expect(titre.className).toContain(t);
    expect(titre.querySelector('[data-barre="visible"]')).toHaveClass('opacity-100');
    expect(cartes.className).not.toContain('ring-purple-500');
    expect(cartes.querySelector('[data-barre="masquee"]')).toHaveClass('opacity-0');
    // Survol / focus / appui présents sur tous.
    for (const t of [titre, cartes]) {
      expect(t.className).toMatch(/\bhover:/);
      expect(t.className).toContain('focus-visible:ring-2');
      expect(t.className).toContain('active:scale-[0.98]');
    }
  });

  it('le clic sélectionne durablement', () => {
    const onChange = vi.fn();
    render(<Groupe onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Cartes' }));
    expect(onChange).toHaveBeenCalledWith('cartes');
    expect(screen.getByRole('tab', { name: 'Cartes' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Titre' })).toHaveAttribute('aria-selected', 'false');
    fireEvent.blur(screen.getByRole('tab', { name: 'Cartes' }));
    expect(screen.getByRole('tab', { name: 'Cartes' })).toHaveAttribute('aria-selected', 'true');
  });

  it('← / → naviguent en sautant les onglets désactivés, en boucle ; Début/Fin vont aux extrémités', () => {
    render(<Groupe />);
    const tab = (n: string) => screen.getByRole('tab', { name: n });
    tab('Titre').focus();
    fireEvent.keyDown(tab('Titre'), { key: 'ArrowRight' });
    expect(tab('Cartes')).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(tab('Cartes'));
    // « Vidéo » est désactivé : sauté.
    fireEvent.keyDown(tab('Cartes'), { key: 'ArrowRight' });
    expect(tab('CTA')).toHaveAttribute('aria-selected', 'true');
    // Boucle vers le début.
    fireEvent.keyDown(tab('CTA'), { key: 'ArrowRight' });
    expect(tab('Titre')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tab('Titre'), { key: 'ArrowLeft' });
    expect(tab('CTA')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tab('CTA'), { key: 'Home' });
    expect(tab('Titre')).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tab('Titre'), { key: 'End' });
    expect(tab('CTA')).toHaveAttribute('aria-selected', 'true');
  });
});
