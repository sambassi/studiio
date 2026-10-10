import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * CARTES — l'ordre change, la voix ne suit plus : on le DIT dans la liste des
 * cartes, avant le rendu, avec « Régénérer la voix » (même action que le
 * panneau des voix). Rien n'est régénéré sans clic.
 */
import { etatVoixCartes, morceauxCartes, texteDesMorceaux } from '../lib/creer/synchro-cartes';
import CartesEditeur from '../components/creer/CartesEditeur';

const carte = (id: string, title: string, description = '', value = '') => ({ id, icon: 'Heart', title, description, value });
const A = carte('a', 'RISQUE RÉDUIT', 'De moitié', '50 %');
const B = carte('b', 'RÉACTION COMPLÈTE', 'En 3 semaines');
const C = carte('c', 'FEMME', 'Plus concernée');
const voixPour = (cartes: typeof A[]) => ({ audioUrl: 'https://x/voix.mp3', textAtGeneration: texteDesMorceaux(morceauxCartes(cartes)) });

describe('etatVoixCartes', () => {
  it('même ordre → ok ; pas de voix → ok', () => {
    expect(etatVoixCartes([A, B, C], voixPour([A, B, C]))).toBe('ok');
    expect(etatVoixCartes([A, B, C], null)).toBe('ok');
    expect(etatVoixCartes([A, B, C], { audioUrl: null, textAtGeneration: 'x' })).toBe('ok');
  });
  it('⚠️ mêmes cartes, ordre changé (regroupement / ↑↓) → ordre', () => {
    expect(etatVoixCartes([C, A, B], voixPour([A, B, C]))).toBe('ordre');
    expect(etatVoixCartes([A, C, B], voixPour([A, B, C]))).toBe('ordre');
  });
  it('texte retouché → texte', () => {
    expect(etatVoixCartes([A, B, carte('c', 'HOMME', 'Plus concerné')], voixPour([A, B, C]))).toBe('texte');
  });
});

describe('Liste des cartes — alerte et régénération directe', () => {
  afterEach(cleanup);
  const base = { cards: [A, B, C], onChange: () => {} } as const;

  it('⚠️ ordre changé : message clair + bouton « Régénérer la voix » qui déclenche l’action', () => {
    const regenerer = vi.fn();
    const { container } = render(<CartesEditeur {...base} voixPerimee={{ motif: 'ordre', onRegenerer: regenerer }} />);
    const alerte = container.querySelector('[data-cartes-voix-perimee="ordre"]')!;
    expect(alerte.textContent).toContain('L’ordre des cartes a changé. Régénérez la voix des cartes pour conserver la synchronisation.');
    fireEvent.click(container.querySelector('[data-cartes-regenerer-voix]')!);
    expect(regenerer).toHaveBeenCalledTimes(1);
  });

  it('voix à jour : aucune alerte', () => {
    const { container } = render(<CartesEditeur {...base} voixPerimee={null} />);
    expect(container.querySelector('[data-cartes-voix-perimee]')).toBeNull();
  });

  it('⚠️ câblage : l’éditeur calcule l’état et transmet la demande au panneau des voix (même action « Régénérer »)', () => {
    const wizard = readFileSync(resolve(__dirname, '../app/dashboard/creer/AssistantWizard.tsx'), 'utf-8');
    expect(wizard).toContain('etatVoixCartes(generated?.cards ?? [], sequenceVoices.cartes)');
    expect(wizard).toContain('demandeRegeneration={demandeRegenVoix}');
    const panneau = readFileSync(resolve(__dirname, '../components/creer/SequenceVoicesPanel.tsx'), 'utf-8');
    expect(panneau).toContain('void generateTts(demandeRegeneration.key);');
  });
});
